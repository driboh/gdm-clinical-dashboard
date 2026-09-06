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
