export type CollectStep = "glucose" | "foods" | "snacks" | "comments" | "confirming";

export interface LogEntry {
  glucose_value?: number;
  foods_eaten: string;
  snacks: string;
  comments: string;
  time_hint: string;
  date_hint: string;
  logged_at?: string | null;
  timing_confirmed?: boolean;
}

const NONE = /^(none|no|nope|n\/a|nothing|no snacks?|no food|not really|no sugar)$/i;
const PAST_TIME =
  /\b(in the |this )?(morning|afternoon|evening|last night|tonight|before lunch|after lunch|before dinner|after dinner|at breakfast|at lunch)\b/i;
const CURRENT_TIME = /\b(right now|just now|currently|at the moment|now)\b/i;

const TIME_SLOTS: Record<string, { hour: number; minute: number }> = {
  morning: { hour: 8, minute: 0 },
  breakfast: { hour: 8, minute: 0 },
  "before lunch": { hour: 11, minute: 30 },
  lunch: { hour: 12, minute: 30 },
  "after lunch": { hour: 14, minute: 0 },
  afternoon: { hour: 15, minute: 0 },
  "before dinner": { hour: 18, minute: 0 },
  dinner: { hour: 19, minute: 0 },
  "after dinner": { hour: 21, minute: 0 },
  evening: { hour: 20, minute: 0 },
  night: { hour: 22, minute: 0 },
  "last night": { hour: 22, minute: 0 },
};

export function isAnswered(value: string) {
  return value.trim().length > 0;
}

export function isExplicitNone(value: string) {
  return NONE.test(value.trim());
}

export function isPastTimeHint(hint: string): boolean {
  if (!hint.trim()) return false;
  if (CURRENT_TIME.test(hint)) return false;
  return PAST_TIME.test(hint);
}

export function isCurrentTimeHint(hint: string): boolean {
  return CURRENT_TIME.test(hint);
}

function startOfLocalDay(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate());
}

function parseCalendarDate(hint: string, now: Date): Date | null {
  const lower = hint.toLowerCase();
  if (lower.includes("yesterday")) {
    const d = startOfLocalDay(now);
    d.setDate(d.getDate() - 1);
    return d;
  }
  const slash = hint.match(/(\d{1,2})[\/\-](\d{1,2})(?:[\/\-](\d{2,4}))?/);
  if (slash) {
    const month = Number(slash[1]) - 1;
    const day = Number(slash[2]);
    const year = slash[3] ? Number(slash[3].length === 2 ? `20${slash[3]}` : slash[3]) : now.getFullYear();
    return new Date(year, month, day);
  }
  return null;
}

export function resolveLoggedAt(timeHint: string, dateHint: string, now = new Date()): string {
  if (!timeHint.trim() && !dateHint.trim()) return now.toISOString();
  if (isCurrentTimeHint(timeHint)) return now.toISOString();

  let base = startOfLocalDay(now);
  const parsedDate = dateHint ? parseCalendarDate(dateHint, now) : null;
  if (parsedDate) {
    base = parsedDate;
  } else if (/yesterday/i.test(`${timeHint} ${dateHint}`)) {
    base.setDate(base.getDate() - 1);
  }

  const combined = `${timeHint} ${dateHint}`.toLowerCase();
  let slot = { hour: 12, minute: 0 };
  for (const [key, value] of Object.entries(TIME_SLOTS)) {
    if (combined.includes(key)) {
      slot = value;
      break;
    }
  }
  if (/\bmorning\b/.test(combined)) slot = TIME_SLOTS.morning;

  const resolved = new Date(base);
  resolved.setHours(slot.hour, slot.minute, 0, 0);
  if (resolved.getTime() > now.getTime() && !parsedDate && !/yesterday/i.test(combined)) {
    /* same-day past slot */
  } else if (resolved.getTime() > now.getTime()) {
    resolved.setDate(resolved.getDate() - 1);
  }
  return resolved.toISOString();
}

function timeHintMatchesNow(hint: string, now: Date): boolean {
  const h = now.getHours();
  const lower = hint.toLowerCase();
  if (/afternoon/.test(lower) && h >= 12 && h < 18) return true;
  if (/morning/.test(lower) && h >= 5 && h < 12) return true;
  if (/evening/.test(lower) && h >= 17) return true;
  return false;
}

export function hasCurrentReadingIntent(text: string): boolean {
  return CURRENT_TIME.test(text) && /\b\d{1,2}(?:\.\d{1,2})?\b/.test(text);
}

export function entryNeedsTimingConfirm(entry: LogEntry, transcript: string, now = new Date()): boolean {
  if (entry.timing_confirmed || entry.logged_at) return false;
  if (entry.glucose_value == null || Number.isNaN(entry.glucose_value)) return false;
  if (hasCurrentReadingIntent(transcript)) return false;
  if (isAnswered(entry.date_hint) || /yesterday|last (mon|tue|wed|thu|fri|sat|sun)/i.test(entry.date_hint)) {
    return true;
  }
  if (!isPastTimeHint(entry.time_hint)) return false;
  if (/this (morning|afternoon|evening)/i.test(entry.time_hint) && timeHintMatchesNow(entry.time_hint, now)) {
    return false;
  }
  return true;
}

export function findEntryNeedingTimingConfirm(entries: LogEntry[], transcript: string): LogEntry | null {
  return entries.find((e) => entryNeedsTimingConfirm(e, transcript)) ?? null;
}

export function buildTimingConfirmPrompt(entry: LogEntry, unit: string): string {
  const parts = [entry.time_hint, entry.date_hint].filter(isAnswered);
  const when = parts.length ? parts.join(", ") : "earlier";
  return (
    `You mentioned ${entry.glucose_value} ${unit} ${when}. ` +
    `Do you want to log that reading? Reply **log it** to record it (including missed entries from earlier dates), ` +
    `or tell me your **current** reading instead.`
  );
}

/**
 * Normalize a time_hint for matching purposes only (not for display).
 * Different extraction passes (regex vs LLM) may phrase the same time-of-day
 * slightly differently — e.g. "in the morning" vs "morning", or "this afternoon"
 * vs "afternoon" — and without normalization these produce different readingKeys,
 * causing the same logical entry to be merged as a duplicate.
 */
function normalizeTimeHintForKey(hint: string): string {
  return hint
    .trim()
    .toLowerCase()
    .replace(/^(in the |this |at )/, "")
    .trim();
}

export function readingKey(e: LogEntry): string {
  return `${e.glucose_value ?? "?"}:${normalizeTimeHintForKey(e.time_hint)}:${e.date_hint.trim().toLowerCase()}`;
}

export function prepareEntry(entry: LogEntry, transcript = "", now = new Date()): LogEntry {
  const e: LogEntry = {
    ...entry,
    foods_eaten: entry.foods_eaten?.trim() ?? "",
    snacks: entry.snacks?.trim() ?? "",
    comments: entry.comments?.trim() ?? "",
    time_hint: entry.time_hint?.trim() ?? "",
    date_hint: entry.date_hint?.trim() ?? "",
    timing_confirmed: entry.timing_confirmed ?? false,
    logged_at: entry.logged_at ?? null,
  };

  if (!e.timing_confirmed && !e.logged_at && e.glucose_value != null && !entryNeedsTimingConfirm(e, transcript, now)) {
    e.timing_confirmed = true;
    e.logged_at = resolveLoggedAt(e.time_hint, e.date_hint, now);
  }
  return e;
}

export function nextCollectStep(entries: LogEntry[]): CollectStep {
  const missing = missingCollectSteps(entries);
  if (!missing.length) return "confirming";
  return missing[0];
}

export function missingCollectSteps(entries: LogEntry[]): Exclude<CollectStep, "confirming">[] {
  const missing: Exclude<CollectStep, "confirming">[] = [];
  if (!entries.length || entries.every((e) => e.glucose_value == null || Number.isNaN(e.glucose_value))) {
    missing.push("glucose");
  }
  if (entries.some((e) => !isAnswered(e.foods_eaten))) missing.push("foods");
  if (entries.some((e) => !isAnswered(e.snacks))) missing.push("snacks");
  if (entries.some((e) => !isAnswered(e.comments))) missing.push("comments");
  return missing;
}

export const COLLECT_PROMPTS: Record<Exclude<CollectStep, "confirming">, string> = {
  glucose: "What's your glucose reading right now?",
  foods: "What did you eat for that meal?",
  snacks: 'Any snacks? (say "none" if not)',
  comments: "How are you feeling? Any notes or symptoms?",
};

const COLLECT_PHRASES: Record<Exclude<CollectStep, "confirming">, string> = {
  glucose: "what's your glucose reading",
  foods: "what you ate",
  snacks: "any snacks",
  comments: "how you're feeling",
};

function buildWhen(e: LogEntry): string {
  const t = e.time_hint.trim();
  const d = e.date_hint.trim();
  if (!t) return d;
  if (!d) return t;
  // Avoid "yesterday yesterday morning" — if time_hint already includes date_hint, use time_hint only
  if (t.toLowerCase().includes(d.toLowerCase())) return t;
  return `${d} ${t}`;
}

export function buildCollectPrompt(entries: LogEntry[]): string {
  const missing = missingCollectSteps(entries);
  if (!missing.length) return "";

  // When glucose is the first missing field and we already have time/date context, use it
  if (missing[0] === "glucose") {
    const e = entries.find((e) => isAnswered(e.time_hint) || isAnswered(e.date_hint));
    if (e) {
      // Build "yesterday morning" — prefer time_hint; prepend date_hint when it adds info
      const when = buildWhen(e);
      if (missing.length === 1) return `What was your glucose reading ${when}?`;
      // Other fields also missing — ask for all in one message
      const rest = missing.slice(1);
      if (rest.length === 2 && rest.includes("snacks") && rest.includes("comments")) {
        return `What was your glucose reading ${when}? Also — any snacks, and how are you feeling?`;
      }
      if (rest.length === 1) return `What was your glucose reading ${when}, and ${COLLECT_PHRASES[rest[0]]}?`;
    }
    if (missing.length === 1) return COLLECT_PROMPTS.glucose;
  }

  if (missing.length === 1) return COLLECT_PROMPTS[missing[0]];
  if (missing.length === 2 && missing.includes("snacks") && missing.includes("comments")) {
    return "Any snacks, and how are you feeling?";
  }
  if (missing.length === 2 && missing.includes("foods") && missing.includes("comments")) {
    return "What did you eat, and how are you feeling?";
  }
  const parts = missing.map((m) => COLLECT_PHRASES[m]);
  const last = parts.pop()!;
  const head = parts.map((p, i) => (i === 0 ? p.charAt(0).toUpperCase() + p.slice(1) : p));
  return `${head.join(", ")}, and ${last}?`;
}

function mergePair(old: LogEntry, parsed: LogEntry, transcript: string): LogEntry {
  const preferNewGlucose =
    parsed.time_hint && /right now|just now|currently/i.test(parsed.time_hint)
      ? parsed.glucose_value
      : undefined;

  return prepareEntry(
    {
      glucose_value: preferNewGlucose ?? parsed.glucose_value ?? old.glucose_value,
      foods_eaten: pickField(old.foods_eaten, parsed.foods_eaten),
      snacks: pickField(old.snacks, parsed.snacks),
      comments: pickField(old.comments, parsed.comments),
      time_hint: pickField(old.time_hint, parsed.time_hint),
      date_hint: pickField(old.date_hint, parsed.date_hint),
      logged_at: parsed.logged_at ?? old.logged_at,
      timing_confirmed: parsed.timing_confirmed ?? old.timing_confirmed,
    },
    transcript,
  );
}

export function mergeEntries(prev: LogEntry[], parsed: LogEntry[], transcript = ""): LogEntry[] {
  if (!parsed.length) return prev.map((e) => prepareEntry(e, transcript));

  const prevByKey = new Map(prev.map((e) => [readingKey(e), e]));
  return parsed.map((p) => {
    const old = prevByKey.get(readingKey(p));
    return old ? mergePair(old, p, transcript) : prepareEntry(p, transcript);
  });
}

function pickField(old: string, neu: string): string {
  if (isAnswered(neu)) return neu;
  return old;
}

export function combineFoodsForSave(entry: LogEntry): string | null {
  const parts = [entry.foods_eaten, entry.snacks].filter((s) => isAnswered(s) && !isExplicitNone(s));
  return parts.length ? parts.join(", ") : null;
}

export function commentsForSave(entry: LogEntry): string | null {
  if (!isAnswered(entry.comments) || isExplicitNone(entry.comments)) return null;
  return entry.comments.trim();
}

export function loggedAtForSave(entry: LogEntry): string {
  if (entry.logged_at) return entry.logged_at;
  return resolveLoggedAt(entry.time_hint, entry.date_hint);
}

export function normalizeParsedEntry(raw: {
  glucose_value: number;
  foods_eaten?: string;
  snacks?: string;
  comments?: string;
  time_hint?: string;
  date_hint?: string;
  logged_at?: string | null;
  timing_confirmed?: boolean;
}): LogEntry {
  return prepareEntry({
    glucose_value: raw.glucose_value,
    foods_eaten: raw.foods_eaten?.trim() ?? "",
    snacks: raw.snacks?.trim() ?? "",
    comments: raw.comments?.trim() ?? "",
    time_hint: raw.time_hint?.trim() ?? "",
    date_hint: raw.date_hint?.trim() ?? "",
    logged_at: raw.logged_at ?? null,
    timing_confirmed: raw.timing_confirmed ?? false,
  });
}
