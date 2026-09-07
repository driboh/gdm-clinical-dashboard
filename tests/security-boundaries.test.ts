import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const read = (path: string) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");

test("every private clinical API enforces a server-side clinician role", () => {
  for (const route of [
    "app/api/clinical-data/route.ts",
    "app/api/clinician-portal/route.ts",
    "app/api/patient-portal/access/route.ts",
    "app/api/audit/route.ts",
  ]) assert.match(read(route), /requireClinician\(/, route);
});

test("API authorization is not replaced by a redirecting UI middleware", () => {
  const proxy = read("proxy.ts");
  assert.doesNotMatch(proxy, /\/api\/clinical-data|\/api\/clinician-portal|\/api\/audit|\/api\/patient-portal\/access/);
});

test("production auth has no localhost, debug, or hard-coded identity bypass", () => {
  const auth = read("app/lib/auth/server.ts") + read("app/lib/auth/authorization.ts");
  assert.doesNotMatch(auth, /localhost|trusted local|debug.*auth|bypass/i);
  assert.match(auth, /BETTER_AUTH_SECRET/);
  assert.match(auth, /twoFactor\(/);
  assert.match(auth, /twoFactorEnabled/);
  assert.doesNotMatch(auth, /NEON_AUTH_BASE_URL|createNeonAuth/);
  assert.match(auth, /CLINICIAN_ADMIN_EMAILS/);
});

test("managed Neon Auth can no longer authorize production requests", () => {
  const route = read("app/api/auth/[...path]/route.ts");
  const server = read("app/lib/auth/server.ts");
  assert.match(route, /toNextJsHandler\(auth\)/);
  assert.doesNotMatch(route + server, /@neondatabase\/auth|NEON_AUTH_COOKIE_SECRET/);
});

test("no clinical browser persistence remains", () => {
  const dashboard = read("app/DashboardClient.tsx");
  assert.doesNotMatch(dashboard, /localStorage|sessionStorage|indexedDB/);
});

test("server state excludes portal secrets and server-authoritative audit data", () => {
  const api = read("app/lib/clinicalDataApi.ts");
  assert.match(api, /portalAccess:\s*\[\]/);
  assert.match(api, /patientSubmissions:\s*\[\]/);
  assert.match(api, /auditEvents:\s*\[\]/);
});

test("production security headers cover transport, framing, content types, referrers, permissions, and CSP", () => {
  const config = read("next.config.ts");
  for (const header of ["Strict-Transport-Security", "X-Content-Type-Options", "Referrer-Policy", "X-Frame-Options", "Permissions-Policy", "Content-Security-Policy"])
    assert.match(config, new RegExp(header));
  assert.match(config, /frame-ancestors 'none'/);
});

test("authentication and patient portal abuse controls use shared PostgreSQL rate limiting", () => {
  const limiter = read("app/lib/rateLimit.ts");
  const auth = read("app/lib/auth/server.ts");
  const portal = read("app/api/patient-portal/[token]/route.ts");
  assert.match(limiter, /security_rate_limits/);
  assert.match(limiter, /createHash\("sha256"\)/);
  assert.match(auth, /customStorage: options\?\.rateLimitStorage \|\| \{ consume: consumeRateLimit \}/);
  assert.match(portal, /portal-submit/);
  assert.match(portal, /tooManyRequests/);
  assert.match(portal, /rows\.length>31/);
  assert.match(portal, /Each date may appear only once/);
  assert.match(portal, /toISOString\(\)\.slice\(0,10\)===text/);
});
