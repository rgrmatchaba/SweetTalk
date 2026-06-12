import { type LogEntry, isAnswered, isExplicitNone } from "@/lib/log-entry";

const PAST_DATE =
  /\b(yesterday|last (monday|tuesday|wednesday|thursday|friday|saturday|sunday)|\d{1,2}[\/\-]\d{1,2}(?:[\/\-]\d{2,4})?|(?:jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]* \d{1,2})\b/i;

export const LOG_START_PATTERN =
  /Share your glucose|Tell me your reading|log your reading|starting a new log|__log_marker__/i;

export function extractDateHint(text: string): string {
  const m = text.match(PAST_DATE);
  return m?.[0]?.trim() ?? "";
}

export function looksLikeReading(text: string): boolean {
  return /\b\d{1,2}(?:\.\d{1,2})?\b/.test(text);
}

/** True when a message looks like a log entry even without a glucose number (date/food/meal context). */
export function looksLikeLogEntry(text: string): boolean {
  if (looksLikeReading(text)) return true;
  if (/\b(yesterday|this morning|this afternoon|this evening|in the morning|last night|before breakfast|after breakfast|before lunch|after lunch|before dinner|after dinner)\b/i.test(text)) return true;
  if (/\b(i (ate|had)|ate|had)\b.{1,40}\b(breakfast|lunch|dinner|oats|toast|rice|bread|chicken|beef|fish|fruit|soup|stew|salad)\b/i.test(text)) return true;
  return false;
}

/** Extract food/time/date context from a message that has no glucose number yet. */
export function extractPartialEntry(text: string): LogEntry {
  const time_hint = inferTimeHint(text);
  const raw_date = extractDateHint(text);
  // Avoid "yesterday yesterday morning" — drop date_hint when time_hint already encodes it
  const date_hint = raw_date && time_hint.toLowerCase().includes(raw_date.toLowerCase()) ? "" : raw_date;
  return {
    glucose_value: undefined,
    foods_eaten: inferFood(text),
    snacks: inferSnacks(text),
    comments: inferComments(text),
    time_hint,
    date_hint,
  };
}

export interface DateTimeCorrection {
  time_hint: string;
  date_hint: string;
}

/** Detect when the user is correcting the date/time of a pending entry. */
export function extractDateTimeCorrection(text: string): DateTimeCorrection | null {
  const hasDateLang = /\b(yesterday|last night|this morning|this afternoon|this evening)\b/i.test(text);
  const hasChangeVerb = /\b(change|update|fix|set|was from|it was|that was|log it as)\b/i.test(text);
  const hasMention = /\b(date|time|morning|afternoon|evening|yesterday)\b/i.test(text);

  if (!hasDateLang && !(hasChangeVerb && hasMention)) return null;

  const time_hint = inferTimeHint(text);
  const date_hint = extractDateHint(text);

  if (!date_hint && !time_hint) return null;
  // Don't trigger if the ONLY match is a glucose correction keyword ("was 6.4")
  if (!hasDateLang && !hasMention) return null;

  return { date_hint, time_hint };
}

export function isFreshReadingMessage(text: string): boolean {
  return (
    looksLikeReading(text) &&
    (/\b(this (afternoon|morning|evening)|in the (morning|afternoon|evening)|yesterday|my reading was|reading was)\b/i.test(
      text,
    ) ||
      /\blog (a |another |new )?reading\b/i.test(text) ||
      /\badd (a |another )?reading\b/i.test(text))
  );
}

export function isCorrectionMessage(text: string): boolean {
  if (isFreshReadingMessage(text)) return false;
  return (
    /\b(actually|change|wrong|correct|instead|meant|update|also had|not \d|should be)\b/i.test(text) ||
    (looksLikeReading(text) && /\bwas\b/i.test(text))
  );
}

export function hasCorrectionKeywords(text: string): boolean {
  return /\b(actually|change|wrong|correct|instead|meant|update|also had|should be)\b/i.test(text);
}

const FOOD_WORDS_RE =
  /\b(ate|eat|had|food|meal|breakfast|lunch|dinner|snack|vegetables|veggies|oats|toast|stew|potato|banana|chicken|beef|fish|bread|rice|salad|soup|fruit)\b/i;

/** If the correction text is purely a glucose value with no food context, return that value. */
export function extractGlucoseOnlyCorrection(text: string): number | null {
  if (FOOD_WORDS_RE.test(text)) return null;
  const m = text.match(/\b(\d{1,3}(?:\.\d{1,2})?)\b/);
  if (!m) return null;
  const val = parseFloat(m[1]);
  return isNaN(val) || val <= 0 ? null : val;
}

export function isLogPastReading(text: string): boolean {
  const t = text.trim().toLowerCase();
  return (
    /^(yes|yeah|yep|log it|record it|that one|save that|yes log|log that)\b/.test(t) ||
    /\b(log|record)\s+(it|that|the morning|the afternoon|that reading)\b/.test(t) ||
    /\b(morning|afternoon|evening)\s+(one|reading)\b/.test(t)
  );
}

export function isPreferCurrentReading(text: string): boolean {
  return (
    /\b(current|right now|now instead|just now|at the moment)\b/i.test(text) ||
    (/^(no|nope)\b/i.test(text.trim()) && !/\blog\b/i.test(text))
  );
}

function inferSnacks(text: string): string {
  if (/\bno (?:snacks?|sugar)\b/i.test(text)) return "none";
  const m = text.match(/\bsnacks?\s*[:\-]?\s*(.+?)(?:\.|,|$)/i);
  return m?.[1]?.trim() ?? "";
}

function inferFood(text: string): string {
  const m = text.match(
    /\b(?:ate|had|eaten|for (?:breakfast|lunch|dinner))\s+(.+?)(?:\.|,|no snack|feeling|and how|$)/i,
  );
  if (!m) return "";
  let food = m[1].trim();
  food = food.replace(/\bno (?:snacks?|sugar)\b.*$/i, "").trim();
  return food;
}

function cleanComments(raw: string): string {
  let c = raw.trim();
  c = c.replace(/\b(this |in the )?(morning|afternoon|evening)\b[^.!?]*\breading was\s*\d+[^.!?]*/gi, "");
  c = c.replace(/\bi ate\s+.+$/i, "");
  c = c.replace(/\breading was\s*\d+[^.!?]*/gi, "");
  if (c.length > 120 || (looksLikeReading(c) && /\breading\b/i.test(c))) return "";
  return c.trim();
}

function inferComments(text: string): string {
  const m = text.match(/\b(?:feeling|feel|i'?m)\s+(.+?)$/i);
  if (m) return cleanComments(m[1]);
  if (/\b(tired|drained|exhausted|sore|dizzy|hungry|fine|ok|okay)\b/i.test(text)) {
    const hit = text.match(/\b(feeling\s+)?(tired|drained|exhausted|sore|dizzy|hungry|fine|ok|okay)\b[^.!?]*/i);
    return cleanComments(hit?.[0] ?? "");
  }
  return "";
}

function inferTimeHint(fragment: string): string {
  const m = fragment.match(
    // "yesterday evening/morning/afternoon" must come before bare "yesterday" so the compound is preferred
    /\b(yesterday\s+(?:morning|afternoon|evening|night)|(?:in the |this )?(?:morning|afternoon|evening)|(?:before|after)\s+(?:lunch|dinner)|right now|just now|last night|yesterday)\b/i,
  );
  return m?.[0]?.trim() ?? "";
}

/** Exported so callers can validate LLM-produced time hints against the original text. */
export function extractTimeHint(text: string): string {
  return inferTimeHint(text);
}

function extractFieldsNear(fragment: string): Pick<LogEntry, "foods_eaten" | "snacks" | "comments"> {
  return {
    foods_eaten: inferFood(fragment),
    snacks: inferSnacks(fragment),
    comments: inferComments(fragment),
  };
}

export function regexExtractEntries(text: string): LogEntry[] {
  const entries: LogEntry[] = [];
  const dateHint = extractDateHint(text);

  const patterns: Array<{ re: RegExp; hint: string }> = [
    {
      re: /\byesterday\s+(?:morning|afternoon|evening|night)\b[^.!?]{0,60}?(?:reading\s+)?(?:was|is|'s)?\s*(\d{1,2}(?:\.\d{1,2})?)/gi,
      hint: "",
    },
    {
      re: /\b(?:in the |this )?afternoon\b[^.!?]{0,50}?(?:reading\s+)?(?:was|is|'s)?\s*(\d{1,2}(?:\.\d{1,2})?)/gi,
      hint: "this afternoon",
    },
    {
      re: /\b(?:in the |this )?morning\b[^.!?]{0,50}?(?:reading\s+)?(?:was|is|'s)?\s*(\d{1,2}(?:\.\d{1,2})?)/gi,
      hint: "in the morning",
    },
    {
      re: /\b(?:in the |this )?evening\b[^.!?]{0,50}?(?:reading\s+)?(?:was|is|'s)?\s*(\d{1,2}(?:\.\d{1,2})?)/gi,
      hint: "this evening",
    },
    {
      re: /\b(right now|just now|currently)\b[^.!?]{0,30}?(?:its?|is|'s)?\s*(\d{1,2}(?:\.\d{1,2})?)/gi,
      hint: "right now",
    },
    {
      re: /\b(\d{1,2}(?:\.\d{1,2})?)\s*(?:mmol\/l|mg\/dl)?\s*(?:in the morning|this morning|this afternoon|before lunch|after lunch)/gi,
      hint: "",
    },
    {
      re: /\breading\b[^.!?]{0,40}?(?:was|is)\s*(\d{1,2}(?:\.\d{1,2})?)/gi,
      hint: "",
    },
  ];

  for (const { re, hint } of patterns) {
    let m: RegExpExecArray | null;
    const regex = new RegExp(re.source, re.flags);
    while ((m = regex.exec(text)) !== null) {
      const value = Number(m[m.length - 1]);
      if (Number.isNaN(value) || value <= 0 || value > 40) continue;
      const start = Math.max(0, m.index - 30);
      const end = Math.min(text.length, m.index + m[0].length + 80);
      const fragment = text.slice(start, end);
      const timeHint = hint || inferTimeHint(fragment);
      const local = extractFieldsNear(fragment);
      const global = extractFieldsNear(text);
      entries.push({
        glucose_value: value,
        foods_eaten: local.foods_eaten || global.foods_eaten,
        snacks: local.snacks || global.snacks,
        comments: local.comments || global.comments,
        time_hint: timeHint,
        date_hint: dateHint,
      });
    }
  }

  if (!entries.length) {
    const nums = [...text.matchAll(/\b(\d{1,2}(?:\.\d{1,2})?)\b/g)];
    for (const n of nums) {
      const value = Number(n[1]);
      if (Number.isNaN(value) || value <= 0 || value > 40) continue;
      const fragment = text.slice(Math.max(0, n.index! - 40), Math.min(text.length, n.index! + 60));
      if (!/\b(reading|glucose|sugar|level|mmol|was|is)\b/i.test(fragment) && nums.length > 2) continue;
      const local = extractFieldsNear(fragment);
      const global = extractFieldsNear(text);
      entries.push({
        glucose_value: value,
        foods_eaten: local.foods_eaten || global.foods_eaten,
        snacks: local.snacks || global.snacks,
        comments: local.comments || global.comments,
        time_hint: inferTimeHint(fragment),
        date_hint: dateHint,
      });
      break;
    }
  }

  const seen = new Set<string>();
  return entries.filter((e) => {
    const key = `${e.glucose_value}:${e.time_hint}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

export function applyAnswerToMissingFields(
  entries: LogEntry[],
  text: string,
  missing: Array<"foods" | "snacks" | "comments">,
): LogEntry[] {
  const foods = inferFood(text);
  const snacks = inferSnacks(text);
  const comments = inferComments(text);

  return entries.map((e) => {
    const needsFood = !isAnswered(e.foods_eaten) && missing.includes("foods");
    const needsSnacks = !isAnswered(e.snacks) && missing.includes("snacks");
    const needsComments = !isAnswered(e.comments) && missing.includes("comments");

    return {
      ...e,
      foods_eaten: needsFood && isAnswered(foods) ? foods : e.foods_eaten,
      snacks: needsSnacks && isAnswered(snacks) ? snacks : needsSnacks && isExplicitNone(text) ? "none" : e.snacks,
      comments: needsComments && isAnswered(comments) ? comments : e.comments,
    };
  });
}

export function findLastLogMarkerId(msgs: Array<{ id: string; role: string; content: string }>): string | null {
  for (let i = msgs.length - 1; i >= 0; i--) {
    if (msgs[i].role === "bot" && LOG_START_PATTERN.test(msgs[i].content)) return msgs[i].id;
  }
  return null;
}

export function transcriptSinceMarker(
  msgs: Array<{ id: string; role: string; content: string }>,
  markerId: string | null,
): string {
  if (!markerId) return "";
  const idx = msgs.findIndex((m) => m.id === markerId);
  if (idx < 0) return "";
  return msgs
    .slice(idx + 1)
    .filter((m) => m.role === "user")
    .map((m) => m.content)
    .join(" ");
}

export function rebuildLoggingTranscript(msgs: Array<{ role: string; content: string; id?: string }>): string {
  const withIds = msgs.map((m, i) => ({ ...m, id: m.id ?? String(i) }));
  const marker = findLastLogMarkerId(withIds);
  return transcriptSinceMarker(withIds, marker);
}
