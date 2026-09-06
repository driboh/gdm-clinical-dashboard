import { recordAudit } from "../../lib/audit";
import { authorizationResponse, requireClinician } from "../../lib/auth/authorization";

const allowed = new Set([
  "patient.viewed",
  "patient.created",
  "patient.edited",
  "glucose.reviewed",
  "glucose.changed",
  "visit.edited",
  "visit.finalized",
  "visit.refinalized",
  "medication.changed",
  "report.generated",
]);

export async function POST(request: Request) {
  try {
    const actor = await requireClinician();
    const body = await request.json();
    const events = Array.isArray(body.events) ? body.events.slice(0, 25) : [];
    for (const event of events) {
      if (!allowed.has(String(event.action))) continue;
      await recordAudit({
        actor,
        action: String(event.action),
        patientId: event.patientId ? String(event.patientId) : undefined,
        entityType: event.entityType ? String(event.entityType) : undefined,
        entityId: event.entityId ? String(event.entityId) : undefined,
        details: event.details ? String(event.details).slice(0, 500) : undefined,
      });
    }
    return Response.json({ ok: true });
  } catch (error) {
    return authorizationResponse(error) || Response.json({ error: "Audit event could not be recorded." }, { status: 503 });
  }
}
