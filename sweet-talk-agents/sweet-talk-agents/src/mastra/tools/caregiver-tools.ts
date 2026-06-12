import { createTool } from '@mastra/core/tools';
import { z } from 'zod';
import { supabase } from '../lib/supabase';

/**
 * Retrieve the caregiver contact details (and the patient's own name) from
 * the user's profile.
 */
export const getCaregiverContactTool = createTool({
  id: 'get-caregiver-contact',
  description:
    "Retrieve the caregiver's name, email, phone, and configured summary time from the user's profile, along with the patient's name.",
  inputSchema: z.object({
    userId: z.string().describe('The Supabase auth user id for the current user'),
  }),
  outputSchema: z.object({
    hasCaregiver: z.boolean(),
    patientName: z.string().nullable(),
    caregiverName: z.string().nullable(),
    caregiverEmail: z.string().nullable(),
    caregiverPhone: z.string().nullable(),
    summaryTime: z.string(),
  }),
  execute: async ({ userId }) => {
    const { data, error } = await supabase
      .from('profiles')
      .select('name, caregiver_name, caregiver_email, caregiver_phone, caregiver_summary_time')
      .eq('user_id', userId)
      .maybeSingle();

    if (error) {
      throw new Error(`Failed to fetch caregiver contact: ${error.message}`);
    }

    return {
      hasCaregiver: !!data?.caregiver_email || !!data?.caregiver_phone,
      patientName: data?.name ?? null,
      caregiverName: data?.caregiver_name ?? null,
      caregiverEmail: data?.caregiver_email ?? null,
      caregiverPhone: data?.caregiver_phone ?? null,
      summaryTime: data?.caregiver_summary_time ?? '21:00',
    };
  },
});

/**
 * Build the data needed for today's daily summary: reading count, average,
 * highest/lowest with times, unique foods, comments, and on-time/late
 * entry counts.
 */
export const getDailySummaryDataTool = createTool({
  id: 'get-daily-summary-data',
  description: "Query today's glucose logs for a user and summarize them for the caregiver daily summary.",
  inputSchema: z.object({
    userId: z.string().describe('The Supabase auth user id for the current user'),
  }),
  outputSchema: z.object({
    date: z.string(),
    count: z.number().int(),
    unit: z.string(),
    average: z.number().nullable(),
    highest: z.object({ value: z.number(), time: z.string() }).nullable(),
    lowest: z.object({ value: z.number(), time: z.string() }).nullable(),
    foods: z.array(z.string()),
    comments: z.array(z.string()),
    onTimeCount: z.number().int(),
    lateCount: z.number().int(),
  }),
  execute: async ({ userId }) => {
    const today = new Date().toISOString().slice(0, 10);

    const { data, error } = await supabase
      .from('glucose_logs')
      .select('glucose_value, glucose_unit, foods_eaten, comments, logged_at, entry_tag')
      .eq('user_id', userId)
      .gte('logged_at', `${today}T00:00:00`)
      .lte('logged_at', `${today}T23:59:59`)
      .order('logged_at', { ascending: true });

    if (error) {
      throw new Error(`Failed to fetch daily summary data: ${error.message}`);
    }

    const rows = data ?? [];

    if (rows.length === 0) {
      return {
        date: today,
        count: 0,
        unit: 'mmol/L',
        average: null,
        highest: null,
        lowest: null,
        foods: [],
        comments: [],
        onTimeCount: 0,
        lateCount: 0,
      };
    }

    const unit = rows[0].glucose_unit ?? 'mmol/L';
    const sum = rows.reduce((acc, r) => acc + (r.glucose_value ?? 0), 0);
    const average = Math.round((sum / rows.length) * 10) / 10;

    const highestRow = rows.reduce((max, r) => (r.glucose_value > max.glucose_value ? r : max), rows[0]);
    const lowestRow = rows.reduce((min, r) => (r.glucose_value < min.glucose_value ? r : min), rows[0]);

    const foods = Array.from(
      new Set(
        rows
          .map((r) => r.foods_eaten)
          .filter((f): f is string => !!f && f.trim().length > 0)
          .flatMap((f) => f.split(',').map((item) => item.trim()))
          .filter((item) => item.length > 0),
      ),
    );

    const comments = rows
      .map((r) => r.comments)
      .filter((c): c is string => !!c && c.trim().length > 0);

    const onTimeCount = rows.filter((r) => r.entry_tag === 'on_time').length;
    const lateCount = rows.filter((r) => r.entry_tag === 'late_entry').length;

    return {
      date: today,
      count: rows.length,
      unit,
      average,
      highest: { value: highestRow.glucose_value, time: highestRow.logged_at },
      lowest: { value: lowestRow.glucose_value, time: lowestRow.logged_at },
      foods,
      comments,
      onTimeCount,
      lateCount,
    };
  },
});

/**
 * Send the daily summary email via Resend.
 *
 * Requires RESEND_API_KEY to be set. If it's not configured, returns
 * sent: false with a reason so the caller can log it as a failed attempt.
 */
export const sendEmailTool = createTool({
  id: 'send-email',
  description: "Send the caregiver daily summary via the Resend email API.",
  inputSchema: z.object({
    to: z.string().describe('Caregiver email address'),
    subject: z.string(),
    body: z.string().describe('Plain-text email body'),
  }),
  outputSchema: z.object({
    sent: z.boolean(),
    reason: z.string().nullable(),
  }),
  execute: async ({ to, subject, body }) => {
    const apiKey = process.env.RESEND_API_KEY;
    const fromAddress = process.env.RESEND_FROM_EMAIL ?? 'Sweet Talk <onboarding@resend.dev>';

    if (!apiKey) {
      return { sent: false, reason: 'RESEND_API_KEY is not configured' };
    }

    const response = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        from: fromAddress,
        to: [to],
        subject,
        text: body,
      }),
    });

    if (!response.ok) {
      const errorText = await response.text();
      return { sent: false, reason: `Resend API error (${response.status}): ${errorText}` };
    }

    return { sent: true, reason: null };
  },
});

/**
 * Log a caregiver summary send attempt to caregiver_send_log.
 */
export const logCaregiverSendTool = createTool({
  id: 'log-caregiver-send',
  description: 'Write a caregiver daily-summary send attempt and its status to caregiver_send_log.',
  inputSchema: z.object({
    userId: z.string().describe('The Supabase auth user id for the current user'),
    status: z.enum(['sent', 'failed', 'failed_permanent']),
    errorMessage: z.string().nullable().optional(),
  }),
  outputSchema: z.object({
    logId: z.string(),
  }),
  execute: async ({ userId, status, errorMessage }) => {
    const { data, error } = await supabase
      .from('caregiver_send_log')
      .insert({ user_id: userId, status, error_message: errorMessage ?? null })
      .select('id')
      .single();

    if (error) {
      throw new Error(`Failed to log caregiver send: ${error.message}`);
    }

    return { logId: data.id };
  },
});

/**
 * Notify the user in-app that the caregiver summary couldn't be delivered.
 */
export const sendInAppAlertTool = createTool({
  id: 'send-in-app-alert',
  description: 'Save an in-app alert for the user, e.g. when caregiver delivery fails permanently.',
  inputSchema: z.object({
    userId: z.string().describe('The Supabase auth user id for the current user'),
    message: z.string(),
  }),
  outputSchema: z.object({
    notificationId: z.string(),
  }),
  execute: async ({ userId, message }) => {
    const { data, error } = await supabase
      .from('notifications')
      .insert({ user_id: userId, type: 'caregiver_alert', message })
      .select('id')
      .single();

    if (error) {
      throw new Error(`Failed to send in-app alert: ${error.message}`);
    }

    return { notificationId: data.id };
  },
});
