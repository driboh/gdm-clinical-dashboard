import test from "node:test";
import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import { readFileSync } from "node:fs";
import { DataType, newDb } from "pg-mem";
import type { Pool } from "pg";
import type { createClinicianAuth as CreateClinicianAuth } from "../app/lib/auth/server.ts";

const baseURL = "http://auth.test";
const email = "daniel@wellnessprimarycare.com";
const password = "Fictional-Test-Password-2026!";

type CookieJar = Map<string, string>;
type ClinicianAuth = ReturnType<typeof CreateClinicianAuth>;

function totp(secret: string) {
  const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
  const clean = secret.toUpperCase().replace(/=+$/, "");
  let bits = "";
  for (const character of clean) bits += alphabet.indexOf(character).toString(2).padStart(5, "0");
  const bytes = Buffer.from((bits.match(/.{8}/g) || []).map((byte) => Number.parseInt(byte, 2)));
  const counter = Buffer.alloc(8);
  counter.writeBigUInt64BE(BigInt(Math.floor(Date.now() / 30_000)));
  const digest = createHmac("sha1", bytes).update(counter).digest();
  const offset = digest[digest.length - 1] & 15;
  const number = (digest.readUInt32BE(offset) & 0x7fffffff) % 1_000_000;
  return String(number).padStart(6, "0");
}

function cookieHeader(jar: CookieJar) {
  return [...jar.entries()].map(([name, value]) => `${name}=${value}`).join("; ");
}

function updateCookies(jar: CookieJar, response: Response) {
  for (const value of response.headers.getSetCookie()) {
    const [pair] = value.split(";");
    const separator = pair.indexOf("=");
    const name = pair.slice(0, separator);
    const cookieValue = pair.slice(separator + 1);
    if (cookieValue) jar.set(name, cookieValue); else jar.delete(name);
  }
}

async function post(auth: ClinicianAuth, path: string, body: object, jar: CookieJar) {
  const response = await auth.handler(new Request(`${baseURL}/api/auth${path}`, {
    method: "POST",
    headers: { "content-type": "application/json", origin: baseURL, cookie: cookieHeader(jar) },
    body: JSON.stringify(body),
  }));
  updateCookies(jar, response);
  return response;
}

async function getSession(auth: ClinicianAuth, jar: CookieJar) {
  const response = await auth.handler(new Request(`${baseURL}/api/auth/get-session`, {
    headers: { origin: baseURL, cookie: cookieHeader(jar) },
  }));
  return response.json() as Promise<{ user?: { twoFactorEnabled?: boolean } } | null>;
}

test("Better Auth login, mandatory TOTP, recovery code, logout, and invalidation", async () => {
  process.env.DATABASE_URL = "postgresql://build:build@127.0.0.1/build";
  process.env.BETTER_AUTH_SECRET = "test-module-secret-at-least-thirty-two-characters";
  process.env.BETTER_AUTH_URL = baseURL;
  process.env.NEXT_PHASE = "phase-production-build";
  const { createClinicianAuth } = await import("../app/lib/auth/server.ts");
  const memory = newDb({ autoCreateForeignKeyIndices: true });
  memory.getSchema("pg_catalog").registerFunction({
    name: "current_schemas",
    args: [DataType.bool],
    returns: DataType.text,
    implementation: () => "{public}",
  });
  memory.public.none(readFileSync(new URL("../migrations/20260906_better_auth_mfa.sql", import.meta.url), "utf8"));
  const adapter = memory.adapters.createPg();
  const pool = new adapter.Pool() as unknown as Pool;
  const auth = createClinicianAuth(pool, {
    baseURL,
    secret: "test-secret-at-least-thirty-two-characters-long",
    secureCookies: false,
    skipSchemaValidation: true,
  });
  const jar: CookieJar = new Map();

  const signUp = await post(auth, "/sign-up/email", { email, password, name: "Daniel Riboh, PA-C" }, jar);
  assert.equal(signUp.status, 200, await signUp.clone().text());
  assert.equal((await getSession(auth, jar))?.user?.twoFactorEnabled, false);

  const enable = await post(auth, "/two-factor/enable", { password, method: "totp", issuer: "GDM Clinical Dashboard" }, jar);
  assert.equal(enable.status, 200, await enable.clone().text());
  const enrollment = await enable.json() as { totpURI: string; backupCodes: string[] };
  assert.equal(enrollment.backupCodes.length, 10);
  const secret = new URL(enrollment.totpURI).searchParams.get("secret");
  assert.ok(secret);

  const verifyEnrollment = await post(auth, "/two-factor/verify-totp", { code: totp(secret), trustDevice: false }, jar);
  assert.equal(verifyEnrollment.status, 200, await verifyEnrollment.clone().text());
  assert.equal((await getSession(auth, jar))?.user?.twoFactorEnabled, true);

  const logout = await post(auth, "/sign-out", {}, jar);
  assert.equal(logout.status, 200);
  assert.equal(await getSession(auth, jar), null, "signed-out session must be invalidated server-side");

  const login = await post(auth, "/sign-in/email", { email, password }, jar);
  assert.equal(login.status, 200, await login.clone().text());
  const loginBody = await login.json() as { twoFactorRedirect?: boolean };
  assert.equal(loginBody.twoFactorRedirect, true);
  assert.equal(await getSession(auth, jar), null, "password alone must not create an authenticated session");

  const wrongChallenge = await post(auth, "/two-factor/verify-totp", { code: "111111", trustDevice: false }, jar);
  assert.ok(wrongChallenge.status >= 400, "incorrect sign-in code must be rejected");
  const challenge = await post(auth, "/two-factor/verify-totp", { code: totp(secret), trustDevice: false }, jar);
  assert.equal(challenge.status, 200, await challenge.clone().text());
  assert.equal((await getSession(auth, jar))?.user?.twoFactorEnabled, true);

  await post(auth, "/sign-out", {}, jar);
  await post(auth, "/sign-in/email", { email, password }, jar);
  const recovery = await post(auth, "/two-factor/verify-backup-code", { code: enrollment.backupCodes[0], trustDevice: false }, jar);
  assert.equal(recovery.status, 200, await recovery.clone().text());
  assert.equal((await getSession(auth, jar))?.user?.twoFactorEnabled, true);

  await post(auth, "/sign-out", {}, jar);
  await post(auth, "/sign-in/email", { email, password }, jar);
  const reusedRecovery = await post(auth, "/two-factor/verify-backup-code", { code: enrollment.backupCodes[0], trustDevice: false }, jar);
  assert.equal(reusedRecovery.status, 401, "a recovery code must be single-use");

  await pool.end();
});
