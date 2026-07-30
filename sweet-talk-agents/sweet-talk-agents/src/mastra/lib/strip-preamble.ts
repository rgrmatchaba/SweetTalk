/**
 * Strip reasoning preamble that agent LLMs sometimes leak before the actual
 * user-facing response, e.g.:
 *   "Now I'll call handoffToValidationTool with the extracted entry:Got it — 6.2..."
 *   "User is onboarded. No active log. Intent: LOGGING (glucose number 4.5).Got it — ..."
 *
 * Also strips Groq/Llama tool-call markup that weak models dump as plain text:
 *   `(function=getActiveLogTool>{"userId":"..."};</function>`
 *   `<function=handoffToAgentTool,{...}</function>`
 *
 * Mirrors stripAgentPreamble in sweet-talk-voice-health/src/lib/ai.functions.ts —
 * keep the two in sync. Strategy: repeatedly strip leading sentences that are
 * clearly internal reasoning (meta vocabulary, reasoning openers, or bare intent
 * labels). Sentence boundaries are ".", ":" or newline — but a "." or ":"
 * followed by a digit is part of the sentence, so glucose values (4.5) and
 * times (09:00:00Z) are never cut in half.
 */

const SENTENCE = /^\s*(?:[^.:\n]|\.(?=\d)|:(?=\d))+[.:\n]\s*/;

// Vocabulary that only appears in leaked reasoning, never in real replies.
const META =
  /\b(intent|onboarded|active log|hasActiveLog|flowStep|classif\w*|rout(?:e|ed|ing)\b|pipeline|extract\w*|hand(?:ing)?\s?off|validation agent|extraction agent|logging agent|handoffTo\w*|pendingLog)\b/i;

// Reasoning-style sentence openers (third-person narration about "the user" included).
const STARTER =
  /^(?:Now I'?ll|I'?ll|I will|I need to|I see|I'?m going|Let me|Since |Based on |The user|They\b|This message|This is an? |Looking at|First,? |Executing|Running|Processing)/i;

// Bare intent labels — case-sensitive so "logging" in real replies never matches.
// Consumes an attached parenthetical, e.g. `LOGGING (food item mentioned, ...)`.
const INTENT_LABEL = /^(?:LOGGING|CORRECTION|OFF-TOPIC|REDIRECT|ANALYSIS|QA)\b(?:\s*\([^)]*\))?[.:\s]*/;

// Groq/Llama sometimes emit tool calls as plain text instead of structured calls.
const TOOL_CALL_MARKUP =
  /(?:\(\s*)?<?\s*function\s*=\s*[A-Za-z0-9_-]+\s*[>,]\s*\{[\s\S]*?\}\s*;?\s*<\/\s*function\s*>/gi;

export function stripToolCallMarkup(text: string): string {
  return text.replace(TOOL_CALL_MARKUP, ' ').replace(/\n{3,}/g, '\n\n').trim();
}

export function stripReasoningPreamble(text: string): string {
  let out = stripToolCallMarkup(text);
  for (let i = 0; i < 8; i++) {
    const label = out.match(INTENT_LABEL);
    if (label && label[0].length < out.length) {
      out = out.slice(label[0].length).trim();
      continue;
    }
    const match = out.match(SENTENCE);
    if (!match) break;
    const sentence = match[0].trim();
    if (!META.test(sentence) && !STARTER.test(sentence)) break;
    const rest = out.slice(match[0].length).trim();
    if (rest.length === 0) break; // never strip the whole message
    out = rest;
  }
  return out;
}
