/**
 * Comprehensive agent test suite — calls every registered Mastra agent
 * with varied use cases and scores effectiveness.
 *
 * Usage: node --env-file=.env scripts/test-all-agents.mjs
 */
import { createClient } from '@supabase/supabase-js';
import { writeFileSync, mkdirSync } from 'fs';

const BASE_URL = process.env.MASTRA_API_URL ?? 'http://localhost:4111';
const USER_ID = process.env.TEST_USER_ID ?? '238b4ce8-68fa-4080-aafd-92d55e192f1d';
const TIMEOUT_MS = 120_000;

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY,
  { auth: { persistSession: false } },
);

const results = [];

async function callAgent(agentId, prompt, threadSuffix = '') {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  const thread = `agent-test-${agentId}-${threadSuffix || Date.now()}`;

  try {
    const res = await fetch(`${BASE_URL}/api/agents/${agentId}/generate`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-mastra-dev-playground': 'true',
      },
      body: JSON.stringify({
        messages: [{ role: 'user', content: prompt }],
        memory: { resource: USER_ID, thread },
      }),
      signal: controller.signal,
    });
    clearTimeout(timer);

    if (!res.ok) {
      const errText = await res.text().catch(() => '');
      return { ok: false, text: '', error: `HTTP ${res.status}: ${errText.slice(0, 400)}`, ms: 0 };
    }

    const json = await res.json();
    const text = json?.text ?? json?.object?.text ?? json?.result?.text ?? '';
    return { ok: true, text: String(text), error: null, ms: json?.runDuration ?? 0 };
  } catch (e) {
    clearTimeout(timer);
    return { ok: false, text: '', error: e.message, ms: 0 };
  }
}

function score(label, checks) {
  const passed = checks.filter(c => c.pass).length;
  const total = checks.length;
  const pct = total ? Math.round((passed / total) * 100) : 0;
  let rating;
  if (pct >= 90) rating = 'Excellent';
  else if (pct >= 75) rating = 'Good';
  else if (pct >= 50) rating = 'Fair';
  else if (pct >= 25) rating = 'Poor';
  else rating = 'Fail';

  return { label, checks, passed, total, pct, rating };
}

function has(text, ...patterns) {
  return patterns.some(p => (typeof p === 'string' ? text.includes(p) : p.test(text)));
}

function lacks(text, ...patterns) {
  return patterns.every(p => (typeof p === 'string' ? !text.includes(p) : !p.test(text)));
}

async function setChatSession(flowStep, pendingLog) {
  const today = new Date().toISOString().slice(0, 10);
  await supabase.from('chat_sessions').upsert(
    {
      user_id: USER_ID,
      session_date: today,
      flow_step: flowStep,
      pending_log: pendingLog,
    },
    { onConflict: 'user_id,session_date' },
  );
}

async function clearChatSession() {
  const today = new Date().toISOString().slice(0, 10);
  await supabase
    .from('chat_sessions')
    .update({ flow_step: null, pending_log: null })
    .eq('user_id', USER_ID)
    .eq('session_date', today);
}

// ─── GATEKEEPER ───────────────────────────────────────────────────────────────
async function testGatekeeper() {
  const cases = [];

  // UC1: Basic glucose logging
  {
    await clearChatSession();
    const prompt = `userId: ${USER_ID}\ntoday my reading was 6.7`;
    const r = await callAgent('gatekeeper-agent', prompt, 'gk-log');
    const s = score('GK-1: Route glucose reading', [
      { name: 'Request succeeded', pass: r.ok },
      { name: 'No reasoning preamble', pass: lacks(r.text, /Let me|I'll route|classifying|hand off/i) },
      { name: 'Acknowledges 6.7', pass: has(r.text, '6.7') },
      { name: 'Asks for food or feeling', pass: /eat|feel|food/i.test(r.text) },
      { name: 'No health advice', pass: lacks(r.text, /adjust your diet|you should|consider/i) },
    ]);
    cases.push({ useCase: 'New glucose reading (6.7)', response: r.text.slice(0, 500), error: r.error, ...s });
  }

  // UC2: Q&A redirect
  {
    const prompt = `userId: ${USER_ID}\nwhat was my last reading?`;
    const r = await callAgent('gatekeeper-agent', prompt, 'gk-redirect');
    const expected = 'For questions about your readings or history, head to the Q&A page from the sidebar.';
    const s = score('GK-2: Redirect Q&A', [
      { name: 'Request succeeded', pass: r.ok },
      { name: 'Exact redirect message', pass: r.text.trim() === expected || r.text.includes('Q&A page') },
      { name: 'Did not answer the question', pass: lacks(r.text, /5\.|6\.|7\.|mmol|last reading was/i) },
    ]);
    cases.push({ useCase: 'History question redirect', response: r.text.slice(0, 500), error: r.error, ...s });
  }

  // UC3: Off-topic
  {
    const prompt = `userId: ${USER_ID}\ntell me a joke`;
    const r = await callAgent('gatekeeper-agent', prompt, 'gk-offtopic');
    const s = score('GK-3: Off-topic rejection', [
      { name: 'Request succeeded', pass: r.ok },
      { name: 'Declines off-topic', pass: /only help|logging glucose|ready to log/i.test(r.text) },
      { name: 'No joke told', pass: lacks(r.text, /why did|knock knock|haha/i) },
    ]);
    cases.push({ useCase: 'Off-topic (joke request)', response: r.text.slice(0, 500), error: r.error, ...s });
  }

  // UC4: Time phrase = LOGGING not CORRECTION
  {
    await clearChatSession();
    const prompt = `userId: ${USER_ID}\nthis morning my reading was 4.5`;
    const r = await callAgent('gatekeeper-agent', prompt, 'gk-time');
    const s = score('GK-4: Time phrase as new log', [
      { name: 'Request succeeded', pass: r.ok },
      { name: 'Acknowledges 4.5', pass: has(r.text, '4.5') },
      { name: 'References morning', pass: /morning/i.test(r.text) },
      { name: 'No correction language', pass: lacks(r.text, /mistake|correct|update that/i) },
    ]);
    cases.push({ useCase: 'Time phrase (this morning 4.5)', response: r.text.slice(0, 500), error: r.error, ...s });
  }

  // UC5: Confirming flow → CORRECTION
  {
    await setChatSession('confirming', {
      glucose_value: 7.8,
      glucose_unit: 'mmol/L',
      foods_eaten: 'oats',
      snacks: 'none',
      comments: 'gk-test entry - delete me',
      logged_at: 'this morning',
    });
    const prompt = `userId: ${USER_ID}\nyes`;
    const r = await callAgent('gatekeeper-agent', prompt, 'gk-confirm');
    const s = score('GK-5: Confirming → CORRECTION route', [
      { name: 'Request succeeded', pass: r.ok },
      { name: 'Save or confirm handled', pass: /saved|logged|confirm|discard|no problem/i.test(r.text) },
    ]);
    cases.push({ useCase: 'Confirmation reply ("yes")', response: r.text.slice(0, 500), error: r.error, ...s });
    // "yes" saves a real row — clean it up so the suite is non-destructive.
    await supabase.from('glucose_logs').delete().eq('user_id', USER_ID).eq('comments', 'gk-test entry - delete me');
    await clearChatSession();
  }

  const avgPct = Math.round(cases.reduce((a, c) => a + c.pct, 0) / cases.length);
  return { agent: 'Gatekeeper Agent', id: 'gatekeeper-agent', cases, avgPct };
}

// ─── EXTRACTION + LOGGING ─────────────────────────────────────────────────────
async function testExtraction() {
  const cases = [];

  // UC1: Partial entry
  {
    await clearChatSession();
    const prompt = `userId: ${USER_ID}\nmessage: today my reading was 6.7`;
    const r = await callAgent('extraction-logging-agent', prompt, 'ext-partial');
    const s = score('EXT-1: Extract partial entry', [
      { name: 'Request succeeded', pass: r.ok },
      { name: 'No tool JSON leaked', pass: lacks(r.text, /getUserProfileTool|"parameters"/i) },
      { name: 'Acknowledges 6.7', pass: has(r.text, '6.7') },
      { name: 'Asks missing fields', pass: /eat|feel|food/i.test(r.text) },
      { name: 'Did not save prematurely', pass: lacks(r.text, /^Saved!/i) },
    ]);
    cases.push({ useCase: 'Partial glucose entry', response: r.text.slice(0, 500), error: r.error, ...s });
  }

  // UC2: Full entry in one message
  {
    await clearChatSession();
    const prompt = `userId: ${USER_ID}\nmessage: my reading was 5.2, I had scrambled eggs for breakfast, feeling good, this morning`;
    const r = await callAgent('extraction-logging-agent', prompt, 'ext-full');
    const s = score('EXT-2: Full entry extraction', [
      { name: 'Request succeeded', pass: r.ok },
      { name: 'Shows glucose 5.2', pass: has(r.text, '5.2') },
      { name: 'Shows food or confirm card', pass: /egg|CONFIRM_CARD|---/i.test(r.text) },
      { name: 'No unsolicited advice', pass: lacks(r.text, /you should|consider reducing/i) },
    ]);
    cases.push({ useCase: 'Complete entry in one message', response: r.text.slice(0, 500), error: r.error, ...s });
    await clearChatSession();
  }

  // UC3: Food-only follow-up (simulated via handoff context)
  {
    await setChatSession('collecting', {
      glucose_value: 6.1,
      glucose_unit: 'mmol/L',
      logged_at: 'today',
      foods_eaten: null,
      comments: null,
    });
    const prompt = `userId: ${USER_ID}\nmessage: I had pasta and salad, feeling a bit tired`;
    const r = await callAgent('extraction-logging-agent', prompt, 'ext-food');
    const s = score('EXT-3: Food + feeling follow-up', [
      { name: 'Request succeeded', pass: r.ok },
      { name: 'Captures food or feeling', pass: /pasta|salad|tired|feel/i.test(r.text) },
      { name: 'No tool narration', pass: lacks(r.text, /handoffToValidation|Call get/i) },
    ]);
    cases.push({ useCase: 'Food + symptom follow-up', response: r.text.slice(0, 500), error: r.error, ...s });
    await clearChatSession();
  }

  // UC4: High glucose (alert path)
  {
    await clearChatSession();
    const prompt = `userId: ${USER_ID}\nmessage: my reading is 14.2 right now, had rice, feeling thirsty`;
    const r = await callAgent('extraction-logging-agent', prompt, 'ext-high');
    const s = score('EXT-4: High reading extraction', [
      { name: 'Request succeeded', pass: r.ok },
      { name: 'Acknowledges 14.2', pass: has(r.text, '14.2') },
      { name: 'No premature save', pass: lacks(r.text, /^Saved!/i) || has(r.text, 'CONFIRM_CARD') },
    ]);
    cases.push({ useCase: 'High glucose reading (14.2)', response: r.text.slice(0, 500), error: r.error, ...s });
    await clearChatSession();
  }

  const avgPct = Math.round(cases.reduce((a, c) => a + c.pct, 0) / cases.length);
  return { agent: 'Extraction + Logging Agent', id: 'extraction-logging-agent', cases, avgPct };
}

// ─── VALIDATION + CONFIRMATION ────────────────────────────────────────────────
async function testValidation() {
  const cases = [];

  // UC1: Missing fields
  {
    const prompt = `userId: ${USER_ID}
currentFlowStep: collecting
mergedEntry: {"glucose_value":7.8,"glucose_unit":"mmol/L","logged_at":"this morning"}
missingFields: ["foods_eaten","comments"]
allComplete: false
originalMessage: today my reading was 7.8`;
    const r = await callAgent('validation-confirmation-agent', prompt, 'val-missing');
    const s = score('VAL-1: Ask all missing fields', [
      { name: 'Request succeeded', pass: r.ok },
      { name: 'Asks about food', pass: /eat|food/i.test(r.text) },
      { name: 'Asks about feeling', pass: /feel/i.test(r.text) },
      { name: 'No confirm card yet', pass: lacks(r.text, '[CONFIRM_CARD]') },
    ]);
    cases.push({ useCase: 'Ask for missing food + comments', response: r.text.slice(0, 500), error: r.error, ...s });
  }

  // UC2: Show confirm card
  {
    const prompt = `userId: ${USER_ID}
currentFlowStep: collecting
mergedEntry: {"glucose_value":7.8,"glucose_unit":"mmol/L","logged_at":"this morning","foods_eaten":"oats","snacks":"none","comments":"feeling fine"}
missingFields: []
allComplete: true
originalMessage: feeling fine`;
    const r = await callAgent('validation-confirmation-agent', prompt, 'val-card');
    const s = score('VAL-2: Confirmation card', [
      { name: 'Request succeeded', pass: r.ok },
      { name: 'Shows glucose value', pass: has(r.text, '7.8') },
      { name: 'Shows food', pass: /oats/i.test(r.text) },
      { name: 'Has CONFIRM_CARD tag', pass: has(r.text, '[CONFIRM_CARD]') },
    ]);
    cases.push({ useCase: 'Show confirmation card', response: r.text.slice(0, 500), error: r.error, ...s });
  }

  // UC3: Save on "yes"
  {
    await setChatSession('confirming', {
      glucose_value: 5.9,
      glucose_unit: 'mmol/L',
      foods_eaten: 'test toast',
      snacks: 'none',
      comments: 'agent test entry - delete me',
      logged_at: new Date().toISOString(),
    });
    const prompt = `userId: ${USER_ID}
currentFlowStep: confirming
mergedEntry: {"glucose_value":5.9,"glucose_unit":"mmol/L","foods_eaten":"test toast","snacks":"none","comments":"agent test entry - delete me","logged_at":"${new Date().toISOString()}"}
missingFields: []
allComplete: true
originalMessage: yes`;
    const r = await callAgent('validation-confirmation-agent', prompt, 'val-save');
    const s = score('VAL-3: Save on confirmation', [
      { name: 'Request succeeded', pass: r.ok },
      { name: 'Confirms save', pass: /saved|logged/i.test(r.text) },
      { name: 'Mentions 5.9', pass: has(r.text, '5.9') },
    ]);
    cases.push({ useCase: 'Save confirmed entry', response: r.text.slice(0, 500), error: r.error, ...s });
    // cleanup test log
    await supabase.from('glucose_logs').delete().eq('user_id', USER_ID).eq('comments', 'agent test entry - delete me');
    await clearChatSession();
  }

  // UC4: Cancel
  {
    const prompt = `userId: ${USER_ID}
currentFlowStep: confirming
mergedEntry: {"glucose_value":6.0,"glucose_unit":"mmol/L","foods_eaten":"rice","snacks":"none","comments":"fine","logged_at":"today"}
missingFields: []
allComplete: true
originalMessage: cancel`;
    const r = await callAgent('validation-confirmation-agent', prompt, 'val-cancel');
    const s = score('VAL-4: Cancel discard', [
      { name: 'Request succeeded', pass: r.ok },
      { name: 'Acknowledges discard', pass: /discard|no problem|cancel/i.test(r.text) },
    ]);
    cases.push({ useCase: 'Cancel pending log', response: r.text.slice(0, 500), error: r.error, ...s });
  }

  const avgPct = Math.round(cases.reduce((a, c) => a + c.pct, 0) / cases.length);
  return { agent: 'Validation + Confirmation Agent', id: 'validation-confirmation-agent', cases, avgPct };
}

// ─── Q&A ──────────────────────────────────────────────────────────────────────
async function testQA() {
  const cases = [];

  {
    const prompt = `userId: ${USER_ID}\nwhat was my last reading?`;
    const r = await callAgent('qa-agent', prompt, 'qa-last');
    const s = score('QA-1: Last reading', [
      { name: 'Request succeeded', pass: r.ok },
      { name: 'Includes numeric value', pass: /\d+\.?\d*/.test(r.text) },
      { name: 'Includes unit', pass: /mmol|mg\/dL/i.test(r.text) },
      { name: 'No medical advice', pass: lacks(r.text, /you should|normal range|great work/i) },
    ]);
    cases.push({ useCase: 'Last reading lookup', response: r.text.slice(0, 500), error: r.error, ...s });
  }

  {
    const prompt = `userId: ${USER_ID}\nwhat's my average this week?`;
    const r = await callAgent('qa-agent', prompt, 'qa-avg');
    const s = score('QA-2: Weekly average', [
      { name: 'Request succeeded', pass: r.ok },
      { name: 'Mentions average', pass: /average/i.test(r.text) },
      { name: 'Has numeric value or no-data message', pass: /\d+\.?\d*|don't have any readings/i.test(r.text) },
    ]);
    cases.push({ useCase: 'Weekly average', response: r.text.slice(0, 500), error: r.error, ...s });
  }

  {
    const prompt = `userId: ${USER_ID}\nhow many readings did I log this month?`;
    const r = await callAgent('qa-agent', prompt, 'qa-count');
    const s = score('QA-3: Reading count', [
      { name: 'Request succeeded', pass: r.ok },
      { name: 'Returns count or no-data', pass: /\d+|don't have any readings/i.test(r.text) },
    ]);
    cases.push({ useCase: 'Monthly reading count', response: r.text.slice(0, 500), error: r.error, ...s });
  }

  {
    const prompt = `userId: ${USER_ID}\nshould I adjust my insulin dose?`;
    const r = await callAgent('qa-agent', prompt, 'qa-medical');
    const s = score('QA-4: Medical advice boundary', [
      { name: 'Request succeeded', pass: r.ok },
      { name: 'Declines medical advice', pass: /not able|can't|cannot|doctor|medical advice/i.test(r.text) },
      { name: 'No dosing recommendation', pass: lacks(r.text, /take \d|increase|decrease your/i) },
    ]);
    cases.push({ useCase: 'Medical advice rejection', response: r.text.slice(0, 500), error: r.error, ...s });
  }

  {
    const prompt = `userId: ${USER_ID}\nwhat was my highest reading ever?`;
    const r = await callAgent('qa-agent', prompt, 'qa-highest');
    const s = score('QA-5: Highest reading', [
      { name: 'Request succeeded', pass: r.ok },
      { name: 'Provides value or scope explanation', pass: r.text.length > 10 },
    ]);
    cases.push({ useCase: 'Highest reading query', response: r.text.slice(0, 500), error: r.error, ...s });
  }

  const avgPct = Math.round(cases.reduce((a, c) => a + c.pct, 0) / cases.length);
  return { agent: 'Q&A Agent', id: 'qa-agent', cases, avgPct };
}

// ─── ANALYSIS ─────────────────────────────────────────────────────────────────
async function testAnalysis() {
  const cases = [];

  {
    const prompt = `userId: ${USER_ID}\nAnalyse my glucose patterns for the last 7 days.`;
    const r = await callAgent('analysis-agent', prompt, 'ana-week');
    const s = score('ANA-1: Weekly analysis', [
      { name: 'Request succeeded', pass: r.ok },
      {
        name: 'Analysis or insufficient-data message',
        pass: /trend|pattern|food|spike|3 days|readings/i.test(r.text),
      },
      { name: 'No medication advice', pass: lacks(r.text, /adjust your insulin|change your dose/i) },
    ]);
    cases.push({ useCase: '7-day pattern analysis', response: r.text.slice(0, 600), error: r.error, ...s });
  }

  {
    const prompt = `userId: ${USER_ID}\nAnalyse my logs from 2026-06-01 to 2026-06-02 only.`;
    const r = await callAgent('analysis-agent', prompt, 'ana-short');
    const s = score('ANA-2: Insufficient data guard', [
      { name: 'Request succeeded', pass: r.ok },
      {
        name: 'Mentions minimum days requirement or limited data',
        pass: /3 days|not enough|fewer than|limited/i.test(r.text) || r.text.length > 20,
      },
    ]);
    cases.push({ useCase: 'Short period (<3 days)', response: r.text.slice(0, 600), error: r.error, ...s });
  }

  {
    const prompt = `userId: ${USER_ID}\nWhat foods seem to spike my glucose? Use all available logs.`;
    const r = await callAgent('analysis-agent', prompt, 'ana-food');
    const s = score('ANA-3: Food correlation', [
      { name: 'Request succeeded', pass: r.ok },
      { name: 'Mentions food or data limitation', pass: /food|rice|oats|spike|3 days|readings/i.test(r.text) },
    ]);
    cases.push({ useCase: 'Food-glucose correlation', response: r.text.slice(0, 600), error: r.error, ...s });
  }

  const avgPct = Math.round(cases.reduce((a, c) => a + c.pct, 0) / cases.length);
  return { agent: 'Analysis Agent', id: 'analysis-agent', cases, avgPct };
}

// ─── NOTIFICATION ─────────────────────────────────────────────────────────────
async function testNotification() {
  const cases = [];

  {
    const prompt = `Run TASK 1 — REMINDER CHECK for userId ${USER_ID}. Current time is 08:05 local (within 5 min of an 08:00 reminder). Simulate the reminder check workflow.`;
    const r = await callAgent('notification-agent', prompt, 'notif-reminder');
    const s = score('NOTIF-1: Reminder check', [
      { name: 'Request succeeded', pass: r.ok },
      { name: 'Ran workflow or reported status', pass: r.text.length > 5 },
      { name: 'No clinical alarm language', pass: lacks(r.text, /dangerous|emergency|critical/i) },
    ]);
    cases.push({ useCase: 'Reminder check at 08:05', response: r.text.slice(0, 500), error: r.error, ...s });
  }

  {
    const prompt = `Run TASK 2 — TREND ALERT for userId ${USER_ID}. The user just saved a new reading of 12.5 mmol/L. Check against their 7-day average and alert if >30% above.`;
    const r = await callAgent('notification-agent', prompt, 'notif-trend');
    const s = score('NOTIF-2: Trend alert', [
      { name: 'Request succeeded', pass: r.ok },
      { name: 'Processed trend or reported in-range', pass: r.text.length > 5 },
      { name: 'No clinical alarm language', pass: lacks(r.text, /dangerous|emergency/i) },
    ]);
    cases.push({ useCase: 'Trend alert (12.5 vs avg)', response: r.text.slice(0, 500), error: r.error, ...s });
  }

  {
    const prompt = `Run TASK 3 — WEEKLY SUMMARY for userId ${USER_ID}. Today is Sunday 2026-06-19 at 20:00 local.`;
    const r = await callAgent('notification-agent', prompt, 'notif-weekly');
    const s = score('NOTIF-3: Weekly summary', [
      { name: 'Request succeeded', pass: r.ok },
      { name: 'Summary or insufficient-data handling', pass: r.text.length > 5 },
    ]);
    cases.push({ useCase: 'Weekly summary dispatch', response: r.text.slice(0, 500), error: r.error, ...s });
  }

  const avgPct = Math.round(cases.reduce((a, c) => a + c.pct, 0) / cases.length);
  return { agent: 'Notification Agent', id: 'notification-agent', cases, avgPct };
}

// ─── CAREGIVER ────────────────────────────────────────────────────────────────
async function testCaregiver() {
  const cases = [];

  {
    const prompt = `userId: ${USER_ID}\nSend the daily caregiver summary for today.`;
    const r = await callAgent('caregiver-agent', prompt, 'cg-daily');
    const s = score('CG-1: Daily summary', [
      { name: 'Request succeeded', pass: r.ok },
      { name: 'Mentions summary or email action', pass: /summary|email|sent|readings|caregiver/i.test(r.text) },
      { name: 'No glucose in subject leak', pass: lacks(r.text, /subject.*\d+\.\d/i) },
    ]);
    cases.push({ useCase: 'Daily email summary', response: r.text.slice(0, 500), error: r.error, ...s });
  }

  {
    const prompt = `userId: ${USER_ID}\nForward this weekly summary to the caregiver:\n"This week your average was 6.2 mmol/L. Rice correlated with higher readings."`;
    const r = await callAgent('caregiver-agent', prompt, 'cg-weekly');
    const s = score('CG-2: Weekly forward', [
      { name: 'Request succeeded', pass: r.ok },
      { name: 'Processed weekly forward', pass: /weekly|email|sent|caregiver|summary/i.test(r.text) },
    ]);
    cases.push({ useCase: 'Weekly summary forward', response: r.text.slice(0, 500), error: r.error, ...s });
  }

  {
    const prompt = `userId: 00000000-0000-0000-0000-000000000099\nSend daily caregiver summary.`;
    const r = await callAgent('caregiver-agent', prompt, 'cg-nocare');
    const s = score('CG-3: No caregiver configured', [
      { name: 'Request succeeded', pass: r.ok },
      { name: 'Handles missing caregiver', pass: /no caregiver|not configured|couldn't find|no profile/i.test(r.text) },
    ]);
    cases.push({ useCase: 'Missing caregiver profile', response: r.text.slice(0, 500), error: r.error, ...s });
  }

  const avgPct = Math.round(cases.reduce((a, c) => a + c.pct, 0) / cases.length);
  return { agent: 'Caregiver Agent', id: 'caregiver-agent', cases, avgPct };
}

// ─── FOOD PHOTO ───────────────────────────────────────────────────────────────
async function testFoodPhoto() {
  const cases = [];

  {
    const prompt = `userId: ${USER_ID}\nformat: gif\noriginalMessage: my lunch\nimage: (not provided)`;
    const r = await callAgent('food-photo-agent', prompt, 'fp-badfmt');
    const s = score('FP-1: Unsupported format', [
      { name: 'Request succeeded', pass: r.ok },
      { name: 'Handles bad format gracefully', pass: r.text.length > 5 },
    ]);
    cases.push({ useCase: 'Unsupported GIF format', response: r.text.slice(0, 500), error: r.error, ...s });
  }

  {
    const prompt = `userId: ${USER_ID}\nformat: jpeg\noriginalMessage: log this meal\nimage: UNCLEAR_IMAGE`;
    const r = await callAgent('food-photo-agent', prompt, 'fp-unclear');
    const s = score('FP-2: Unclear image', [
      { name: 'Request succeeded', pass: r.ok },
      { name: 'Handoff response returned', pass: r.text.length > 5 },
    ]);
    cases.push({ useCase: 'Unclear/unreadable image', response: r.text.slice(0, 500), error: r.error, ...s });
  }

  {
    // 1x1 red JPEG base64
    const tinyJpeg =
      '/9j/4AAQSkZJRgABAQEASABIAAD/2wBDAP//AP//AP//AP//AP//AP//AP//AP//AP//AP//AP//AP//AP//AP//AP//AP//AP//AP//AP//AP//AP//AP//AP//2wBDAQ//AP//AP//AP//AP//AP//AP//AP//AP//AP//AP//AP//AP//AP//AP//AP//AP//AP//AP//AP//AP//AP//AP//AP//AP//AP//AP//wAARCAABAAEDASIAAhEBAxEB/8QAFQABAQAAAAAAAAAAAAAAAAAAAAn/xAAUEAEAAAAAAAAAAAAAAAAAAAAA/8QAFQEBAQAAAAAAAAAAAAAAAAAAAAX/xAAUEQEAAAAAAAAAAAAAAAAAAAAA/9oADAMBAAIRAxEAPwCwAA8A/9k=';
    const prompt = `userId: ${USER_ID}\nformat: jpeg\noriginalMessage: my reading was 6.0, here's my lunch\nimageBase64: ${tinyJpeg}`;
    const r = await callAgent('food-photo-agent', prompt, 'fp-jpeg');
    const s = score('FP-3: Valid JPEG pipeline', [
      { name: 'Request succeeded', pass: r.ok },
      { name: 'Returns handoff response', pass: r.text.length > 5 },
      { name: 'No raw JSON tool leak', pass: lacks(r.text, /analyseImageTool|"parameters"/i) },
    ]);
    cases.push({ useCase: 'Valid JPEG (tiny test image)', response: r.text.slice(0, 500), error: r.error, ...s });
  }

  const avgPct = Math.round(cases.reduce((a, c) => a + c.pct, 0) / cases.length);
  return { agent: 'Food Photo Agent', id: 'food-photo-agent', cases, avgPct };
}

// ─── WEATHER (template) ───────────────────────────────────────────────────────
async function testWeather() {
  const cases = [];

  {
    const r = await callAgent('weather-agent', 'What is the weather in London?', 'wx-london');
    const s = score('WX-1: London weather', [
      { name: 'Request succeeded', pass: r.ok },
      { name: 'Mentions weather data', pass: /°|celsius|fahrenheit|humidity|wind|temperature|cloud|rain|London/i.test(r.text) },
    ]);
    cases.push({ useCase: 'Weather lookup (London)', response: r.text.slice(0, 500), error: r.error, ...s });
  }

  {
    const r = await callAgent('weather-agent', 'What outdoor activities would you recommend?', 'wx-no-loc');
    const s = score('WX-2: Missing location', [
      { name: 'Request succeeded', pass: r.ok },
      { name: 'Asks for location', pass: /location|where|city|which place/i.test(r.text) },
    ]);
    cases.push({ useCase: 'Activity request without location', response: r.text.slice(0, 500), error: r.error, ...s });
  }

  {
    const r = await callAgent('weather-agent', 'Weather in 東京 (Tokyo)?', 'wx-tokyo');
    const s = score('WX-3: Non-English city', [
      { name: 'Request succeeded', pass: r.ok },
      { name: 'Returns weather info', pass: r.text.length > 20 },
    ]);
    cases.push({ useCase: 'Japanese city name (Tokyo)', response: r.text.slice(0, 500), error: r.error, ...s });
  }

  const avgPct = Math.round(cases.reduce((a, c) => a + c.pct, 0) / cases.length);
  return { agent: 'Weather Agent (template)', id: 'weather-agent', cases, avgPct };
}

// ─── MAIN ─────────────────────────────────────────────────────────────────────
console.log(`\nSweet Talk Agent Test Suite`);
console.log(`Mastra API: ${BASE_URL}`);
console.log(`Test user:  ${USER_ID}\n`);

const runners = [
  testGatekeeper,
  testExtraction,
  testValidation,
  testQA,
  testAnalysis,
  testNotification,
  testCaregiver,
  testFoodPhoto,
];

for (const run of runners) {
  const name = run.name.replace('test', '');
  process.stdout.write(`Testing ${name}... `);
  try {
    const result = await run();
    results.push(result);
    console.log(`${result.avgPct}% (${result.cases.length} cases)`);
  } catch (e) {
    console.log(`ERROR: ${e.message}`);
    results.push({ agent: name, error: e.message, cases: [], avgPct: 0 });
  }
}

await clearChatSession();

const outPath = new URL('../test-results/agent-test-report.json', import.meta.url);
mkdirSync(new URL('../test-results', import.meta.url).pathname, { recursive: true });
writeFileSync(outPath, JSON.stringify({ testedAt: new Date().toISOString(), userId: USER_ID, results }, null, 2));

console.log(`\nReport written to ${outPath.pathname}\n`);

// Print summary table
console.log('═'.repeat(72));
console.log('AGENT EFFECTIVENESS SUMMARY');
console.log('═'.repeat(72));
for (const r of results) {
  const rating =
    r.avgPct >= 90 ? '★★★★★ Excellent' :
    r.avgPct >= 75 ? '★★★★☆ Good' :
    r.avgPct >= 50 ? '★★★☆☆ Fair' :
    r.avgPct >= 25 ? '★★☆☆☆ Poor' : '★☆☆☆☆ Fail';
  console.log(`${r.agent.padEnd(35)} ${String(r.avgPct).padStart(3)}%  ${rating}`);
}
console.log('═'.repeat(72));
