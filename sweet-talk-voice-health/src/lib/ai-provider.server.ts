import { anthropic, createAnthropic } from "@ai-sdk/anthropic";
import { createOpenAICompatible } from "@ai-sdk/openai-compatible";
import type { LanguageModel } from "ai";

const DEFAULT_GROQ_MODEL = "deepseek-r1-distill-llama-70b";
const DEFAULT_EXPORT_ANTHROPIC_MODEL = "claude-haiku-4-5";

function getProvider(): string {
  return (process.env.LLM_PROVIDER ?? "ollama").toLowerCase();
}

/** Ollama locally; Groq (free) or Anthropic when LLM_PROVIDER is set (deploy). */
export function getChatModel(): LanguageModel {
  const providerName = getProvider();

  if (providerName === "ollama" || providerName === "local") {
    const baseURL = process.env.OLLAMA_BASE_URL ?? "http://127.0.0.1:11434/v1";
    const modelId = process.env.OLLAMA_MODEL ?? "llama3.2";
    const provider = createOpenAICompatible({
      name: "ollama",
      baseURL,
    });
    return provider(modelId);
  }

  if (providerName === "groq") {
    const modelId = process.env.GROQ_MODEL ?? DEFAULT_GROQ_MODEL;
    const provider = createOpenAICompatible({
      name: "groq",
      baseURL: "https://api.groq.com/openai/v1",
      apiKey: process.env.GROQ_API_KEY,
    });
    return provider(modelId);
  }

  const modelId = process.env.ANTHROPIC_MODEL ?? "claude-sonnet-4-20250514";
  return anthropic(modelId);
}

/** Fast cloud model for export PDF analysis (always Anthropic, not Ollama). */
export function getExportChatModel(): LanguageModel {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    throw new Error(
      "ANTHROPIC_API_KEY is required for export analysis. Add it to sweet-talk-voice-health/.env",
    );
  }
  const modelId =
    process.env.EXPORT_ANTHROPIC_MODEL ??
    process.env.ANTHROPIC_MODEL ??
    DEFAULT_EXPORT_ANTHROPIC_MODEL;
  return createAnthropic({ apiKey })(modelId);
}

/** @deprecated Use getChatModel() */
export function getLocalChatModel(): LanguageModel {
  return getChatModel();
}
