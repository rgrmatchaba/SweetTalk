import { createTool } from '@mastra/core/tools';
import { z } from 'zod';
import { supabase } from '../lib/supabase';

/**
 * Tools used by more than one agent. Keeping these in one place avoids
 * duplicating Supabase queries across agent-specific tool files.
 */

// ---------------------------------------------------------------------------
// Profile
// ---------------------------------------------------------------------------

/**
 * Check whether a profile exists for this user and whether they've
 * completed onboarding. Every Supabase user gets an empty profile row
 * automatically on signup (via a DB trigger), so "exists" will almost
 * always be true — the important field is `onboarded`.
 */
export const getUserProfileTool = createTool({
  id: 'get-user-profile',
  description:
    "Check whether a profile exists for the current user and whether they've completed onboarding.",
  inputSchema: z.object({
    userId: z.string().describe('The Supabase auth user id for the current user'),
  }),
  outputSchema: z.object({
    exists: z.boolean(),
    onboarded: z.boolean(),
    profile: z.record(z.string(), z.any()).nullable(),
  }),
  execute: async ({ userId }) => {
    const { data, error } = await supabase
      .from('profiles')
      .select('*')
      .eq('user_id', userId)
      .maybeSingle();

    if (error) {
      throw new Error(`Failed to fetch profile: ${error.message}`);
    }

    return {
      exists: !!data,
      onboarded: !!data?.onboarded,
      profile: data ?? null,
    };
  },
});

/**
 * Retrieve the user's glucose unit and reminder times — needed by the
 * Extraction Agent to label readings correctly and compute the grace
 * period (on_time vs late_entry) when saving.
 */
export const getScheduledRemindersTool = createTool({
  id: 'get-scheduled-reminders',
  description:
    "Retrieve the user's glucose unit preference and reminder times, used for labelling readings and grace-period calculations.",
  inputSchema: z.object({
    userId: z.string().describe('The Supabase auth user id for the current user'),
  }),
  outputSchema: z.object({
    glucoseUnit: z.string(),
    reminderTimes: z.array(z.string()).describe('Reminder times as "HH:MM" strings'),
  }),
  execute: async ({ userId }) => {
    const { data, error } = await supabase
      .from('profiles')
      .select('glucose_unit, reminder_times')
      .eq('user_id', userId)
      .maybeSingle();

    if (error) {
      throw new Error(`Failed to fetch reminder schedule: ${error.message}`);
    }

    return {
      glucoseUnit: data?.glucose_unit ?? 'mmol/L',
      reminderTimes: data?.reminder_times ?? [],
    };
  },
});

// ---------------------------------------------------------------------------
// Active log / chat session
// ---------------------------------------------------------------------------

/**
 * Check if the user has an incomplete logging session in progress for
 * today (e.g. mid-way through the multi-reading flow).
 */
export const getActiveLogTool = createTool({
  id: 'get-active-log',
  description:
    'Check whether the user has an incomplete logging session in progress for today.',
  inputSchema: z.object({
    userId: z.string().describe('The Supabase auth user id for the current user'),
  }),
  outputSchema: z.object({
    hasActiveLog: z.boolean(),
    flowStep: z.string().nullable(),
    pendingLog: z.record(z.string(), z.any()).nullable(),
  }),
  execute: async ({ userId }) => {
    const today = new Date().toISOString().slice(0, 10);

    const { data, error } = await supabase
      .from('chat_sessions')
      .select('flow_step, pending_log')
      .eq('user_id', userId)
      .eq('session_date', today)
      .maybeSingle();

    if (error) {
      throw new Error(`Failed to fetch active session: ${error.message}`);
    }

    const flowStep = data?.flow_step ?? null;
    const hasActiveLog = flowStep !== null && flowStep !== 'qa';

    return {
      hasActiveLog,
      flowStep,
      pendingLog: data?.pending_log ?? null,
    };
  },
});

/**
 * Get today's chat session for the user, creating an empty one if it
 * doesn't exist yet. Used to maintain conversation context (flow_step,
 * pending_log) and as the parent row for chat_messages.
 */
export const getChatSessionTool = createTool({
  id: 'get-chat-session',
  description:
    "Retrieve (or create) today's chat session for the user, including its flow_step and pending_log, to maintain context across messages.",
  inputSchema: z.object({
    userId: z.string().describe('The Supabase auth user id for the current user'),
  }),
  outputSchema: z.object({
    sessionId: z.string(),
    flowStep: z.string().nullable(),
    pendingLog: z.record(z.string(), z.any()).nullable(),
  }),
  execute: async ({ userId }) => {
    const session = await getOrCreateChatSession(userId);
    return {
      sessionId: session.id,
      flowStep: session.flow_step ?? null,
      pendingLog: session.pending_log ?? null,
    };
  },
});

/**
 * Save a chat message (from the bot or the user) to chat_messages,
 * attached to today's chat session.
 */
export const saveChatMessageTool = createTool({
  id: 'save-chat-message',
  description: "Write a bot or user message to today's chat session history.",
  inputSchema: z.object({
    userId: z.string().describe('The Supabase auth user id for the current user'),
    role: z.enum(['bot', 'user']),
    content: z.string(),
  }),
  outputSchema: z.object({
    messageId: z.string(),
  }),
  execute: async ({ userId, role, content }) => {
    const session = await getOrCreateChatSession(userId);

    const { data, error } = await supabase
      .from('chat_messages')
      .insert({
        session_id: session.id,
        role,
        content,
      })
      .select('id')
      .single();

    if (error) {
      throw new Error(`Failed to save chat message: ${error.message}`);
    }

    return { messageId: data.id };
  },
});

/**
 * Shared helper: get today's chat_sessions row for a user, creating an
 * empty one if it doesn't exist yet.
 */
export async function getOrCreateChatSession(userId: string) {
  const today = new Date().toISOString().slice(0, 10);

  const { data: existing, error: fetchError } = await supabase
    .from('chat_sessions')
    .select('*')
    .eq('user_id', userId)
    .eq('session_date', today)
    .maybeSingle();

  if (fetchError) {
    throw new Error(`Failed to fetch chat session: ${fetchError.message}`);
  }

  if (existing) {
    return existing;
  }

  const { data: created, error: createError } = await supabase
    .from('chat_sessions')
    .insert({ user_id: userId, session_date: today })
    .select('*')
    .single();

  if (createError) {
    throw new Error(`Failed to create chat session: ${createError.message}`);
  }

  return created;
}

/**
 * Update the flow_step and/or pending_log on today's chat session.
 * Used by the Validation + Confirmation Agent to persist progress
 * across messages (e.g. "Entry 1 done, asking about Entry 2").
 */
export const updateChatSessionTool = createTool({
  id: 'update-chat-session',
  description:
    "Update today's chat session with the current flow_step and/or pending_log, to persist progress across messages.",
  inputSchema: z.object({
    userId: z.string().describe('The Supabase auth user id for the current user'),
    flowStep: z
      .enum(['glucose', 'foods', 'snacks', 'comments', 'timing_confirm', 'confirming', 'qa'])
      .nullable()
      .optional(),
    pendingLog: z.record(z.string(), z.any()).nullable().optional(),
  }),
  outputSchema: z.object({
    sessionId: z.string(),
  }),
  execute: async ({ userId, flowStep, pendingLog }) => {
    const session = await getOrCreateChatSession(userId);

    const updates: Record<string, unknown> = {};
    if (flowStep !== undefined) updates.flow_step = flowStep;
    if (pendingLog !== undefined) updates.pending_log = pendingLog;

    const { error } = await supabase.from('chat_sessions').update(updates).eq('id', session.id);

    if (error) {
      throw new Error(`Failed to update chat session: ${error.message}`);
    }

    return { sessionId: session.id };
  },
});
