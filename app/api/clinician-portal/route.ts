import { databaseError, id, json, portalDb } from "../../../db/portal";
import { dateOnly } from "../../lib/dateOnly";

export const dynamic = "force-dynamic";
type Choice = "keep"|"replace"|"skip";
const n=(value:unknown)=>value==null?null:Number(value);

async function snapshot(){
 const sql=portalDb();
 const [patientRows,accessRows,submissionRows,readingRows,auditRows,importedRows]=await Promise.all([
  sql`SELECT id,first_name,last_name,record FROM patients ORDER BY updated_at DESC`,
  sql`SELECT id,patient_id,status,show_targets,created_at,expires_at,disabled_at,last_submission_at FROM patient_portal_access ORDER BY created_at DESC`,
  sql`SELECT * FROM patient_submissions ORDER BY submitted_at DESC`,
  sql`SELECT * FROM patient_submission_readings ORDER BY reading_date`,
  sql`SELECT * FROM audit_events ORDER BY created_at DESC LIMIT 500`,
  sql`SELECT * FROM patient_glucose_readings WHERE source='Patient Portal' ORDER BY reading_date`,
 ]);
 return {
  patients:patientRows.map(x=>json<Record<string,unknown>|null>(x.record,null)).filter((x):x is Record<string,unknown>=>Boolean(x&&x.id&&x.firstName&&x.lastName)),
  portalAccess:accessRows.map(x=>({id:String(x.id),patientId:String(x.patient_id),token:"",status:x.status==="Active"&&new Date(String(x.expires_at))<=new Date()?"Expired":String(x.status),showTargets:Boolean(x.show_targets),createdAt:String(x.created_at),expiresAt:String(x.expires_at),disabledAt:x.disabled_at?String(x.disabled_at):undefined,lastSubmissionAt:x.last_submission_at?String(x.last_submission_at):undefined})),
  patientSubmissions:submissionRows.map(s=>({id:String(s.id),patientId:String(s.patient_id),portalAccessId:String(s.portal_access_id),submissionToken:"",submittedAt:String(s.submitted_at),source:"Patient Portal",status:String(s.status),approvedBy:s.approved_by?String(s.approved_by):undefined,approvedAt:s.approved_at?String(s.approved_at):undefined,importedAt:s.imported_at?String(s.imported_at):undefined,rejectedBy:s.rejected_by?String(s.rejected_by):undefined,rejectedAt:s.rejected_at?String(s.rejected_at):undefined,readings:readingRows.filter(r=>r.submission_id===s.id).map(r=>({id:String(r.id),date:dateOnly(r.reading_date),fasting:n(r.fasting),breakfast:n(r.breakfast),lunch:n(r.lunch),dinner:n(r.dinner),notes:String(r.notes||""),original:json(r.original_values,undefined),editHistory:json(r.edit_history,[])}))})),
  auditEvents:auditRows.map(a=>({id:String(a.id),patientId:String(a.patient_id),submissionId:a.submission_id?String(a.submission_id):undefined,action:String(a.action),actor:String(a.actor),timestamp:String(a.created_at),details:String(a.details||"")})),
  readings:importedRows.map(r=>({id:String(r.id),patientId:String(r.patient_id),date:dateOnly(r.reading_date),fasting:n(r.fasting),breakfast:n(r.breakfast),lunch:n(r.lunch),dinner:n(r.dinner),notes:String(r.notes||""),source:"Patient Portal",sourceSubmissionId:r.source_submission_id?String(r.source_submission_id):undefined}))
 };
}

export async function GET(){try{return Response.json(await snapshot())}catch(error){return Response.json({error:databaseError(error)},{status:503})}}

export async function POST(request:Request){
 try{const body=await request.json(),sql=portalDb();
  for(const patient of body.patients||[])await sql`INSERT INTO patients (id,first_name,last_name,mock,record) VALUES (${patient.id},${patient.firstName},${patient.lastName},true,${JSON.stringify(patient)}) ON CONFLICT (id) DO UPDATE SET first_name=excluded.first_name,last_name=excluded.last_name,record=excluded.record,updated_at=now()`;
  for(const row of body.readings||[])await sql`INSERT INTO patient_glucose_readings (id,patient_id,reading_date,fasting,breakfast,lunch,dinner,notes,source) VALUES (${row.id},${row.patientId},${row.date},${n(row.fasting)},${n(row.breakfast)},${n(row.lunch)},${n(row.dinner)},${String(row.notes||"")},${String(row.source||"Clinician Entry")}) ON CONFLICT (patient_id,reading_date) DO UPDATE SET fasting=excluded.fasting,breakfast=excluded.breakfast,lunch=excluded.lunch,dinner=excluded.dinner,notes=excluded.notes,updated_at=now()`;
  return Response.json({ok:true});
 }catch(error){return Response.json({error:databaseError(error)},{status:503})}
}

export async function PATCH(request:Request){
 try{const body=await request.json(),sql=portalDb(),provider=String(body.provider||"Prototype Clinician"),submissionId=String(body.submissionId||""),submission=(await sql`SELECT * FROM patient_submissions WHERE id=${submissionId} LIMIT 1`)[0];if(!submission)return Response.json({error:"Submission not found"},{status:404});
  if(body.action==="view"){await sql`INSERT INTO audit_events (id,patient_id,submission_id,action,actor,details) VALUES (${id()},${submission.patient_id},${submissionId},'Clinician viewed submission',${provider},'Fictional-data prototype')`;return Response.json({ok:true});}
  if(body.action==="reject"){await sql`UPDATE patient_submissions SET status='Rejected',rejected_by=${provider},rejected_at=now() WHERE id=${submissionId} AND status='Pending'`;await sql`INSERT INTO audit_events (id,patient_id,submission_id,action,actor) VALUES (${id()},${submission.patient_id},${submissionId},'Clinician rejected submission',${provider})`;return Response.json(await snapshot());}
  if(body.action==="edit"){
   for(const row of body.readings||[])await sql`UPDATE patient_submission_readings SET reading_date=${row.date},fasting=${n(row.fasting)},breakfast=${n(row.breakfast)},lunch=${n(row.lunch)},dinner=${n(row.dinner)},notes=${String(row.notes||"").slice(0,1000)},original_values=${JSON.stringify(row.original||null)},edit_history=${JSON.stringify(row.editHistory||[])} WHERE id=${row.id} AND submission_id=${submissionId}`;
   await sql`INSERT INTO audit_events (id,patient_id,submission_id,action,actor) VALUES (${id()},${submission.patient_id},${submissionId},'Clinician edited submitted value',${provider})`;return Response.json(await snapshot());
  }
  if(body.action==="import"){
   for(const row of body.clinicianReadings||[])await sql`INSERT INTO patient_glucose_readings (id,patient_id,reading_date,fasting,breakfast,lunch,dinner,notes,source) VALUES (${row.id},${row.patientId},${row.date},${n(row.fasting)},${n(row.breakfast)},${n(row.lunch)},${n(row.dinner)},${String(row.notes||"")},${String(row.source||"Clinician Entry")}) ON CONFLICT (patient_id,reading_date) DO UPDATE SET fasting=excluded.fasting,breakfast=excluded.breakfast,lunch=excluded.lunch,dinner=excluded.dinner,notes=excluded.notes,updated_at=now()`;
   const rows=await sql`SELECT * FROM patient_submission_readings WHERE submission_id=${submissionId}`;
   for(const row of rows){const readingDate=dateOnly(row.reading_date),existing=(await sql`SELECT * FROM patient_glucose_readings WHERE patient_id=${submission.patient_id} AND reading_date=${readingDate} LIMIT 1`)[0],choice=(body.choices||{})[readingDate] as Choice|undefined,hasDuplicate=existing&&["fasting","breakfast","lunch","dinner"].some(k=>existing[k]!=null&&row[k]!=null);if(hasDuplicate&&!choice)return Response.json({error:"Choose how to handle each possible duplicate before importing.",duplicateDate:readingDate},{status:409});if(choice==="skip")continue;
    if(existing){const replace=choice==="replace",pick=(oldValue:unknown,newValue:unknown)=>newValue==null?oldValue:replace?newValue:oldValue??newValue;await sql`UPDATE patient_glucose_readings SET fasting=${pick(existing.fasting,row.fasting)},breakfast=${pick(existing.breakfast,row.breakfast)},lunch=${pick(existing.lunch,row.lunch)},dinner=${pick(existing.dinner,row.dinner)},notes=${[existing.notes,row.notes].filter(Boolean).join(" · ")},source='Patient Portal',source_submission_id=${submissionId},updated_at=now() WHERE id=${existing.id}`;
    }else await sql`INSERT INTO patient_glucose_readings (id,patient_id,reading_date,fasting,breakfast,lunch,dinner,notes,source,source_submission_id) VALUES (${id()},${submission.patient_id},${readingDate},${n(row.fasting)},${n(row.breakfast)},${n(row.lunch)},${n(row.dinner)},${String(row.notes||"")},'Patient Portal',${submissionId})`;}
   await sql`UPDATE patient_submissions SET status='Imported',approved_by=${provider},approved_at=now(),imported_at=now() WHERE id=${submissionId} AND status='Pending'`;await sql`INSERT INTO audit_events (id,patient_id,submission_id,action,actor,details) VALUES (${id()},${submission.patient_id},${submissionId},'Clinician approved/imported submission',${provider},'Imported to permanent glucose log')`;return Response.json(await snapshot());
  }
  return Response.json({error:"Unsupported action"},{status:400});
 }catch(error){return Response.json({error:databaseError(error)},{status:503})}
}
