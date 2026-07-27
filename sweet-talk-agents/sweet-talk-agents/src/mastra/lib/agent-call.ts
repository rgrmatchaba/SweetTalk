import type { MastraUnion } from '@mastra/core/tools';
import { stripReasoningPreamble } from './strip-preamble';

/**
 * Call another registered agent by its id and return its text response.
 *
 * This is the "agent as tool" pattern: a tool's execute function receives
 * the Mastra instance via its execution context (`context.mastra`), which
 * lets it look up and invoke any other registered agent without creating
 * a circular import between agent files.
 */
export async function callAgent(mastra: MastraUnion | undefined, agentId: string, prompt: string): Promise<string> {
  if (!mastra) {
    throw new Error('Mastra instance not available in tool context — cannot hand off to another agent');
  }

  const agent = mastra.getAgentById(agentId);

  if (!agent) {
    throw new Error(`Agent "${agentId}" is not registered`);
  }

  const result = await agent.generate(prompt);
  return result.text;
}

/**
 * Find the most recent result of a given tool in a generate() result and
 * return its `response` string field, if present. Handles the shapes Mastra
 * uses across versions (top-level toolResults, per-step toolResults, and
 * results nested under `payload`).
 */
function extractToolResponse(result: unknown, toolNames: string[]): string | null {
  const r = result as Record<string, any>;
  const buckets: any[] = [
    ...(Array.isArray(r?.toolResults) ? r.toolResults : []),
    ...(Array.isArray(r?.steps)
      ? r.steps.flatMap((s: any) => (Array.isArray(s?.toolResults) ? s.toolResults : []))
      : []),
  ];

  for (let i = buckets.length - 1; i >= 0; i--) {
    const tr = buckets[i];
    const name = tr?.toolName ?? tr?.payload?.toolName;
    if (!toolNames.includes(name)) continue;
    const out = tr?.result ?? tr?.output ?? tr?.payload?.result ?? tr?.payload?.output;
    const response = out?.response;
    if (typeof response === 'string' && response.trim().length > 0) {
      return response.trim();
    }
  }
  return null;
}

/**
 * Call an agent, but treat the given tool's `response` field as the
 * authoritative user-facing reply when the agent invoked it. The LLM's final
 * text is only a fallback (stripped of reasoning preamble), because models
 * routinely prepend narration like "Now I'll call handoffToValidationTool:"
 * when re-emitting a tool response.
 */
export async function callAgentPreferToolResponse(
  mastra: MastraUnion | undefined,
  agentId: string,
  prompt: string,
  toolNames: string[],
): Promise<string> {
  if (!mastra) {
    throw new Error('Mastra instance not available in tool context — cannot hand off to another agent');
  }

  const agent = mastra.getAgentById(agentId);

  if (!agent) {
    throw new Error(`Agent "${agentId}" is not registered`);
  }

  const result = await agent.generate(prompt);
  const toolResponse = extractToolResponse(result, toolNames);
  if (toolResponse !== null) return toolResponse;
  return stripReasoningPreamble(result.text);
}
