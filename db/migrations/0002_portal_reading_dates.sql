ALTER TABLE patient_submissions
  ADD COLUMN IF NOT EXISTS imported_at timestamptz;
