import { databaseError, id, portalDb, tokenHash } from "../../../../db/portal";

export const dynamic = "force-dynamic";
const numeric = (value: unknown) => value == null || value === "" ? null : Number(value);
const safeReading = (row: Record<string,unknown>) => ({id:String(row.id),date:String(row.reading_date).slice(0,10),fasting:numeric(row.fasting),breakfast:numeric(row.breakfast),lunch:numeric(row.lunch),dinner:numeric(row.dinner),notes:String(row.notes||"")});

async function accessFor(token:string){const sql=portalDb(),hash=tokenHash(token),rows=await sql`SELECT a.*,p.first_name FROM patient_portal_access a JOIN patients p ON p.id=a.patient_id WHERE a.token_hash=${hash} LIMIT 1`,access=rows[0];if(!access||access.status!=="Active"||new Date(String(access.expires_at))<=new Date())return null;return access;}

export async function GET(_request:Request,{params}:{params:Promise<{token:string}>}){
 try{const {token}=await params,sql=portalDb(),access=await accessFor(token);if(!access)return Response.json({error:"This portal link is invalid, expired, or disabled."},{status:404});
  const readings=await sql`SELECT r.* FROM patient_submission_readings r JOIN patient_submissions s ON s.id=r.submission_id WHERE s.portal_access_id=${access.id} ORDER BY r.reading_date DESC LIMIT 7`;
  await sql`INSERT INTO audit_events (id,patient_id,action,actor,details) VALUES (${id()},${access.patient_id},'Portal accessed','Patient Portal','Fictional-data prototype')`;
  return Response.json({firstName:access.first_name,monitoring:access.monitoring,showTargets:access.show_targets,fastingTarget:access.fasting_target,postMealTarget:access.post_meal_target,recent:readings.map(safeReading)});
 }catch(error){return Response.json({error:databaseError(error)},{status:503})}
}

export async function POST(request:Request,{params}:{params:Promise<{token:string}>}){
 try{const {token}=await params,sql=portalDb(),access=await accessFor(token);if(!access)return Response.json({error:"This portal link is invalid, expired, or disabled."},{status:404});const body=await request.json(),rows=Array.isArray(body.readings)?body.readings:[];
  if(!rows.length)return Response.json({error:"Enter at least one glucose value."},{status:400});
  for(const row of rows){if(!/^\d{4}-\d{2}-\d{2}$/.test(String(row.date)))return Response.json({error:"Every reading needs a valid date."},{status:400});for(const key of ["fasting","breakfast","lunch","dinner"]){const value=numeric(row[key]);if(value!=null&&(!Number.isFinite(value)||value<20||value>999))return Response.json({error:"Glucose values must be between 20 and 999 mg/dL."},{status:400});}}
  const submissionId=id(),now=new Date().toISOString();await sql`INSERT INTO patient_submissions (id,patient_id,portal_access_id,submitted_at,source,status) VALUES (${submissionId},${access.patient_id},${access.id},${now},'Patient Portal','Pending')`;
  for(const row of rows)await sql`INSERT INTO patient_submission_readings (id,submission_id,reading_date,fasting,breakfast,lunch,dinner,notes) VALUES (${id()},${submissionId},${row.date},${numeric(row.fasting)},${numeric(row.breakfast)},${numeric(row.lunch)},${numeric(row.dinner)},${String(row.notes||"").slice(0,1000)})`;
  await sql`UPDATE patient_portal_access SET last_submission_at=${now} WHERE id=${access.id}`;await sql`INSERT INTO audit_events (id,patient_id,submission_id,action,actor,details) VALUES (${id()},${access.patient_id},${submissionId},'Glucose submitted','Patient Portal','Persisted in shared PostgreSQL')`;
  return Response.json({submissionId,submittedAt:now,persisted:true},{status:201});
 }catch(error){return Response.json({error:databaseError(error),persisted:false},{status:503})}
}
