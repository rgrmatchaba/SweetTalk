import { createTool } from '@mastra/core/tools';
import { z } from 'zod';
import { supabase } from '../lib/supabase';
import { entrySchema } from './entry-schema';
import { getOrCreateChatSession } from './shared-tools';
import {
  buildCollectingResponse,
  executeConfirmCancel,
  executeConfirmSave,
  formatConfirmCardWithMarker,
  getMissingFields,
  isCancelMessage,
  isConfirmMessage,
  mergePendingEntry,
  persistSessionState,
} from '../lib/logging-orchestration';

// Re-export the profile tools this agent needs — they live in shared-tools.ts
// since other agents use them too.
export { getUserProfileTool, getScheduledRemindersTool } from './shared-tools';

/**
 * Write a confirmed entry to glucose_logs.
 *
 * NOTE: This performs the actual database write. The Extraction Agent's
 * instructions say "only write after confirmation from the Validation
 * Agent" — that confirmation happens in conversation before this tool is
 * called, so the rule is enforced by the agent's behaviour, not by this
 * tool itself.
 */
export const saveGlucoseLogTool = createTool({
  id: 'save-glucose-log',
  description:
    'Write one confirmed glucose log entry to Supabase. Only call this after the Validation + Confirmation Agent has shown the confirmation card and the user has confirmed.',
  inputSchema: z.object({
    userId: z.string().describe('The Supabase auth user id for the current user'),
    glucose_value: z.number(),
    glucose_unit: z.string(),
    foods_eaten: z.string(),
    snacks: z.string().default('none'),
    comments: z.string(),
    logged_at: z.string().describe('ISO timestamp'),
    entry_tag: z.enum(['on_time', 'late_entry']),
  }),
  outputSchema: z.object({
    id: z.string(),
    alert: z.enum(['low', 'high']).nullable().describe('Set when the reading breaches the user\'s safety thresholds'),
    threshold_value: z.number().nullable().describe('The threshold that was breached'),
  }),
  execute: async ({ userId, glucose_value, glucose_unit, foods_eaten, snacks, comments, logged_at, entry_tag }) => {
    const { data, error } = await supabase
      .from('glucose_logs')
      .insert({
        user_id: userId,
        glucose_value,
        glucose_unit,
        foods_eaten,
        snacks,
        comments,
        logged_at,
        entry_tag,
      })
      .select('id')
      .single();

    if (error) {
      throw new Error(`Failed to save glucose log: ${error.message}`);
    }

    // Fetch the user's safety thresholds to check if this reading is dangerous.
    const { data: profile } = await supabase
      .from('profiles')
      .select('low_glucose_threshold, high_glucose_threshold')
      .eq('user_id', userId)
      .maybeSingle();

    const defaultLow = glucose_unit === 'mg/dL' ? 70 : 3.9;
    const defaultHigh = glucose_unit === 'mg/dL' ? 180 : 10.0;
    const low = (profile as any)?.low_glucose_threshold ?? defaultLow;
    const high = (profile as any)?.high_glucose_threshold ?? defaultHigh;

    let alert: 'low' | 'high' | null = null;
    let threshold_value: number | null = null;

    if (glucose_value < low) {
      alert = 'low';
      threshold_value = low;
    } else if (glucose_value > high) {
      alert = 'high';
      threshold_value = high;
    }

    return { id: data.id, alert, threshold_value };
  },
});

/**
 * Hand extracted entries off to the Validation + Confirmation Agent, which
 * checks for missing fields, asks the user to fill them in, shows the
 * confirmation card, and (on confirmation) calls back into this agent to
 * actually save (see validation-tools.ts).
 */
export const handoffToValidationTool = createTool({
  id: 'handoff-to-validation',
  description:
    'Pass extracted entry objects (complete or incomplete) to the Validation + Confirmation Agent. Call this after extraction instead of asking the user anything yourself. Returns the Validation Agent\'s response (questions, confirmation card, or save confirmation) to relay to the user.',
  inputSchema: z.object({
    userId: z.string().describe('The Supabase auth user id for the current user'),
    entries: z.array(entrySchema).describe('Extracted entry objects, complete or incomplete'),
    message: z.string().optional().describe('The original user message, for context'),
  }),
  outputSchema: z.object({
    response: z.string(),
  }),
  execute: async ({ userId, entries, message }, context) => {
    const session = await getOrCreateChatSession(userId);
    const pendingLog: Record<string, unknown> = (session.pending_log as Record<string, unknown>) ?? {};
    const currentFlowStep: string | null = session.flow_step ?? null;
    const originalMessage = message ?? '';

    // Save / cancel during confirming — handled in code, not by the LLM
    if (currentFlowStep === 'confirming') {
      if (isConfirmMessage(originalMessage)) {
        const response = await executeConfirmSave(userId, pendingLog, context.mastra);
        return { response };
      }
      if (isCancelMessage(originalMessage)) {
        const response = await executeConfirmCancel(userId);
        return { response };
      }
      return { response: formatConfirmCardWithMarker(pendingLog) };
    }

    const newEntry: Record<string, unknown> = (entries[0] as Record<string, unknown>) ?? {};
    const merged = mergePendingEntry(pendingLog, newEntry, originalMessage);

    // Ensure glucose unit from profile when we have a value
    if (merged.glucose_value != null && !merged.glucose_unit) {
      const { data: profile } = await supabase
        .from('profiles')
        .select('glucose_unit')
        .eq('user_id', userId)
        .maybeSingle();
      merged.glucose_unit = profile?.glucose_unit ?? 'mmol/L';
    }

    const missingFields = getMissingFields(merged);
    const allComplete = missingFields.length === 0;

    await persistSessionState(userId, merged, allComplete);

    const response = buildCollectingResponse(merged, missingFields, allComplete);
    return { response };
  },
});

/**
 * Update an existing glucose log entry (for post-save corrections).
 * Only fields the caller provides are updated.
 */
export const updateGlucoseLogTool = createTool({
  id: 'update-glucose-log',
  description:
    "Update an existing glucose_logs row. Used when the user corrects a value after it's already been saved.",
  inputSchema: z.object({
    userId: z.string().describe('The Supabase auth user id for the current user — used to scope the update'),
    logId: z.string().describe('The id of the glucose_logs row to update'),
    glucose_value: z.number().optional(),
    foods_eaten: z.string().optional(),
    snacks: z.string().optional(),
    comments: z.string().optional(),
    logged_at: z.string().optional().describe('ISO timestamp'),
    entry_tag: z.enum(['on_time', 'late_entry']).optional(),
  }),
  outputSchema: z.object({
    id: z.string(),
  }),
  execute: async ({ userId, logId, ...fields }) => {
    const updates = Object.fromEntries(Object.entries(fields).filter(([, v]) => v !== undefined));

    if (Object.keys(updates).length === 0) {
      throw new Error('No fields provided to update');
    }

    const { data, error } = await supabase
      .from('glucose_logs')
      .update(updates)
      .eq('id', logId)
      .eq('user_id', userId)
      .select('id')
      .single();

    if (error) {
      throw new Error(`Failed to update glucose log: ${error.message}`);
    }

    return { id: data.id };
  },
});
