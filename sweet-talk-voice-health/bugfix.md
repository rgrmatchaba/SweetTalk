# Bug Fix Log

Tracks bugs found and fixed during development.

---

## Open

_None yet_

---

### Timing confirm fired before food collection — food message dropped, "log it" lost context
**File(s):** `src/components/chat-agent.tsx`
**Symptom:** User said "Yesterday evening my reading was 2.3", bot asked "log it?", user answered with food, bot said "Reply log it…" and ignored the food. After "log it", bot asked for food again.
**Root cause:** `advanceAfterMerge` checked `findEntryNeedingTimingConfirm` immediately on first parse — before food/snacks/comments were collected. This put the session in `timing_confirm` state too early. `handleTimingConfirm` only handles "log it" or a new reading; food answers fell through to "Reply log it…" and were discarded.
**Fix:** Moved timing confirm check inside the `collectStep === "confirming"` branch in `advanceAfterMerge`. Timing confirmation now only fires after ALL four fields are collected. Food/snacks/comments are always gathered first through the normal logging flow.

---

### Double bot messages when starting a new log from QA mode
**File(s):** `src/components/chat-agent.tsx`, `src/lib/log-parse.ts`
**Symptom:** Sending "Yesterday evening my reading was 2.3" from QA mode produced two consecutive bot messages: "Starting a new log —..." immediately followed by the timing confirm prompt.
**Root cause:** `resetLoggingAttempt` always persisted a visible "Starting a new log" bot message. When called from QA→logging, this appeared just before `continueLogging`'s response, producing two bot replies for one user message.
**Fix:** `resetLoggingAttempt` now defaults to a hidden `"__log_marker__"` message. Added `__log_marker__` to `LOG_START_PATTERN` so `transcriptSinceMarker` still works. Hidden markers are filtered out of the chat UI render. Callers that want a visible message (e.g. the explicit "Log a reading" button via `startLogging`) still pass a prompt string.

---

### Wrong time_hint — LLM returned "in the morning" for "Yesterday evening"
**File(s):** `src/lib/log-parse.ts`, `src/components/chat-agent.tsx`
**Symptom:** Timing confirm said "You mentioned 2.3 mmol/L in the morning, yesterday" when user said "Yesterday evening".
**Root cause:** Two issues: (1) `inferTimeHint` regex had `yesterday(?:\s+morning)?` which matched "Yesterday" at the start of the sentence, ignoring "evening". (2) The Ollama LLM parser independently hallucinated "in the morning".
**Fix:** (1) Updated `inferTimeHint` regex — `yesterday\s+(?:morning|afternoon|evening|night)` now comes first, capturing the compound form before bare "yesterday". (2) Added "evening" and "yesterday + time" patterns to `regexExtractEntries`. (3) Added post-processing in `tryParseReading`: when the regex finds a different time hint that is actually present in the transcript text, the regex result overrides the LLM's output.

---

### Logging intent not detected when message has food/date but no glucose number
**File(s):** `src/components/chat-agent.tsx`, `src/lib/log-parse.ts`
**Symptom:** "yesterday morning i had oats for breakfast" in QA mode went to `handleQA` instead of starting the logging flow. The LLM generated a confused response and the food/date context was never captured in state.
**Root cause:** The QA→logging routing check (`looksLikeReading(text)`) only fires when there's a number. A message with date/time/food context but no glucose silently falls to `handleQA`.
**Fix:** Added `looksLikeLogEntry` to `log-parse.ts`. Detects logging intent from date/time words ("yesterday", "this morning") and food+meal patterns even without a glucose number. QA→logging routing now uses `looksLikeLogEntry` instead of `looksLikeReading`.

---

### Partial food/date context lost — no placeholder entry when glucose is missing
**File(s):** `src/components/chat-agent.tsx`, `src/lib/log-parse.ts`
**Symptom:** When user said "yesterday morning i had oats" without a glucose number, the confirmation prompt asked "What's your glucose reading right now?" — losing the date and food context entirely.
**Root cause:** `continueLogging`'s fallback branch called `regexExtractEntries(transcript)` which requires a number. Returned empty → `pendingEntries` was empty → `buildCollectPrompt` had no date/time hints to use.
**Fix:** Added `extractPartialEntry` to `log-parse.ts`. When `regexExtractEntries` returns empty but the transcript has food/time/date context, `continueLogging` now creates a partial placeholder entry. `buildCollectPrompt` (already fixed) then uses the entry's `time_hint`/`date_hint` to ask "What was your glucose reading yesterday morning?"

---

### Date/time correction in confirming step not applied — date stayed as today
**File(s):** `src/components/chat-agent.tsx`, `src/lib/log-parse.ts`
**Symptom:** User said "this was yesterday morning so change the date" while reviewing the confirmation card. Bot repeated "Here's your summary" with the date still showing today.
**Root cause:** The correction path re-parsed the full transcript using `tryParseReading` (the voice-transcript LLM). It doesn't understand date change commands in natural language — failed to extract "yesterday morning" from the correction sentence.
**Fix:** Added `extractDateTimeCorrection` to `log-parse.ts`. In the confirming block, date/time corrections are now detected and handled first (before glucose corrections): the entry's `time_hint`, `date_hint`, and `logged_at` are patched in-place and `advanceAfterMerge` is called, which routes to `timing_confirm` so the user explicitly confirms the backdated entry.

---

---

## Fixed

### Sign-up toggle snaps back to Sign in while typing
**File(s):** `src/routes/auth.tsx`
**Symptom:** On the auth page, switching to Sign up then typing email/password made the mode toggle slide back to Sign in.
**Root cause:** The honey pill used Framer Motion `layout` together with a percentage `x` animation. Any reflow while typing (keyboard, autofill UI, sibling AnimatePresence) re-projected layout and snapped the pill to the Sign-in position. The form was also inside a `key={mode}` AnimatePresence, so a mode flicker would remount inputs mid-typing.
**Fix:** Removed `layout` from the pill; position it with stable `left` + `x: 0% | 100%`. Kept email/password/submit outside the mode-keyed AnimatePresence so typing never remounts the form. Added a regression assertion in the auth e2e toggle test.

---

### LLM references prior-session DB data as "you mentioned earlier" (hallucination)
**File(s):** `src/components/chat-agent.tsx`
**Symptom:** Bot said "you mentioned feeling drained after eating sweet potato" — sourced from a saved database record, not the current conversation.
**Root cause:** `buildSystemPrompt(logsContext)` injected the past 50 DB records with no framing. The LLM treated them as conversational recall and said "you mentioned."
**Fix:** Prefixed the DB history block: `"PAST SAVED DATABASE RECORDS — NOT things the user said in this conversation. Never say 'you mentioned' based on these."` (`buildSystemPrompt` in `chat-agent.tsx`)

---

### Corrections during confirming silently discarded the log
**File(s):** `src/components/chat-agent.tsx`, `src/lib/log-parse.ts`
**Symptom:** User typed "actually 6.1" to correct a reading — the log was wiped and restarted silently instead of updating the value.
**Root cause:** In `handleSend`, the confirming branch checked `isFreshReadingMessage` before `isCorrectionMessage`. Any message with a number (including "actually 6.1") matched `isFreshReadingMessage` and triggered `resetLoggingAttempt`, skipping the correction path.
**Fix:** Added `hasCorrectionKeywords` to `log-parse.ts`. In the confirming block, correction keywords are checked first — if present, the message goes to correction handling regardless of whether it also looks like a fresh reading.

---

### Glucose correction re-parsed full transcript — created duplicate entries
**File(s):** `src/components/chat-agent.tsx`, `src/lib/log-parse.ts`
**Symptom:** "Actually it was 6.1" (correcting 6.4) produced 2 entries: both 6.4 and 6.1.
**Root cause:** The correction path appended the correction text to the full transcript, then re-parsed. The parser saw both values and created two entries.
**Fix:** Added `extractGlucoseOnlyCorrection` to `log-parse.ts`. For single-entry, glucose-only corrections (no food keywords in the correction text), the value is patched directly onto `pendingEntries[0]` without re-parsing the transcript. Multi-field and multi-entry corrections still use the full re-parse path.

---

### LLM generated 5-part questions in a single response
**File(s):** `src/components/chat-agent.tsx`
**Symptom:** Bot asked "Did anything change? Did you eat more? Any snacks? How are you feeling? Is the reading accurate?" in one message, violating Rule 2.
**Root cause:** `handleQA` called `callProxy` with the full session history (potentially 50+ messages), giving the local model too much context to ramble on.
**Fix:** Capped `buildHistory` call in `handleQA` to `messages.slice(-9)` — the last 10 messages only. Also added RULE 0 to the top of SYSTEM_PROMPT to further constrain model behaviour.

---

### No guardrail against clinical interpretation of readings
**File(s):** `src/components/chat-agent.tsx` (SYSTEM_PROMPT)
**Symptom:** Bot questioned the accuracy of a user-reported reading: "Is this afternoon's reading accurate compared to what you previously said?"
**Root cause:** SYSTEM_PROMPT had no rule prohibiting clinical commentary.
**Fix:** Added `RULE 0` to SYSTEM_PROMPT: "NEVER question, verify, or interpret the accuracy of a reading the user provides. Never compare readings or give clinical commentary. Log exactly what the user says."

---

### Backdated log with food but no glucose asked "right now" instead of using date context
**File(s):** `src/lib/log-entry.ts`
**Symptom:** User said "yesterday morning I had oats for breakfast." Bot replied "What's your glucose reading right now?"
**Root cause:** `buildCollectPrompt` returned `COLLECT_PROMPTS["glucose"]` unconditionally, without checking `time_hint`/`date_hint` already on the entry.
**Fix:** When asking for glucose and the entry already has `time_hint` or `date_hint`, `buildCollectPrompt` now generates "What was your glucose reading yesterday morning?" using the existing context.

---

### Full session history sent to LLM caused date/context blending in QA responses
**File(s):** `src/components/chat-agent.tsx`
**Symptom:** Bot mixed dates from earlier logging turns into QA responses (e.g., "this morning 6/7 evening" in a response about a different reading).
**Root cause:** `handleQA` called `buildHistory(messages, userMsg)` — all messages in the session — giving the LLM full access to prior logging summaries containing dates and readings.
**Fix:** Changed to `messages.slice(-9)` — only the last 10 messages are sent for QA, eliminating stale date/reading context from earlier in the session.

---

### Discard button silently destroyed logs with no confirmation
**File(s):** `src/components/chat-agent.tsx`
**Symptom:** "No problem — discarded that log" appeared without the user intending to discard. The Discard button fired immediately on first click with no confirmation.
**Root cause:** Single-click Discard button sat next to the Save button; easy to misclick.
**Fix:** Discard is now a two-step action. First click shows "Yes, discard" / "Keep" options. The log is only wiped on the second explicit confirmation.

---

### Ghost readings from stale `loggingTranscript` (stale closure + Q&A contamination)
**File(s):** `src/components/chat-agent.tsx`, `src/lib/log-parse.ts`
**Symptom:** Starting a new log after Q&A (e.g. "this afternoon my reading was 6.4") produced 3 entries — the new reading plus 2 ghost readings (e.g. 5.5, 3.5) from earlier in the session.
**Root cause:** Two compounding issues: (1) `setLoggingTranscript("")` was called immediately before `continueLogging(text)`, but `continueLogging` captured `loggingTranscript` from its closure — React state hadn't updated yet, so the old transcript was used. (2) On session reload, `rebuildLoggingTranscript` scanned all user messages in the session including Q&A turns, so readings mentioned in Q&A polluted the next logging attempt.
**Fix:** `resetLoggingAttempt()` now does a hard reset — inserts a log marker bot message and clears pending_log, transcript state, and entries atomically. `transcriptSinceMarker` (in `log-parse.ts`) uses the marker message ID to scope parsing to only user messages sent after the marker, ignoring all prior session context. On reload, the marker is restored via `findLastLogMarkerId`; if no valid marker exists, stale `pending_log` is discarded.

---

### Wrong food / cross-entry data contamination
**File(s):** `src/lib/log-entry.ts`
**Symptom:** After a new reading, the confirmation card showed food from a completely different meal or previous session entry (e.g. "sweet potato with tea" instead of "beef stew").
**Root cause:** `mergeEntries` was matching entries by array index. A new afternoon entry at index 0 would inherit food/comments from the old morning entry at index 0, even when they were different meals.
**Fix:** `mergeEntries` now matches by `glucose_value + time_hint + date_hint` (via `readingKey`). Food and comments only propagate into entries that are genuinely missing those fields — an afternoon entry cannot inherit from a morning entry.

---

### Notes field dumped raw transcript instead of extracted comments
**File(s):** `src/lib/log-entry.ts`, `src/lib/ai.functions.ts`
**Symptom:** The "Notes" field in the confirmation card contained the user's entire message verbatim (e.g. "feeling really drained and tired this afternoon my reading was 6.4 i ate some beef stew with sweet potatoe and veggies") instead of a clean extracted comment.
**Root cause:** When the accumulated transcript was long and noisy (due to the stale transcript bug above), the LLM parser couldn't cleanly extract just the feelings/symptoms and dumped the whole input. Also, `commentsForSave` didn't strip transcript noise.
**Fix:** Comments are now cleaned on extraction. Also fixed by the transcript scoping fix — clean, short transcripts make extraction reliable.

---

### Claude called during `confirming` step — improvised responses
**File(s):** `src/components/chat-agent.tsx`
**Symptom:** While reviewing the confirmation card, sending any non-"yes" message triggered a verbose Ollama-generated response referencing prior Q&A history, ignoring rules 1–4.
**Root cause:** The `confirming` branch called `callProxy` with the full chat history, giving the LLM full context to improvise. No scope control.
**Fix:** Confirming step now handles only three branches with no LLM call: (1) "yes" / equivalent → save, (2) correction message detected → re-parse and update card, (3) fresh reading → `resetLoggingAttempt`. Any other input gets a fixed prompt: "Type yes to save, tell me what to change, or send a new reading."

---

### "this afternoon" timing not auto-resolved — showed "Time will be set on save"
**File(s):** `src/lib/log-entry.ts`, `src/lib/log-parse.ts`
**Symptom:** When a user said "this afternoon my reading was 6.4" in the afternoon, the confirmation card showed "Time will be set on save" instead of the resolved timestamp.
**Root cause:** `resolveLoggedAt` wasn't being called at parse time for unambiguous current-day time hints. `entryNeedsTimingConfirm` was triggering unnecessarily for hints like "this afternoon" when the current time was clearly in the afternoon.
**Fix:** `prepareEntry` now calls `resolveLoggedAt` immediately for time hints that don't need user confirmation (current-day, unambiguous). `entryNeedsTimingConfirm` only fires for genuinely ambiguous cases (e.g. "in the morning" said in the evening). Confirmation card now shows the resolved time.

---

### `"none"` snacks value rendered in confirmation card
**File(s):** `src/components/chat-agent.tsx`
**Symptom:** Confirmation card showed "Snacks: none" as a row — cluttered and redundant since "none" carries no information worth displaying.
**Root cause:** Card checked `{e.snacks && ...}` — the string `"none"` is truthy so it rendered.
**Fix:** Card now uses `isAnswered(e.snacks) && !isExplicitNone(e.snacks)` so `"none"` values are silently omitted from display.

---

## Format

```
### [short title]
**File(s):** `path/to/file.ts`
**Symptom:** What the user saw or what broke.
**Root cause:** Why it happened.
**Fix:** What was changed.
```
