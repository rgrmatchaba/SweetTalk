import { createTool } from '@mastra/core/tools';
import { z } from 'zod';
import { supabase } from '../lib/supabase';

/**
 * Fetch all glucose_logs for a user within a date range, plus how many
 * distinct calendar days are covered (used for the "need at least 3 days"
 * check) and the user's glucose unit.
 */
export const getLogsForPeriodTool = createTool({
  id: 'get-logs-for-period',
  description:
    'Fetch all glucose logs for a user within a date range, for pattern analysis. Returns the logs, the glucose unit, and how many distinct days are covered.',
  inputSchema: z.object({
    userId: z.string().describe('The Supabase auth user id for the current user'),
    startDate: z.string().describe('Start of the period as an ISO date string (e.g. "2025-06-01")'),
    endDate: z.string().describe('End of the period as an ISO date string (e.g. "2025-06-07")'),
  }),
  outputSchema: z.object({
    logs: z.array(
      z.object({
        glucose_value: z.number(),
        glucose_unit: z.string(),
        foods_eaten: z.string().nullable(),
        snacks: z.string().nullable(),
        comments: z.string().nullable(),
        logged_at: z.string(),
        entry_tag: z.string(),
      }),
    ),
    daysCovered: z.number().int(),
    glucoseUnit: z.string(),
  }),
  execute: async ({ userId, startDate, endDate }) => {
    const [logsResult, profileResult] = await Promise.all([
      supabase
        .from('glucose_logs')
        .select('glucose_value, glucose_unit, foods_eaten, snacks, comments, logged_at, entry_tag')
        .eq('user_id', userId)
        .gte('logged_at', `${startDate}T00:00:00`)
        .lte('logged_at', `${endDate}T23:59:59`)
        .order('logged_at', { ascending: true }),
      supabase.from('profiles').select('glucose_unit').eq('user_id', userId).maybeSingle(),
    ]);

    if (logsResult.error) {
      throw new Error(`Failed to fetch logs for period: ${logsResult.error.message}`);
    }

    const logs = logsResult.data ?? [];
    const distinctDays = new Set(logs.map((row) => row.logged_at.slice(0, 10)));
    const glucoseUnit = profileResult.data?.glucose_unit ?? logs[0]?.glucose_unit ?? 'mmol/L';

    return {
      logs,
      daysCovered: distinctDays.size,
      glucoseUnit,
    };
  },
});

/**
 * Apply the post-processing guardrail: strip any sentence that contains
 * clinical/prescriptive language and replace it with a standard
 * "discuss with your doctor" pointer.
 *
 * NOTE: The spec describes a separate "callClaudeAnalysis" step that sends
 * the structured log data to Claude with the analysis prompt. In this
 * Mastra setup, the Analysis Agent itself IS that Claude call — its
 * instructions contain the analysis prompt, and it writes the narrative
 * directly using the logs returned by getLogsForPeriodTool. This tool
 * covers the deterministic guardrail step that runs on the agent's draft
 * narrative before it's shown to the user.
 */
const BLOCKED_PHRASES = [
  'you should',
  'consult',
  'recommend',
  'prescribe',
  'increase your dose',
  'decrease your dose',
  'see a doctor',
  'medical advice',
];

export const formatAnalysisOutputTool = createTool({
  id: 'format-analysis-output',
  description:
    "Strip clinical/prescriptive language from a draft analysis narrative (sentences containing phrases like 'you should', 'consult', 'recommend', 'see a doctor') and replace them with a standard doctor-discussion pointer.",
  inputSchema: z.object({
    draftNarrative: z.string().describe('The draft narrative produced by the Analysis Agent'),
  }),
  outputSchema: z.object({
    narrative: z.string(),
    flaggedSentenceCount: z.number().int(),
  }),
  execute: async ({ draftNarrative }) => {
    // Split into sentences on '.', '!', '?' followed by whitespace/end, keeping it simple.
    const sentences = draftNarrative.split(/(?<=[.!?])\s+/);
    let flaggedSentenceCount = 0;

    const cleaned = sentences.map((sentence: string) => {
      const lower = sentence.toLowerCase();
      const isFlagged = BLOCKED_PHRASES.some((phrase) => lower.includes(phrase));
      if (isFlagged) {
        flaggedSentenceCount += 1;
        return '[Please discuss this with your doctor]';
      }
      return sentence;
    });

    return {
      narrative: cleaned.join(' '),
      flaggedSentenceCount,
    };
  },
});
