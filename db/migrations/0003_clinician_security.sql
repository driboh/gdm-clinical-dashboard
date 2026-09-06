CREATE TABLE IF NOT EXISTS clinician_access (
  id uuid PRIMARY KEY,
  auth_user_id text UNIQUE,
  email text NOT NULL UNIQUE,
  display_name text NOT NULL,
  role text NOT NULL CHECK (role IN ('Admin','Clinician','Read-only staff')),
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  last_login_at timestamptz
);

ALTER TABLE audit_events ALTER COLUMN patient_id DROP NOT NULL;
ALTER TABLE audit_events ADD COLUMN IF NOT EXISTS actor_id text;
ALTER TABLE audit_events ADD COLUMN IF NOT EXISTS source text NOT NULL DEFAULT 'Clinician';
ALTER TABLE audit_events ADD COLUMN IF NOT EXISTS entity_type text;
ALTER TABLE audit_events ADD COLUMN IF NOT EXISTS entity_id text;
CREATE INDEX IF NOT EXISTS audit_action_created_idx ON audit_events(action, created_at DESC);
CREATE INDEX IF NOT EXISTS audit_actor_created_idx ON audit_events(actor_id, created_at DESC);
