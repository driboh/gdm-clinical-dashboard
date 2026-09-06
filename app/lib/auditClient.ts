"use client";
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
