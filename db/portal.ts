import { createHash, randomBytes, randomUUID } from "node:crypto";
import { neon } from "@neondatabase/serverless";
import { ensureAwsRuntimeSecrets } from "../app/lib/awsRuntimeSecrets.ts";

await ensureAwsRuntimeSecrets();

export type DbRow = Record<string, unknown>;

export function portalDb() {
  const connection = process.env.DATABASE_URL || process.env.POSTGRES_URL;
  if (!connection) throw new Error("DATABASE_URL is not configured.");
  return neon(connection);
}

export const id = () => randomUUID();
export const portalToken = () =>
  `${randomBytes(16).toString("base64url")}.${randomBytes(32).toString("base64url")}`;
export const tokenHash = (token: string) =>
  createHash("sha256").update(token).digest("hex");
export const expiresInDays = (days = 90) =>
  new Date(Date.now() + days * 86400000).toISOString();

export function json<T>(value: unknown, fallback: T): T {
  if (value == null) return fallback;
  if (typeof value === "string") {
    try {
      return JSON.parse(value) as T;
    } catch {
      return fallback;
    }
  }
  return value as T;
}

export function databaseError(error: unknown) {
  const message = error instanceof Error ? error.message : "Database request failed";
  if (message.includes("DATABASE_URL")) return "The shared prototype database has not been connected yet.";
  if (message.includes("does not exist")) return "The shared database schema has not been installed yet.";
  return "The shared database request failed. No success was recorded.";
}
