import type {
  AppData,
  AuditEvent,
  PatientPortalAccess,
  PatientSubmission,
  SubmittedReading,
} from "./data.ts";
import { newId } from "./data.ts";

export const PROTOTYPE_STORAGE_KEY = "gdm-clinical-data-v2";
export type DuplicateChoice = "keep" | "replace" | "skip";

// Prototype adapter boundary. Real deployment must replace this with authenticated
// patient/clinician sessions, expiring tokens, encrypted transport/storage, access
// controls, audit logging, backups, a secure database, HIPAA-appropriate vendors
// and BAAs, and a formal security review before PHI is used.
export const patientPortalService = {
  createInvitation(
    data: AppData,
    patientId: string,
    showTargets = data.settings.showPatientPortalTargets !== false,
  ) {
    const now = new Date().toISOString(),
      disabled = data.portalAccess.map((x) =>
        x.patientId === patientId && x.status === "Active"
          ? { ...x, status: "Disabled" as const, disabledAt: now }
          : x,
      );
    const access: PatientPortalAccess = {
      id: newId("portal"),
      patientId,
      token: crypto.randomUUID().replaceAll("-", ""),
      status: "Active",
      createdAt: now,
      showTargets,
    };
    return {
      data: {
        ...data,
        portalAccess: [access, ...disabled],
        auditEvents: [
          audit(data, patientId, "Portal invitation created", "Clinician"),
          ...data.auditEvents,
        ],
      },
      access,
    };
  },
  disableAccess(data: AppData, patientId: string) {
    const now = new Date().toISOString();
    return {
      ...data,
      portalAccess: data.portalAccess.map((x) =>
        x.patientId === patientId && x.status === "Active"
          ? { ...x, status: "Disabled" as const, disabledAt: now }
          : x,
      ),
      auditEvents: [
        audit(data, patientId, "Portal access disabled", "Clinician"),
        ...data.auditEvents,
      ],
    };
  },
  resolveAccess(data: AppData, token: string) {
    return data.portalAccess.find(
      (x) => x.token === token && x.status === "Active",
    );
  },
  submit(data: AppData, token: string, rows: SubmittedReading[]) {
    const access = this.resolveAccess(data, token);
    if (!access)
      throw new Error("This patient portal link is disabled or invalid.");
    const submittedAt = new Date().toISOString(),
      submission: PatientSubmission = {
        id: newId("submission"),
        patientId: access.patientId,
        submissionToken: token,
        submittedAt,
        readings: rows.map((x) => ({ ...x })),
        source: "Patient Portal",
        status: "Pending",
      };
    return {
      ...data,
      portalAccess: data.portalAccess.map((x) =>
        x.id === access.id ? { ...x, lastSubmissionAt: submittedAt } : x,
      ),
      patientSubmissions: [submission, ...data.patientSubmissions],
      auditEvents: [
        audit(
          data,
          access.patientId,
          "Patient glucose submission received",
          "Patient Portal",
          submission.id,
        ),
        ...data.auditEvents,
      ],
    };
  },
  reject(data: AppData, submissionId: string, provider: string) {
    const item = data.patientSubmissions.find((x) => x.id === submissionId);
    if (!item) return data;
    const now = new Date().toISOString();
    return {
      ...data,
      patientSubmissions: data.patientSubmissions.map((x) =>
        x.id === submissionId
          ? {
              ...x,
              status: "Rejected" as const,
              rejectedBy: provider,
              rejectedAt: now,
            }
          : x,
      ),
      auditEvents: [
        audit(data, item.patientId, "Submission rejected", provider, item.id),
        ...data.auditEvents,
      ],
    };
  },
  edit(
    data: AppData,
    submissionId: string,
    rows: SubmittedReading[],
    provider: string,
  ) {
    const item = data.patientSubmissions.find((x) => x.id === submissionId);
    if (!item) return data;
    return {
      ...data,
      patientSubmissions: data.patientSubmissions.map((x) =>
        x.id === submissionId ? { ...x, readings: rows } : x,
      ),
      auditEvents: [
        audit(
          data,
          item.patientId,
          "Patient submission edited before import",
          provider,
          item.id,
        ),
        ...data.auditEvents,
      ],
    };
  },
  duplicates(data: AppData, submission: PatientSubmission) {
    return submission.readings
      .filter((row) =>
        data.readings.some(
          (x) =>
            x.patientId === submission.patientId &&
            x.date === row.date &&
            (["fasting", "breakfast", "lunch", "dinner"] as const).some(
              (k) => x[k] != null && row[k] != null,
            ),
        ),
      )
      .map((x) => x.date);
  },
  approveAndImport(
    data: AppData,
    submissionId: string,
    provider: string,
    choices: Record<string, DuplicateChoice> = {},
  ) {
    const submission = data.patientSubmissions.find(
      (x) => x.id === submissionId,
    );
    if (!submission) return data;
    const duplicateDates = this.duplicates(data, submission);
    if (duplicateDates.some((date) => !choices[date]))
      throw new Error(
        "Choose how to handle each possible duplicate before importing.",
      );
    let readings = [...data.readings];
    for (const row of submission.readings) {
      const existing = readings.find(
          (x) => x.patientId === submission.patientId && x.date === row.date,
        ),
        choice = choices[row.date];
      if (existing && choice === "skip") continue;
      if (existing) {
        const useIncoming = choice === "replace";
        readings = readings.map((x) =>
          x.id !== existing.id
            ? x
            : {
                ...x,
                fasting: merge(existing.fasting, row.fasting, useIncoming),
                breakfast: merge(
                  existing.breakfast,
                  row.breakfast,
                  useIncoming,
                ),
                lunch: merge(existing.lunch, row.lunch, useIncoming),
                dinner: merge(existing.dinner, row.dinner, useIncoming),
                notes: [existing.notes, row.notes].filter(Boolean).join(" · "),
                source: "Patient Portal",
                sourceSubmissionId: submission.id,
              },
        );
      } else
        readings.push({
          id: newId("reading"),
          patientId: submission.patientId,
          date: row.date,
          fasting: row.fasting,
          breakfast: row.breakfast,
          lunch: row.lunch,
          dinner: row.dinner,
          notes: row.notes,
          source: "Patient Portal",
          sourceSubmissionId: submission.id,
        });
    }
    const now = new Date().toISOString();
    return {
      ...data,
      readings,
      patientSubmissions: data.patientSubmissions.map((x) =>
        x.id === submissionId
          ? {
              ...x,
              status: "Imported" as const,
              approvedBy: provider,
              approvedAt: now,
              importedAt: now,
            }
          : x,
      ),
      auditEvents: [
        audit(
          data,
          submission.patientId,
          "Submission approved and imported",
          provider,
          submission.id,
        ),
        ...data.auditEvents,
      ],
    };
  },
};

function merge(
  existing: number | null,
  incoming: number | null,
  replace: boolean,
) {
  return incoming == null
    ? existing
    : replace
      ? incoming
      : (existing ?? incoming);
}
function audit(
  data: AppData,
  patientId: string,
  action: string,
  actor: string,
  submissionId?: string,
): AuditEvent {
  return {
    id: newId("audit"),
    patientId,
    submissionId,
    action,
    actor,
    timestamp: new Date().toISOString(),
    details: `Prototype local event ${data.auditEvents.length + 1}`,
  };
}

export function editSubmittedReading(
  row: SubmittedReading,
  field: keyof Pick<
    SubmittedReading,
    "date" | "fasting" | "breakfast" | "lunch" | "dinner" | "notes"
  >,
  value: string | number | null,
  provider: string,
): SubmittedReading {
  const originalValue = row[field];
  if (originalValue === value) return row;
  const originalRow: Omit<SubmittedReading, "original" | "editHistory"> = {
    id: row.id,
    date: row.date,
    fasting: row.fasting,
    breakfast: row.breakfast,
    lunch: row.lunch,
    dinner: row.dinner,
    notes: row.notes,
  };
  return {
    ...row,
    [field]: value,
    original: row.original || originalRow,
    editHistory: [
      ...(row.editHistory || []),
      {
        editedBy: provider,
        editedAt: new Date().toISOString(),
        field,
        originalValue,
        newValue: value,
      },
    ],
  };
}
