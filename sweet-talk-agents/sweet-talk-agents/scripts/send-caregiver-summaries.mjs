/**
 * Cron entry point: finds users whose caregiver summary time matches the
 * current hour and asks the Caregiver Agent to send their daily summary.
 *
 * Run hourly (e.g. via cron/launchd) while the Mastra dev server
 * (`npm run dev`, served at MASTRA_API_URL) is running:
 *
 *   npm run send-caregiver-summaries
 *
 * Requires SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY (service role!) and
 * optionally MASTRA_API_URL in .env (load with `node --env-file=.env`).
 */
import { createClient } from '@supabase/supabase-js';

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const mastraUrl = process.env.MASTRA_API_URL ?? 'http://localhost:4111';

if (!supabaseUrl || !supabaseServiceKey) {
  console.error('Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY in .env');
  process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseServiceKey, {
  auth: { persistSession: false },
});

const now = new Date();
const currentHour = String(now.getHours()).padStart(2, '0');

console.log(`[caregiver-summaries] Running at ${now.toISOString()} (local hour ${currentHour})`);

const { data: profiles, error } = await supabase
  .from('profiles')
  .select('user_id, name, caregiver_email, caregiver_summary_time')
  .not('caregiver_email', 'is', null);

if (error) {
  console.error('Failed to load profiles:', error.message);
  process.exit(1);
}

const due = (profiles ?? []).filter((p) => {
  if (!p.caregiver_email) return false;
  const summaryHour = (p.caregiver_summary_time ?? '21:00').slice(0, 2);
  return summaryHour === currentHour;
});

console.log(`[caregiver-summaries] ${due.length} of ${profiles?.length ?? 0} profile(s) due this hour`);

for (const profile of due) {
  const userId = profile.user_id;
  try {
    const res = await fetch(`${mastraUrl}/api/agents/caregiver-agent/generate`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-mastra-dev-playground': 'true',
      },
      body: JSON.stringify({
        messages: [
          {
            role: 'user',
            content: `userId: ${userId}\nIt's time to send today's daily summary to this user's caregiver. Please proceed.`,
          },
        ],
        memory: {
          resource: userId,
          thread: `caregiver-summary-${userId}-${now.toISOString().slice(0, 10)}`,
        },
      }),
    });

    if (!res.ok) {
      const text = await res.text().catch(() => '');
      console.error(`[caregiver-summaries] ${userId}: agent request failed (${res.status}): ${text.slice(0, 300)}`);
      continue;
    }

    const json = await res.json().catch(() => ({}));
    console.log(`[caregiver-summaries] ${userId}: ${json.text ?? '(no text in response)'}`);
  } catch (e) {
    console.error(`[caregiver-summaries] ${userId}: error`, e instanceof Error ? e.message : e);
  }
}

console.log('[caregiver-summaries] Done.');
