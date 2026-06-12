-- Tables and columns required by the Notification Agent (Agent 7) and
-- Caregiver Agent (Agent 8).

-- Caregiver contact details + summary send time, stored on the user's profile.
ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS caregiver_name TEXT,
  ADD COLUMN IF NOT EXISTS caregiver_email TEXT,
  ADD COLUMN IF NOT EXISTS caregiver_phone TEXT,
  ADD COLUMN IF NOT EXISTS caregiver_summary_time TEXT DEFAULT '21:00';

-- In-app notification queue (reminders, trend alerts, weekly summaries,
-- and fallback for failed push notifications).
CREATE TABLE IF NOT EXISTS public.notifications (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  type TEXT NOT NULL,
  message TEXT NOT NULL,
  read BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.notifications TO authenticated;
GRANT ALL ON public.notifications TO service_role;
ALTER TABLE public.notifications ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "own notifications" ON public.notifications;
CREATE POLICY "own notifications" ON public.notifications FOR ALL TO authenticated
  USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

CREATE INDEX IF NOT EXISTS idx_notifications_user_created ON public.notifications(user_id, created_at DESC);

-- Internal error log for failed scheduled tasks (service-role only).
CREATE TABLE IF NOT EXISTS public.error_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  task_name TEXT NOT NULL,
  user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE,
  error_message TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

GRANT ALL ON public.error_logs TO service_role;
ALTER TABLE public.error_logs ENABLE ROW LEVEL SECURITY;

-- Log of caregiver daily-summary send attempts (service-role only).
CREATE TABLE IF NOT EXISTS public.caregiver_send_log (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  status TEXT NOT NULL,
  error_message TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

GRANT ALL ON public.caregiver_send_log TO service_role;
ALTER TABLE public.caregiver_send_log ENABLE ROW LEVEL SECURITY;

CREATE INDEX IF NOT EXISTS idx_caregiver_send_log_user_created ON public.caregiver_send_log(user_id, created_at DESC);
