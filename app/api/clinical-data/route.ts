import { portalDb } from "../../../db/portal";
import { recordAudit } from "../../lib/audit";
import { authorizationResponse, requireClinician } from "../../lib/auth/authorization";

export const dynamic = "force-dynamic";

async function ensureSchema() {
  const sql = portalDb();
  await sql`CREATE TABLE IF NOT EXISTS clinical_app_state (
    id text PRIMARY KEY, schema_version integer NOT NULL DEFAULT 1,
    record jsonb NOT NULL, updated_by text NOT NULL,
    created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now())`;
  await sql`CREATE TABLE IF NOT EXISTS clinician_drafts (
    clinician_id text NOT NULL, patient_id text NOT NULL REFERENCES patients(id) ON DELETE CASCADE,
    record jsonb NOT NULL, created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(), PRIMARY KEY (clinician_id, patient_id))`;
  await sql`ALTER TABLE audit_events ADD COLUMN IF NOT EXISTS outcome text NOT NULL DEFAULT 'Success'`;
  await sql`CREATE TABLE IF NOT EXISTS clinical_visits (id text PRIMARY KEY,patient_id text NOT NULL REFERENCES patients(id) ON DELETE CASCADE,visit_date date NOT NULL,status text NOT NULL,record jsonb NOT NULL,created_at timestamptz NOT NULL DEFAULT now(),updated_at timestamptz NOT NULL DEFAULT now())`;
  await sql`CREATE TABLE IF NOT EXISTS clinical_visit_versions (visit_id text NOT NULL REFERENCES clinical_visits(id) ON DELETE CASCADE,version integer NOT NULL,record jsonb NOT NULL,finalized_at timestamptz,created_at timestamptz NOT NULL DEFAULT now(),PRIMARY KEY (visit_id,version))`;
  await sql`CREATE TABLE IF NOT EXISTS clinical_medications (id text PRIMARY KEY,patient_id text NOT NULL REFERENCES patients(id) ON DELETE CASCADE,status text NOT NULL,record jsonb NOT NULL,created_at timestamptz NOT NULL DEFAULT now(),updated_at timestamptz NOT NULL DEFAULT now())`;
  await sql`CREATE TABLE IF NOT EXISTS clinical_medication_changes (visit_id text NOT NULL REFERENCES clinical_visits(id) ON DELETE CASCADE,sequence integer NOT NULL,patient_id text NOT NULL REFERENCES patients(id) ON DELETE CASCADE,record jsonb NOT NULL,created_at timestamptz NOT NULL DEFAULT now(),PRIMARY KEY (visit_id,sequence))`;
  await sql`CREATE TABLE IF NOT EXISTS clinical_reports (id text PRIMARY KEY,patient_id text NOT NULL REFERENCES patients(id) ON DELETE CASCADE,visit_id text,record jsonb NOT NULL,created_at timestamptz NOT NULL DEFAULT now(),updated_at timestamptz NOT NULL DEFAULT now())`;
  await sql`CREATE TABLE IF NOT EXISTS provider_settings (id text PRIMARY KEY,record jsonb NOT NULL,updated_by text NOT NULL,updated_at timestamptz NOT NULL DEFAULT now())`;
}

export async function GET() {
  try {
    const actor = await requireClinician();
    await ensureSchema();
    const sql = portalDb();
    const rows = await sql`SELECT record, schema_version, updated_at FROM clinical_app_state WHERE id='primary' LIMIT 1`;
    const drafts = await sql`SELECT patient_id, record FROM clinician_drafts WHERE clinician_id=${actor.userId}`;
    return Response.json({
      state: rows[0]?.record || null,
      schemaVersion: Number(rows[0]?.schema_version || 1),
      updatedAt: rows[0]?.updated_at ? String(rows[0].updated_at) : null,
      drafts: Object.fromEntries(drafts.map((row) => [String(row.patient_id), row.record])),
    });
  } catch (error) {
    return authorizationResponse(error) || Response.json({ error: "Clinical data could not be loaded." }, { status: 503 });
  }
}

export async function PUT(request: Request) {
  try {
    const actor = await requireClinician(["Admin", "Clinician"]);
    const body = await request.json();
    if (!body?.state || typeof body.state !== "object") return Response.json({ error: "Invalid clinical state." }, { status: 400 });
    await ensureSchema();
    const sql = portalDb();
    const state = body.state as Record<string, unknown>;
    const patients = Array.isArray(state.patients) ? state.patients as Record<string, unknown>[] : [];
    const readings = Array.isArray(state.readings) ? state.readings as Record<string, unknown>[] : [];
    const visits = Array.isArray(state.visits) ? state.visits as Record<string, unknown>[] : [];
    const medications = Array.isArray(state.medications) ? state.medications as Record<string, unknown>[] : [];
    const reports = Array.isArray(state.reports) ? state.reports as Record<string, unknown>[] : [];
    for (const patient of patients) await sql`INSERT INTO patients (id,first_name,last_name,mock,record) VALUES (${String(patient.id)},${String(patient.firstName)},${String(patient.lastName)},${Boolean(patient.mock)},${JSON.stringify(patient)}) ON CONFLICT (id) DO UPDATE SET first_name=excluded.first_name,last_name=excluded.last_name,mock=excluded.mock,record=excluded.record,updated_at=now()`;
    for (const reading of readings) await sql`INSERT INTO patient_glucose_readings (id,patient_id,reading_date,fasting,breakfast,lunch,dinner,notes,source) VALUES (${String(reading.id)},${String(reading.patientId)},${String(reading.date)},${reading.fasting == null ? null : Number(reading.fasting)},${reading.breakfast == null ? null : Number(reading.breakfast)},${reading.lunch == null ? null : Number(reading.lunch)},${reading.dinner == null ? null : Number(reading.dinner)},${String(reading.notes || "")},${String(reading.source || "Clinician Entry")}) ON CONFLICT (patient_id,reading_date) DO UPDATE SET fasting=excluded.fasting,breakfast=excluded.breakfast,lunch=excluded.lunch,dinner=excluded.dinner,notes=excluded.notes,updated_at=now()`;
    for (const visit of visits) {
      await sql`INSERT INTO clinical_visits (id,patient_id,visit_date,status,record) VALUES (${String(visit.id)},${String(visit.patientId)},${String(visit.date)},${String(visit.status)},${JSON.stringify(visit)}) ON CONFLICT (id) DO UPDATE SET visit_date=excluded.visit_date,status=excluded.status,record=excluded.record,updated_at=now()`;
      const versions = Array.isArray(visit.versions) ? visit.versions as Record<string, unknown>[] : [];
      for (const version of versions) await sql`INSERT INTO clinical_visit_versions (visit_id,version,record,finalized_at) VALUES (${String(visit.id)},${Number(version.version)},${JSON.stringify(version)},${version.finalizedAt ? String(version.finalizedAt) : null}) ON CONFLICT (visit_id,version) DO UPDATE SET record=excluded.record,finalized_at=excluded.finalized_at`;
      const changes = Array.isArray(visit.medicationChangeDetails) ? visit.medicationChangeDetails as Record<string, unknown>[] : [];
      for (let index=0; index<changes.length; index++) await sql`INSERT INTO clinical_medication_changes (visit_id,sequence,patient_id,record) VALUES (${String(visit.id)},${index + 1},${String(visit.patientId)},${JSON.stringify(changes[index])}) ON CONFLICT (visit_id,sequence) DO UPDATE SET record=excluded.record`;
    }
    for (const medication of medications) await sql`INSERT INTO clinical_medications (id,patient_id,status,record) VALUES (${String(medication.id)},${String(medication.patientId)},${String(medication.status)},${JSON.stringify(medication)}) ON CONFLICT (id) DO UPDATE SET status=excluded.status,record=excluded.record,updated_at=now()`;
    for (const report of reports) await sql`INSERT INTO clinical_reports (id,patient_id,visit_id,record) VALUES (${String(report.id)},${String(report.patientId)},${report.visitId ? String(report.visitId) : null},${JSON.stringify(report)}) ON CONFLICT (id) DO UPDATE SET visit_id=excluded.visit_id,record=excluded.record,updated_at=now()`;
    await sql`INSERT INTO provider_settings (id,record,updated_by) VALUES ('primary',${JSON.stringify(state.settings || {})},${actor.displayName}) ON CONFLICT (id) DO UPDATE SET record=excluded.record,updated_by=excluded.updated_by,updated_at=now()`;
    await sql`INSERT INTO clinical_app_state (id,schema_version,record,updated_by)
      VALUES ('primary',1,${JSON.stringify(body.state)},${actor.displayName})
      ON CONFLICT (id) DO UPDATE SET record=excluded.record,schema_version=excluded.schema_version,
      updated_by=excluded.updated_by,updated_at=now()`;
    await recordAudit({ actor, action: "clinical.state.saved", source: "Clinician", entityType: "clinical_state", entityId: "primary", details: "Success" });
    return Response.json({ ok: true, persisted: true, updatedAt: new Date().toISOString() });
  } catch (error) {
    return authorizationResponse(error) || Response.json({ error: "Clinical data could not be saved." }, { status: 503 });
  }
}

export async function PATCH(request: Request) {
  try {
    const actor = await requireClinician(["Admin", "Clinician"]);
    const body = await request.json();
    const patientId = String(body.patientId || "");
    if (!patientId) return Response.json({ error: "Patient is required." }, { status: 400 });
    await ensureSchema();
    const sql = portalDb();
    if (body.action === "delete-draft") {
      await sql`DELETE FROM clinician_drafts WHERE clinician_id=${actor.userId} AND patient_id=${patientId}`;
    } else if (body.action === "save-draft" && body.draft && typeof body.draft === "object") {
      await sql`INSERT INTO clinician_drafts (clinician_id,patient_id,record) VALUES (${actor.userId},${patientId},${JSON.stringify(body.draft)})
        ON CONFLICT (clinician_id,patient_id) DO UPDATE SET record=excluded.record,updated_at=now()`;
    } else return Response.json({ error: "Unsupported draft action." }, { status: 400 });
    return Response.json({ ok: true });
  } catch (error) {
    return authorizationResponse(error) || Response.json({ error: "Draft could not be saved." }, { status: 503 });
  }
}
