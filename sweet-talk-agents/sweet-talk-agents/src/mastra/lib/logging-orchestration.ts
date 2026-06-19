import type { MastraUnion } from '@mastra/core/tools';
import { supabase } from './supabase';
import { getOrCreateChatSession } from '../tools/shared-tools';
import { REQUIRED_ENTRY_FIELDS } from '../tools/entry-schema';

export const CONFIRM_CARD_MARKER = '[CONFIRM_CARD]';

const CONFIRM_WORDS = /^(yes|y|save|confirm|ok|okay|sure|yep|yeah)$/i;
const CANCEL_WORDS = /^(no|n|cancel|discard|nope|nah)$/i;

const FOOD_HINTS =
  /\b(ate|eaten|eat|eating|had|food|meal|meals|breakfast|lunch|dinner|snack|snacks|cookie|rice|bread|pasta|egg|eggs|oats|sandwich|salad|beef|chicken|fruit|coffee|tea|juice)\b/i;
const FEELING_HINTS =
  /\b(feel|feeling|felt|fine|great|good|bad|tired|dizzy|sick|well|okay|ok|symptom|symptoms|thirsty|hungry|energy|mood)\b/i;
const TIME_HINTS =
  /\b(\d{1,2}\s*(:\d{2})?\s*(am|pm|a\.m\.|p\.m\.)|\d{1,2}:\d{2}|morning|afternoon|evening|night|noon|midnight|today|tonight|now|just now|this morning|this afternoon|this evening|last night|yesterday|at \d)/i;

export function isConfirmMessage(message: string): boolean {
  return CONFIRM_WORDS.test(message.trim());
}

export function isCancelMessage(message: string): boolean {
  return CANCEL_WORDS.test(message.trim());
}

export function getMissingFields(merged: Record<string, unknown>): string[] {
  return REQUIRED_ENTRY_FIELDS.filter(f => merged[f] == null || merged[f] === '');
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

function formatAcknowledgment(merged: Record<string, unknown>): string {
  const value = merged.glucose_value;
  const unit = merged.glucose_unit ?? 'mmol/L';
  const time = merged.logged_at;

  if (value == null) return '';

  if (time) {
    return `Got it — ${value} ${unit} ${time}.`.replace(/\s+\./g, '.');
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

  if (needsFood && needsFeeling) {
    questions.push('What did you eat, and how are you feeling?');
  } else if (needsFood) {
    questions.push('What did you eat?');
  } else if (needsFeeling) {
    questions.push('And how are you feeling?');
  }

  if (needsTime) {
    questions.push(
      questions.length > 0
        ? 'Also, when did you take the reading?'
        : 'When did you take this reading?',
    );
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
  const timeLabel =
    typeof merged.logged_at === 'string' && merged.logged_at.length > 0
      ? `${merged.logged_at} reading`
      : 'Reading';

  return `---
${timeLabel}
- Glucose: ${merged.glucose_value} ${unit}
- Food: ${merged.foods_eaten}
- Snacks: ${merged.snacks ?? 'none'}
- Comments: ${merged.comments}
- Time: ${merged.logged_at}
---`;
}

export function formatConfirmCardWithMarker(merged: Record<string, unknown>): string {
  return `${formatConfirmCard(merged)}\n${CONFIRM_CARD_MARKER}`;
}

/** Parse human time phrases into an ISO timestamp (best-effort). */
export function parseLoggedAtToIso(loggedAt: string): string {
  const raw = loggedAt.trim().toLowerCase();
  const now = new Date();

  if (/^\d{4}-\d{2}-\d{2}t/i.test(raw)) {
    const d = new Date(raw);
    if (!Number.isNaN(d.getTime())) return d.toISOString();
  }

  const pmMatch = raw.match(/(\d{1,2})(?::(\d{2}))?\s*(pm|p\.m\.)/);
  if (pmMatch) {
    let hour = parseInt(pmMatch[1], 10);
    if (hour < 12) hour += 12;
    const min = pmMatch[2] ? parseInt(pmMatch[2], 10) : 0;
    now.setHours(hour, min, 0, 0);
    return now.toISOString();
  }

  const amMatch = raw.match(/(\d{1,2})(?::(\d{2}))?\s*(am|a\.m\.)/);
  if (amMatch) {
    let hour = parseInt(amMatch[1], 10);
    if (hour === 12) hour = 0;
    const min = amMatch[2] ? parseInt(amMatch[2], 10) : 0;
    now.setHours(hour, min, 0, 0);
    return now.toISOString();
  }

  const clockMatch = raw.match(/\b(\d{1,2}):(\d{2})\b/);
  if (clockMatch) {
    now.setHours(parseInt(clockMatch[1], 10), parseInt(clockMatch[2], 10), 0, 0);
    return now.toISOString();
  }

  if (/morning/.test(raw)) {
    now.setHours(8, 0, 0, 0);
    return now.toISOString();
  }
  if (/afternoon/.test(raw)) {
    now.setHours(14, 0, 0, 0);
    return now.toISOString();
  }
  if (/evening|night|tonight/.test(raw)) {
    now.setHours(19, 0, 0, 0);
    return now.toISOString();
  }
  if (/noon/.test(raw)) {
    now.setHours(12, 0, 0, 0);
    return now.toISOString();
  }
  if (/today|now|just now/.test(raw)) {
    return now.toISOString();
  }

  const parsed = new Date(loggedAt);
  if (!Number.isNaN(parsed.getTime())) return parsed.toISOString();

  return now.toISOString();
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
  const time = merged.logged_at ?? 'now';
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
    .insert({
      user_id: userId,
      glucose_value: Number(mergedEntry.glucose_value),
      glucose_unit,
      foods_eaten: String(mergedEntry.foods_eaten),
      snacks: String(mergedEntry.snacks ?? 'none'),
      comments: String(mergedEntry.comments),
      logged_at,
      entry_tag,
    })
    .select('id')
    .single();

  if (error) {
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
  await clearChatSessionState(userId);

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
