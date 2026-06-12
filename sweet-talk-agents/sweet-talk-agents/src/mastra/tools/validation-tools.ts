import { createTool } from '@mastra/core/tools';
import { z } from 'zod';
import { supabase } from '../lib/supabase';
import { callAgent } from '../lib/agent-call';
import { entrySchema, REQUIRED_ENTRY_FIELDS, type Entry } from './entry-schema';

// Re-export the session tools this agent needs — they live in shared-tools.ts
// since other agents use them too.
export { getChatSessionTool, saveChatMessageTool, updateChatSessionTool } from './shared-tools';

/**
 * Check a list of entry objects for missing required fields. Pure logic,
 * no Supabase — used to drive the "ask for missing fields, one entry at
 * a time" flow.
 */
export const validateEntriesTool = createTool({
  id: 'validate-entries',
  description:
    'Check entry objects (from the Extraction Agent) for missing required fields. Returns which fields are missing per entry, in order.',
  inputSchema: z.object({
    entries: z.array(entrySchema),
  }),
  outputSchema: z.object({
    allComplete: z.boolean(),
    results: z.array(
      z.object({
        index: z.number().int(),
        isComplete: z.boolean(),
        missingFields: z.array(z.string()),
      }),
    ),
  }),
  execute: async ({ entries }: { entries: Entry[] }) => {
    const results = entries.map((entry, index) => {
      const missingFields = REQUIRED_ENTRY_FIELDS.filter((field) => {
        const value = entry[field];
        return value === null || value === undefined || value === '';
      });

      return {
        index,
        isComplete: missingFields.length === 0,
        missingFields: [...missingFields],
      };
    });

    return {
      allComplete: results.every((r: { isComplete: boolean }) => r.isComplete),
      results,
    };
  },
});

/**
 * Hand off confirmed entries to the Extraction + Logging Agent to actually
 * save them (it owns saveGlucoseLogTool and the grace-period logic).
 */
export const triggerSaveTool = createTool({
  id: 'trigger-save',
  description:
    'Ask the Extraction + Logging Agent to save one or more confirmed entries after the user has confirmed the confirmation card.',
  inputSchema: z.object({
    userId: z.string().describe('The Supabase auth user id for the current user'),
    entries: z.array(
      entrySchema.extend({
        glucose_value: z.number(),
        foods_eaten: z.string(),
        comments: z.string(),
        logged_at: z.string(),
      }),
    ),
  }),
  outputSchema: z.object({
    result: z.string(),
  }),
  execute: async (
    {
      userId,
      entries,
    }: {
      userId: string;
      entries: Array<Entry & { glucose_value: number; foods_eaten: string; comments: string; logged_at: string }>;
    },
    context,
  ) => {
    const result = await callAgent(
      context.mastra,
      'extraction-logging-agent',
      `userId: ${userId}\nThe user has confirmed the following entries — save each of them now using saveGlucoseLogTool (computing entry_tag via getScheduledRemindersTool and the grace period rule). Confirmed entries (JSON): ${JSON.stringify(entries)}`,
    );

    return { result };
  },
});

/**
 * Hand off an already-saved entry's correction to the Extraction + Logging
 * Agent to actually update it.
 */
export const triggerUpdateTool = createTool({
  id: 'trigger-update',
  description: "Ask the Extraction + Logging Agent to update an already-saved glucose_logs row after the user confirms they'd like to change it.",
  inputSchema: z.object({
    userId: z.string().describe('The Supabase auth user id for the current user'),
    logId: z.string().describe('The id of the glucose_logs row to update'),
    glucose_value: z.number().optional(),
    foods_eaten: z.string().optional(),
    snacks: z.string().optional(),
    comments: z.string().optional(),
    logged_at: z.string().optional(),
  }),
  outputSchema: z.object({
    result: z.string(),
  }),
  execute: async ({ userId, logId, ...fields }, context) => {
    const updates = Object.fromEntries(Object.entries(fields).filter(([, v]) => v !== undefined));

    if (Object.keys(updates).length === 0) {
      throw new Error('No fields provided to update');
    }

    const result = await callAgent(
      context.mastra,
      'extraction-logging-agent',
      `userId: ${userId}\nThe user has confirmed a correction to an already-saved entry. Update logId ${logId} using updateGlucoseLogTool (recomputing entry_tag if logged_at or glucose_value changed). Changed fields (JSON): ${JSON.stringify(updates)}`,
    );

    return { result };
  },
});
