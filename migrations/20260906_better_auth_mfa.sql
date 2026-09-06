-- Additive Better Auth + TOTP schema for the clinician application.
-- Rollback: deploy the pre-migration application commit. These isolated tables
-- may remain in place; no existing clinical or managed Neon Auth table changes.

CREATE TABLE IF NOT EXISTS clinician_auth_user (
  id text PRIMARY KEY,
  name text NOT NULL,
  email text NOT NULL UNIQUE,
  email_verified boolean NOT NULL DEFAULT false,
  image text,
  created_at timestamp NOT NULL DEFAULT now(),
  updated_at timestamp NOT NULL DEFAULT now(),
  two_factor_enabled boolean DEFAULT false
);

CREATE TABLE IF NOT EXISTS clinician_auth_session (
  id text PRIMARY KEY,
  expires_at timestamp NOT NULL,
  token text NOT NULL UNIQUE,
  created_at timestamp NOT NULL DEFAULT now(),
  updated_at timestamp NOT NULL,
  ip_address text,
  user_agent text,
  user_id text NOT NULL REFERENCES clinician_auth_user(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS clinician_auth_session_userId_idx ON clinician_auth_session(user_id);

CREATE TABLE IF NOT EXISTS clinician_auth_account (
  id text PRIMARY KEY,
  account_id text NOT NULL,
  provider_id text NOT NULL,
  user_id text NOT NULL REFERENCES clinician_auth_user(id) ON DELETE CASCADE,
  access_token text,
  refresh_token text,
  id_token text,
  access_token_expires_at timestamp,
  refresh_token_expires_at timestamp,
  scope text,
  password text,
  created_at timestamp NOT NULL DEFAULT now(),
  updated_at timestamp NOT NULL
);
CREATE INDEX IF NOT EXISTS clinician_auth_account_userId_idx ON clinician_auth_account(user_id);

CREATE TABLE IF NOT EXISTS clinician_auth_verification (
  id text PRIMARY KEY,
  identifier text NOT NULL,
  value text NOT NULL,
  expires_at timestamp NOT NULL,
  created_at timestamp NOT NULL DEFAULT now(),
  updated_at timestamp NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS clinician_auth_verification_identifier_idx ON clinician_auth_verification(identifier);

CREATE TABLE IF NOT EXISTS clinician_auth_two_factor (
  id text PRIMARY KEY,
  secret text NOT NULL,
  backup_codes text NOT NULL,
  user_id text NOT NULL REFERENCES clinician_auth_user(id) ON DELETE CASCADE,
  verified boolean DEFAULT true,
  failed_verification_count integer DEFAULT 0,
  locked_until timestamp
);
CREATE INDEX IF NOT EXISTS clinician_auth_two_factor_secret_idx ON clinician_auth_two_factor(secret);
CREATE INDEX IF NOT EXISTS clinician_auth_two_factor_userId_idx ON clinician_auth_two_factor(user_id);
