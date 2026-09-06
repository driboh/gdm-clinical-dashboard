CREATE TABLE IF NOT EXISTS clinical_visits (
  id text PRIMARY KEY, patient_id text NOT NULL REFERENCES patients(id) ON DELETE CASCADE,
  visit_date date NOT NULL, status text NOT NULL, record jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now());
CREATE INDEX IF NOT EXISTS clinical_visits_patient_date_idx ON clinical_visits(patient_id, visit_date DESC);

CREATE TABLE IF NOT EXISTS clinical_visit_versions (
  visit_id text NOT NULL REFERENCES clinical_visits(id) ON DELETE CASCADE,
  version integer NOT NULL, record jsonb NOT NULL, finalized_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(), PRIMARY KEY (visit_id, version));

CREATE TABLE IF NOT EXISTS clinical_medications (
  id text PRIMARY KEY, patient_id text NOT NULL REFERENCES patients(id) ON DELETE CASCADE,
  status text NOT NULL, record jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now());
CREATE INDEX IF NOT EXISTS clinical_medications_patient_idx ON clinical_medications(patient_id);

CREATE TABLE IF NOT EXISTS clinical_medication_changes (
  visit_id text NOT NULL REFERENCES clinical_visits(id) ON DELETE CASCADE,
  sequence integer NOT NULL, patient_id text NOT NULL REFERENCES patients(id) ON DELETE CASCADE,
  record jsonb NOT NULL, created_at timestamptz NOT NULL DEFAULT now(), PRIMARY KEY (visit_id, sequence));

CREATE TABLE IF NOT EXISTS clinical_reports (
  id text PRIMARY KEY, patient_id text NOT NULL REFERENCES patients(id) ON DELETE CASCADE,
  visit_id text, record jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now());
CREATE INDEX IF NOT EXISTS clinical_reports_patient_idx ON clinical_reports(patient_id);

CREATE TABLE IF NOT EXISTS provider_settings (
  id text PRIMARY KEY, record jsonb NOT NULL, updated_by text NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now());
