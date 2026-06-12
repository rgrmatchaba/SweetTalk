import type { MastraUnion } from '@mastra/core/tools';

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
