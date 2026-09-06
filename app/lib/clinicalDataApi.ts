import type { AppData } from "./data";

type ServerState = { state: AppData | null; drafts: Record<string, unknown>; updatedAt: string | null };
async function request<T>(options?: RequestInit): Promise<T> {
  const response = await fetch("/api/clinical-data", {
    ...options,
    headers: { "content-type": "application/json", ...(options?.headers || {}) },
    cache: "no-store",
  });
  const payload = await response.json().catch(() => ({ error: "Invalid server response" }));
  if (!response.ok) throw new Error(payload.error || "Clinical database request failed.");
  return payload as T;
}

export const clinicalDataApi = {
  load: () => request<ServerState>(),
  save: (state: AppData) => request<{ ok: true; persisted: true }>({
    method: "PUT",
    body: JSON.stringify({
      state: {
        ...state,
        // These records have dedicated server tables. Never persist plaintext
        // portal tokens or duplicate authoritative portal/audit data here.
        portalAccess: [],
        patientSubmissions: [],
        auditEvents: [],
        readings: state.readings.filter((row) => row.source !== "Patient Portal"),
      },
    }),
  }),
  saveDraft: (patientId: string, draft: unknown) => request<{ ok: true }>({ method: "PATCH", body: JSON.stringify({ action: "save-draft", patientId, draft }) }),
  deleteDraft: (patientId: string) => request<{ ok: true }>({ method: "PATCH", body: JSON.stringify({ action: "delete-draft", patientId }) }),
};
