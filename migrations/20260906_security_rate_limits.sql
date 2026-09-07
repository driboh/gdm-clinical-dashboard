-- Shared abuse-control buckets for Better Auth and patient portal routes.
-- Keys are SHA-256 digests; this table never stores raw IP addresses, email
-- addresses, passwords, MFA values, portal tokens, or clinical payloads.
CREATE TABLE IF NOT EXISTS security_rate_limits (
  key_hash text PRIMARY KEY,
  request_count integer NOT NULL,
  expires_at timestamptz NOT NULL
);
CREATE INDEX IF NOT EXISTS security_rate_limits_expires_idx
  ON security_rate_limits(expires_at);
