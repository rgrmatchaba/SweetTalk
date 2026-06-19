-- Add 'collecting' to the flow_step CHECK constraint.
-- This value is written by handoffToValidationTool when a log entry is
-- in progress but not yet complete. The original migration omitted it,
-- causing every Turn-1 session write to fail silently with a constraint
-- violation — which is why pending_log never persisted across turns.
ALTER TABLE public.chat_sessions DROP CONSTRAINT IF EXISTS chat_sessions_flow_step_check;
ALTER TABLE public.chat_sessions ADD CONSTRAINT chat_sessions_flow_step_check
  CHECK (flow_step IN ('collecting', 'glucose', 'foods', 'snacks', 'comments', 'timing_confirm', 'confirming', 'qa'));
