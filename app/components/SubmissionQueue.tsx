"use client";
import { useMemo, useState } from "react";
import { CheckCircle2, ClipboardCheck, Edit3, X, XCircle } from "lucide-react";
import type { AppData, PatientSubmission, SubmittedReading } from "../lib/data";
import {
  editSubmittedReading,
  patientPortalService,
  type DuplicateChoice,
} from "../lib/patientPortalService";
import { mergePortalSnapshot, patientPortalApi } from "../lib/patientPortalApi";

export function SubmissionQueue({
  data,
  save,
  openPatient,
}: {
  data: AppData;
  save: (data: AppData) => void;
  openPatient: (id: string) => void;
}) {
  const [selectedId, setSelectedId] = useState<string | null>(null),
    selected = data.patientSubmissions.find((x) => x.id === selectedId),
    pending = data.patientSubmissions.filter(
      (x) => x.status === "Pending",
    ).length;
  return (
    <div className="stack">
      <div className="page-title">
        <span>
          <h1>Patient Submissions</h1>
          <p>
            Review patient-entered values before they become clinical glucose
            data.
          </p>
        </span>
        <em className="submission-count">{pending} awaiting review</em>
      </div>
      <div className="prototype-banner">
        <b>PROTOTYPE — FICTIONAL DATA ONLY</b>
        <span>
          Submissions are stored locally in this browser and have not been
          authenticated.
        </span>
      </div>
      <section className="card table-wrap">
        <table>
          <thead>
            <tr>
              <th>Patient</th>
              <th>Submission Date</th>
              <th>Reading Dates</th>
              <th>Status</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {data.patientSubmissions.map((item) => {
              const patient = data.patients.find(
                  (x) => x.id === item.patientId,
                ),
                dates = item.readings.map((x) => x.date).sort();
              return (
                <tr key={item.id}>
                  <td>
                    <button
                      className="table-link"
                      onClick={() => openPatient(item.patientId)}
                    >
                      {patient
                        ? `${patient.firstName} ${patient.lastName}`
                        : "Unknown fictional patient"}
                    </button>
                  </td>
                  <td>{new Date(item.submittedAt).toLocaleString()}</td>
                  <td>
                    {dates.length
                      ? `${fmtDate(dates[0])}${dates.length > 1 ? ` – ${fmtDate(dates.at(-1)!)} (${dates.length} days)` : ""}`
                      : "—"}
                  </td>
                  <td>
                    <em
                      className={`submission-status ${item.status.toLowerCase()}`}
                    >
                      {item.status}
                    </em>
                  </td>
                  <td>
                    <button
                      className="secondary"
                      onClick={() => {
                        setSelectedId(item.id);
                        patientPortalApi.action("view", item.id, data.settings.displayName).catch(() => {});
                      }}
                    >
                      Review
                    </button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
        {!data.patientSubmissions.length && (
          <p className="empty">No patient submissions yet.</p>
        )}
      </section>
      {selected && (
        <ReviewSubmission
          data={data}
          submission={selected}
          save={save}
          close={() => setSelectedId(null)}
        />
      )}
    </div>
  );
}

function ReviewSubmission({
  data,
  submission,
  save,
  close,
}: {
  data: AppData;
  submission: PatientSubmission;
  save: (data: AppData) => void;
  close: () => void;
}) {
  const provider = data.settings.displayName,
    [editing, setEditing] = useState(false),
    [rows, setRows] = useState<SubmittedReading[]>(
      submission.readings.map((x) => ({ ...x })),
    ),
    [importing, setImporting] = useState(false),
    [choices, setChoices] = useState<Record<string, DuplicateChoice>>({}),
    [error, setError] = useState(""),
    patient = data.patients.find((x) => x.id === submission.patientId),
    duplicates = useMemo(
      () =>
        patientPortalService.duplicates(data, {
          ...submission,
          readings: rows,
        }),
      [data, submission, rows],
    );
  const edit = (
    row: SubmittedReading,
    field: keyof Pick<
      SubmittedReading,
      "date" | "fasting" | "breakfast" | "lunch" | "dinner" | "notes"
    >,
    value: string,
  ) => {
    const parsed = ["fasting", "breakfast", "lunch", "dinner"].includes(field)
      ? value === ""
        ? null
        : Number(value)
      : value;
    setRows(
      rows.map((x) =>
        x.id === row.id ? editSubmittedReading(x, field, parsed, provider) : x,
      ),
    );
  };
  const saveEdits = async () => {
    try {
      const snapshot = await patientPortalApi.action("edit", submission.id, provider, { readings: rows });
      save(mergePortalSnapshot(data, snapshot));
      setEditing(false);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Edits could not be saved.");
    }
  };
  const approve = async () => {
    if (duplicates.length && !importing) {
      setImporting(true);
      return;
    }
    try {
      const snapshot = await patientPortalApi.import(
        submission.id,
        provider,
        choices,
        data.readings.filter(
          (reading) =>
            reading.patientId === submission.patientId &&
            reading.source !== "Patient Portal",
        ),
      );
      save(mergePortalSnapshot(data, snapshot));
      close();
    } catch (e) {
      setError(
        e instanceof Error ? e.message : "Import could not be completed.",
      );
    }
  };
  const reject = async () => {
    if (confirm("Reject this fictional patient submission?")) {
      try {
        const snapshot = await patientPortalApi.action("reject", submission.id, provider);
        save(mergePortalSnapshot(data, snapshot));
        close();
      } catch (e) {
        setError(e instanceof Error ? e.message : "Submission could not be rejected.");
      }
    }
  };
  return (
    <div className="overlay">
      <div className="modal submission-modal">
        <div className="modal-head">
          <span>
            <small>PATIENT PORTAL REVIEW</small>
            <h2>Patient-Submitted Glucose Readings</h2>
            <p>
              {patient
                ? `${patient.firstName} ${patient.lastName}`
                : "Unknown patient"}{" "}
              · Received {new Date(submission.submittedAt).toLocaleString()} ·{" "}
              {data.settings.monitoring}
            </p>
          </span>
          <button onClick={close} aria-label="Close review">
            <X />
          </button>
        </div>
        <div className="modal-body">
          <div className="review-warning">
            Patient-entered values are unverified. Review every value before
            importing.
          </div>
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Date</th>
                  <th>Fasting</th>
                  <th>Breakfast</th>
                  <th>Lunch</th>
                  <th>Dinner</th>
                  <th>Notes</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => (
                  <tr key={row.id}>
                    {(
                      [
                        "date",
                        "fasting",
                        "breakfast",
                        "lunch",
                        "dinner",
                        "notes",
                      ] as const
                    ).map((field) => (
                      <td key={field}>
                        {editing ? (
                          <input
                            type={
                              field === "date"
                                ? "date"
                                : field === "notes"
                                  ? "text"
                                  : "number"
                            }
                            value={row[field] ?? ""}
                            onChange={(e) => edit(row, field, e.target.value)}
                          />
                        ) : (
                          <ReadingValue
                            value={row[field]}
                            target={
                              field === "fasting"
                                ? data.settings.fastingTarget
                                : ["breakfast", "lunch", "dinner"].includes(
                                      field,
                                    )
                                  ? data.settings.monitoring === "1 hour"
                                    ? data.settings.oneHourTarget
                                    : data.settings.twoHourTarget
                                  : undefined
                            }
                          />
                        )}{" "}
                        {row.editHistory?.some((x) => x.field === field) && (
                          <small className="edited-value">
                            Originally{" "}
                            {String(
                              row.editHistory.find((x) => x.field === field)
                                ?.originalValue,
                            )}
                          </small>
                        )}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {importing && duplicates.length > 0 && (
            <section className="duplicate-box">
              <h3>Possible duplicate reading</h3>
              <p>
                Choose an action for each date. Existing values are never
                overwritten silently.
              </p>
              {duplicates.map((date) => (
                <label key={date}>
                  <span>{fmtDate(date)}</span>
                  <select
                    value={choices[date] || ""}
                    onChange={(e) =>
                      setChoices({
                        ...choices,
                        [date]: e.target.value as DuplicateChoice,
                      })
                    }
                  >
                    <option value="">Choose action</option>
                    <option value="keep">Keep Existing</option>
                    <option value="replace">Replace Existing</option>
                    <option value="skip">Skip</option>
                  </select>
                </label>
              ))}
              <button
                className="link"
                onClick={() => {
                  setImporting(false);
                  setChoices({});
                }}
              >
                Cancel Import
              </button>
            </section>
          )}
          {error && (
            <p className="form-error" role="alert">
              {error}
            </p>
          )}
        </div>
        <div className="modal-foot">
          <button
            className="danger-button"
            onClick={reject}
            disabled={submission.status !== "Pending"}
          >
            <XCircle /> Reject
          </button>
          <div className="footer-actions">
            {editing ? (
              <button className="secondary" onClick={saveEdits}>
                <CheckCircle2 /> Save Edits
              </button>
            ) : (
              <button
                className="secondary"
                onClick={() => setEditing(true)}
                disabled={submission.status !== "Pending"}
              >
                <Edit3 /> Edit Before Import
              </button>
            )}
            <button
              className="primary"
              onClick={approve}
              disabled={submission.status !== "Pending"}
            >
              <ClipboardCheck /> Approve & Import
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

function ReadingValue({
  value,
  target,
}: {
  value: string | number | null;
  target?: number;
}) {
  if (value == null || value === "") return <>—</>;
  const numeric = typeof value === "number" ? value : Number.NaN;
  return (
    <span
      className={
        Number.isFinite(numeric) && target && numeric >= target
          ? "review-high"
          : ""
      }
    >
      {String(value)}
      {Number.isFinite(numeric) && target && numeric >= target ? (
        <small> above goal</small>
      ) : (
        ""
      )}
    </span>
  );
}
function fmtDate(date: string) {
  return new Date(`${date}T12:00:00`).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}
