"use client";
import type { AppData } from "./data";

export type ClientAuditEvent = { action: string; patientId?: string; entityType?: string; entityId?: string; details?: string };

export function sendAudit(events: ClientAuditEvent | ClientAuditEvent[]) {
  const list = Array.isArray(events) ? events : [events];
  if (!list.length) return;
  fetch("/api/audit", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ events: list }),
    keepalive: true,
  }).catch(() => {});
}

export function auditDataChanges(before: AppData, after: AppData) {
  const events: ClientAuditEvent[] = [];
  for (const visit of after.visits) {
    const prior = before.visits.find((item) => item.id === visit.id);
    if (!prior) {
      events.push({ action: "visit.edited", patientId: visit.patientId, entityType: "visit", entityId: visit.id, details: "Visit created" });
      if (visit.status === "Finalized" || visit.status === "Amended") {
        events.push({ action: visit.status === "Amended" ? "visit.refinalized" : "visit.finalized", patientId: visit.patientId, entityType: "visit", entityId: visit.id });
      }
      continue;
    }
    if (JSON.stringify(prior) !== JSON.stringify(visit)) {
      events.push({ action: "visit.edited", patientId: visit.patientId, entityType: "visit", entityId: visit.id });
      if (prior.status !== visit.status && (visit.status === "Finalized" || visit.status === "Amended")) {
        events.push({ action: visit.status === "Amended" ? "visit.refinalized" : "visit.finalized", patientId: visit.patientId, entityType: "visit", entityId: visit.id });
      }
    }
  }
  for (const medication of after.medications) {
    const prior = before.medications.find((item) => item.id === medication.id);
    if (!prior || JSON.stringify(prior) !== JSON.stringify(medication)) {
      events.push({ action: "medication.changed", patientId: medication.patientId, entityType: "medication", entityId: medication.id });
    }
  }
  for (const report of after.reports) {
    if (!before.reports.some((item) => item.id === report.id)) {
      events.push({ action: "report.generated", patientId: report.patientId, entityType: "report", entityId: report.id });
    }
  }
  sendAudit(events);
}
