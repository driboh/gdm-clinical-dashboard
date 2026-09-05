CREATE TABLE IF NOT EXISTS patients (
  id text PRIMARY KEY,
  first_name text NOT NULL,
  last_name text NOT NULL,
  mock boolean NOT NULL DEFAULT true,
  record jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS clinician_users (
  id text PRIMARY KEY,
  display_name text NOT NULL,
  email text,
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS patient_portal_access (
  id uuid PRIMARY KEY,
  patient_id text NOT NULL REFERENCES patients(id) ON DELETE CASCADE,
  token_hash text NOT NULL UNIQUE,
  status text NOT NULL CHECK (status IN ('Active','Disabled','Expired')),
  show_targets boolean NOT NULL DEFAULT true,
  fasting_target integer NOT NULL DEFAULT 95,
  post_meal_target integer NOT NULL DEFAULT 140,
  monitoring text NOT NULL DEFAULT '1 hour',
  created_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL,
  disabled_at timestamptz,
  last_submission_at timestamptz
);
CREATE INDEX IF NOT EXISTS portal_access_patient_idx ON patient_portal_access(patient_id);

CREATE TABLE IF NOT EXISTS patient_submissions (
  id uuid PRIMARY KEY,
  patient_id text NOT NULL REFERENCES patients(id) ON DELETE CASCADE,
  portal_access_id uuid NOT NULL REFERENCES patient_portal_access(id),
  submitted_at timestamptz NOT NULL DEFAULT now(),
  source text NOT NULL DEFAULT 'Patient Portal',
  status text NOT NULL CHECK (status IN ('Pending','Imported','Rejected')),
  approved_by text,
  approved_at timestamptz,
  rejected_by text,
  rejected_at timestamptz
);
CREATE INDEX IF NOT EXISTS submissions_patient_status_idx ON patient_submissions(patient_id, status);

CREATE TABLE IF NOT EXISTS patient_submission_readings (
  id uuid PRIMARY KEY,
  submission_id uuid NOT NULL REFERENCES patient_submissions(id) ON DELETE CASCADE,
  reading_date date NOT NULL,
  fasting integer,
  breakfast integer,
  lunch integer,
  dinner integer,
  notes text NOT NULL DEFAULT '',
  original_values jsonb,
  edit_history jsonb NOT NULL DEFAULT '[]'::jsonb
);

CREATE TABLE IF NOT EXISTS patient_glucose_readings (
  id text PRIMARY KEY,
  patient_id text NOT NULL REFERENCES patients(id) ON DELETE CASCADE,
  reading_date date NOT NULL,
  fasting integer,
  breakfast integer,
  lunch integer,
  dinner integer,
  notes text NOT NULL DEFAULT '',
  source text NOT NULL DEFAULT 'Clinician Entry',
  source_submission_id uuid REFERENCES patient_submissions(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(patient_id, reading_date)
);

CREATE TABLE IF NOT EXISTS audit_events (
  id uuid PRIMARY KEY,
  patient_id text NOT NULL REFERENCES patients(id) ON DELETE CASCADE,
  submission_id uuid REFERENCES patient_submissions(id),
  action text NOT NULL,
  actor text NOT NULL,
  details text,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS audit_patient_created_idx ON audit_events(patient_id, created_at DESC);
