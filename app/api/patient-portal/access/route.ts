import { databaseError, expiresInDays, id, portalDb, portalToken, tokenHash } from "../../../../db/portal";
import { authorizationResponse, requireClinician } from "../../../lib/auth/authorization";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  try {
    const actor = await requireClinician(["Admin", "Clinician"]);
    const body = await request.json();
    if (!body.patient?.id || !body.patient?.firstName || !body.patient?.lastName)
      return Response.json({ error: "A fictional patient record is required." }, { status: 400 });
    const sql = portalDb(), now = new Date().toISOString(), accessId = id(), token = portalToken(), expiresAt = expiresInDays(90);
    await sql`INSERT INTO patients (id, first_name, last_name, mock, record, updated_at)
      VALUES (${body.patient.id}, ${body.patient.firstName}, ${body.patient.lastName}, ${Boolean(body.patient.mock)}, ${JSON.stringify(body.patient)}, ${now})
      ON CONFLICT (id) DO UPDATE SET first_name=EXCLUDED.first_name,last_name=EXCLUDED.last_name,mock=EXCLUDED.mock,record=EXCLUDED.record,updated_at=EXCLUDED.updated_at`;
    await sql`UPDATE patient_portal_access SET status='Disabled',disabled_at=${now} WHERE patient_id=${body.patient.id} AND status='Active'`;
    await sql`INSERT INTO patient_portal_access (id,patient_id,token_hash,status,show_targets,fasting_target,post_meal_target,monitoring,created_at,expires_at)
      VALUES (${accessId},${body.patient.id},${tokenHash(token)},'Active',${body.showTargets !== false},${Number(body.fastingTarget)||95},${Number(body.postMealTarget)||140},${body.monitoring === "2 hour" ? "2 hour" : "1 hour"},${now},${expiresAt})`;
    for (const reading of body.readings || []) await sql`INSERT INTO patient_glucose_readings (id,patient_id,reading_date,fasting,breakfast,lunch,dinner,notes,source)
      VALUES (${reading.id},${body.patient.id},${reading.date},${reading.fasting},${reading.breakfast},${reading.lunch},${reading.dinner},${reading.notes||""},${reading.source||"Clinician Entry"})
      ON CONFLICT (patient_id,reading_date) DO NOTHING`;
    await sql`INSERT INTO clinician_users (id,display_name,email) VALUES (${actor.userId},${actor.displayName},${actor.email}) ON CONFLICT (id) DO NOTHING`;
    await sql`INSERT INTO audit_events (id,patient_id,action,actor,actor_id,source,details) VALUES (${id()},${body.patient.id},'Portal created',${actor.displayName},${actor.userId},'Clinician','Fictional-data prototype')`;
    return Response.json({ access:{id:accessId,patientId:body.patient.id,token,status:"Active",createdAt:now,expiresAt,showTargets:body.showTargets !== false} }, { status: 201 });
  } catch (error) { return authorizationResponse(error) || Response.json({ error: databaseError(error) }, { status: 503 }); }
}

export async function PATCH(request: Request) {
  try {
    const actor = await requireClinician(["Admin", "Clinician"]);
    const body = await request.json(), sql = portalDb(), now = new Date().toISOString();
    if (!body.patientId) return Response.json({ error:"patientId is required" },{status:400});
    await sql`UPDATE patient_portal_access SET status='Disabled',disabled_at=${now} WHERE patient_id=${body.patientId} AND status='Active'`;
    await sql`INSERT INTO audit_events (id,patient_id,action,actor,actor_id,source,details) VALUES (${id()},${body.patientId},'Portal disabled',${actor.displayName},${actor.userId},'Clinician','Fictional-data prototype')`;
    return Response.json({ ok:true });
  } catch (error) { return authorizationResponse(error) || Response.json({ error: databaseError(error) }, { status: 503 }); }
}
