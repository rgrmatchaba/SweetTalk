import { anthropic } from "@ai-sdk/anthropic";
import { createOpenAICompatible } from "@ai-sdk/openai-compatible";
import type { LanguageModel } from "ai";

function useOllama(): boolean {
  const provider = (process.env.LLM_PROVIDER ?? "ollama").toLowerCase();
  return provider === "ollama" || provider === "local";
}

/** Ollama locally; Anthropic when LLM_PROVIDER=anthropic (deploy). */
export function getChatModel(): LanguageModel {
  if (useOllama()) {
    const baseURL = process.env.OLLAMA_BASE_URL ?? "http://127.0.0.1:11434/v1";
    const modelId = process.env.OLLAMA_MODEL ?? "llama3.2";
    const provider = createOpenAICompatible({
      name: "ollama",
      baseURL,
    });
    return provider(modelId);
  }

  const modelId = process.env.ANTHROPIC_MODEL ?? "claude-sonnet-4-20250514";
  return anthropic(modelId);
}

/** @deprecated Use getChatModel() */
export function getLocalChatModel(): LanguageModel {
  return getChatModel();
}
