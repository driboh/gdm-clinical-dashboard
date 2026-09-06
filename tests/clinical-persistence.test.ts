import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

const read = (path: string) => fs.readFileSync(path, "utf8");

test("clinical data is loaded from relational PostgreSQL tables", () => {
  const route = read("app/api/clinical-data/route.ts");
  for (const table of ["patients", "patient_glucose_readings", "clinical_visits", "clinical_medications", "clinical_reports", "provider_settings"])
    assert.match(route, new RegExp(`SELECT[^\n]*${table}`, "i"), `${table} must participate in authoritative reads`);
  assert.doesNotMatch(route, /INSERT INTO clinical_app_state/);
  assert.match(route, /legacyState/);
});

test("clinical writes are transactional and preserve portal and version history", () => {
  const repository = read("db/clinical.ts"), route = read("app/api/clinical-data/route.ts");
  assert.match(repository, /BEGIN/);
  assert.match(repository, /COMMIT/);
  assert.match(repository, /ROLLBACK/);
  assert.match(route, /source <> 'Patient Portal'/);
  assert.match(route, /ON CONFLICT \(visit_id,version\) DO NOTHING/);
  assert.match(route, /unknown patient/);
  assert.match(route, /glucose\.deleted/);
});

test("dashboard save status reflects database outcome and has one clinical write path", () => {
  const dashboard = read("app/DashboardClient.tsx"), portalApi = read("app/lib/patientPortalApi.ts");
  assert.match(dashboard, /setSaved\("Saving…"\)/);
  assert.match(dashboard, /setSaved\("✓ All changes saved"\)/);
  assert.match(dashboard, /setSaved\("Secure save failed"\)/);
  assert.doesNotMatch(dashboard, /patientPortalApi\.sync/);
  assert.doesNotMatch(portalApi, /sync:/);
});

test("application code contains no clinical browser persistence API", () => {
  const files = fs.readdirSync("app", { recursive: true, encoding: "utf8" })
    .filter((name) => /\.(ts|tsx|js|jsx)$/.test(String(name)));
  const source = files.map((name) => read(`app/${name}`)).join("\n");
  assert.doesNotMatch(source, /localStorage|sessionStorage|indexedDB/);
});
