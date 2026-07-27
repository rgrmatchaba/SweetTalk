import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { generateText } from "ai";
import { z } from "zod";

/**
 * Strip reasoning preamble that the Gatekeeper model sometimes leaks before
 * the actual user-facing response. Observed leak shapes:
 *   "Now I'll extract the entry and hand off to validation:Got it — 5.6..."
 *   "Since hasActiveLog is true, I must use LOGGING intent:What did you eat..."
 *   "User is onboarded. No active log. Intent: LOGGING (glucose number 4.5).Got it — 4.5..."
 *   "This is a LOGGING intent. The user mentions a headache...Got it — ..."
 *
 * Strategy: repeatedly strip leading sentences that are clearly internal
 * reasoning (meta vocabulary, reasoning openers, or bare intent labels).
 * Sentence boundaries are ".", ":" or newline — but a "." or ":" followed by
 * a digit is treated as part of the sentence, so glucose values (4.5) and
 * times (09:00:00Z) are never cut in half.
 */
function stripAgentPreamble(text: string): string {
  const SENTENCE = /^\s*(?:[^.:\n]|\.(?=\d)|:(?=\d))+[.:\n]\s*/;
  // Vocabulary that only appears in leaked reasoning, never in real replies.
  const META =
    /\b(intent|onboarded|active log|hasActiveLog|flowStep|classif\w*|rout(?:e|ed|ing)\b|pipeline|extract\w*|hand(?:ing)?\s?off|validation agent|extraction agent|logging agent)\b/i;
  // Reasoning-style sentence openers (third-person narration about "the user" included).
  const STARTER =
    /^(?:Now I'?ll|I'?ll|I will|I need to|I see|I'?m going|Let me|Since |Based on |The user|They\b|This message|This is an? |Looking at|First,? |Executing|Running|Processing)/i;
  // Bare intent labels — case-sensitive so "logging" in real replies never matches.
  // Consumes an attached parenthetical, e.g. `LOGGING (food item mentioned, ...)`,
  // which the model emits with no sentence boundary before the real reply.
  const INTENT_LABEL = /^(?:LOGGING|CORRECTION|OFF-TOPIC|REDIRECT|ANALYSIS|QA)\b(?:\s*\([^)]*\))?[.:\s]*/;

  let out = text;
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

/**
 * Pull the authoritative user-facing reply straight out of the Gatekeeper's
 * handoffToAgentTool result in the Mastra generate response. The tool's
 * `response` field is produced by orchestration code (or already sanitised
 * server-side), so when it exists we use it verbatim and ignore the LLM's
 * final text entirely — the model can't leak reasoning into what it never
 * gets to write. Returns null when no handoff happened (off-topic, redirect,
 * onboarding), in which case the stripped LLM text is used.
 */
function extractHandoffResponse(json: unknown): string | null {
  const j = json as Record<string, any>;
  const buckets: any[] = [
    ...(Array.isArray(j?.toolResults) ? j.toolResults : []),
    ...(Array.isArray(j?.steps)
      ? j.steps.flatMap((s: any) => (Array.isArray(s?.toolResults) ? s.toolResults : []))
      : []),
  ];
  for (let i = buckets.length - 1; i >= 0; i--) {
    const tr = buckets[i];
    const name = tr?.toolName ?? tr?.payload?.toolName;
    if (name !== "handoffToAgentTool" && name !== "handoff-to-agent") continue;
    const out = tr?.result ?? tr?.output ?? tr?.payload?.result ?? tr?.payload?.output;
    const response = out?.response;
    if (typeof response === "string" && response.trim().length > 0) return response.trim();
  }
  return null;
}

const chatMessageSchema = z.object({
  role: z.enum(["user", "assistant"]),
  content: z.string().min(1).max(8000),
});

function aiUnavailableHint(): string {
  const provider = (process.env.LLM_PROVIDER ?? "ollama").toLowerCase();
  if (provider === "anthropic") {
    return "Check ANTHROPIC_API_KEY is set.";
  }
  if (provider === "groq") {
    return "Check GROQ_API_KEY is set (get one free at https://console.groq.com/keys).";
  }
  return `Start Ollama and run: ollama pull ${process.env.OLLAMA_MODEL ?? "llama3.2"}`;
}

const voiceEntrySchema = z.object({
  glucose_value: z.number(),
  foods_eaten: z.string(),
  snacks: z.string(),
  comments: z.string(),
  time_hint: z.string(),
  date_hint: z.string(),
});

async function parseVoiceWithLocalModel(transcript: string, unit: string) {
  const { getChatModel } = await import("@/lib/ai-provider.server");
  const { text } = await generateText({
    model: getChatModel(),
    system: `You parse glucose log transcripts from diabetic users. The unit is ${unit}.

Extract each separate glucose reading mentioned. For each entry capture:
- glucose_value: the numeric reading
- foods_eaten: main meals/food (empty string "" if NOT mentioned)
- snacks: snacks or small bites (empty string "" if NOT mentioned; use "none" if user said no snacks or no sugar)
- comments: mood, feelings, symptoms, notes (empty string "" if NOT mentioned)
- time_hint: time of day e.g. "in the morning", "right now", "before lunch" (empty string if not mentioned)
- date_hint: calendar reference e.g. "yesterday", "6/7", "last Monday" (empty string if not mentioned)

Rules:
- Multiple readings in one message → separate entries (e.g. morning 5.5 and right now 3.5 → two entries)
- "right now" / "currently" → time_hint "right now"
- "in the morning" / "this morning" → time_hint "in the morning"
- Past missed entries are allowed — preserve date_hint for backdating
- If user says "none" or "no snacks" / "no sugar", snacks = "none"
- Do NOT invent values. Empty string means not provided yet.

Return ONLY valid JSON: {"entries":[{"glucose_value":number,"foods_eaten":"string","snacks":"string","comments":"string","time_hint":"string","date_hint":"string"}]}`,
    prompt: transcript,
  });
  const match = text.match(/\{[\s\S]*\}/);
  if (!match) throw new Error("Could not understand that — try again.");
  return z.object({ entries: z.array(voiceEntrySchema).min(1) }).parse(JSON.parse(match[0]));
}

export const sweetTalkAgentChat = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) =>
    z.object({
      message: z.string().min(1).max(8000),
      threadId: z.string().optional(),
    }).parse(input),
  )
  .handler(async ({ context, data }) => {
    const baseUrl = process.env.MASTRA_API_URL ?? "http://localhost:4111";
    const userId = context.userId;
    // A glucose-log chat message is short; oversized input can stall the
    // agent's tool-calling loop for a long time. Cap before it reaches the LLM.
    const message = data.message.length > 2000 ? `${data.message.slice(0, 2000)}…` : data.message;
    const prompt = `userId: ${userId}\n${message}`;
    try {
      const res = await fetch(`${baseUrl}/api/agents/gatekeeper-agent/generate`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-mastra-dev-playground": "true",
        },
        body: JSON.stringify({
          messages: [{ role: "user", content: prompt }],
          memory: {
            resource: userId,
            thread: data.threadId ?? `chat-${userId}`,
          },
        }),
      });
      if (!res.ok) {
        const errText = await res.text().catch(() => "");
        throw new Error(`Mastra agent request failed (${res.status}): ${errText.slice(0, 300)}`);
      }
      const json = await res.json();
      const raw: string | undefined = json?.text ?? json?.object?.text ?? json?.result?.text;
      if (typeof raw !== "string") {
        throw new Error("Mastra agent returned an unexpected response shape");
      }
      // Prefer the deterministic handoff tool response; fall back to the LLM
      // text with any leaked reasoning preamble stripped.
      const text = extractHandoffResponse(json) ?? stripAgentPreamble(raw);
      return { text };
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Agent request failed";
      throw new Error(`${msg}. Is the Mastra agents server running (npm run dev in sweet-talk-agents/sweet-talk-agents)?`);
    }
  });

export const sweetTalkQAChat = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) =>
    z.object({
      message: z.string().min(1).max(8000),
      threadId: z.string().optional(),
    }).parse(input),
  )
  .handler(async ({ context, data }) => {
    const baseUrl = process.env.MASTRA_API_URL ?? "http://localhost:4111";
    const userId = context.userId;
    const prompt = `userId: ${userId}\n${data.message}`;
    try {
      const res = await fetch(`${baseUrl}/api/agents/qa-agent/generate`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-mastra-dev-playground": "true",
        },
        body: JSON.stringify({
          messages: [{ role: "user", content: prompt }],
          memory: {
            resource: userId,
            thread: data.threadId ?? `qa-${userId}`,
          },
        }),
      });
      if (!res.ok) {
        const errText = await res.text().catch(() => "");
        throw new Error(`Mastra agent request failed (${res.status}): ${errText.slice(0, 300)}`);
      }
      const json = await res.json();
      const raw: string | undefined = json?.text ?? json?.object?.text ?? json?.result?.text;
      if (typeof raw !== "string") {
        throw new Error("Mastra agent returned an unexpected response shape");
      }
      // The Q&A agent narrates tool plans too ("I'll retrieve your last reading…").
      return { text: stripAgentPreamble(raw) };
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Agent request failed";
      throw new Error(`${msg}. Is the Mastra agents server running (npm run dev in sweet-talk-agents/sweet-talk-agents)?`);
    }
  });

export const clearChatSession = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const userId = context.userId;
    const todayDate = new Date().toLocaleDateString("en-CA");
    const threadId = `chat-${userId}`;
    const baseUrl = process.env.MASTRA_API_URL ?? "http://localhost:4111";

    const { error } = await context.supabase
      .from("chat_sessions")
      .delete()
      .eq("user_id", userId)
      .eq("session_date", todayDate);

    if (error) throw new Error(error.message);

    await fetch(
      `${baseUrl}/api/memory/threads/${encodeURIComponent(threadId)}?agentId=gatekeeper-agent&resourceId=${encodeURIComponent(userId)}`,
      {
        method: "DELETE",
        headers: { "x-mastra-dev-playground": "true" },
      },
    ).catch(() => {});

    return { ok: true as const };
  });

export const transcribeAudio = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) =>
    z.object({
      audioBase64: z.string().min(1),
      mimeType: z.string().default("audio/webm"),
    }).parse(input),
  )
  .handler(async ({ data }) => {
    const apiKey = process.env.DEEPGRAM_API_KEY;
    if (!apiKey) {
      throw new Error(
        "DEEPGRAM_API_KEY is not configured on the server. Add it to .env (get a key at https://console.deepgram.com).",
      );
    }

    const audioBuffer = Buffer.from(data.audioBase64, "base64");

    // Strip codec suffix — Deepgram only needs the base type (e.g. "audio/webm",
    // not "audio/webm;codecs=opus") otherwise it can return an empty transcript.
    const contentType = data.mimeType.split(";")[0].trim();

    const res = await fetch(
      "https://api.deepgram.com/v1/listen?model=nova-2&smart_format=true&punctuate=true&detect_language=true",
      {
        method: "POST",
        headers: {
          Authorization: `Token ${apiKey}`,
          "Content-Type": contentType,
        },
        body: audioBuffer,
      },
    );

    if (!res.ok) {
      const errText = await res.text().catch(() => "");
      throw new Error(`Deepgram request failed (${res.status}): ${errText.slice(0, 300)}`);
    }

    const json = await res.json();
    const transcript: string =
      json?.results?.channels?.[0]?.alternatives?.[0]?.transcript ?? "";

    return { transcript };
  });

export const chatCompletion = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) =>
    z.object({
      system: z.string().min(1).max(12000),
      messages: z.array(chatMessageSchema).min(1).max(50),
    }).parse(input),
  )
  .handler(async ({ data }) => {
    const { getChatModel } = await import("@/lib/ai-provider.server");
    try {
      const { text } = await generateText({
        model: getChatModel(),
        system: data.system,
        messages: data.messages,
      });
      return { text };
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Chat request failed";
      throw new Error(`AI request failed (${msg}). ${aiUnavailableHint()}`);
    }
  });

export const parseVoiceLog = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) =>
    z.object({
      transcript: z.string().min(1).max(4000),
      unit: z.enum(["mmol/L", "mg/dL"]),
    }).parse(input),
  )
  .handler(async ({ data }) => {
    try {
      return await parseVoiceWithLocalModel(data.transcript, data.unit);
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Voice parse failed";
      throw new Error(`${msg} (${aiUnavailableHint()})`);
    }
  });

export const saveGlucoseLogs = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) =>
    z.object({
      entries: z.array(
        z.object({
          glucose_value: z.number(),
          glucose_unit: z.enum(["mmol/L", "mg/dL"]),
          foods_eaten: z.string().nullable(),
          comments: z.string().nullable(),
          logged_at: z.string().optional(),
          entry_tag: z.enum(["on_time", "late_entry"]).optional(),
        }),
      ).min(1).max(20),
    }).parse(input),
  )
  .handler(async ({ context, data }) => {
    const now = Date.now();
    const rows = data.entries.map((e) => {
      const loggedAt = e.logged_at ?? new Date().toISOString();
      const isBackdated = now - new Date(loggedAt).getTime() > 2 * 60 * 60 * 1000;
      return {
        user_id: context.userId,
        glucose_value: e.glucose_value,
        glucose_unit: e.glucose_unit,
        foods_eaten: e.foods_eaten,
        comments: e.comments,
        logged_at: loggedAt,
        entry_tag: e.entry_tag ?? (isBackdated ? "late_entry" : "on_time"),
      };
    });
    const { error } = await context.supabase.from("glucose_logs").insert(rows);
    if (error) throw new Error(error.message);
    return { count: rows.length };
  });

const glucoseLogAnalysisSchema = z.object({
  glucose_value: z.number(),
  glucose_unit: z.string(),
  foods_eaten: z.string().nullable(),
  snacks: z.string().nullable().optional(),
  comments: z.string().nullable(),
  logged_at: z.string(),
});

export const analyseGlucose = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) =>
    z.object({
      from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
      to: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    }).parse(input),
  )
  .handler(async ({ context, data }) => {
    const baseUrl = process.env.MASTRA_API_URL ?? "http://localhost:4111";
    const userId = context.userId;
    const prompt = `userId: ${userId}\nAnalyse my glucose patterns from ${data.from} to ${data.to}.`;
    try {
      const res = await fetch(`${baseUrl}/api/agents/analysis-agent/generate`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-mastra-dev-playground": "true",
        },
        body: JSON.stringify({
          messages: [{ role: "user", content: prompt }],
          memory: {
            resource: userId,
            thread: `analysis-${userId}-${data.from}-${data.to}`,
          },
        }),
      });
      if (!res.ok) {
        const errText = await res.text().catch(() => "");
        throw new Error(`Mastra agent request failed (${res.status}): ${errText.slice(0, 300)}`);
      }
      const json = await res.json();
      const raw: string | undefined = json?.text ?? json?.object?.text ?? json?.result?.text;
      if (typeof raw !== "string") {
        throw new Error("Mastra agent returned an unexpected response shape");
      }
      return { narrative: stripAgentPreamble(raw) };
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Analysis request failed";
      throw new Error(`${msg}. Is the Mastra agents server running (npm run dev in sweet-talk-agents/sweet-talk-agents)?`);
    }
  });

export const analyseGlucoseForExport = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) =>
    z.object({
      logs: z.array(glucoseLogAnalysisSchema).max(500),
      diabetes_type: z.string().optional(),
      statsSummary: z.string().optional(),
      targetRange: z.string().optional(),
    }).parse(input),
  )
  .handler(async ({ data }) => {
    if (data.logs.length === 0) {
      return { narrative: null };
    }
    const { getExportChatModel } = await import("@/lib/ai-provider.server");
    const compact = data.logs
      .map((l) => `${l.logged_at} | ${l.glucose_value} ${l.glucose_unit} | food: ${l.foods_eaten || "-"} | snacks: ${l.snacks || "-"} | note: ${l.comments || "-"}`)
      .join("\n");
    const { text } = await generateText({
      model: getExportChatModel(),
      system: `You are preparing a clinical observations section for a doctor reviewing a ${data.diabetes_type || "diabetic"} patient's self-reported glucose diary.

Write for a clinician audience in plain English. Structure your response with these headings:
**Overall trend**
**Food & meal patterns**
**Notable highs and lows**
**Patient-reported symptoms & context**
**Logging adherence**

Rules:
- Reference specific readings, dates, foods, and patient comments from the data
- Note correlations between meals/snacks and glucose values — be concrete
- Highlight time-of-day patterns if present
- Mention backdated/late entries if they affect interpretation
- Observations only — no diagnosis, no medication or dosing advice
- Keep it concise: about 250–400 words total`,
      prompt: [
        data.statsSummary ? `Summary statistics:\n${data.statsSummary}` : "",
        data.targetRange ? `Patient target range: ${data.targetRange}` : "",
        `Logs (chronological):\n${compact}`,
      ].filter(Boolean).join("\n\n"),
    });
    return { narrative: text };
  });
