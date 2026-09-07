import { createHash } from "node:crypto";
import { portalDb } from "../../db/portal.ts";

type Rule = { window: number; max: number };

function digest(value: string) {
  return createHash("sha256").update(value).digest("hex");
}

/**
 * Shared PostgreSQL-backed limiter for Vercel's multi-instance runtime.
 * Only one-way hashes are stored; raw IP addresses, emails, and portal tokens
 * are never written to the limiter table or application logs.
 */
export async function consumeRateLimit(key: string, rule: Rule) {
  const sql = portalDb();
  const windowSeconds = Math.max(1, Math.floor(rule.window));
  const bucket = Math.floor(Date.now() / (windowSeconds * 1000));
  const storedKey = digest(`${key}:${bucket}`);
  const expiresAt = new Date((bucket + 1) * windowSeconds * 1000).toISOString();
  await sql`CREATE TABLE IF NOT EXISTS security_rate_limits (
    key_hash text PRIMARY KEY,
    request_count integer NOT NULL,
    expires_at timestamptz NOT NULL
  )`;
  const rows = await sql`INSERT INTO security_rate_limits (key_hash,request_count,expires_at)
    VALUES (${storedKey},1,${expiresAt})
    ON CONFLICT (key_hash) DO UPDATE SET request_count=security_rate_limits.request_count+1
    RETURNING request_count`;
  const count = Number(rows[0]?.request_count || 1);
  return {
    allowed: count <= rule.max,
    retryAfter: count <= rule.max ? null : Math.max(1, Math.ceil((new Date(expiresAt).getTime() - Date.now()) / 1000)),
  };
}

export function requestFingerprint(request: Request) {
  const forwarded = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim();
  return digest(forwarded || request.headers.get("x-real-ip") || "unknown-client");
}

export async function limitRequest(request: Request, scope: string, discriminator: string, max: number, window: number) {
  return consumeRateLimit(`${scope}:${requestFingerprint(request)}:${digest(discriminator)}`, { max, window });
}

export function tooManyRequests(retryAfter: number | null) {
  return Response.json(
    { error: "Too many requests. Please wait and try again." },
    { status: 429, headers: { "Retry-After": String(retryAfter || 60), "Cache-Control": "no-store" } },
  );
}
