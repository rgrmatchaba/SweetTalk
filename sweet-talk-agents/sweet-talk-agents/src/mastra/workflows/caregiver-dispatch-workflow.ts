import { createStep, createWorkflow } from '@mastra/core/workflows';
import { z } from 'zod';
import { supabase } from '../lib/supabase';

/**
 * Single step: find every user whose caregiver_summary_time falls in the
 * current UTC hour and ask the Caregiver Agent to send their daily summary.
 *
 * Profile rows are included only when caregiver_email is non-null.  The hour
 * comparison is intentionally loose (HH:xx matches the whole hour) so the
 * workflow fires once per hour and naturally covers all users configured for
 * that hour, regardless of the exact minute they entered.
 */
const dispatchCaregiverSummariesStep = createStep({
  id: 'dispatch-caregiver-summaries',
  description:
    'Find users due for a caregiver summary this hour and invoke the Caregiver Agent for each.',
  inputSchema: z.object({}),
  outputSchema: z.object({
    dispatched: z.number().int(),
    skipped: z.number().int(),
    errors: z.array(z.string()),
  }),
  execute: async ({ mastra }) => {
    const now = new Date();
    const currentHour = String(now.getHours()).padStart(2, '0');

    // Fetch all profiles that have a caregiver email configured.
    const { data: profiles, error } = await supabase
      .from('profiles')
      .select('user_id, name, caregiver_summary_time')
      .not('caregiver_email', 'is', null);

    if (error) {
      throw new Error(`Failed to load profiles: ${error.message}`);
    }

    const due = (profiles ?? []).filter((p) => {
      const summaryHour = (p.caregiver_summary_time ?? '21:00').slice(0, 2);
      return summaryHour === currentHour;
    });

    const agent = mastra?.getAgentById('caregiver-agent');
    if (!agent) {
      throw new Error('caregiver-agent is not registered in this Mastra instance');
    }

    let dispatched = 0;
    let skipped = 0;
    const errors: string[] = [];
    const today = now.toISOString().slice(0, 10);

    for (const profile of due) {
      const userId = profile.user_id;
      try {
        await agent.generate(
          `userId: ${userId}\nIt's time to send today's daily summary to this user's caregiver. Please proceed.`,
          {
            memory: {
              thread: `caregiver-summary-${userId}-${today}`,
              resource: userId,
            },
          },
        );
        dispatched++;
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        errors.push(`${userId}: ${message}`);
        skipped++;
      }
    }

    return { dispatched, skipped, errors };
  },
});

/**
 * Hourly cron workflow — fires at minute 0 of every UTC hour.
 *
 * Mastra's built-in scheduler reads this `schedule` declaration and
 * automatically triggers the workflow while the Mastra server is running.
 * No external cron daemon is required.
 *
 * The `send-caregiver-summaries` npm script (scripts/send-caregiver-summaries.mjs)
 * remains as a manual escape hatch for local testing or one-off backfills.
 */
export const caregiverDispatchWorkflow = createWorkflow({
  id: 'caregiver-dispatch',
  inputSchema: z.object({}),
  outputSchema: z.object({
    dispatched: z.number().int(),
    skipped: z.number().int(),
    errors: z.array(z.string()),
  }),
  schedule: {
    cron: '0 * * * *',
    timezone: 'Africa/Harare',
  },
})
  .then(dispatchCaregiverSummariesStep);

caregiverDispatchWorkflow.commit();
