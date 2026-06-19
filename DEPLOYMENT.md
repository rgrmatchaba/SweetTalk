# Deploying Sweet Talk for free

This guide deploys both halves of the app without paying for LLM usage:

- **Mastra agents backend** (`sweet-talk-agents/sweet-talk-agents`) → Render free web service
- **Frontend** (`sweet-talk-voice-health`) → Cloudflare Pages/Workers
- **LLM** → Groq's free tier (OpenAI-compatible, no card required)

Everything below uses free tiers. The main tradeoffs: the Render service sleeps
after ~15 min idle (first request after a sleep takes 30-60s to "wake up"), and
local SQLite/DuckDB storage on Render's free plan is ephemeral — fine for a demo,
not for guaranteed long-term memory.

## 1. Get a free Groq API key

1. Sign up at https://console.groq.com (free, no card).
2. Create an API key at https://console.groq.com/keys.
3. Note the model you want — `llama-3.3-70b-versatile` is a good default and
   is already the fallback in this codebase.

## 2. Deploy the Mastra agents backend (Render)

1. Push this repo to GitHub if it isn't already.
2. In Render, **New > Blueprint**, point it at this repo. Render will read
   `sweet-talk-agents/sweet-talk-agents/render.yaml`.
3. When prompted, fill in the env vars marked `sync: false`:
   - `GROQ_API_KEY` — from step 1
   - `SUPABASE_URL` — from your Supabase project settings
   - `SUPABASE_SERVICE_ROLE_KEY` — Supabase Dashboard > Project Settings > API > service_role
   - `RESEND_API_KEY` / `RESEND_FROM_EMAIL` — for caregiver emails (optional, leave blank to disable)
4. Deploy. Once live, note the public URL Render gives you, e.g.
   `https://sweet-talk-agents.onrender.com`.
5. Sanity check: `curl https://sweet-talk-agents.onrender.com/api/agents` should
   list your agents (first request may be slow if the service was asleep).

## 3. Deploy the frontend (Cloudflare Pages / Workers)

1. Install Wrangler if needed: `npm install -g wrangler` then `wrangler login`.
2. In `sweet-talk-voice-health/wrangler.jsonc`, update the `vars.MASTRA_API_URL`
   to the Render URL from step 2.
3. From `sweet-talk-voice-health/`:
   ```
   npm install
   npm run build
   ```
4. Check what Nitro generated under `.output/` — if it created its own
   `wrangler.json` inside `.output/server/`, compare it against the root
   `wrangler.jsonc` and adjust paths if they differ.
5. Set secrets (these should NOT go in `wrangler.jsonc` since that file is
   committed to git):
   ```
   wrangler secret put SUPABASE_SERVICE_ROLE_KEY   # if used server-side
   wrangler secret put DEEPGRAM_API_KEY
   wrangler secret put GROQ_API_KEY                # only if frontend AI functions use Groq too
   wrangler secret put LLM_PROVIDER                # set to "groq"
   wrangler secret put GROQ_MODEL                  # llama-3.3-70b-versatile
   ```
   Public, non-secret values (Supabase URL/anon key, `MASTRA_API_URL`) can stay
   in `wrangler.jsonc` `vars`.
6. Deploy:
   ```
   wrangler deploy
   ```
7. Wrangler prints your public `*.workers.dev` URL — that's the shareable link.

## 4. Switch both apps to Groq

In both `.env` files (and the Render/Cloudflare env vars from steps 2 & 3):

```
LLM_PROVIDER=groq
GROQ_API_KEY=your-groq-api-key
GROQ_MODEL=llama-3.3-70b-versatile
```

This swaps `getDefaultModel()` (agents backend) and `getChatModel()` (frontend)
over to Groq's free OpenAI-compatible endpoint — no Anthropic billing.

## 5. Smoke test

- Visit the deployed frontend URL, log in, and send a chat message — it should
  round-trip through the Render-hosted Gatekeeper agent.
- Try the voice agent (needs `DEEPGRAM_API_KEY` set as a Cloudflare secret).
- If you see "Mastra agent request failed", the Render service may still be
  waking up — retry after ~30s.

## Notes & future improvements

- **Cold starts**: Render free services sleep when idle. For a "glimpse" demo
  this is acceptable; if it's annoying, a free uptime pinger (e.g.
  UptimeRobot hitting `/api/agents` every 10 min) keeps it warm.
- **Persistent memory**: `mastra.db` (LibSQL) and the DuckDB observability
  store are local files on Render's ephemeral disk. They survive while the
  instance is running but can reset on redeploy. If long-term memory across
  redeploys matters, point `LibSQLStore` at a hosted libSQL/Turso database
  (Turso has a free tier) instead of `file:./mastra.db`.
- **CORS**: if the frontend and Mastra backend are on different domains and
  you hit CORS errors, the Mastra server may need a CORS config added in
  `src/mastra/index.ts` allowing your Cloudflare Workers domain.
