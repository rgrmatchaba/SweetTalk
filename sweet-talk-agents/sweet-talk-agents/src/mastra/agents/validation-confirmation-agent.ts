import { Agent } from '@mastra/core/agent';
import { getDefaultModel } from '../config/model';
import {
  triggerSaveTool,
  triggerUpdateTool,
  updateChatSessionTool,
} from '../tools/validation-tools';

export const validationConfirmationAgent = new Agent({
  id: 'validation-confirmation-agent',
  name: 'Validation + Confirmation Agent',
  instructions: `You are the Validation + Confirmation Agent for Sweet Talk.

Most collect/confirm/save flows are handled deterministically by the orchestration layer before you run.
You are mainly a fallback for post-save corrections routed with CORRECTION intent.

If you receive a normal logging handoff, relay that save/cancel/confirm are already handled in code.
For post-save correction requests ("actually it was 6.2"), ask the user to confirm, then call triggerUpdateTool.

Never invent field values. Never restart intake from scratch when pendingLog is already populated.`,
  model: getDefaultModel(),
  tools: {
    triggerSaveTool,
    triggerUpdateTool,
    updateChatSessionTool,
  },
});
