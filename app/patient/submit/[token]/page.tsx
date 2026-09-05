"use client";
import { useEffect, useMemo, useState } from "react";
import { useParams } from "next/navigation";
import type { SubmittedReading } from "../../../lib/data";
import { newId } from "../../../lib/data";
import { patientPortalApi } from "../../../lib/patientPortalApi";

const today = () => new Date().toISOString().slice(0, 10);
const blank = (date = today()): SubmittedReading => ({
  id: newId("submitted-reading"),
  date,
  fasting: null,
  breakfast: null,
  lunch: null,
  dinner: null,
  notes: "",
});
const shift = (date: string, days: number) => {
  const d = new Date(`${date}T12:00:00`);
  d.setDate(d.getDate() + days);
  return d.toISOString().slice(0, 10);
};
const label = (date: string) =>
  new Date(`${date}T12:00:00`).toLocaleDateString("en-US", {
    weekday: "long",
    month: "long",
    day: "numeric",
  });

export default function PatientGlucosePortal() {
  const params = useParams<{ token: string }>(),
    token = String(params.token || ""),
    [portal, setPortal] = useState<Awaited<ReturnType<typeof patientPortalApi.portal>> | null>(null),
    [loading, setLoading] = useState(true),
    [rows, setRows] = useState<SubmittedReading[]>([blank()]),
    [message, setMessage] = useState(""),
    [error, setError] = useState("");
  useEffect(() => {
    patientPortalApi.portal(token).then(setPortal).catch(e=>setError(e instanceof Error?e.message:"The shared portal could not be opened.")).finally(()=>setLoading(false));
  }, [token]);
  const mealLabel = portal?.monitoring === "2 hour" ? "2 Hours After" : "1 Hour After";
  const recent = useMemo(() => [...(portal?.recent||[])].sort((a,b)=>b.date.localeCompare(a.date)).slice(0,7), [portal]);
  const update = (id: string, key: keyof SubmittedReading, value: string) =>
    setRows(
      rows.map((row) =>
        row.id !== id
          ? row
          : {
              ...row,
              [key]: ["fasting", "breakfast", "lunch", "dinner"].includes(key)
                ? value === ""
                  ? null
                  : Number(value)
                : value,
            },
      ),
    );
  const addPrevious = () => {
    const earliest =
        [...rows].sort((a, b) => a.date.localeCompare(b.date))[0]?.date ||
        today(),
      date = shift(earliest, -1);
    if (!rows.some((x) => x.date === date)) setRows([...rows, blank(date)]);
  };
  const addWeek = () => {
    const dates = new Set(rows.map((x) => x.date)),
      next = [...rows];
    for (let i = 1; i <= 6; i++) {
      const date = shift(today(), -i);
      if (!dates.has(date)) next.push(blank(date));
    }
    setRows(next.sort((a, b) => b.date.localeCompare(a.date)));
  };
  const submit = async () => {
    if (!portal) return;
    const entered = rows.filter((r) =>
      [r.fasting, r.breakfast, r.lunch, r.dinner].some((v) => v != null),
    );
    if (!entered.length) {
      setError("Enter at least one glucose value before submitting.");
      return;
    }
    try {
      await patientPortalApi.submit(token, entered);
      const refreshed=await patientPortalApi.portal(token);
      setPortal(refreshed);
      setRows([blank()]);
      setError("");
      setMessage("Readings submitted successfully");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Submission failed.");
    }
  };
  if (error && !portal)
    return <PortalState title="GDM Glucose Log" message={error} />;
  if (loading)
    return (
      <PortalState
        title="GDM Glucose Log"
        message="Opening your glucose log…"
      />
    );
  if (!portal)
    return (
      <PortalState
        title="Link unavailable"
        message="This portal link is invalid, expired, or disabled. Contact your care team for a new link."
      />
    );
  return (
    <main className="patient-portal">
      <header>
        <span className="patient-mark">G</span>
        <div>
          <h1>GDM Glucose Log</h1>
          <p>Enter your blood sugar readings below.</p>
        </div>
      </header>
      <div className="portal-warning">
        <b>PROTOTYPE — FICTIONAL DATA ONLY</b>
        <span>
          Do not enter real health information. Fictional submissions are saved
          to the shared prototype database for clinician review.
        </span>
      </div>
      <section className="portal-welcome">
        <p>Hello, {portal.firstName}</p>
        <span>Monitoring: {portal.monitoring} after meals · mg/dL</span>
      </section>
      {portal.showTargets && (
        <section className="portal-goals">
          <h2>Your glucose goals</h2>
          <div>
            <span>
              <b>Fasting</b>&lt;{portal.fastingTarget} mg/dL
            </span>
            <span>
              <b>{portal.monitoring} after meals</b>&lt;{portal.postMealTarget} mg/dL
            </span>
          </div>
          <p>Use the targets provided by your care team.</p>
        </section>
      )}
      <section className="portal-entry">
        <div className="portal-entry-head">
          <div>
            <small>
              {rows.length === 1 && rows[0].date === today()
                ? "TODAY"
                : "GLUCOSE READINGS"}
            </small>
            <h2>
              {rows.length === 1 ? label(rows[0].date) : `${rows.length} days`}
            </h2>
          </div>
          <span>mg/dL</span>
        </div>
        {rows.map((row) => (
          <article className="portal-day" key={row.id}>
            {rows.length > 1 && (
              <div className="portal-day-title">
                <b>{label(row.date)}</b>
                <button
                  onClick={() => setRows(rows.filter((x) => x.id !== row.id))}
                  aria-label={`Remove ${label(row.date)}`}
                >
                  Remove
                </button>
              </div>
            )}
            <label>
              <span>Date</span>
              <input
                type="date"
                value={row.date}
                onChange={(e) => update(row.id, "date", e.target.value)}
              />
            </label>
            <div className="portal-numbers">
              {(["fasting", "breakfast", "lunch", "dinner"] as const).map(
                (key) => (
                  <label key={key}>
                    <span>
                      {key === "fasting"
                        ? "Fasting"
                        : `${mealLabel} ${key[0].toUpperCase() + key.slice(1)}`}
                    </span>
                    <input
                      inputMode="numeric"
                      type="number"
                      min="20"
                      max="999"
                      placeholder="—"
                      value={row[key] ?? ""}
                      onChange={(e) => update(row.id, key, e.target.value)}
                    />
                  </label>
                ),
              )}
            </div>
            <label>
              <span>
                Notes <em>optional</em>
              </span>
              <textarea
                rows={2}
                value={row.notes}
                onChange={(e) => update(row.id, "notes", e.target.value)}
                placeholder="Meals, activity, or anything your care team asked you to note"
              />
            </label>
          </article>
        ))}
        <div className="portal-actions">
          <button className="portal-secondary" onClick={addPrevious}>
            Enter Previous Day
          </button>
          <button className="portal-secondary" onClick={addWeek}>
            Add Multiple Days
          </button>
          <button className="portal-submit" onClick={submit}>
            Submit {rows.length === 1 ? "Today’s" : "These"} Readings
          </button>
        </div>
        {message && (
          <p className="portal-success" role="status">
            ✓ {message}
          </p>
        )}
        {error && (
          <p className="portal-error" role="alert">
            {error}
          </p>
        )}
      </section>
      <section className="portal-recent">
        <h2>Recently submitted</h2>
        {recent.length ? (
          recent.map((row) => (
            <article key={row.id}>
              <div>
                <b>
                  {new Date(`${row.date}T12:00:00`).toLocaleDateString(
                    "en-US",
                    { month: "short", day: "numeric" },
                  )}
                </b>
                <small>Submitted</small>
              </div>
              <p>
                {[
                  ["Fasting", row.fasting],
                  ["Breakfast", row.breakfast],
                  ["Lunch", row.lunch],
                  ["Dinner", row.dinner],
                ]
                  .filter(([, v]) => v != null)
                  .map(([k, v]) => `${k} ${v}`)
                  .join(" · ")}
              </p>
            </article>
          ))
        ) : (
          <p className="portal-empty">No recent submissions yet.</p>
        )}
      </section>
      <footer>
        This portal accepts readings only. It does not provide diagnosis or
        medication advice. Contact your care team as directed.
      </footer>
    </main>
  );
}

function PortalState({ title, message }: { title: string; message: string }) {
  return (
    <main className="patient-portal portal-state">
      <div className="patient-mark">G</div>
      <h1>{title}</h1>
      <p>{message}</p>
      <div className="portal-warning">
        <b>PROTOTYPE — FICTIONAL DATA ONLY</b>
      </div>
    </main>
  );
}
