import type { MastraUnion } from '@mastra/core/tools';
import { toGlucoseLogInsert } from './glucose-log-row';
import { supabase } from './supabase';
import { getOrCreateChatSession } from '../tools/shared-tools';
import { REQUIRED_ENTRY_FIELDS } from '../tools/entry-schema';

export const CONFIRM_CARD_MARKER = '[CONFIRM_CARD]';

/**
 * A single glucose-log message is short (a reading, a food, a feeling). Very
 * long inputs are either abuse or a runaway transcript, and they can stall the
 * extraction LLM's tool-calling loop for a long time. Cap what we feed the
 * agents so one oversized message can't hang a request.
 */
export const MAX_AGENT_MESSAGE_CHARS = 1500;

export function truncateAgentMessage(message: string, max = MAX_AGENT_MESSAGE_CHARS): string {
  if (typeof message !== 'string' || message.length <= max) return message;
  return `${message.slice(0, max)}…`;
}

const CONFIRM_WORDS = /^(yes|y|save|confirm|ok|okay|sure|yep|yeah)$/i;
const CANCEL_WORDS = /^(no|n|cancel|discard|nope|nah)$/i;

const FOOD_HINTS =
  /\b(ate|eaten|eat|eating|had|food|meal|meals|breakfast|lunch|dinner|snack|snacks|cookie|rice|bread|pasta|egg|eggs|oats|sandwich|salad|beef|chicken|fruit|coffee|tea|juice)\b/i;
const FEELING_HINTS =
  /\b(feel|feeling|felt|fine|great|good|bad|tired|dizzy|sick|well|okay|ok|symptom|symptoms|thirsty|hungry|energy|mood|headache|head\s*ache|nausea|nauseous|shaky|shaking|sweaty|sweating|weak|weakness|blurry|blurred|cramp|cramps|pain|ache|aches|aching|sore|stressed|anxious|anxiety|faint|lightheaded|light-headed|palpitations|numb|tingling|complaints?|unwell|drowsy|sleepy|irritable|jittery)\b/i;
const TIME_HINTS =
  /\b(\d{1,2}\s*(:\d{2})?\s*(am|pm|a\.m\.|p\.m\.)|\d{1,2}:\d{2}|morning|afternoon|evening|night|noon|midnight|today|tonight|now|just now|this morning|this afternoon|this evening|last night|yesterday|at \d)/i;

export function isConfirmMessage(message: string): boolean {
  return CONFIRM_WORDS.test(message.trim());
}

export function isCancelMessage(message: string): boolean {
  return CANCEL_WORDS.test(message.trim());
}

/**
 * A time phrase only counts as an exact time when it pins down a clock time
 * ("7:30am", "14:00", "noon", "just now"). Day-only or day-part phrases
 * ("yesterday", "this morning") would otherwise be silently anchored to a
 * guessed hour — instead we ask the user for the exact time.
 */
const EXACT_TIME_RE =
  /\d{1,2}(?::\d{2})?\s*(?:am|pm|a\.m\.|p\.m\.)|\b\d{1,2}:\d{2}\b|\d{4}-\d{2}-\d{2}t\d{2}:\d{2}|\bnoon\b|\bmidnight\b|\b(?:just|right)\s+now\b|\bnow\b/i;

export function hasExactTime(loggedAt: string): boolean {
  return EXACT_TIME_RE.test(loggedAt);
}

/** Phrase names a day ("yesterday", "on Monday", "6/7") rather than just a clock time. */
const DAY_PART_RE =
  /\b(?:yesterday|today|tonight|last night|this (?:morning|afternoon|evening)|\d+\s+days?\s+ago|sunday|monday|tuesday|wednesday|thursday|friday|saturday|january|february|march|april|may|june|july|august|september|october|november|december|\d{1,2}\/\d{1,2})\b/i;

export function getMissingFields(merged: Record<string, unknown>): string[] {
  return REQUIRED_ENTRY_FIELDS.filter(f => {
    if (merged[f] == null || merged[f] === '') return true;
    return f === 'logged_at' && !hasExactTime(String(merged[f]));
  });
}

export function messageContainsNumber(message: string, value: number): boolean {
  const normalized = message.replace(/,/g, '.');
  const patterns = [
    new RegExp(`\\b${value}\\b`),
    new RegExp(`\\b${value.toFixed(1)}\\b`),
  ];
  return patterns.some(p => p.test(normalized));
}

/**
 * Strip fields the Extraction LLM invented when they aren't supported by the
 * current user message. Fields already in pendingLog are preserved via merge base.
 */
export function sanitizeExtractedFields(
  newEntry: Record<string, unknown>,
  message: string,
  pendingLog: Record<string, unknown>,
): Record<string, unknown> {
  const sanitized = { ...newEntry };

  if (
    sanitized.glucose_value != null &&
    pendingLog.glucose_value == null &&
    !messageContainsNumber(message, Number(sanitized.glucose_value))
  ) {
    delete sanitized.glucose_value;
  }

  if (sanitized.foods_eaten != null && pendingLog.foods_eaten == null && !FOOD_HINTS.test(message)) {
    delete sanitized.foods_eaten;
  }

  if (sanitized.snacks != null && pendingLog.snacks == null && !FOOD_HINTS.test(message)) {
    delete sanitized.snacks;
  }

  if (sanitized.comments != null && pendingLog.comments == null && !FEELING_HINTS.test(message)) {
    delete sanitized.comments;
  }

  if (sanitized.logged_at != null && pendingLog.logged_at == null && !TIME_HINTS.test(message)) {
    delete sanitized.logged_at;
  }

  return sanitized;
}

export function mergePendingEntry(
  pendingLog: Record<string, unknown>,
  rawNewEntry: Record<string, unknown>,
  message: string,
): Record<string, unknown> {
  const newEntry = sanitizeExtractedFields(rawNewEntry, message, pendingLog);

  // Pending "yesterday" + new "7:30am" → "yesterday at 7:30am". The user is
  // answering our exact-time follow-up, so keep the day they already gave.
  const pendingTime = typeof pendingLog.logged_at === 'string' ? pendingLog.logged_at : '';
  const newTime = typeof newEntry.logged_at === 'string' ? newEntry.logged_at : '';
  if (
    pendingTime.length > 0 &&
    newTime.length > 0 &&
    DAY_PART_RE.test(pendingTime) &&
    !DAY_PART_RE.test(newTime) &&
    hasExactTime(newTime) &&
    !hasExactTime(pendingTime)
  ) {
    const article = /^\d/.test(newTime.trim()) ? 'at ' : '';
    newEntry.logged_at = `${pendingTime} ${article}${newTime.trim()}`;
  }

  if (
    pendingLog.glucose_value != null &&
    newEntry.glucose_value != null &&
    Number(pendingLog.glucose_value) === Number(newEntry.glucose_value)
  ) {
    newEntry.glucose_value = null;
  }

  let base: Record<string, unknown> = { ...pendingLog };
  if (
    pendingLog.glucose_value != null &&
    newEntry.glucose_value != null &&
    pendingLog.glucose_value !== newEntry.glucose_value
  ) {
    base = {};
  }

  const merged: Record<string, unknown> = { ...base };
  for (const [key, value] of Object.entries(newEntry)) {
    if (value !== null && value !== undefined && value !== '') {
      merged[key] = value;
    }
  }

  if (merged.snacks == null || merged.snacks === '') {
    merged.snacks = 'none';
  }

  return merged;
}

/** Whether a pending entry refers to a day before today (drives question tense). */
function isPastDayEntry(merged: Record<string, unknown>): boolean {
  const loggedAt = merged.logged_at;
  if (typeof loggedAt !== 'string' || loggedAt.length === 0) return false;
  const resolved = resolveLoggedAt(loggedAt);
  return !resolved.isToday && !resolved.explicitFuture;
}

function formatAcknowledgment(merged: Record<string, unknown>): string {
  const value = merged.glucose_value;
  const unit = merged.glucose_unit ?? 'mmol/L';
  const time = merged.logged_at;

  if (value == null) return '';

  if (typeof time === 'string' && time.length > 0) {
    // "taken at 10am" / "taken yesterday at 2pm" — add "at" only before bare clock times.
    const article = /^\d/.test(time.trim()) ? 'at ' : '';
    return `Got it — ${value} ${unit}, taken ${article}${time}.`;
  }
  return `Got it — ${value} ${unit}.`;
}

export function formatFollowUpQuestion(
  merged: Record<string, unknown>,
  missingFields: string[],
): string {
  const questions: string[] = [];

  const needsFood = missingFields.includes('foods_eaten');
  const needsFeeling = missingFields.includes('comments');
  const needsTime = missingFields.includes('logged_at');
  const needsGlucose = missingFields.includes('glucose_value');

  // Past-day readings get past tense ("how were you feeling?"), today's get present.
  const past = isPastDayEntry(merged);
  const feelingQ = past ? 'how were you feeling at the time?' : 'how are you feeling?';

  if (needsFood && needsFeeling) {
    questions.push(`What did you eat, and ${feelingQ}`);
  } else if (needsFood) {
    questions.push(past ? 'What did you eat around that reading?' : 'What did you eat?');
  } else if (needsFeeling) {
    questions.push(`And ${feelingQ}`);
  }

  if (needsTime) {
    const partialTime = typeof merged.logged_at === 'string' ? merged.logged_at.trim() : '';
    let timeQ: string;
    if (partialTime.length > 0) {
      // We know the day/part of day but not the exact time.
      timeQ = `What exact time ${past ? 'was that' : 'did you take it'} (e.g. 7:30am)?`;
    } else {
      timeQ =
        questions.length > 0
          ? 'Also, what exact time did you take the reading (e.g. 7:30am)?'
          : 'What exact time did you take this reading (e.g. 7:30am)?';
    }
    questions.push(timeQ);
  }

  if (needsGlucose) {
    questions.push("What's your glucose reading?");
  }

  const ack = formatAcknowledgment(merged);
  if (questions.length === 0) {
    return ack || 'Could you share a few more details about this reading?';
  }

  return ack ? `${ack} ${questions.join(' ')}` : questions.join(' ');
}

export function formatConfirmCard(merged: Record<string, unknown>): string {
  const unit = merged.glucose_unit ?? 'mmol/L';
  const rawTime = typeof merged.logged_at === 'string' ? merged.logged_at : '';
  const timeLabel = rawTime.length > 0 ? `${rawTime} reading` : 'Reading';

  // For readings not taken today, show the resolved absolute date so the user
  // confirms the actual day, not just the phrase ("yesterday at 2pm (Mon 6 Jul, 14:00)").
  let timeDisplay: string = rawTime;
  if (rawTime.length > 0) {
    const resolved = resolveLoggedAt(rawTime);
    if (!resolved.isToday && !resolved.explicitFuture) {
      timeDisplay = `${rawTime} (${formatResolvedDate(resolved.iso)})`;
    }
  }

  return `---
${timeLabel}
- Glucose: ${merged.glucose_value} ${unit}
- Food: ${merged.foods_eaten}
- Snacks: ${merged.snacks ?? 'none'}
- Comments: ${merged.comments}
- Time: ${timeDisplay}
---`;
}

export function formatConfirmCardWithMarker(merged: Record<string, unknown>): string {
  return `${formatConfirmCard(merged)}\n${CONFIRM_CARD_MARKER}`;
}

const WEEKDAYS = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];
const MONTHS = [
  'january', 'february', 'march', 'april', 'may', 'june',
  'july', 'august', 'september', 'october', 'november', 'december',
];

function sameDay(a: Date, b: Date): boolean {
  return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
}

export interface ResolvedLoggedAt {
  iso: string;
  /** The resolved timestamp falls on today's date. */
  isToday: boolean;
  /** The phrase points at the future ("tomorrow", a future date) — reject, readings must have happened. */
  explicitFuture: boolean;
}

/**
 * Resolve a human time phrase into a concrete timestamp, handling both the
 * day part ("yesterday", "on Monday", "2 days ago", "6/7", "July 6") and the
 * time part ("2pm", "09:30", "morning"). Rules:
 * - No day word + a time later than now → most recent past occurrence (yesterday).
 * - Same-day words ("tonight", "this morning") resolving slightly ahead of now → clamp to now.
 * - "tomorrow" / "next …" / explicit future dates → explicitFuture (caller rejects).
 * - Day word with no time → midday of that day.
 */
export function resolveLoggedAt(loggedAt: string, now: Date = new Date()): ResolvedLoggedAt {
  const raw = loggedAt.trim().toLowerCase();
  const result = new Date(now);
  const FUTURE_SLACK_MS = 60_000;

  // Already an ISO timestamp
  if (/^\d{4}-\d{2}-\d{2}t/i.test(raw)) {
    const d = new Date(loggedAt.trim());
    if (!Number.isNaN(d.getTime())) {
      return {
        iso: d.toISOString(),
        isToday: sameDay(d, now),
        explicitFuture: d.getTime() > now.getTime() + FUTURE_SLACK_MS,
      };
    }
  }

  if (/\btomorrow\b|\bnext\s+\w+/.test(raw)) {
    return { iso: now.toISOString(), isToday: true, explicitFuture: true };
  }

  // ── Day part ──
  let dayOffset: number | null = null;
  let explicitDate: Date | null = null;

  if (/\bday before yesterday\b/.test(raw)) dayOffset = -2;
  else if (/\byesterday\b/.test(raw)) dayOffset = -1;
  else if (/\b(today|tonight|this (morning|afternoon|evening)|just now|now)\b/.test(raw)) dayOffset = 0;
  else {
    const ago = raw.match(/\b(\d+)\s+days?\s+ago\b/);
    if (ago) dayOffset = -parseInt(ago[1], 10);
  }

  if (dayOffset === null) {
    for (let i = 0; i < 7; i++) {
      if (new RegExp(`\\b(?:last\\s+)?${WEEKDAYS[i]}\\b`).test(raw)) {
        let diff = now.getDay() - i;
        if (diff < 0) diff += 7;
        if (/\blast\s/.test(raw) && diff === 0) diff = 7;
        dayOffset = -diff;
        break;
      }
    }
  }

  if (dayOffset === null) {
    // Numeric date, day-first (e.g. "6/7" = 6 July); swap if the month slot is impossible.
    const dm = raw.match(/\b(\d{1,2})\/(\d{1,2})(?:\/(\d{2,4}))?\b/);
    if (dm) {
      let d = parseInt(dm[1], 10);
      let m = parseInt(dm[2], 10);
      if (m > 12 && d <= 12) [d, m] = [m, d];
      const y = dm[3] ? (parseInt(dm[3], 10) < 100 ? 2000 + parseInt(dm[3], 10) : parseInt(dm[3], 10)) : now.getFullYear();
      explicitDate = new Date(y, m - 1, d);
    } else {
      for (let m = 0; m < 12; m++) {
        const re = new RegExp(
          `\\b(?:(\\d{1,2})(?:st|nd|rd|th)?\\s+(?:of\\s+)?${MONTHS[m]}|${MONTHS[m]}\\s+(\\d{1,2})(?:st|nd|rd|th)?)\\b`,
        );
        const mm = raw.match(re);
        if (mm) {
          explicitDate = new Date(now.getFullYear(), m, parseInt(mm[1] ?? mm[2], 10));
          break;
        }
      }
    }
  }

  if (explicitDate && !Number.isNaN(explicitDate.getTime())) {
    result.setFullYear(explicitDate.getFullYear(), explicitDate.getMonth(), explicitDate.getDate());
  } else if (dayOffset !== null) {
    result.setDate(result.getDate() + dayOffset);
  }

  const hasDayPart = (explicitDate !== null && !Number.isNaN(explicitDate.getTime())) || dayOffset !== null;

  // ── Time part ──
  let hasTime = true;
  const pmMatch = raw.match(/(\d{1,2})(?::(\d{2}))?\s*(pm|p\.m\.)/);
  const amMatch = raw.match(/(\d{1,2})(?::(\d{2}))?\s*(am|a\.m\.)/);
  const clockMatch = raw.match(/\b(\d{1,2}):(\d{2})\b/);

  if (pmMatch) {
    let hour = parseInt(pmMatch[1], 10);
    if (hour < 12) hour += 12;
    result.setHours(hour, pmMatch[2] ? parseInt(pmMatch[2], 10) : 0, 0, 0);
  } else if (amMatch) {
    let hour = parseInt(amMatch[1], 10);
    if (hour === 12) hour = 0;
    result.setHours(hour, amMatch[2] ? parseInt(amMatch[2], 10) : 0, 0, 0);
  } else if (clockMatch) {
    result.setHours(parseInt(clockMatch[1], 10), parseInt(clockMatch[2], 10), 0, 0);
  } else if (/morning/.test(raw)) {
    result.setHours(8, 0, 0, 0);
  } else if (/afternoon/.test(raw)) {
    result.setHours(14, 0, 0, 0);
  } else if (/evening|night|tonight/.test(raw)) {
    result.setHours(19, 0, 0, 0);
  } else if (/\bnoon\b/.test(raw)) {
    result.setHours(12, 0, 0, 0);
  } else if (/\bmidnight\b/.test(raw)) {
    result.setHours(0, 0, 0, 0);
  } else {
    hasTime = false;
  }

  if (!hasDayPart && !hasTime) {
    const parsed = new Date(loggedAt);
    if (!Number.isNaN(parsed.getTime())) {
      return {
        iso: parsed.toISOString(),
        isToday: sameDay(parsed, now),
        explicitFuture: parsed.getTime() > now.getTime() + FUTURE_SLACK_MS,
      };
    }
    return { iso: now.toISOString(), isToday: true, explicitFuture: false };
  }

  if (hasDayPart && !hasTime) {
    // Day-only phrase ("yesterday", "on Monday") — anchor to midday.
    if (dayOffset === 0) {
      // "today"/"just now" with no time means now.
      return { iso: now.toISOString(), isToday: true, explicitFuture: false };
    }
    result.setHours(12, 0, 0, 0);
  }

  const isFuture = result.getTime() > now.getTime() + FUTURE_SLACK_MS;

  if (isFuture) {
    if (!hasDayPart) {
      // Bare time later than now ("at 11pm" said at 2pm) → most recent past occurrence.
      result.setDate(result.getDate() - 1);
    } else if (dayOffset === 0) {
      // Same-day phrase slightly ahead ("this morning" said at 7am) → clamp to now.
      return { iso: now.toISOString(), isToday: true, explicitFuture: false };
    } else {
      // Explicit future date — reject upstream.
      return { iso: result.toISOString(), isToday: sameDay(result, now), explicitFuture: true };
    }
  }

  return { iso: result.toISOString(), isToday: sameDay(result, now), explicitFuture: false };
}

/** Parse human time phrases into an ISO timestamp (best-effort). */
export function parseLoggedAtToIso(loggedAt: string): string {
  return resolveLoggedAt(loggedAt).iso;
}

/** Human-friendly rendering of a resolved timestamp, e.g. "Mon 6 Jul, 14:00". */
export function formatResolvedDate(iso: string): string {
  return new Date(iso).toLocaleString('en-GB', {
    weekday: 'short',
    day: 'numeric',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
  });
}

export function computeEntryTag(
  loggedAtIso: string,
  reminderTimes: string[],
): 'on_time' | 'late_entry' {
  if (reminderTimes.length === 0) return 'on_time';

  const loggedDate = new Date(loggedAtIso);
  if (Number.isNaN(loggedDate.getTime())) return 'on_time';

  for (const rt of reminderTimes) {
    const [h, m] = rt.split(':').map(v => parseInt(v, 10));
    const reminder = new Date(loggedDate);
    reminder.setHours(h, m ?? 0, 0, 0);
    const diffMs = Math.abs(loggedDate.getTime() - reminder.getTime());
    if (diffMs <= 60 * 60 * 1000) return 'on_time';
  }

  return 'late_entry';
}

export async function clearChatSessionState(userId: string): Promise<void> {
  const session = await getOrCreateChatSession(userId);
  const { error } = await supabase
    .from('chat_sessions')
    .update({ flow_step: null, pending_log: null })
    .eq('id', session.id);

  if (error) {
    throw new Error(`Failed to clear chat session: ${error.message}`);
  }
}

export async function persistSessionState(
  userId: string,
  merged: Record<string, unknown>,
  allComplete: boolean,
): Promise<void> {
  const session = await getOrCreateChatSession(userId);
  const { error } = await supabase
    .from('chat_sessions')
    .update({
      flow_step: allComplete ? 'confirming' : 'collecting',
      pending_log: merged,
    })
    .eq('id', session.id);

  if (error) {
    throw new Error(`Failed to save session state: ${error.message}`);
  }
}

export function formatSaveConfirmation(
  merged: Record<string, unknown>,
  alert: 'low' | 'high' | null,
  thresholdValue: number | null,
): string {
  const unit = merged.glucose_unit ?? 'mmol/L';
  const value = merged.glucose_value;
  let time = String(merged.logged_at ?? 'now');
  const resolved = resolveLoggedAt(time);
  if (!resolved.isToday && !resolved.explicitFuture) {
    time = `${time} (${formatResolvedDate(resolved.iso)})`;
  }
  let text = `Saved! Logged ${value} ${unit} for ${time}.`;

  if (alert === 'low' && thresholdValue != null) {
    text += `\n⚠️ URGENT — LOW GLUCOSE: Your reading of ${value} ${unit} is below your safe threshold of ${thresholdValue} ${unit}. Eat or drink 15g of fast-acting carbs immediately (e.g. glucose tablets, fruit juice, or sweets). Sit down and recheck in 15 minutes.`;
    text += '\nWould you like tips on what to eat right now?';
  } else if (alert === 'high' && thresholdValue != null) {
    text += `\n⚠️ HIGH GLUCOSE: Your reading of ${value} ${unit} is above your safe threshold of ${thresholdValue} ${unit}. Drink water, avoid carbs, and consider your medication. Contact your doctor if it stays high or you feel unwell.`;
    text += '\nWould you like advice on managing a high reading?';
  }

  return text;
}

export async function executeConfirmCancel(userId: string): Promise<string> {
  await clearChatSessionState(userId);
  return 'No problem — log discarded.';
}

export async function executeConfirmSave(
  userId: string,
  mergedEntry: Record<string, unknown>,
  _mastra?: MastraUnion,
): Promise<string> {
  const missing = getMissingFields(mergedEntry);
  if (missing.length > 0) {
    return formatFollowUpQuestion(mergedEntry, missing);
  }

  // Idempotency guard against concurrent confirmations (double-tapped "yes",
  // retries, the client firing twice). This atomic compare-and-swap flips the
  // session out of 'confirming' in a single statement; only the request that
  // wins the swap proceeds to insert. Losers return a benign confirmation
  // without writing a duplicate glucose_logs row.
  const today = new Date().toISOString().slice(0, 10);
  const { data: claimed, error: claimError } = await supabase
    .from('chat_sessions')
    .update({ flow_step: null, pending_log: null })
    .eq('user_id', userId)
    .eq('session_date', today)
    .eq('flow_step', 'confirming')
    .select('id');

  if (claimError) {
    throw new Error(`Failed to claim confirmation: ${claimError.message}`);
  }

  if (!claimed || claimed.length === 0) {
    // No 'confirming' session left to claim — another request already saved
    // this entry. Acknowledge without inserting again.
    const unit = (mergedEntry.glucose_unit as string) ?? 'mmol/L';
    return `Saved! Logged ${mergedEntry.glucose_value} ${unit} for ${mergedEntry.logged_at ?? 'now'}.`;
  }

  const { data: profile } = await supabase
    .from('profiles')
    .select('glucose_unit, reminder_times, low_glucose_threshold, high_glucose_threshold')
    .eq('user_id', userId)
    .maybeSingle();

  const glucose_unit = (mergedEntry.glucose_unit as string) ?? profile?.glucose_unit ?? 'mmol/L';
  const loggedAtRaw = String(mergedEntry.logged_at);
  const logged_at = parseLoggedAtToIso(loggedAtRaw);
  const reminderTimes: string[] = profile?.reminder_times ?? [];
  const entry_tag = computeEntryTag(logged_at, reminderTimes);

  const { data, error } = await supabase
    .from('glucose_logs')
    .insert(
      toGlucoseLogInsert({
        user_id: userId,
        glucose_value: Number(mergedEntry.glucose_value),
        glucose_unit,
        foods_eaten: String(mergedEntry.foods_eaten),
        snacks: String(mergedEntry.snacks ?? 'none'),
        comments: String(mergedEntry.comments),
        logged_at,
        entry_tag,
      }),
    )
    .select('id')
    .single();

  if (error) {
    // Restore the session so the user can retry "yes" rather than losing the entry.
    await supabase
      .from('chat_sessions')
      .update({ flow_step: 'confirming', pending_log: mergedEntry })
      .eq('user_id', userId)
      .eq('session_date', today);
    throw new Error(`Failed to save glucose log: ${error.message}`);
  }

  const defaultLow = glucose_unit === 'mg/dL' ? 70 : 3.9;
  const defaultHigh = glucose_unit === 'mg/dL' ? 180 : 10.0;
  const low = (profile as { low_glucose_threshold?: number } | null)?.low_glucose_threshold ?? defaultLow;
  const high = (profile as { high_glucose_threshold?: number } | null)?.high_glucose_threshold ?? defaultHigh;
  const glucoseValue = Number(mergedEntry.glucose_value);

  let alert: 'low' | 'high' | null = null;
  let threshold_value: number | null = null;
  if (glucoseValue < low) {
    alert = 'low';
    threshold_value = low;
  } else if (glucoseValue > high) {
    alert = 'high';
    threshold_value = high;
  }

  void data;

  return formatSaveConfirmation(
    { ...mergedEntry, glucose_unit, logged_at: loggedAtRaw },
    alert,
    threshold_value,
  );
}

export function buildCollectingResponse(
  merged: Record<string, unknown>,
  missingFields: string[],
  allComplete: boolean,
): string {
  if (allComplete) {
    return formatConfirmCardWithMarker(merged);
  }
  return formatFollowUpQuestion(merged, missingFields);
}
