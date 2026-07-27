import { createTool } from '@mastra/core/tools';
import { z } from 'zod';
import { supabase } from '../lib/supabase';
import { callAgent, callAgentPreferToolResponse } from '../lib/agent-call';
import { stripReasoningPreamble } from '../lib/strip-preamble';
import { getOrCreateChatSession } from './shared-tools';
import {
  executeConfirmCancel,
  executeConfirmSave,
  formatConfirmCardWithMarker,
  isCancelMessage,
  isConfirmMessage,
  truncateAgentMessage,
} from '../lib/logging-orchestration';

// getUserProfileTool and getActiveLogTool now live in shared-tools.ts since
// the Extraction and Validation agents need them too. Re-exported here so
// existing imports of gatekeeper-tools keep working.
export { getUserProfileTool, getActiveLogTool } from './shared-tools';

/**
 * Save onboarding details collected by the Gatekeeper to the profiles
 * table. A profile row already exists for every user (created on
 * signup), so this updates it and marks onboarded = true.
 */
export const createProfileTool = createTool({
  id: 'create-profile',
  description:
    'Save onboarding details (name, diabetes type, glucose unit, recording frequency, reminder times) to the profiles table and mark the user as onboarded. Call this once all onboarding questions have been answered.',
  inputSchema: z.object({
    userId: z.string().describe('The Supabase auth user id for the current user'),
    name: z.string().describe("The user's name"),
    diabetesType: z
      .string()
      .describe('e.g. "Type 1", "Type 2", "Gestational", "Prediabetes"'),
    glucoseUnit: z.enum(['mmol/L', 'mg/dL']),
    recordingFrequency: z
      .number()
      .int()
      .describe('How many times per day the user plans to log readings'),
    reminderTimes: z
      .array(z.string())
      .describe('Reminder times of day as strings, e.g. ["08:00", "13:00", "18:00"]'),
  }),
  outputSchema: z.object({
    profileId: z.string(),
  }),
  execute: async ({ userId, name, diabetesType, glucoseUnit, recordingFrequency, reminderTimes }) => {
    const { data, error } = await supabase
      .from('profiles')
      .update({
        name,
        diabetes_type: diabetesType,
        glucose_unit: glucoseUnit,
        recording_frequency: recordingFrequency,
        reminder_times: reminderTimes,
        onboarded: true,
        updated_at: new Date().toISOString(),
      })
      .eq('user_id', userId)
      .select('id')
      .single();

    if (error) {
      throw new Error(`Failed to save profile: ${error.message}`);
    }

    return { profileId: data.id };
  },
});

/**
 * Save one medication entry during onboarding. Call once per
 * medication the user lists.
 */
export const createMedicationTool = createTool({
  id: 'create-medication',
  description:
    'Save one medication entry for the user during onboarding. Call this once per medication if the user takes more than one.',
  inputSchema: z.object({
    userId: z.string().describe('The Supabase auth user id for the current user'),
    profileId: z.string().describe('The profile id returned by create-profile'),
    name: z.string().describe('Medication name'),
    dosage: z.string().optional().describe('e.g. "10 units", "500mg"'),
    frequency: z.number().int().optional().describe('Times per day this medication is taken'),
    type: z.string().optional().describe('e.g. "insulin", "tablet"'),
  }),
  outputSchema: z.object({
    medicationId: z.string(),
  }),
  execute: async ({ userId, profileId, name, dosage, frequency, type }) => {
    const { data, error } = await supabase
      .from('medications')
      .insert({
        user_id: userId,
        profile_id: profileId,
        name,
        dosage,
        frequency,
        type,
      })
      .select('id')
      .single();

    if (error) {
      throw new Error(`Failed to save medication: ${error.message}`);
    }

    return { medicationId: data.id };
  },
});

/**
 * Hand a classified message off to the agent responsible for it, and
 * return that agent's response so the Gatekeeper can relay it to the user.
 *
 * EXPORT and SETTINGS don't have agents yet (export/PDF flow and a
 * settings/profile-update flow aren't built), so those intents return a
 * placeholder note instead of calling an agent.
 */
export const handoffToAgentTool = createTool({
  id: 'handoff-to-agent',
  description:
    'Hand a classified message off to the agent responsible for it (Extraction + Logging, Q&A, or Analysis) and return its response. Always call this after classifying a relevant (non off-topic) message.',
  inputSchema: z.object({
    userId: z.string().describe('The Supabase auth user id for the current user'),
    intent: z.enum(['LOGGING', 'CORRECTION', 'QA', 'ANALYSIS', 'EXPORT', 'SETTINGS']),
    message: z.string().describe('The original user message being routed'),
    reason: z.string().optional().describe('Brief note on why this intent was chosen'),
  }),
  outputSchema: z.object({
    intent: z.string(),
    routedTo: z.string(),
    response: z.string().nullable(),
    note: z.string(),
  }),
  execute: async ({ userId, intent, message: rawMessage, reason }, context) => {
    const message = truncateAgentMessage(rawMessage);
    const session = await getOrCreateChatSession(userId);
    const pendingLog = (session.pending_log as Record<string, unknown>) ?? {};
    const flowStep = session.flow_step ?? null;

    // Deterministic: confirming + save/cancel — never delegate intent to the Gatekeeper LLM
    if (flowStep === 'confirming') {
      if (isConfirmMessage(message)) {
        const response = await executeConfirmSave(userId, pendingLog, context.mastra);
        return {
          intent: 'CORRECTION',
          routedTo: 'orchestrator',
          response,
          note: 'Confirmed save handled deterministically.',
        };
      }
      if (isCancelMessage(message)) {
        const response = await executeConfirmCancel(userId);
        return {
          intent: 'CORRECTION',
          routedTo: 'orchestrator',
          response,
          note: 'Cancel handled deterministically.',
        };
      }
      return {
        intent: 'CORRECTION',
        routedTo: 'orchestrator',
        response: formatConfirmCardWithMarker(pendingLog),
        note: 'Re-showing confirmation card.',
      };
    }

    const agentIdMap: Record<string, string> = {
      LOGGING: 'extraction-logging-agent',
      CORRECTION: 'validation-confirmation-agent',
      QA: 'qa-agent',
      ANALYSIS: 'analysis-agent',
    };

    const routedTo = agentIdMap[intent];

    if (!routedTo) {
      return {
        intent,
        routedTo: intent === 'EXPORT' ? 'export-flow' : 'settings-flow',
        response: null,
        note: `Routing decision recorded (reason: ${reason ?? 'n/a'}). The ${intent} flow isn't built yet — respond to the user as a helpful placeholder (acknowledge what you understood and say that part is coming soon).`,
      };
    }

    let prompt: string;

    if (routedTo === 'extraction-logging-agent') {
      prompt = `userId: ${userId}
flowStep: ${flowStep ?? 'null'}
pendingLog: ${JSON.stringify(pendingLog)}
message: ${message}

Extract ONLY fields explicitly present in message. Leave unmentioned fields null.
Then call handoffToValidationTool with the extracted entry and relay its response exactly.`;
    } else if (routedTo === 'validation-confirmation-agent') {
      prompt = `userId: ${userId}
flowStep: ${flowStep ?? 'null'}
pendingLog: ${JSON.stringify(pendingLog)}
message: ${message}`;
    } else {
      prompt = `userId: ${userId}\nmessage: ${message}`;
    }

    // For the extraction route, the authoritative reply is built in code by
    // handoffToValidationTool — prefer that tool's response over the LLM's
    // narrated text so reasoning preamble can never reach the user. Other
    // routes (Q&A, Analysis) author their reply with the LLM; strip any
    // leaked preamble from those.
    const response =
      routedTo === 'extraction-logging-agent'
        ? await callAgentPreferToolResponse(context.mastra, routedTo, prompt, [
            'handoffToValidationTool',
            'handoff-to-validation',
          ])
        : stripReasoningPreamble(await callAgent(context.mastra, routedTo, prompt));

    return {
      intent,
      routedTo,
      response,
      note: `Routed to ${routedTo}. Relay its response to the user — do not rewrite it unless needed for tone.`,
    };
  },
});
