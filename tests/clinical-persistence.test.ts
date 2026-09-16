import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";
import { localDateToday } from "../app/lib/dateOnly.ts";

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
  assert.match(dashboard, /setSaved\("Secure save failed — reloaded last confirmed data"\)/);
  assert.doesNotMatch(dashboard, /patientPortalApi\.sync/);
  assert.doesNotMatch(portalApi, /sync:/);
});

test("application code contains no clinical browser persistence API", () => {
  const files = fs.readdirSync("app", { recursive: true, encoding: "utf8" })
    .filter((name) => /\.(ts|tsx|js|jsx)$/.test(String(name)));
  const source = files.map((name) => read(`app/${name}`)).join("\n");
  assert.doesNotMatch(source, /localStorage|sessionStorage|indexedDB/);
});

test("first visit defaults to an initial consultation and later visits to follow-up", () => {
  const dashboard = read("app/DashboardClient.tsx");
  assert.match(
    dashboard,
    /prior \? "Follow-Up" : "Initial GDM Consultation"/,
  );
});

test("patient list glucose-control sort uses glucose statistics", () => {
  const dashboard = read("app/DashboardClient.tsx");
  assert.match(dashboard, /if \(sort === "Glucose Control"\)/);
  assert.match(dashboard, /return bStats\.atGoal - aStats\.atGoal/);
});

test("patient submissions accurately describe server-backed review status", () => {
  const queue = read("app/components/SubmissionQueue.tsx");
  assert.match(queue, /stored in the shared PostgreSQL database/);
  assert.doesNotMatch(queue, /stored locally in this browser/);
});

test("patient overview recent visits navigate to visit history", () => {
  const dashboard = read("app/DashboardClient.tsx");
  assert.match(
    dashboard,
    /<VisitRow key=\{v\.id\} v=\{v\} onClick=\{\(\) => setTab\("Visits"\)\} \/>/,
  );
});

test("local clinical dates do not depend on UTC conversion", () => {
  assert.equal(localDateToday(new Date(2026, 8, 5, 23, 45)), "2026-09-05");
  assert.equal(localDateToday(new Date(2026, 0, 1, 0, 5)), "2026-01-01");
});

test("weekly visit drafts include the complete editable workflow", () => {
  const dashboard = read("app/DashboardClient.tsx");
  for (const field of ["history", "assessment", "summary", "plan", "education", "fetalSurveillance", "deliveryPlanning", "medChange"])
    assert.match(dashboard, new RegExp(`\\b${field}\\b`));
  assert.match(dashboard, /const draftPayload: WeeklyVisitDraft/);
  assert.match(dashboard, /await persistDraft\(\)/);
});

test("critical saves are serialized and failures reload authoritative PostgreSQL state", () => {
  const dashboard = read("app/DashboardClient.tsx");
  assert.match(dashboard, /const saveQueue = useRef<Promise<unknown>>/);
  assert.match(dashboard, /\.then\(\(\) => clinicalDataApi\.save\(stamped\)\)/);
  assert.match(dashboard, /setData0\(migrateData\(server\.state\)\)/);
  assert.match(dashboard, /reloaded last confirmed data/);
  assert.match(dashboard, /The visit was not finalized because it could not be saved securely/);
});

test("portal imports use authoritative server rows and one transaction", () => {
  const route = read("app/api/clinician-portal/route.ts");
  const api = read("app/lib/patientPortalApi.ts");
  assert.match(route, /withClinicalTransaction/);
  assert.match(route, /Only pending submissions can be changed or imported/);
  assert.match(route, /FOR UPDATE/);
  assert.doesNotMatch(route, /body\.clinicianReadings/);
  assert.doesNotMatch(api, /clinicianReadings/);
});

test("PDF report persistence is awaited and reports partial failure accurately", () => {
  const dashboard = read("app/DashboardClient.tsx");
  assert.match(dashboard, /pdfCreated = true;\s*await saveReport\(reportRecord\)/);
  assert.match(dashboard, /The PDF downloaded, but its report record could not be saved/);
});

test("refinalization synchronizes structured post-visit therapy only for the latest visit", () => {
  const dashboard = read("app/DashboardClient.tsx");
  assert.match(dashboard, /A historical visit cannot replace the patient's current medication list/);
  assert.match(dashboard, /therapy: formatTherapy\(revisedPostVisitTherapy\)/);
  assert.match(dashboard, /medications = updateActiveMedicationList/);
  assert.match(dashboard, /updated\.therapyAfterVisit = clone\(revisedPostVisitTherapy\)/);
});
