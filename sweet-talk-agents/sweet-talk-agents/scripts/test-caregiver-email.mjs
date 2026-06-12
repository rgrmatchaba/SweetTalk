/**
 * One-shot test: fetch today's summary data and send the caregiver email
 * directly via Resend, without going through the agent/model layer.
 *
 * Usage:
 *   node --env-file=.env scripts/test-caregiver-email.mjs
 */
import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY,
  { auth: { persistSession: false } },
);

const USER_ID = '238b4ce8-68fa-4080-aafd-92d55e192f1d';

// 1. Fetch caregiver contact
const { data: profile, error: profileErr } = await supabase
  .from('profiles')
  .select('name, caregiver_name, caregiver_email, caregiver_summary_time')
  .eq('user_id', USER_ID)
  .single();

if (profileErr) { console.error('Profile fetch failed:', profileErr.message); process.exit(1); }
if (!profile.caregiver_email) { console.error('No caregiver email on this profile.'); process.exit(1); }

console.log(`Caregiver: ${profile.caregiver_name} <${profile.caregiver_email}>`);
console.log(`Patient:   ${profile.name}`);

// 2. Fetch today's glucose logs
const today = new Date().toISOString().slice(0, 10);
const { data: logs, error: logsErr } = await supabase
  .from('glucose_logs')
  .select('glucose_value, glucose_unit, foods_eaten, comments, logged_at, entry_tag')
  .eq('user_id', USER_ID)
  .gte('logged_at', `${today}T00:00:00`)
  .lte('logged_at', `${today}T23:59:59`)
  .order('logged_at', { ascending: true });

if (logsErr) { console.error('Logs fetch failed:', logsErr.message); process.exit(1); }

console.log(`Logs today: ${logs.length}`);

// 3. Build summary
let summaryBody;
if (logs.length === 0) {
  summaryBody = `Sweet Talk Daily Summary for ${profile.name} — ${today}
Readings today: 0
No readings were logged today.
Sent by Sweet Talk on behalf of ${profile.name}`;
} else {
  const unit = logs[0].glucose_unit ?? 'mmol/L';
  const sum = logs.reduce((a, r) => a + (r.glucose_value ?? 0), 0);
  const avg = Math.round((sum / logs.length) * 10) / 10;
  const highest = logs.reduce((m, r) => r.glucose_value > m.glucose_value ? r : m, logs[0]);
  const lowest  = logs.reduce((m, r) => r.glucose_value < m.glucose_value ? r : m, logs[0]);
  const foods = [...new Set(
    logs.flatMap(r => (r.foods_eaten ?? '').split(',').map(f => f.trim()).filter(Boolean))
  )];
  const comments = logs.map(r => r.comments).filter(Boolean);
  const onTime = logs.filter(r => r.entry_tag === 'on_time').length;
  const late   = logs.filter(r => r.entry_tag === 'late_entry').length;

  const fmtTime = iso => new Date(iso).toLocaleTimeString('en-ZA', { hour: '2-digit', minute: '2-digit', timeZone: 'Africa/Harare' });

  summaryBody = `Sweet Talk Daily Summary for ${profile.name} — ${today}
Readings today: ${logs.length}
Average reading: ${avg} ${unit}
Highest: ${highest.glucose_value} at ${fmtTime(highest.logged_at)}
Lowest: ${lowest.glucose_value} at ${fmtTime(lowest.logged_at)}
Foods logged: ${foods.length ? foods.join(', ') : 'none'}
Comments: ${comments.length ? comments.join('; ') : 'none'}
Logged on time: ${onTime} | Late entries: ${late}
Sent by Sweet Talk on behalf of ${profile.name}`;
}

console.log('\n--- Email body preview ---');
console.log(summaryBody);
console.log('--------------------------\n');

// 4. Send via Resend
const resendKey = process.env.RESEND_API_KEY;
const fromAddress = process.env.RESEND_FROM_EMAIL ?? 'Sweet Talk <onboarding@resend.dev>';

if (!resendKey) { console.error('RESEND_API_KEY not set.'); process.exit(1); }

const res = await fetch('https://api.resend.com/emails', {
  method: 'POST',
  headers: { Authorization: `Bearer ${resendKey}`, 'Content-Type': 'application/json' },
  body: JSON.stringify({
    from: fromAddress,
    to: [profile.caregiver_email],
    subject: `Sweet Talk — Daily Update for ${profile.name}`,
    text: summaryBody,
  }),
});

const json = await res.json().catch(() => ({}));

if (res.ok) {
  console.log('Email sent successfully. Resend ID:', json.id);
} else {
  console.error('Resend error:', res.status, JSON.stringify(json));
}
