import type { PoolClient } from "pg";
import { clinicalPool, withClinicalTransaction } from "../../../db/clinical";
import { authorizationResponse, requireClinician } from "../../lib/auth/authorization";

export const dynamic = "force-dynamic";
type RecordValue = Record<string, unknown>;

async function ensureSchema(client: Pick<PoolClient, "query"> = clinicalPool()) {
  await client.query(`CREATE TABLE IF NOT EXISTS clinical_app_state (id text PRIMARY KEY,schema_version integer NOT NULL DEFAULT 1,record jsonb NOT NULL,updated_by text NOT NULL,created_at timestamptz NOT NULL DEFAULT now(),updated_at timestamptz NOT NULL DEFAULT now())`);
  await client.query(`CREATE TABLE IF NOT EXISTS clinician_drafts (clinician_id text NOT NULL,patient_id text NOT NULL REFERENCES patients(id) ON DELETE CASCADE,record jsonb NOT NULL,created_at timestamptz NOT NULL DEFAULT now(),updated_at timestamptz NOT NULL DEFAULT now(),PRIMARY KEY (clinician_id,patient_id))`);
  await client.query("ALTER TABLE audit_events ADD COLUMN IF NOT EXISTS outcome text NOT NULL DEFAULT 'Success'");
  await client.query(`CREATE TABLE IF NOT EXISTS clinical_visits (id text PRIMARY KEY,patient_id text NOT NULL REFERENCES patients(id) ON DELETE CASCADE,visit_date date NOT NULL,status text NOT NULL,record jsonb NOT NULL,created_at timestamptz NOT NULL DEFAULT now(),updated_at timestamptz NOT NULL DEFAULT now())`);
  await client.query(`CREATE TABLE IF NOT EXISTS clinical_visit_versions (visit_id text NOT NULL REFERENCES clinical_visits(id) ON DELETE CASCADE,version integer NOT NULL,record jsonb NOT NULL,finalized_at timestamptz,created_at timestamptz NOT NULL DEFAULT now(),PRIMARY KEY (visit_id,version))`);
  await client.query(`CREATE TABLE IF NOT EXISTS clinical_medications (id text PRIMARY KEY,patient_id text NOT NULL REFERENCES patients(id) ON DELETE CASCADE,status text NOT NULL,record jsonb NOT NULL,created_at timestamptz NOT NULL DEFAULT now(),updated_at timestamptz NOT NULL DEFAULT now())`);
  await client.query(`CREATE TABLE IF NOT EXISTS clinical_medication_changes (visit_id text NOT NULL REFERENCES clinical_visits(id) ON DELETE CASCADE,sequence integer NOT NULL,patient_id text NOT NULL REFERENCES patients(id) ON DELETE CASCADE,record jsonb NOT NULL,created_at timestamptz NOT NULL DEFAULT now(),PRIMARY KEY (visit_id,sequence))`);
  await client.query(`CREATE TABLE IF NOT EXISTS clinical_reports (id text PRIMARY KEY,patient_id text NOT NULL REFERENCES patients(id) ON DELETE CASCADE,visit_id text,record jsonb NOT NULL,created_at timestamptz NOT NULL DEFAULT now(),updated_at timestamptz NOT NULL DEFAULT now())`);
  await client.query(`CREATE TABLE IF NOT EXISTS provider_settings (id text PRIMARY KEY,record jsonb NOT NULL,updated_by text NOT NULL,updated_at timestamptz NOT NULL DEFAULT now())`);
}

function records(value: unknown) { return Array.isArray(value) ? value.filter((item): item is RecordValue => Boolean(item && typeof item === "object")) : []; }
function required(record: RecordValue, key: string) { const value = String(record[key] ?? "").trim(); if (!value) throw new Error(`Invalid clinical record: ${key} is required.`); return value; }
function assertUnique(rows: RecordValue[], label: string) { const ids = rows.map((row) => required(row, "id")); if (new Set(ids).size !== ids.length) throw new Error(`Duplicate ${label} identifier.`); }
async function audit(client: PoolClient, actor: { userId: string; displayName: string }, action: string, entityType: string, entityId: string, patientId?: string) {
  await client.query(`INSERT INTO audit_events (id,patient_id,action,actor,actor_id,source,entity_type,entity_id,details,outcome) VALUES ($1,$2,$3,$4,$5,'Clinician',$6,$7,'Server-authorized clinical write','Success')`, [crypto.randomUUID(), patientId || null, action, actor.displayName, actor.userId, entityType, entityId]);
}

export async function GET() {
  try {
    const actor = await requireClinician();
    await ensureSchema();
    const pool = clinicalPool();
    const [patients, readings, visits, medications, reports, settings, drafts, legacy] = await Promise.all([
      pool.query("SELECT record FROM patients ORDER BY created_at,id"),
      pool.query("SELECT id,patient_id,reading_date::text AS date,fasting,breakfast,lunch,dinner,notes,source,source_submission_id FROM patient_glucose_readings ORDER BY reading_date,id"),
      pool.query("SELECT record FROM clinical_visits ORDER BY visit_date,id"), pool.query("SELECT record FROM clinical_medications ORDER BY created_at,id"),
      pool.query("SELECT record FROM clinical_reports ORDER BY created_at,id"), pool.query("SELECT record,updated_at FROM provider_settings WHERE id='primary' LIMIT 1"),
      pool.query("SELECT patient_id,record FROM clinician_drafts WHERE clinician_id=$1", [actor.userId]), pool.query("SELECT record,updated_at FROM clinical_app_state WHERE id='primary' LIMIT 1"),
    ]);
    const legacyState = legacy.rows[0]?.record as RecordValue | undefined;
    const state = patients.rowCount ? {
      patients: patients.rows.map((row) => row.record),
      readings: readings.rows.map((row) => ({ id:String(row.id),patientId:String(row.patient_id),date:String(row.date),fasting:row.fasting==null?null:Number(row.fasting),breakfast:row.breakfast==null?null:Number(row.breakfast),lunch:row.lunch==null?null:Number(row.lunch),dinner:row.dinner==null?null:Number(row.dinner),notes:String(row.notes||""),source:String(row.source),sourceSubmissionId:row.source_submission_id?String(row.source_submission_id):undefined })),
      visits: visits.rows.map((row) => row.record), medications: medications.rows.map((row) => row.record), reports: reports.rows.map((row) => row.record),
      portalAccess: [], patientSubmissions: [], auditEvents: [], settings: settings.rows[0]?.record || legacyState?.settings || {},
    } : legacyState || null;
    return Response.json({ state, schemaVersion:2, updatedAt:settings.rows[0]?.updated_at?String(settings.rows[0].updated_at):legacy.rows[0]?.updated_at?String(legacy.rows[0].updated_at):null, drafts:Object.fromEntries(drafts.rows.map((row)=>[String(row.patient_id),row.record])) });
  } catch (error) { return authorizationResponse(error) || Response.json({ error:error instanceof Error?error.message:"Clinical data could not be loaded." }, { status:503 }); }
}

export async function PUT(request: Request) {
  try {
    const actor = await requireClinician(["Admin","Clinician"]), body = await request.json();
    if (!body?.state || typeof body.state !== "object") return Response.json({ error:"Invalid clinical state." }, { status:400 });
    const state = body.state as RecordValue, patients=records(state.patients), readings=records(state.readings), visits=records(state.visits), medications=records(state.medications), reports=records(state.reports);
    [patients,readings,visits,medications,reports].forEach((rows,index)=>assertUnique(rows,["patient","reading","visit","medication","report"][index]));
    const patientIds=new Set(patients.map((row)=>required(row,"id")));
    for (const [label,rows] of [["reading",readings],["visit",visits],["medication",medications],["report",reports]] as const) for (const row of rows) if (!patientIds.has(required(row,"patientId"))) throw new Error(`${label} references an unknown patient.`);
    const updatedAt=await withClinicalTransaction(async(client)=>{
      await ensureSchema(client);
      const oldReadings=new Map((await client.query("SELECT id,patient_id FROM patient_glucose_readings WHERE source <> 'Patient Portal'")).rows.map((row)=>[String(row.id),String(row.patient_id)]));
      const oldPatients=new Set((await client.query("SELECT id FROM patients")).rows.map((row)=>String(row.id))), oldVisits=new Set((await client.query("SELECT id FROM clinical_visits")).rows.map((row)=>String(row.id))), oldReports=new Set((await client.query("SELECT id FROM clinical_reports")).rows.map((row)=>String(row.id)));
      for(const patient of patients){const id=required(patient,"id");await client.query(`INSERT INTO patients (id,first_name,last_name,mock,record) VALUES ($1,$2,$3,$4,$5) ON CONFLICT (id) DO UPDATE SET first_name=excluded.first_name,last_name=excluded.last_name,mock=excluded.mock,record=excluded.record,updated_at=now()`,[id,required(patient,"firstName"),required(patient,"lastName"),Boolean(patient.mock),patient]);await audit(client,actor,oldPatients.has(id)?"patient.edited":"patient.created","patient",id,id);}
      for(const reading of readings){const id=required(reading,"id"),patientId=required(reading,"patientId"),date=required(reading,"date");if(!/^\d{4}-\d{2}-\d{2}$/.test(date))throw new Error("Glucose reading date must use YYYY-MM-DD.");await client.query(`INSERT INTO patient_glucose_readings (id,patient_id,reading_date,fasting,breakfast,lunch,dinner,notes,source) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) ON CONFLICT (patient_id,reading_date) DO UPDATE SET fasting=excluded.fasting,breakfast=excluded.breakfast,lunch=excluded.lunch,dinner=excluded.dinner,notes=excluded.notes,source=excluded.source,updated_at=now()`,[id,patientId,date,reading.fasting??null,reading.breakfast??null,reading.lunch??null,reading.dinner??null,String(reading.notes||""),String(reading.source||"Clinician Entry")]);await audit(client,actor,"glucose.changed","glucose_reading",id,patientId);}
      const retained=new Set(readings.map((row)=>required(row,"id")));for(const [id,patientId] of oldReadings)if(!retained.has(id)){await client.query("DELETE FROM patient_glucose_readings WHERE id=$1 AND source <> 'Patient Portal'",[id]);await audit(client,actor,"glucose.deleted","glucose_reading",id,patientId);}
      for(const visit of visits){const id=required(visit,"id"),patientId=required(visit,"patientId");await client.query(`INSERT INTO clinical_visits (id,patient_id,visit_date,status,record) VALUES ($1,$2,$3,$4,$5) ON CONFLICT (id) DO UPDATE SET visit_date=excluded.visit_date,status=excluded.status,record=excluded.record,updated_at=now()`,[id,patientId,required(visit,"date"),required(visit,"status"),visit]);for(const version of records(visit.versions))await client.query(`INSERT INTO clinical_visit_versions (visit_id,version,record,finalized_at) VALUES ($1,$2,$3,$4) ON CONFLICT (visit_id,version) DO NOTHING`,[id,Number(version.version),version,version.finalizedAt||null]);for(const [index,change] of records(visit.medicationChangeDetails).entries())await client.query(`INSERT INTO clinical_medication_changes (visit_id,sequence,patient_id,record) VALUES ($1,$2,$3,$4) ON CONFLICT (visit_id,sequence) DO UPDATE SET record=excluded.record`,[id,index+1,patientId,change]);await audit(client,actor,oldVisits.has(id)?"visit.edited":"visit.created","visit",id,patientId);}
      for(const medication of medications){const id=required(medication,"id"),patientId=required(medication,"patientId");await client.query(`INSERT INTO clinical_medications (id,patient_id,status,record) VALUES ($1,$2,$3,$4) ON CONFLICT (id) DO UPDATE SET status=excluded.status,record=excluded.record,updated_at=now()`,[id,patientId,required(medication,"status"),medication]);await audit(client,actor,"medication.changed","medication",id,patientId);}
      for(const report of reports){const id=required(report,"id"),patientId=required(report,"patientId");await client.query(`INSERT INTO clinical_reports (id,patient_id,visit_id,record) VALUES ($1,$2,$3,$4) ON CONFLICT (id) DO UPDATE SET visit_id=excluded.visit_id,record=excluded.record,updated_at=now()`,[id,patientId,report.visitId||null,report]);if(!oldReports.has(id))await audit(client,actor,"report.generated","report",id,patientId);}
      await client.query(`INSERT INTO provider_settings (id,record,updated_by) VALUES ('primary',$1,$2) ON CONFLICT (id) DO UPDATE SET record=excluded.record,updated_by=excluded.updated_by,updated_at=now()`,[state.settings||{},actor.displayName]);
      const result=await client.query("SELECT now() AS updated_at");return String(result.rows[0].updated_at);
    });
    return Response.json({ok:true,persisted:true,updatedAt});
  }catch(error){const response=authorizationResponse(error);if(response)return response;const message=error instanceof Error?error.message:"Clinical data could not be saved.";return Response.json({error:message},{status:message.startsWith("Invalid")||message.includes("unknown patient")||message.includes("Duplicate")?400:503});}
}

export async function PATCH(request:Request){try{const actor=await requireClinician(["Admin","Clinician"]),body=await request.json(),patientId=String(body.patientId||"");if(!patientId)return Response.json({error:"Patient is required."},{status:400});await ensureSchema();const pool=clinicalPool();if(body.action==="delete-draft")await pool.query("DELETE FROM clinician_drafts WHERE clinician_id=$1 AND patient_id=$2",[actor.userId,patientId]);else if(body.action==="save-draft"&&body.draft&&typeof body.draft==="object")await pool.query(`INSERT INTO clinician_drafts (clinician_id,patient_id,record) VALUES ($1,$2,$3) ON CONFLICT (clinician_id,patient_id) DO UPDATE SET record=excluded.record,updated_at=now()`,[actor.userId,patientId,body.draft]);else return Response.json({error:"Unsupported draft action."},{status:400});return Response.json({ok:true});}catch(error){return authorizationResponse(error)||Response.json({error:"Draft could not be saved."},{status:503});}}
