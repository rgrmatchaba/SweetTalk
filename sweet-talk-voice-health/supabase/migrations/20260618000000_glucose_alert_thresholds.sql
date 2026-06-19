-- Glucose alert thresholds stored per user on their profile.
-- Defaults match standard clinical guidelines:
--   Low  < 3.9 mmol/L  (70 mg/dL)
--   High > 10.0 mmol/L (180 mg/dL)
-- Users can override these in their Profile page.

ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS low_glucose_threshold  NUMERIC DEFAULT 3.9,
  ADD COLUMN IF NOT EXISTS high_glucose_threshold NUMERIC DEFAULT 10.0;
