import { createTool } from '@mastra/core/tools';
import { z } from 'zod';
import { supabase } from '../lib/supabase';

// getUserProfileTool is needed so the Q&A Agent can retrieve the user's
// glucose unit preference for display. Re-exported from the shared file.
export { getUserProfileTool } from './shared-tools';

const dateRangeInput = z.object({
  userId: z.string().describe('The Supabase auth user id for the current user'),
  startDate: z.string().describe('Start of the period as an ISO date string (e.g. "2025-06-01")'),
  endDate: z.string().describe('End of the period as an ISO date string (e.g. "2025-06-07")'),
});

/**
 * AVG(glucose_value) for a given date range.
 */
export const getAverageReadingTool = createTool({
  id: 'get-average-reading',
  description:
    'Calculate the average glucose reading for a given date range. Returns the average value, count of readings, and the glucose unit.',
  inputSchema: dateRangeInput,
  outputSchema: z.object({
    average: z.number().nullable(),
    count: z.number(),
    unit: z.string(),
  }),
  execute: async ({ userId, startDate, endDate }) => {
    const [logsResult, profileResult] = await Promise.all([
      supabase
        .from('glucose_logs')
        .select('glucose_value, glucose_unit')
        .eq('user_id', userId)
        .gte('logged_at', `${startDate}T00:00:00`)
        .lte('logged_at', `${endDate}T23:59:59`),
      supabase
        .from('profiles')
        .select('glucose_unit')
        .eq('user_id', userId)
        .maybeSingle(),
    ]);

    if (logsResult.error) {
      throw new Error(`Failed to fetch readings: ${logsResult.error.message}`);
    }

    const rows = logsResult.data ?? [];
    const unit = profileResult.data?.glucose_unit ?? rows[0]?.glucose_unit ?? 'mmol/L';

    if (rows.length === 0) {
      return { average: null, count: 0, unit };
    }

    const sum = rows.reduce((acc, r) => acc + (r.glucose_value ?? 0), 0);
    const average = Math.round((sum / rows.length) * 10) / 10;

    return { average, count: rows.length, unit };
  },
});

/**
 * Most recent glucose_log entry for the user.
 */
export const getLastReadingTool = createTool({
  id: 'get-last-reading',
  description:
    "Retrieve the user's most recent glucose log entry, including the value, unit, time, and foods eaten.",
  inputSchema: z.object({
    userId: z.string().describe('The Supabase auth user id for the current user'),
  }),
  outputSchema: z.object({
    glucose_value: z.number().nullable(),
    glucose_unit: z.string().nullable(),
    logged_at: z.string().nullable(),
    foods_eaten: z.string().nullable(),
  }),
  execute: async ({ userId }) => {
    const { data, error } = await supabase
      .from('glucose_logs')
      .select('glucose_value, glucose_unit, logged_at, foods_eaten')
      .eq('user_id', userId)
      .order('logged_at', { ascending: false })
      .limit(1)
      .maybeSingle();

    if (error) {
      throw new Error(`Failed to fetch last reading: ${error.message}`);
    }

    return {
      glucose_value: data?.glucose_value ?? null,
      glucose_unit: data?.glucose_unit ?? null,
      logged_at: data?.logged_at ?? null,
      foods_eaten: data?.foods_eaten ?? null,
    };
  },
});

/**
 * Count of log entries for a given date range.
 */
export const getReadingCountTool = createTool({
  id: 'get-reading-count',
  description: 'Count the number of glucose log entries within a given date range.',
  inputSchema: dateRangeInput,
  outputSchema: z.object({
    count: z.number(),
  }),
  execute: async ({ userId, startDate, endDate }) => {
    const { count, error } = await supabase
      .from('glucose_logs')
      .select('id', { count: 'exact', head: true })
      .eq('user_id', userId)
      .gte('logged_at', `${startDate}T00:00:00`)
      .lte('logged_at', `${endDate}T23:59:59`);

    if (error) {
      throw new Error(`Failed to count readings: ${error.message}`);
    }

    return { count: count ?? 0 };
  },
});

/**
 * MAX(glucose_value) for a given date range.
 */
export const getHighestReadingTool = createTool({
  id: 'get-highest-reading',
  description: 'Find the highest glucose reading within a given date range.',
  inputSchema: dateRangeInput,
  outputSchema: z.object({
    glucose_value: z.number().nullable(),
    glucose_unit: z.string().nullable(),
    logged_at: z.string().nullable(),
  }),
  execute: async ({ userId, startDate, endDate }) => {
    const { data, error } = await supabase
      .from('glucose_logs')
      .select('glucose_value, glucose_unit, logged_at')
      .eq('user_id', userId)
      .gte('logged_at', `${startDate}T00:00:00`)
      .lte('logged_at', `${endDate}T23:59:59`)
      .order('glucose_value', { ascending: false })
      .limit(1)
      .maybeSingle();

    if (error) {
      throw new Error(`Failed to fetch highest reading: ${error.message}`);
    }

    return {
      glucose_value: data?.glucose_value ?? null,
      glucose_unit: data?.glucose_unit ?? null,
      logged_at: data?.logged_at ?? null,
    };
  },
});

/**
 * MIN(glucose_value) for a given date range.
 */
export const getLowestReadingTool = createTool({
  id: 'get-lowest-reading',
  description: 'Find the lowest glucose reading within a given date range.',
  inputSchema: dateRangeInput,
  outputSchema: z.object({
    glucose_value: z.number().nullable(),
    glucose_unit: z.string().nullable(),
    logged_at: z.string().nullable(),
  }),
  execute: async ({ userId, startDate, endDate }) => {
    const { data, error } = await supabase
      .from('glucose_logs')
      .select('glucose_value, glucose_unit, logged_at')
      .eq('user_id', userId)
      .gte('logged_at', `${startDate}T00:00:00`)
      .lte('logged_at', `${endDate}T23:59:59`)
      .order('glucose_value', { ascending: true })
      .limit(1)
      .maybeSingle();

    if (error) {
      throw new Error(`Failed to fetch lowest reading: ${error.message}`);
    }

    return {
      glucose_value: data?.glucose_value ?? null,
      glucose_unit: data?.glucose_unit ?? null,
      logged_at: data?.logged_at ?? null,
    };
  },
});

/**
 * All readings for a specific calendar date.
 */
export const getReadingsByDateTool = createTool({
  id: 'get-readings-by-date',
  description:
    'Retrieve all glucose log entries for a specific calendar date (YYYY-MM-DD). Returns an array of readings sorted chronologically.',
  inputSchema: z.object({
    userId: z.string().describe('The Supabase auth user id for the current user'),
    date: z.string().describe('The calendar date to query, formatted as YYYY-MM-DD'),
  }),
  outputSchema: z.object({
    readings: z.array(
      z.object({
        glucose_value: z.number(),
        glucose_unit: z.string(),
        logged_at: z.string(),
        foods_eaten: z.string().nullable(),
        comments: z.string().nullable(),
      }),
    ),
    count: z.number(),
  }),
  execute: async ({ userId, date }) => {
    const { data, error } = await supabase
      .from('glucose_logs')
      .select('glucose_value, glucose_unit, logged_at, foods_eaten, comments')
      .eq('user_id', userId)
      .gte('logged_at', `${date}T00:00:00`)
      .lte('logged_at', `${date}T23:59:59`)
      .order('logged_at', { ascending: true });

    if (error) {
      throw new Error(`Failed to fetch readings for date: ${error.message}`);
    }

    const readings = (data ?? []).map((r) => ({
      glucose_value: r.glucose_value,
      glucose_unit: r.glucose_unit,
      logged_at: r.logged_at,
      foods_eaten: r.foods_eaten ?? null,
      comments: r.comments ?? null,
    }));

    return { readings, count: readings.length };
  },
});
