import type { MastraModelConfig } from '@mastra/core/llm';

// ─── Model options by provider ────────────────────────────────────────────────
//
// FREE TIER (no cost, recommended for development):
//   groq     — llama-3.3-70b-versatile (fast, but weak at multi-step tool calling)
//   groq     — llama-3.1-70b-versatile (slightly better tool compliance than 3.3)
//   gemini   — gemini-2.0-flash         ← BEST FREE option for agentic tool calling
//
// PAID (better compliance, production-ready):
//   anthropic — claude-haiku-4-5        ← cheapest, excellent instruction following
//   anthropic — claude-sonnet-4-5       ← best quality, moderate cost
//   openai    — gpt-4o-mini             ← cheap, reliable tool calling
//
// Set LLM_PROVIDER env var to: 'ollama' | 'groq' | 'gemini' | 'anthropic' | 'openai'
// ─────────────────────────────────────────────────────────────────────────────

const DEFAULT_ANTHROPIC_MODEL = 'anthropic/claude-haiku-4-5-20251001';
const DEFAULT_GROQ_MODEL = 'llama-3.3-70b-versatile';
const DEFAULT_GEMINI_MODEL = 'gemini-2.0-flash';

// Pin Anthropic's versioned base URL at module load (before any provider is
// constructed). @mastra/core's bare-string Anthropic path can otherwise resolve
// a base URL without `/v1`, making it POST to https://api.anthropic.com/messages
// and 404 on every call. Setting it here (or via the ANTHROPIC_BASE_URL env in
// .env / render.yaml) fixes it. Env value wins if already set.
if (!process.env.ANTHROPIC_BASE_URL) {
  process.env.ANTHROPIC_BASE_URL = 'https://api.anthropic.com/v1';
}

function getProvider(): string {
  return (process.env.LLM_PROVIDER ?? 'ollama').toLowerCase();
}

/** Ollama locally; Groq / Gemini (free) or Anthropic (paid) when LLM_PROVIDER is set. */
export function getDefaultModel(): MastraModelConfig {
  const provider = getProvider();

  if (provider === 'ollama' || provider === 'local') {
    return {
      providerId: 'ollama',
      modelId: process.env.OLLAMA_MODEL ?? 'llama3.2',
      url: process.env.OLLAMA_BASE_URL ?? 'http://127.0.0.1:11434/v1',
    };
  }

  if (provider === 'groq') {
    return {
      providerId: 'groq',
      modelId: process.env.GROQ_MODEL ?? DEFAULT_GROQ_MODEL,
      url: 'https://api.groq.com/openai/v1',
      apiKey: process.env.GROQ_API_KEY,
    };
  }

  // Gemini 2.0 Flash — free tier via Google AI Studio, best free option for
  // structured tool calling in multi-agent flows. Uses Google's OpenAI-compatible
  // endpoint so no extra package is needed.
  // Get a free key at: https://aistudio.google.com/apikey
  if (provider === 'gemini') {
    return {
      providerId: 'openai',
      modelId: process.env.GEMINI_MODEL ?? DEFAULT_GEMINI_MODEL,
      url: 'https://generativelanguage.googleapis.com/v1beta/openai/',
      apiKey: process.env.GEMINI_API_KEY,
    };
  }

  // Anthropic — best instruction following, paid. Set ANTHROPIC_API_KEY.
  // (Base URL pinned at module load above.)
  if (provider === 'anthropic') {
    return process.env.ANTHROPIC_MODEL ?? DEFAULT_ANTHROPIC_MODEL;
  }

  // OpenAI — reliable tool calling, paid. Set OPENAI_API_KEY.
  if (provider === 'openai') {
    return {
      providerId: 'openai',
      modelId: process.env.OPENAI_MODEL ?? 'gpt-4o-mini',
      apiKey: process.env.OPENAI_API_KEY,
    };
  }

  // Default fallback: Anthropic Haiku
  return process.env.ANTHROPIC_MODEL ?? DEFAULT_ANTHROPIC_MODEL;
}
