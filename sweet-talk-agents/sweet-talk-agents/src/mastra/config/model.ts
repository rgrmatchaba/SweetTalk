import type { MastraModelConfig } from '@mastra/core/llm';

const DEFAULT_ANTHROPIC_MODEL = 'anthropic/claude-sonnet-4-5';

function useOllama(): boolean {
  const provider = (process.env.LLM_PROVIDER ?? 'ollama').toLowerCase();
  return provider === 'ollama' || provider === 'local';
}

/** Ollama locally; Anthropic when LLM_PROVIDER=anthropic (deploy). */
export function getDefaultModel(): MastraModelConfig {
  if (useOllama()) {
    return {
      providerId: 'ollama',
      modelId: process.env.OLLAMA_MODEL ?? 'llama3.2',
      url: process.env.OLLAMA_BASE_URL ?? 'http://127.0.0.1:11434/v1',
    };
  }

  return process.env.ANTHROPIC_MODEL ?? DEFAULT_ANTHROPIC_MODEL;
}
