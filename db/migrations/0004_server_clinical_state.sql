CREATE TABLE IF NOT EXISTS clinical_app_state (
  id text PRIMARY KEY,
  schema_version integer NOT NULL DEFAULT 1,
  record jsonb NOT NULL,
  updated_by text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS clinician_drafts (
  clinician_id text NOT NULL,
  patient_id text NOT NULL REFERENCES patients(id) ON DELETE CASCADE,
  record jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (clinician_id, patient_id)
);

ALTER TABLE audit_events ADD COLUMN IF NOT EXISTS outcome text NOT NULL DEFAULT 'Success';
