import { portalDb } from "../../db/portal";
import type { ClinicianContext } from "./auth/authorization";

export async function recordAudit(input: {
  action: string;
  actor?: ClinicianContext;
  source?: "Clinician" | "Patient Portal" | "System";
  patientId?: string;
  submissionId?: string;
  entityType?: string;
  entityId?: string;
  details?: string;
}) {
  const sql = portalDb();
  await sql`INSERT INTO audit_events
    (id,patient_id,submission_id,action,actor,actor_id,source,entity_type,entity_id,details)
    VALUES (${crypto.randomUUID()},${input.patientId || null},${input.submissionId || null},${input.action},${input.actor?.displayName || input.source || "System"},${input.actor?.userId || null},${input.source || "Clinician"},${input.entityType || null},${input.entityId || null},${input.details || null})`;
}
