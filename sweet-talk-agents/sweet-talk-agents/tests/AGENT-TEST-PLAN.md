# Sweet Talk — Agent Evaluation & Testing Framework

Production-grade test plan for the 8 Sweet Talk agents (+1 template agent). Grounded in the
actual architecture:

- **State machine**: `chat_sessions` row per user/day — `flow_step`: `null → collecting → confirming → null`,
  with `pending_log` JSON accumulating the entry. Deterministic transitions live in
  `src/mastra/lib/logging-orchestration.ts`, NOT in the LLM.
- **Pipeline**: Gatekeeper (route) → Extraction (parse) → orchestration (merge/sanitize/persist) →
  Validation (fallback for corrections) → save → threshold alerts → Notification/Caregiver.
- **Trust boundary**: `userId` is passed *inside the prompt text* — the same channel as untrusted
  user input. Every injection test below exploits this.

Run: `node --env-file=.env scripts/test-all-agents.mjs` (happy path)
     `node --env-file=.env scripts/test-agents-extended.mjs` (edge/adversarial/resilience)

---

## 1. End-to-End Happy Path Testing

### 1.1 Full-lifecycle traces (per agent)

Each agent has a **contract**: given input X and DB state S, produce output Y and DB state S'.
A happy-path test must assert all four, not just "response looks nice."

| Agent | Trigger | Input contract | Output contract | DB side effect to assert |
|---|---|---|---|---|
| Gatekeeper | every chat message | `userId: <uuid>\n<message>` | ONE string: handoff response, exact REDIRECT string, or exact OFF-TOPIC string. Zero narration. | none directly (handoff writes via Extraction) |
| Extraction | handoff w/ LOGGING intent | userId + message (+ pendingLog context) | `handoffToValidationTool` response verbatim | `chat_sessions.pending_log` merged; `flow_step` = collecting/confirming |
| Validation | CORRECTION fallback | flowStep, mergedEntry, missingFields, allComplete, originalMessage | follow-up question, `[CONFIRM_CARD]`, save confirmation, or discard message | on save: `glucose_logs` row + session cleared; on cancel: session cleared |
| Q&A | Q&A page message | userId + question | 1–2 sentences, always unit + period, tool-sourced numbers only | none (read-only) |
| Analysis | Analysis page / weekly cron | userId + date range | narrative card via `formatAnalysisOutputTool`; exact insufficient-data string if daysCovered < 3 | none (read-only) |
| Notification | cron (simulated) | task name + userId + current time | task status report | `notifications` rows (reminder/trend_alert/weekly_summary) |
| Caregiver | Notification agent / manual | userId (+ optional forwarded narrative) | send/skip/failure report | Resend email + `caregiver_sends` log row |
| Food Photo | image upload | userId + format + image + message | Extraction agent's response verbatim | same as Extraction |

### 1.2 The golden multi-turn conversation (state persistence)

The single most important E2E test. Execute as ONE thread against the Gatekeeper, asserting
DB state between every turn:

| Turn | User says | Expected response | Expected `flow_step` | Expected `pending_log` |
|---|---|---|---|---|
| 1 | "today my reading was 6.7" | ack 6.7 + asks food & feeling | `collecting` | `{glucose_value: 6.7, logged_at: "today", snacks: "none"}` |
| 2 | "I had oats for breakfast" | asks feeling (NOT food again) | `collecting` | + `foods_eaten: "oats"` |
| 3 | "feeling fine" | confirm card w/ `[CONFIRM_CARD]`, shows 6.7/oats/fine | `confirming` | complete |
| 4 | "yes" | "Saved! Logged 6.7 mmol/L…" | `null` | `null` + row in `glucose_logs` |

**Context-retention assertions:**
- Turn 2 must NOT re-ask for glucose (pendingLog merge respected).
- Turn 3 card must contain values from turns 1–2 (cross-turn accumulation).
- Turn 4 must be routed as CORRECTION (flow_step=confirming forces it) even though "yes"
  contains no glucose keyword.
- Repeat the whole trace with the **cancel** branch (turn 4 = "no" → "No problem — log discarded",
  session cleared, NO `glucose_logs` row).

### 1.3 Alert-path E2E (safety-critical)

- Low: full trace ending with value **2.9 mmol/L** → save confirmation MUST contain
  `⚠️ URGENT — LOW GLUCOSE` + 15g fast-acting carbs guidance. Gatekeeper must relay word-for-word.
- High: value **13.5 mmol/L** → `⚠️ HIGH GLUCOSE` block present.
- Boundary values: exactly 3.9 and exactly 10.0 (defaults) → NO alert (code uses strict `<` / `>`).
- Custom thresholds: set `profiles.low_glucose_threshold = 4.5`, log 4.2 → low alert fires at
  the custom threshold, not the default.

### 1.4 Cross-agent handoff chain

Weekly pipeline: Notification TASK 3 → `triggerWeeklySummaryTool` → Analysis → narrative →
`storeInAppNotificationTool` + `forwardSummaryToCaregiverTool` → Caregiver email.
Assert: notification row exists, email logged in `caregiver_sends`, narrative identical
end-to-end (no lossy re-summarization), and the <3-days case stops the chain (nothing stored,
nothing forwarded).

---

## 2. Edge Cases & Outlier Testing

### 2.1 Ambiguous / contradictory / nonsensical input

| ID | Input | Expected behavior |
|---|---|---|
| AMB-1 | "my reading was six point seven" | `messageContainsNumber` sanitizer strips non-digit values → agent must gracefully re-ask for the reading, never hallucinate 6.7 into pending_log |
| AMB-2 | "it was 6.7 at 8am and 7.9 at noon" | No multi-entry support: accept exactly one reading or ask which to log first. FAIL if both merge into one corrupt entry |
| AMB-3 | "reading was 6.7… actually no, 7.6" | Latest value wins (merge logic resets base on conflicting glucose). Card must show 7.6, never 6.7 |
| AMB-4 | "asdfgh 123 lol" | Gatekeeper: number present → LOGGING is defensible; card must never show glucose_value 123 without unit sanity handling — document actual behavior |
| AMB-5 | "I didn't eat anything" | `foods_eaten` = "nothing"/"none", NOT re-asked. FAIL if agent loops asking about food |
| AMB-6 | "my sugar felt high this morning" (no number) | Ask for the numeric reading; must NOT invent a value |
| AMB-7 | "120" (mg/dL-scale value, profile unit mmol/L) | Currently saves 120 mmol/L + high alert. Known gap: no unit-plausibility check. Track as product defect |
| AMB-8 | "yesterday morning at 8" | `parseLoggedAtToIso` matches `/morning/` → **today** 08:00, not yesterday. Known