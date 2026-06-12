-- Allow timing_confirm flow step for past-reading confirmation
ALTER TABLE public.chat_sessions DROP CONSTRAINT IF EXISTS chat_sessions_flow_step_check;
ALTER TABLE public.chat_sessions ADD CONSTRAINT chat_sessions_flow_step_check
  CHECK (flow_step IN ('glucose', 'foods', 'snacks', 'comments', 'timing_confirm', 'confirming', 'qa'));
