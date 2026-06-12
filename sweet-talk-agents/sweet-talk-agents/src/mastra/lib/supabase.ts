import { createClient } from '@supabase/supabase-js';

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!supabaseUrl || !supabaseServiceKey) {
  throw new Error(
    'Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY environment variables. ' +
      'Add them to .env — use the Supabase *service role* key (Project Settings > API), ' +
      'not the anon/publishable key, since this backend reads and writes on behalf of any user.',
  );
}

/**
 * Shared Supabase client for all Mastra tools.
 * Uses the service role key, which bypasses Row Level Security —
 * every tool MUST filter by user_id itself to keep data scoped correctly.
 */
export const supabase = createClient(supabaseUrl, supabaseServiceKey, {
  auth: { persistSession: false },
});
