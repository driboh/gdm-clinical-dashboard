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
  assert.match(auth, /NEON_AUTH_BASE_URL/);
  assert.match(auth, /CLINICIAN_ADMIN_EMAILS/);
});

test("browser storage is only read for one-time migration and then removed", () => {
  const dashboard = read("app/DashboardClient.tsx");
  assert.equal((dashboard.match(/localStorage\.getItem/g) || []).length, 1);
  assert.equal((dashboard.match(/localStorage\.setItem/g) || []).length, 0);
  assert.match(dashboard, /localStorage\.removeItem\("gdm-clinical-data-v2"\)/);
});

test("server state excludes portal secrets and server-authoritative audit data", () => {
  const api = read("app/lib/clinicalDataApi.ts");
  assert.match(api, /portalAccess:\s*\[\]/);
  assert.match(api, /patientSubmissions:\s*\[\]/);
  assert.match(api, /auditEvents:\s*\[\]/);
});
