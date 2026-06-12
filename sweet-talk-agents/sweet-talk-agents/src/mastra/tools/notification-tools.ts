import { createTool } from '@mastra/core/tools';
import { z } from 'zod';
import { supabase } from '../lib/supabase';
import { callAgent } from '../lib/agent-call';

/**
 * All users who have at least one reminder time configured, plus their
 * glucose unit (for message formatting).
 */
export const getUserRemindersTool = createTool({
  id: 'get-user-reminders',
  description: 'Retrieve all users with active reminder schedules (non-empty reminder_times).',
  inputSchema: z.object({}),
  outputSchema: z.object({
    users: z.array(
      z.object({
        userId: z.string(),
        name: z.string().nullable(),
        reminderTimes: z.array(z.string()),
        glucoseUnit: z.string(),
      }),
    ),
  }),
  execute: async () => {
    const { data, error } = await supabase
      .from('profiles')
      .select('user_id, name, reminder_times, glucose_unit')
      .not('reminder_times', 'eq', '{}');

    if (error) {
      throw new Error(`Failed to fetch user reminders: ${error.message}`);
    }

    const users = (data ?? [])
      .filter((row) => (row.reminder_times ?? []).length > 0)
      .map((row) => ({
        userId: row.user_id,
        name: row.name ?? null,
        reminderTimes: row.reminder_times ?? [],
        glucoseUnit: row.glucose_unit ?? 'mmol/L',
      }));

    return { users };
  },
});

/**
 * Check whether the user has a glucose log within a given time window
 * (used to suppress a reminder if they've already logged).
 */
export const getLogsForTimeWindowTool = createTool({
  id: 'get-logs-for-time-window',
  description: 'Check whether the user has a glucose log within a given time window (ISO timestamps).',
  inputSchema: z.object({
    userId: z.string().describe('The Supabase auth user id for the current user'),
    windowStart: z.string().describe('Start of the window as an ISO timestamp'),
    windowEnd: z.string().describe('End of the window as an ISO timestamp'),
  }),
  outputSchema: z.object({
    hasLog: z.boolean(),
    count: z.number().int(),
  }),
  execute: async ({ userId, windowStart, windowEnd }) => {
    const { data, error, count } = await supabase
      .from('glucose_logs')
      .select('id', { count: 'exact' })
      .eq('user_id', userId)
      .gte('logged_at', windowStart)
      .lte('logged_at', windowEnd);

    if (error) {
      throw new Error(`Failed to check logs for window: ${error.message}`);
    }

    return { hasLog: (count ?? data?.length ?? 0) > 0, count: count ?? data?.length ?? 0 };
  },
});

/**
 * Attempt to send a browser push notification.
 *
 * NOTE: This project has no push-notification infrastructure (service
 * worker / web push subscription) wired up yet, so this always reports
 * `sent: false`. The Notification Agent's instructions handle the
 * fallback by calling storeInAppNotificationTool when sent is false, per
 * the NOTIFICATION FALLBACK rule in the spec.
 */
export const sendPushNotificationTool = createTool({
  id: 'send-push-notification',
  description:
    "Attempt to send a browser push notification to the user. Currently always returns sent: false (no push infrastructure configured) — caller should fall back to storeInAppNotificationTool.",
  inputSchema: z.object({
    userId: z.string().describe('The Supabase auth user id for the current user'),
    message: z.string(),
  }),
  outputSchema: z.object({
    sent: z.boolean(),
    reason: z.string().nullable(),
  }),
  execute: async () => {
    return { sent: false, reason: 'Push notifications are not configured for this deployment yet' };
  },
});

/**
 * Save a notification to the notifications table for in-app display.
 */
export const storeInAppNotificationTool = createTool({
  id: 'store-in-app-notification',
  description: 'Save a notification to Supabase for in-app display.',
  inputSchema: z.object({
    userId: z.string().describe('The Supabase auth user id for the current user'),
    type: z.enum(['reminder', 'trend_alert', 'weekly_summary', 'caregiver_alert']),
    message: z.string(),
  }),
  outputSchema: z.object({
    notificationId: z.string(),
  }),
  execute: async ({ userId, type, message }) => {
    const { data, error } = await supabase
      .from('notifications')
      .insert({ user_id: userId, type, message })
      .select('id')
      .single();

    if (error) {
      throw new Error(`Failed to store notification: ${error.message}`);
    }

    return { notificationId: data.id };
  },
});

/**
 * Calculate the user's average glucose reading over the last N days
 * (default 7), for trend-alert comparisons.
 */
export const getRecentAverageTool = createTool({
  id: 'get-recent-average',
  description: "Calculate the user's average glucose reading over the last N days (default 7).",
  inputSchema: z.object({
    userId: z.string().describe('The Supabase auth user id for the current user'),
    days: z.number().int().positive().optional().describe('Number of days to average over (default 7)'),
  }),
  outputSchema: z.object({
    average: z.number().nullable(),
    count: z.number().int(),
    unit: z.string(),
  }),
  execute: async ({ userId, days }) => {
    const windowDays = days ?? 7;
    const since = new Date();
    since.setDate(since.getDate() - windowDays);

    const { data, error } = await supabase
      .from('glucose_logs')
      .select('glucose_value, glucose_unit')
      .eq('user_id', userId)
      .gte('logged_at', since.toISOString());

    if (error) {
      throw new Error(`Failed to fetch recent average: ${error.message}`);
    }

    const rows = data ?? [];
    if (rows.length === 0) {
      return { average: null, count: 0, unit: 'mmol/L' };
    }

    const sum = rows.reduce((acc, r) => acc + (r.glucose_value ?? 0), 0);
    const average = Math.round((sum / rows.length) * 10) / 10;

    return { average, count: rows.length, unit: rows[0]?.glucose_unit ?? 'mmol/L' };
  },
});

/**
 * Hand off to the Analysis Agent to produce the weekly summary narrative
 * for a user, covering the last 7 days of logs.
 */
export const triggerWeeklySummaryTool = createTool({
  id: 'trigger-weekly-summary',
  description:
    "Ask the Analysis Agent to produce a brief weekly check-in narrative for the user's last 7 days of logs. Returns the narrative text, or a note if there isn't enough data.",
  inputSchema: z.object({
    userId: z.string().describe('The Supabase auth user id for the current user'),
  }),
  outputSchema: z.object({
    summary: z.string(),
  }),
  execute: async ({ userId }, context) => {
    const summary = await callAgent(
      context.mastra,
      'analysis-agent',
      `userId: ${userId}\nProduce a brief weekly check-in summary covering the last 7 days (analysis period: last 7 days). Keep it short — overall trend, food pattern observations, notable spikes, time-of-day patterns. If there isn't at least 3 days of data, say so instead of analyzing.`,
    );

    return { summary };
  },
});

/**
 * Forward a weekly summary to the Caregiver Agent so it can email it to
 * the user's configured caregiver, if any. The Caregiver Agent itself
 * checks whether a caregiver is configured and handles the "none
 * configured" case.
 */
export const forwardSummaryToCaregiverTool = createTool({
  id: 'forward-summary-to-caregiver',
  description:
    "Forward a weekly summary to the Caregiver Agent so it can be emailed to the user's configured caregiver (if any). Returns the Caregiver Agent's response.",
  inputSchema: z.object({
    userId: z.string().describe('The Supabase auth user id for the current user'),
    summary: z.string().describe('The weekly summary narrative to forward'),
  }),
  outputSchema: z.object({
    response: z.string(),
  }),
  execute: async ({ userId, summary }, context) => {
    const response = await callAgent(
      context.mastra,
      'caregiver-agent',
      `userId: ${userId}\nA weekly summary has just been generated for this user. If a caregiver is configured, send it to them (you may use this weekly narrative in place of/alongside the usual daily summary). Weekly summary: ${summary}`,
    );

    return { response };
  },
});

/**
 * Write a failed scheduled-task error to error_logs.
 */
export const logErrorTool = createTool({
  id: 'log-error',
  description: 'Write a failed scheduled task error to the error_logs table.',
  inputSchema: z.object({
    taskName: z.string().describe('Name of the scheduled task that failed, e.g. "reminder_check"'),
    userId: z.string().nullable().optional().describe('The affected user, if applicable'),
    errorMessage: z.string(),
  }),
  outputSchema: z.object({
    logged: z.boolean(),
  }),
  execute: async ({ taskName, userId, errorMessage }) => {
    const { error } = await supabase.from('error_logs').insert({
      task_name: taskName,
      user_id: userId ?? null,
      error_message: errorMessage,
    });

    if (error) {
      // If we can't even log the error, there's nothing more to do here.
      return { logged: false };
    }

    return { logged: true };
  },
});
