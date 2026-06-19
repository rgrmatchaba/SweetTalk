-- Add snacks column expected by agent tools and analysis queries
ALTER TABLE public.glucose_logs
  ADD COLUMN IF NOT EXISTS snacks TEXT DEFAULT 'none';
