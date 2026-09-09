"use client";
import { useEffect, useMemo, useRef, useState } from "react";
import { Chart } from "chart.js/auto";
import {
  AlertTriangle,
  Archive,
  BarChart3,
  CalendarDays,
  ChevronDown,
  ClipboardList,
  Download,
  FileText,
  HeartPulse,
  Inbox,
  LayoutDashboard,
  Menu,
  Plus,
  Search,
  Settings as SettingsIcon,
  Stethoscope,
  Upload,
  Users,
  X,
} from "lucide-react";
import {
  AppData,
  ClinicalSummaryData,
  demoData,
  fullName,
  Medication,
  Patient,
  Reading,
  Report as ReportType,
  ReportSnapshot,
  Settings,
  Visit,
  newId,
} from "./lib/data";
import {
  age,
  alertsFor,
  analyze,
  bmi,
  fmt,
  gestation,
  gestationDays,
} from "./lib/clinical";
import { migrateData } from "./lib/migrate";
import { WeeklySnapshot } from "./components/WeeklySnapshot";
import { GdmClinicalSummary } from "./components/GdmClinicalSummary";
import { buildClinicalSummary, reportPlanItems } from "./lib/reportSummary";
import { buildReportModel, validateVisitConsistency } from "./lib/reportModel";
import {
  applyRegimenChange,
  formatMedicationChange,
  formatTherapy,
  parseRecordedMedicationChange,
  snapshotActiveTherapy,
  updateActiveMedicationList,
} from "./lib/medicationTimeline";
import { PatientPortalCard } from "./components/PatientPortalCard";
import { SubmissionQueue } from "./components/SubmissionQueue";
import { mergePortalSnapshot, patientPortalApi } from "./lib/patientPortalApi";
import { clinicalDataApi } from "./lib/clinicalDataApi";
import {
  medicationChangeIsComplete,
  normalizeMedicationChangeDraft,
  type MedicationChangeDraft,
} from "./lib/medicationChangeValidation";
import { sendAudit } from "./lib/auditClient";
import { signOut } from "./auth/actions";

type Page =
  | "Dashboard"
  | "Patients"
  | "Patient"
  | "Visits"
  | "Patient Submissions"
  | "Reports"
  | "Settings";
const nav = [
  ["Dashboard", LayoutDashboard],
  ["Patients", Users],
  ["New Patient", Plus],
  ["Visits", ClipboardList],
  ["Glucose Log", BarChart3],
  ["Patient Submissions", Inbox],
  ["Reports", FileText],
  ["Settings", SettingsIcon],
] as const;
const tabs = ["Overview", "Glucose", "Visits", "Medications", "Reports"];
const clone = <T,>(x: T): T => JSON.parse(JSON.stringify(x));
const patientSnapshot = (p: Patient) => ({
  firstName: p.firstName,
  lastName: p.lastName,
  mrn: p.mrn,
  dob: p.dob,
  edd: p.edd,
  gravida: p.gravida,
  para: p.para,
  referringOb: p.referringOb,
  obPractice: p.obPractice,
  site: p.site,
  heightFeet: p.heightFeet,
  heightInches: p.heightInches,
  preWeight: p.preWeight,
  pregnancyType: p.pregnancyType,
});
const structuredVisit = (visit: Visit): Visit => {
  const recorded = parseRecordedMedicationChange(visit.medicationChanges || ""),
    bp =
      visit.bloodPressure ||
      visit.maternalFindings.match(/BP\s+([^;·.]+)/i)?.[1]?.trim(),
    hr =
      visit.heartRate ||
      visit.maternalFindings.match(/HR\s+([^;·.]+)/i)?.[1]?.trim(),
    edema =
      visit.edema ||
      visit.maternalFindings.match(/edema\s+([^;·.]+)/i)?.[1]?.trim(),
    currentMedication =
      visit.therapyAtStart?.[0] || recorded?.from || visit.currentMedication,
    newMedication =
      visit.therapyAfterVisit?.find(
        (x) =>
          x.medication.toLowerCase() === recorded?.medication.toLowerCase(),
      ) ||
      recorded?.to ||
      visit.newMedication,
    therapyAtStart =
      visit.therapyAtStart || (currentMedication ? [currentMedication] : []),
    therapyAfterVisit =
      visit.therapyAfterVisit ||
      (newMedication ? [newMedication] : therapyAtStart);
  return {
    ...visit,
    bloodPressure: bp,
    heartRate: hr,
    edema,
    currentMedication,
    newMedication,
    therapyAtStart,
    therapyAfterVisit,
    medicationChangeDetails:
      visit.medicationChangeDetails || (recorded ? [recorded] : []),
  };
};
const stampFinalizedVisits = (data: AppData): AppData => {
  const now = new Date().toISOString();
  return {
    ...data,
    visits: data.visits.map((raw) => {
      const v = structuredVisit(raw);
      if (v.status !== "Finalized" || v.finalizedAt) return v;
      const p = data.patients.find((x) => x.id === v.patientId),
        reviewed =
          v.glucoseSnapshot ||
          filterReviewReadings(
            data.readings.filter((r) => r.patientId === v.patientId),
            v.glucosePeriod || "7",
            v.glucoseStart,
            v.glucoseEnd,
          ),
        stamped: Visit = {
          ...v,
          version: 1,
          finalizedAt: now,
          originalFinalizedAt: now,
          finalizedBy: v.provider || data.settings.displayName,
          currentTherapy: v.currentTherapy || p?.therapy,
          patientSnapshot:
            v.patientSnapshot || (p ? patientSnapshot(p) : undefined),
          glucoseSnapshot: clone(reviewed),
          glucoseStatsSnapshot:
            v.glucoseStatsSnapshot || analyze(reviewed, data.settings),
          glucosePattern:
            v.glucosePattern ||
            glucosePattern(analyze(reviewed, data.settings)),
        };
      return {
        ...stamped,
        versions: [
          {
            version: 1,
            finalizedAt: now,
            provider: stamped.finalizedBy || data.settings.displayName,
            revisionReason: "Original",
            originalFinalizedAt: now,
            snapshot: JSON.stringify({ ...stamped, versions: undefined }),
          },
        ],
      };
    }),
  };
};

function Trend({
  readings,
  settings,
  range = "7",
  onRange,
}: {
  readings: Reading[];
  settings: Settings;
  range?: string;
  onRange?: (x: string) => void;
}) {
  const ref = useRef<HTMLCanvasElement>(null),
    filtered = useMemo(() => {
      if (range === "all") return readings;
      const days = Number(range),
        cut = Date.now() - days * 86400000;
      return readings.filter((x) => new Date(x.date).getTime() >= cut);
    }, [readings, range]);
  useEffect(() => {
    if (!ref.current) return;
    const meal =
        settings.monitoring === "1 hour"
          ? settings.oneHourTarget
          : settings.twoHourTarget,
      c = new Chart(ref.current, {
        type: "line",
        data: {
          labels: filtered.map((x) => fmt(x.date).replace(/, \d{4}/, "")),
          datasets: [
            {
              label: "Fasting",
              data: filtered.map((x) => x.fasting),
              borderColor: "#16a6a1",
              tension: 0.35,
            },
            {
              label: "Breakfast",
              data: filtered.map((x) => x.breakfast),
              borderColor: "#6b78dc",
              tension: 0.35,
            },
            {
              label: "Lunch",
              data: filtered.map((x) => x.lunch),
              borderColor: "#e39a43",
              tension: 0.35,
            },
            {
              label: "Dinner",
              data: filtered.map((x) => x.dinner),
              borderColor: "#e36c78",
              tension: 0.35,
            },
            {
              label: "Fasting goal",
              data: filtered.map(() => settings.fastingTarget),
              borderColor: "#95b9b7",
              pointRadius: 0,
              borderDash: [5, 5],
              borderWidth: 1,
            },
            {
              label: "Post-meal goal",
              data: filtered.map(() => meal),
              borderColor: "#aab1bf",
              pointRadius: 0,
              borderDash: [5, 5],
              borderWidth: 1,
            },
          ],
        },
        options: {
          responsive: true,
          maintainAspectRatio: false,
          plugins: {
            legend: {
              position: "bottom",
              labels: { usePointStyle: true, boxWidth: 7, padding: 16 },
            },
          },
          scales: {
            y: {
              min: 60,
              max: 180,
              grid: { color: "#edf1f3" },
              title: { display: true, text: "Glucose (mg/dL)" },
            },
            x: { grid: { display: false } },
          },
        },
      });
    return () => c.destroy();
  }, [filtered, settings]);
  return (
    <div className="chart-area">
      {onRange && (
        <select
          value={range}
          onChange={(e) => onRange(e.target.value)}
          className="chart-filter"
        >
          <option value="7">Last 7 days</option>
          <option value="14">Last 14 days</option>
          <option value="30">Last 30 days</option>
          <option value="all">Entire pregnancy</option>
        </select>
      )}
      <div className="chart">
        <canvas ref={ref} />
      </div>
    </div>
  );
}
function Stat({
  label,
  value,
  meta,
  tone = "teal",
}: {
  label: string;
  value: string;
  meta: string;
  tone?: string;
}) {
  return (
    <div className={`stat ${tone}`}>
      <span>{label}</span>
      <b>{value}</b>
      <small>{meta}</small>
    </div>
  );
}
function Btn({
  children,
  onClick,
  kind = "primary",
  type = "button",
  disabled = false,
}: {
  children: React.ReactNode;
  onClick?: () => void;
  kind?: string;
  type?: "button" | "submit";
  disabled?: boolean;
}) {
  return (
    <button type={type} className={kind} onClick={onClick} disabled={disabled}>
      {children}
    </button>
  );
}
function Field({
  label,
  name,
  value,
  type = "text",
  required = false,
  onChange,
}: {
  label: string;
  name?: string;
  value: string | number;
  type?: string;
  required?: boolean;
  onChange?: (v: string) => void;
}) {
  return (
    <label className="field">
      <span>
        {label}
        {required && " *"}
      </span>
      <input
        name={name}
        type={type}
        value={value}
        required={required}
        onChange={(e) => onChange?.(e.target.value)}
      />
    </label>
  );
}
function Select<T extends string = string>({
  label,
  value,
  items,
  onChange,
}: {
  label: string;
  value: T;
  items: string[];
  onChange?: (v: T) => void;
}) {
  return (
    <label className="field">
      <span>{label}</span>
      <select value={value} onChange={(e) => onChange?.(e.target.value as T)}>
        {items.map((x) => (
          <option key={x}>{x}</option>
        ))}
      </select>
    </label>
  );
}
function Checks({
  items,
  selected,
  onChange,
}: {
  items: string[];
  selected: string[];
  onChange: (x: string[]) => void;
}) {
  return (
    <div className="checks">
      {items.map((x) => (
        <label key={x}>
          <input
            type="checkbox"
            checked={selected.includes(x)}
            onChange={(e) =>
              onChange(
                e.target.checked
                  ? [...selected, x]
                  : selected.filter((y) => y !== x),
              )
            }
          />
          <span>{x}</span>
        </label>
      ))}
    </div>
  );
}
function Section({
  title,
  children,
  collapse = false,
}: {
  title: string;
  children: React.ReactNode;
  collapse?: boolean;
}) {
  const [o, setO] = useState(true);
  return (
    <section className="card section">
      <button
        className="section-title"
        type="button"
        onClick={() => collapse && setO(!o)}
      >
        <h3>{title}</h3>
        {collapse && <ChevronDown />}
      </button>
      {o && <div className="section-content">{children}</div>}
    </section>
  );
}
function Badge({
  children,
  tone = "",
}: {
  children: React.ReactNode;
  tone?: string;
}) {
  const label =
    children === "PROTOTYPE · FICTIONAL DATA"
      ? "Clinical Dashboard — Authorized users only"
      : children;
  return <em className={`badge ${tone}`}>{label}</em>;
}
function glucosePattern(s: ReturnType<typeof analyze>) {
  if (s.hypo) return "Recurrent hypoglycemia";
  const meals = [
      ["breakfast", s.breakfast],
      ["lunch", s.lunch],
      ["dinner", s.dinner],
    ] as const,
    elevated = meals.filter(([, x]) => x.count && x.pct >= 30);
  if (s.fasting.count && s.fasting.pct >= 30)
    return elevated.length
      ? "Mixed fasting and postprandial elevations"
      : "Persistent fasting elevations";
  if (elevated.length > 1)
    return "Recurrent postprandial elevations at multiple meals";
  if (elevated.length === 1)
    return `Recurrent post-${elevated[0][0]} elevations`;
  return "Values predominantly within target";
}
function filterReviewReadings(
  readings: Reading[],
  period: string,
  start = "",
  end = "",
) {
  if (period === "custom")
    return readings.filter(
      (r) => (!start || r.date >= start) && (!end || r.date <= end),
    );
  const cutoff = new Date();
  cutoff.setHours(0, 0, 0, 0);
  cutoff.setDate(cutoff.getDate() - (Number(period) - 1));
  return readings.filter(
    (r) => new Date(`${r.date}T12:00`).getTime() >= cutoff.getTime(),
  );
}

export default function Home() {
  const [data, setData0] = useState<AppData>(demoData),
    [ready, setReady] = useState(false),
    [loadError, setLoadError] = useState(false),
    [drafts, setDrafts] = useState<Record<string, unknown>>({}),
    [saved, setSaved] = useState("✓ All changes saved"),
    [page, setPage] = useState<Page>("Dashboard"),
    [patientId, setPatientId] = useState("p-sarah"),
    [tab, setTab] = useState("Overview"),
    [menu, setMenu] = useState(false),
    [patientModal, setPatientModal] = useState<"new" | "edit" | null>(null),
    [visitOpen, setVisitOpen] = useState(false),
    [reportPatient, setReportPatient] = useState<string | null>(null),
    [reportId, setReportId] = useState<string | null>(null),
    [detailVisit, setDetailVisit] = useState<string | null>(null),
    [query, setQuery] = useState("");
  useEffect(() => {
    let active = true;
    const load = async () => {
      try {
        const server = await clinicalDataApi.load();
        let initial = server.state ? migrateData(server.state) : null;
        if (!initial) {
          initial = migrateData(demoData);
          await clinicalDataApi.save(initial);
        }
        if (active) {
          setData0(initial);
          setDrafts(server.drafts || {});
        }
      } catch {
        if (active) {
          setSaved("Secure clinical database unavailable");
          setLoadError(true);
        }
      } finally {
        if (active) setReady(true);
      }
    };
    load();
    return () => { active = false; };
  }, []);
  useEffect(() => {
    if (!ready) return;
    let active = true;
    const refresh = async () => {
      try {
        const snapshot = await patientPortalApi.snapshot();
        if (active) setData0((current) => mergePortalSnapshot(current, snapshot));
      } catch {
        if (active) setSaved("Shared portal database unavailable");
      }
    };
    refresh();
    const timer = window.setInterval(refresh, 30000);
    return () => { active = false; window.clearInterval(timer); };
  }, [ready]);
  const save = (next: AppData) => {
    const stamped = stampFinalizedVisits(next);
    setData0(stamped);
    setSaved("Saving…");
    const persistence = clinicalDataApi.save(stamped);
    persistence
      .then(() => setSaved("✓ All changes saved"))
      .catch(() => setSaved("Secure save failed"));
    return persistence;
  };
  const patient =
    data.patients.find((x) => x.id === patientId) || data.patients[0];
  const openPatient = (id: string, t = "Overview") => {
    sendAudit({ action: "patient.viewed", patientId: id, entityType: "patient", entityId: id });
    if (t === "Glucose") sendAudit({ action: "glucose.reviewed", patientId: id, entityType: "patient", entityId: id, details: "Success" });
    setPatientId(id);
    setTab(t);
    setPage("Patient");
    setQuery("");
  };
  const go = (item: string) => {
    setMenu(false);
    if (item === "Dashboard") setPage("Dashboard");
    if (item === "Patients") setPage("Patients");
    if (item === "New Patient") setPatientModal("new");
    if (item === "Visits") setPage("Visits");
    if (item === "Patient Submissions") setPage("Patient Submissions");
    if (item === "Reports") setPage("Reports");
    if (item === "Settings") setPage("Settings");
    if (item === "Glucose Log") {
      if (patient) openPatient(patient.id, "Glucose");
      else setPage("Patients");
    }
  };
  const results = query
    ? data.patients
        .filter((p) =>
          [fullName(p), p.mrn, p.referringOb, p.site].some((x) =>
            x.toLowerCase().includes(query.toLowerCase()),
          ),
        )
        .slice(0, 6)
    : [];
  const updatePatient = (p: Patient) =>
    save({
      ...data,
      patients: data.patients.map((x) => (x.id === p.id ? p : x)),
    });
  if (!ready)
    return <div className="loading">Loading GDM Clinical Dashboard…</div>;
  if (loadError)
    return <div className="loading">Secure clinical database unavailable. No browser-stored clinical record was opened. Please refresh or contact the administrator.</div>;
  return (
    <div className="shell">
      <aside className={menu ? "open" : ""}>
        <div className="brand">
          <i>
            <HeartPulse />
          </i>
          <span>
            <b>GDM Clinical</b>
            <small>Dashboard</small>
          </span>
          <button className="close" onClick={() => setMenu(false)}>
            <X />
          </button>
        </div>
        <nav>
          {nav.map(([x, I]) => (
            <button
              className={
                page === x ||
                (x === "Glucose Log" && page === "Patient" && tab === "Glucose")
                  ? "active"
                  : ""
              }
              key={x}
              onClick={() => go(x)}
            >
              <I />
              {x}
              {x === "Patient Submissions" &&
                data.patientSubmissions.some((s) => s.status === "Pending") && (
                  <em className="nav-count">
                    {
                      data.patientSubmissions.filter(
                        (s) => s.status === "Pending",
                      ).length
                    }
                  </em>
                )}
            </button>
          ))}
        </nav>
        <div className="dev">
          <AlertTriangle />
          <p>
            <b>Clinical Dashboard — Authorized users only</b>
          </p>
        </div>
        <div className="profile">
          <i>DR</i>
          <span>
            <b>Daniel Riboh, PA-C</b>
            <small>GDM Management</small>
          </span>
        </div>
        <form action={signOut} className="logout-form">
          <button type="submit" className="logout-button">Sign out</button>
        </form>
      </aside>
      <main>
        <header>
          <button className="hamb" onClick={() => setMenu(true)}>
            <Menu />
          </button>
          <div className="global-search">
            <label className="search">
              <Search />
              <input
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Search patients, MRN, referring OB…"
              />
            </label>
            {results.length > 0 && (
              <div className="search-results">
                {results.map((p) => (
                  <button key={p.id} onClick={() => openPatient(p.id)}>
                    <b>{fullName(p)}</b>
                    <small>
                      {p.mrn} · {p.referringOb}
                    </small>
                  </button>
                ))}
              </div>
            )}
          </div>
          <span className={`saved ${saved.toLowerCase().includes("failed") || saved.toLowerCase().includes("unavailable") ? "failed" : ""}`}>
            {saved}
          </span>
          {page === "Patient" && (
            <Btn onClick={() => setVisitOpen(true)}>
              <Plus /> New Visit
            </Btn>
          )}
        </header>
        <div className="content">
          {page === "Dashboard" && (
            <GlobalDashboard
              data={data}
              open={openPatient}
              reviewSubmissions={() => setPage("Patient Submissions")}
            />
          )}{" "}
          {page === "Patients" && (
            <PatientsPage
              data={data}
              open={openPatient}
              add={() => setPatientModal("new")}
            />
          )}{" "}
          {page === "Patient" && patient && (
            <PatientPage
              data={data}
              p={patient}
              tab={tab}
              setTab={setTab}
              save={save}
              edit={() => setPatientModal("edit")}
              newVisit={() => setVisitOpen(true)}
              report={() => setReportPatient(patient.id)}
              allPatients={() => setPage("Patients")}
            />
          )}{" "}
          {page === "Visits" && (
            <GlobalVisits
              data={data}
              openPatient={openPatient}
              openVisit={setDetailVisit}
            />
          )}{" "}
          {page === "Patient Submissions" && (
            <SubmissionQueue
              data={data}
              save={save}
              openPatient={openPatient}
            />
          )}{" "}
          {page === "Reports" && (
            <GlobalReports data={data} openReport={setReportPatient} />
          )}{" "}
          {page === "Settings" && <SettingsPage data={data} save={save} />}
        </div>
      </main>
      {patientModal && (
        <PatientForm
          mode={patientModal}
          initial={patientModal === "edit" ? patient : undefined}
          data={data}
          close={() => setPatientModal(null)}
          submit={(p) => {
            const next =
              patientModal === "new"
                ? { ...data, patients: [...data.patients, p] }
                : {
                    ...data,
                    patients: data.patients.map((x) => (x.id === p.id ? p : x)),
                  };
            save(next);
            setPatientModal(null);
            openPatient(p.id);
          }}
        />
      )}
      {visitOpen && patient && (
        <VisitFlowFast
          p={patient}
          data={data}
          savedDraft={drafts[patient.id]}
          close={() => setVisitOpen(false)}
          save={(next) => {
            const result = save(next);
            setVisitOpen(false);
            return result;
          }}
          report={() => {
            setVisitOpen(false);
            setReportPatient(patient.id);
          }}
        />
      )}
      {reportPatient && (
        <ReportViewPdf
          data={data}
          p={
            data.patients.find((x) => x.id === reportPatient) ||
            data.patients.find(
              (x) =>
                x.id ===
                data.reports.find((r) => r.id === reportPatient)?.patientId,
            )!
          }
          reportId={
            data.reports.some((r) => r.id === reportPatient)
              ? reportPatient
              : reportId || undefined
          }
          close={() => {
            setReportPatient(null);
            setReportId(null);
          }}
          backToVisit={() => {
            setReportPatient(null);
            setReportId(null);
            setTab("Visits");
            setPage("Patient");
          }}
          saveReport={(r) =>
            save({
              ...data,
              reports: data.reports.some((x) => x.id === r.id)
                ? data.reports.map((x) => (x.id === r.id ? r : x))
                : [r, ...data.reports],
            })
          }
        />
      )}{" "}
      {/* Frozen historical report selection */}
      {detailVisit && (
        <VersionedVisitDetail
          visit={data.visits.find((x) => x.id === detailVisit)!}
          patient={
            data.patients.find(
              (p) =>
                p.id ===
                data.visits.find((v) => v.id === detailVisit)?.patientId,
            )!
          }
          data={data}
          save={save}
          close={() => setDetailVisit(null)}
        />
      )}
    </div>
  );
}

function GlobalDashboard({
  data,
  open,
  reviewSubmissions,
}: {
  data: AppData;
  open: (id: string) => void;
  reviewSubmissions: () => void;
}) {
  const active = data.patients.filter((p) => !p.archived),
    attention = active.filter(
      (p) =>
        alertsFor(
          p,
          data.readings.filter((r) => r.patientId === p.id),
          data.settings,
        ).length,
    ),
    pending = data.patientSubmissions.filter((x) => x.status === "Pending");
  return (
    <div className="stack">
      <div className="page-title">
        <span>
          <h1>Clinical Dashboard</h1>
          <p>Active gestational diabetes population overview</p>
        </span>
        <Badge>PROTOTYPE · FICTIONAL DATA</Badge>
      </div>
      <div className="stats">
        {[
          ["Total Active GDM Patients", active.length, "Current census"],
          [
            "A1GDM Patients",
            active.filter((p) => p.classification === "A1GDM").length,
            "Diet controlled",
          ],
          [
            "A2GDM Patients",
            active.filter((p) => p.classification === "A2GDM").length,
            "Medication treated",
          ],
          ["Patients Needing Review", attention.length, "Clinician review"],
          [
            "Follow-Ups Due This Week",
            active.filter(
              (p) =>
                new Date(p.nextFollowUp).getTime() - Date.now() <= 7 * 86400000,
            ).length,
            "Next 7 days",
          ],
          [
            "Patients Near Delivery",
            active.filter((p) => {
              const d = 280 - gestationDays(p.edd);
              return d >= 0 && d <= 28;
            }).length,
            "Within 4 weeks",
          ],
        ].map((x, i) => (
          <Stat
            key={String(x[0])}
            label={String(x[0])}
            value={String(x[1])}
            meta={String(x[2])}
            tone={["teal", "blue", "purple", "amber", "green", "slate"][i]}
          />
        ))}
      </div>
      <section className="card submission-summary">
        <span>
          <Inbox />
          <span>
            <h3>Patient Glucose Submissions</h3>
            <p>
              {pending.length
                ? `${pending.length} fictional submission${pending.length === 1 ? "" : "s"} awaiting clinician review`
                : "No submissions awaiting review"}
            </p>
          </span>
        </span>
        <Btn kind={pending.length ? "primary" : "secondary"} onClick={reviewSubmissions}>
          Review Submissions
        </Btn>
      </section>
      <section className="card table-wrap">
        <div className="card-head">
          <span>
            <h3>Patients Requiring Attention</h3>
            <p>
              Patient-specific informational alerts · clinician review required
            </p>
          </span>
        </div>
        <table>
          <thead>
            <tr>
              <th>Patient</th>
              <th>MRN</th>
              <th>Gestation</th>
              <th>Alert</th>
              <th>Next Follow-Up</th>
            </tr>
          </thead>
          <tbody>
            {attention.map((p) => {
              const a = alertsFor(
                p,
                data.readings.filter((r) => r.patientId === p.id),
                data.settings,
              );
              return (
                <tr className="click-row" key={p.id} onClick={() => open(p.id)}>
                  <td>
                    <b>{fullName(p)}</b>
                    <br />
                    <Badge>{p.mock ? "MOCK PATIENT" : p.status}</Badge>
                  </td>
                  <td>{p.mrn}</td>
                  <td>{gestation(p.edd)}</td>
                  <td>{a[0]?.text}</td>
                  <td>{fmt(p.nextFollowUp)}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </section>
    </div>
  );
}

function PatientsPage({
  data,
  open,
  add,
}: {
  data: AppData;
  open: (id: string) => void;
  add: () => void;
}) {
  const [q, setQ] = useState(""),
    [sort, setSort] = useState("Patient Name"),
    [archived, setArchived] = useState(false);
  const rows = data.patients
    .filter(
      (p) =>
        p.archived === archived &&
        [fullName(p), p.mrn, p.referringOb, p.site].some((x) =>
          x.toLowerCase().includes(q.toLowerCase()),
        ),
    )
    .sort((a, b) => {
      if (sort === "Patient Name")
        return fullName(a).localeCompare(fullName(b));
      if (sort === "EDD") return a.edd.localeCompare(b.edd);
      if (sort === "Gestational Age")
        return gestationDays(b.edd) - gestationDays(a.edd);
      if (sort === "Next Follow-Up")
        return a.nextFollowUp.localeCompare(b.nextFollowUp);
      if (sort === "GDM Type")
        return a.classification.localeCompare(b.classification);
      return a.status.localeCompare(b.status);
    });
  return (
    <div className="stack">
      <div className="page-title">
        <span>
          <h1>Patients</h1>
          <p>
            {rows.length} {archived ? "archived" : "active"} patient records
          </p>
        </span>
        <Btn onClick={add}>
          <Plus /> New Patient
        </Btn>
      </div>
      <section className="card filters">
        <label className="search">
          <Search />
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Search name, MRN, referring OB, clinic…"
          />
        </label>
        <select value={sort} onChange={(e) => setSort(e.target.value)}>
          {[
            "Patient Name",
            "EDD",
            "Gestational Age",
            "Next Follow-Up",
            "GDM Type",
            "Glucose Control",
          ].map((x) => (
            <option key={x}>{x}</option>
          ))}
        </select>
        <label className="archive-filter">
          <input
            type="checkbox"
            checked={archived}
            onChange={(e) => setArchived(e.target.checked)}
          />{" "}
          Archived Patients
        </label>
      </section>
      <section className="card table-wrap">
        <table>
          <thead>
            <tr>
              <th>Patient</th>
              <th>MRN</th>
              <th>DOB</th>
              <th>EDD</th>
              <th>Gestational Age</th>
              <th>GDM Type</th>
              <th>Current Therapy</th>
              <th>Glucose Control</th>
              <th>Next Follow-Up</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((p) => {
              const s = analyze(
                data.readings.filter((r) => r.patientId === p.id),
                data.settings,
              );
              return (
                <tr className="click-row" key={p.id} onClick={() => open(p.id)}>
                  <td>
                    <b>{fullName(p)}</b>
                    <div>
                      <Badge>{p.mock ? "MOCK PATIENT" : "NEW"}</Badge>
                    </div>
                  </td>
                  <td>{p.mrn}</td>
                  <td>{fmt(p.dob)}</td>
                  <td>{fmt(p.edd)}</td>
                  <td>{gestation(p.edd)}</td>
                  <td>
                    <Badge
                      tone={p.classification === "A2GDM" ? "warn" : "goal"}
                    >
                      {p.classification}
                    </Badge>
                  </td>
                  <td>{p.therapy}</td>
                  <td>
                    <Badge tone={s.atGoal >= 80 ? "goal" : "warn"}>
                      {s.atGoal >= 80 ? "AT GOAL" : "NEEDS REVIEW"}
                    </Badge>
                  </td>
                  <td>{fmt(p.nextFollowUp)}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </section>
    </div>
  );
}

function PatientPage({
  data,
  p,
  tab,
  setTab,
  save,
  edit,
  newVisit,
  report,
  allPatients,
}: {
  data: AppData;
  p: Patient;
  tab: string;
  setTab: (x: string) => void;
  save: (d: AppData) => void;
  edit: () => void;
  newVisit: () => void;
  report: () => void;
  allPatients: () => void;
}) {
  const readings = data.readings.filter((x) => x.patientId === p.id),
    stats = analyze(readings, data.settings),
    meds = data.medications.filter((x) => x.patientId === p.id),
    visits = data.visits.filter((x) => x.patientId === p.id),
    reports = data.reports.filter((x) => x.patientId === p.id);
  return (
    <>
      <div className="demo">
        <b>SAMPLE / NOT A REAL PATIENT</b>
        <span>
          {p.mock
            ? "This fictional record is included for demonstration only."
            : "Prototype mode — do not enter real PHI."}
        </span>
      </div>
      <div className="patient-head">
        <div>
          <button className="link" onClick={allPatients}>
            ‹ All patients
          </button>
          <div>
            <h1>{fullName(p)}</h1>
            {p.mock && <Badge>MOCK PATIENT</Badge>}
            <Badge tone={stats.atGoal >= 80 ? "goal" : "warn"}>
              {stats.atGoal >= 80 ? "AT GOAL" : "NEEDS REVIEW"}
            </Badge>
          </div>
          <p>
            MRN {p.mrn} · {age(p.dob)} years · G{p.gravida}P{p.para} · EDD{" "}
            {fmt(p.edd)}
          </p>
        </div>
        <div className="head-actions">
          <Btn kind="secondary" onClick={edit}>
            Edit Patient
          </Btn>
          <Btn kind="secondary" onClick={report}>
            <FileText /> Generate OB Report
          </Btn>
        </div>
      </div>
      <div className="tabs">
        {tabs.map((x) => (
          <button
            className={tab === x ? "active" : ""}
            onClick={() => setTab(x)}
            key={x}
          >
            {x}
          </button>
        ))}
      </div>
      {tab === "Overview" && (
        <>
          <Overview
            data={data}
            p={p}
            readings={readings}
            meds={meds}
            visits={visits}
            setTab={setTab}
            newVisit={newVisit}
          />
          <PatientPortalCard data={data} patient={p} save={save} />
        </>
      )}{" "}
      {tab === "Glucose" && (
        <Glucose data={data} p={p} readings={readings} save={save} />
      )}{" "}
      {tab === "Visits" && (
        <PatientVisits
          visits={visits}
          newVisit={newVisit}
          data={data}
          save={save}
        />
      )}{" "}
      {tab === "Medications" && (
        <Medications data={data} p={p} meds={meds} save={save} />
      )}{" "}
      {tab === "Reports" && (
        <PatientReports reports={reports} report={report} />
      )}
    </>
  );
}

function Overview({
  data,
  p,
  readings,
  meds,
  visits,
  setTab,
  newVisit,
}: {
  data: AppData;
  p: Patient;
  readings: Reading[];
  meds: Medication[];
  visits: Visit[];
  setTab: (x: string) => void;
  newVisit: () => void;
}) {
  const s = analyze(readings, data.settings),
    alerts = alertsFor(p, readings, data.settings),
    [range, setRange] = useState("7"),
    weekly = filterReviewReadings(readings, "7");
  return (
    <>
      <WeeklySnapshot
        readings={weekly}
        settings={data.settings}
        therapy={p.therapy}
      />
      <div className="stats">
        <Stat
          label="Gestational Age"
          value={gestation(p.edd)}
          meta={`EDD ${fmt(p.edd)}`}
        />
        <Stat
          label="GDM Classification"
          value={p.classification}
          meta={
            p.classification === "A2GDM"
              ? "Medication controlled"
              : "Diet controlled"
          }
          tone="blue"
        />
        <Stat
          label="Current Therapy"
          value={p.therapy}
          meta={`${meds.filter((m) => m.status === "Active").length} active medications`}
          tone="purple"
        />
        <Stat
          label="Overall Control"
          value={`${s.atGoal}% at goal`}
          meta={`${s.total} readings reviewed`}
          tone="green"
        />
        <Stat
          label="Fasting Above Goal"
          value={`${s.fasting.pct}%`}
          meta={`${s.fasting.above} of ${s.fasting.count} readings`}
          tone="amber"
        />
        <Stat
          label="Next Follow-Up"
          value={fmt(p.nextFollowUp)}
          meta={p.nextFollowUp ? "Scheduled" : "Not scheduled"}
          tone="slate"
        />
      </div>
      <div className="two">
        <section className="card trend">
          <div className="card-head">
            <span>
              <h3>Glucose trend</h3>
              <p>{data.settings.monitoring} postprandial · mg/dL</p>
            </span>
          </div>
          <Trend
            readings={readings}
            settings={data.settings}
            range={range}
            onRange={setRange}
          />
          <button className="link" onClick={() => setTab("Glucose")}>
            View complete glucose log →
          </button>
        </section>
        <section className="card alerts">
          <div className="card-head">
            <span>
              <h3>Clinical alerts</h3>
              <p>Informational · clinician review required</p>
            </span>
            <b className="number">{alerts.length}</b>
          </div>
          {alerts.length ? (
            alerts.map((a, i) => (
              <div className={`alert ${a.type}`} key={i}>
                <AlertTriangle />
                <span>
                  <b>{a.text.split(" — ")[0]}</b>
                  <small>
                    {a.text.split(" — ")[1] || "Clinician review required"}
                  </small>
                </span>
              </div>
            ))
          ) : (
            <p className="empty">No current alerts.</p>
          )}
          <div className="safety">
            <Stethoscope />
            <p>
              <b>Clinical decision support only</b> — all assessments and
              treatment decisions must be reviewed and approved by the treating
              clinician.
            </p>
          </div>
        </section>
      </div>
      <div className="two lower">
        <section className="card">
          <div className="card-head">
            <span>
              <h3>Recent visits</h3>
              <p>Longitudinal care history</p>
            </span>
            <button className="link" onClick={newVisit}>
              <Plus /> New visit
            </button>
          </div>
          {visits.slice(0, 4).map((v) => (
            <VisitRow key={v.id} v={v} />
          ))}
        </section>
        <section className="card snapshot">
          <h3>Care snapshot</h3>
          {[
            ["Current therapy", p.therapy],
            ["Pregnancy type", p.pregnancyType],
            ["BMI", bmi(p)],
            ["Referring OB", p.referringOb],
            ["Clinic / Site", p.site],
          ].map((x) => (
            <div key={x[0]}>
              <span>{x[0]}</span>
              <b>{x[1]}</b>
            </div>
          ))}
        </section>
      </div>
    </>
  );
}
function VisitRow({ v, onClick }: { v: Visit; onClick?: () => void }) {
  return (
    <button className="visit-row" onClick={onClick}>
      <i>
        <b>{new Date(`${v.date}T12:00`).getDate()}</b>
        <small>
          {new Date(`${v.date}T12:00`)
            .toLocaleString("en", { month: "short" })
            .toUpperCase()}
        </small>
      </i>
      <span>
        <b>{v.type}</b>
        <p>{v.summary}</p>
      </span>
      <Badge tone="goal">{v.status.toUpperCase()}</Badge>
    </button>
  );
}

function Glucose({
  data,
  p,
  readings,
  save,
}: {
  data: AppData;
  p: Patient;
  readings: Reading[];
  save: (d: AppData) => void;
}) {
  const [range, setRange] = useState("7"),
    [editing, setEditing] = useState<string | null>(null);
  const update = (id: string, k: keyof Reading, v: string) =>
    save({
      ...data,
      readings: data.readings.map((r) =>
        r.id === id
          ? {
              ...r,
              [k]: ["date", "notes"].includes(k)
                ? v
                : v === ""
                  ? null
                  : Number(v),
            }
          : r,
      ),
    });
  const del = (id: string) => {
    if (confirm("Delete this glucose day?"))
      save({ ...data, readings: data.readings.filter((r) => r.id !== id) });
  };
  const add = () => {
    const r: Reading = {
      id: newId("reading"),
      patientId: p.id,
      date: new Date().toISOString().slice(0, 10),
      fasting: null,
      breakfast: null,
      lunch: null,
      dinner: null,
      notes: "",
    };
    save({ ...data, readings: [...data.readings, r] });
    setEditing(r.id);
  };
  const addWeek = () => {
    const existing = new Set(readings.map((r) => r.date)),
      today = new Date(),
      rows: Reading[] = [];
    for (let i = 6; i >= 0; i--) {
      const d = new Date(today);
      d.setDate(today.getDate() - i);
      const date = d.toISOString().slice(0, 10);
      if (!existing.has(date))
        rows.push({
          id: newId("reading"),
          patientId: p.id,
          date,
          fasting: null,
          breakfast: null,
          lunch: null,
          dinner: null,
          notes: "",
        });
    }
    if (rows.length) save({ ...data, readings: [...data.readings, ...rows] });
  };
  const s = analyze(readings, data.settings),
    meal =
      data.settings.monitoring === "1 hour"
        ? data.settings.oneHourTarget
        : data.settings.twoHourTarget;
  return (
    <div className="stack">
      <div className="page-title">
        <span>
          <h2>Glucose log & analysis</h2>
          <p>
            Targets: fasting &lt;{data.settings.fastingTarget};{" "}
            {data.settings.monitoring} postprandial &lt;{meal} mg/dL
          </p>
        </span>
        <div className="head-actions">
          <Btn kind="secondary" onClick={addWeek}>
            <CalendarDays /> Add 7 Days
          </Btn>
          <Btn onClick={add}>
            <Plus /> Add Day
          </Btn>
        </div>
      </div>
      <WeeklySnapshot
        readings={filterReviewReadings(readings, "7")}
        settings={data.settings}
        therapy={p.therapy}
      />
      <section className="card table-wrap">
        <table>
          <thead>
            <tr>
              <th>Date</th>
              <th>Fasting</th>
              <th>Breakfast</th>
              <th>Lunch</th>
              <th>Dinner</th>
              <th>Notes</th>
              <th>Source</th>
              <th>Actions</th>
            </tr>
          </thead>
          <tbody>
            {readings
              .sort((a, b) => b.date.localeCompare(a.date))
              .map((r) => {
                const edit = editing === r.id;
                return (
                  <tr key={r.id}>
                    <td>
                      <input
                        disabled={!edit}
                        type="date"
                        value={r.date}
                        onChange={(e) => update(r.id, "date", e.target.value)}
                      />
                    </td>
                    {(["fasting", "breakfast", "lunch", "dinner"] as const).map(
                      (k) => {
                        const goal =
                            k === "fasting"
                              ? data.settings.fastingTarget
                              : meal,
                          v = r[k],
                          cl =
                            v === null
                              ? "blank"
                              : v < 70
                                ? "hypo"
                                : v < goal
                                  ? "ok"
                                  : v < goal + 10
                                    ? "over"
                                    : "high";
                        return (
                          <td key={k}>
                            <label className={`reading ${cl}`}>
                              <span>
                                {v === null ? "—" : cl === "ok" ? "✓" : "↑"}
                              </span>
                              <input
                                disabled={!edit}
                                type="number"
                                value={v ?? ""}
                                onChange={(e) =>
                                  update(r.id, k, e.target.value)
                                }
                              />
                            </label>
                          </td>
                        );
                      },
                    )}
                    <td>
                      <input
                        disabled={!edit}
                        value={r.notes}
                        onChange={(e) => update(r.id, "notes", e.target.value)}
                      />
                    </td>
                    <td>
                      <Badge tone={r.source === "Patient Portal" ? "goal" : ""}>
                        {r.source || "Clinician Entry"}
                      </Badge>
                    </td>
                    <td className="row-actions">
                      <button onClick={() => setEditing(edit ? null : r.id)}>
                        {edit ? "Done" : "Edit"}
                      </button>
                      <button className="danger-link" onClick={() => del(r.id)}>
                        Delete
                      </button>
                    </td>
                  </tr>
                );
              })}
          </tbody>
        </table>
      </section>
      <div className="analysis">
        {(["fasting", "breakfast", "lunch", "dinner"] as const).map((k) => (
          <div className="card" key={k}>
            <span>{k}</span>
            <b>{s[k].avg || "—"}</b>
            <small>
              Avg · {s[k].count ? `${s[k].min}–${s[k].max}` : "No data"}
            </small>
            <em>
              {s[k].above} of {s[k].count} above goal ({s[k].pct}%)
            </em>
          </div>
        ))}
      </div>
      <section className="card trend">
        <div className="card-head">
          <span>
            <h3>Glucose trend</h3>
            <p>
              {s.total} readings · {s.atGoal}% at goal · {s.hypo} below 70 ·
              high {s.highest || "—"} · low {s.lowest || "—"}
            </p>
          </span>
        </div>
        <Trend
          readings={readings}
          settings={data.settings}
          range={range}
          onRange={setRange}
        />
      </section>
    </div>
  );
}

function PatientVisits({
  visits,
  newVisit,
  data,
  save,
}: {
  visits: Visit[];
  newVisit: () => void;
  data: AppData;
  save: (d: AppData) => void;
}) {
  const [selectedId, setSelectedId] = useState<string | null>(null),
    selected = data.visits.find((v) => v.id === selectedId);
  return (
    <div className="stack">
      <div className="page-title">
        <span>
          <h2>Visit history</h2>
          <p>
            Finalized notes are protected; deliberate revisions preserve every
            prior version.
          </p>
        </span>
        <Btn onClick={newVisit}>
          <Plus /> New Visit
        </Btn>
      </div>
      <section className="card">
        {visits.length ? (
          visits.map((v) => (
            <VisitRow key={v.id} v={v} onClick={() => setSelectedId(v.id)} />
          ))
        ) : (
          <p className="empty">No visits yet.</p>
        )}
      </section>
      {selected && (
        <VersionedVisitDetail
          visit={selected}
          patient={
            data.patients.find((p) => p.id === selected.patientId) || null
          }
          data={data}
          save={save}
          close={() => setSelectedId(null)}
        />
      )}
    </div>
  );
}
function Medications({
  data,
  p,
  meds,
  save,
}: {
  data: AppData;
  p: Patient;
  meds: Medication[];
  save: (d: AppData) => void;
}) {
  const [editing, setEditing] = useState<Medication | null>(null);
  const submit = (m: Medication) => {
    save({
      ...data,
      medications: data.medications.some((x) => x.id === m.id)
        ? data.medications.map((x) => (x.id === m.id ? m : x))
        : [...data.medications, m],
    });
    setEditing(null);
  };
  const discontinue = (m: Medication) => {
    if (!confirm(`Discontinue ${m.name}?`)) return;
    submit({
      ...m,
      status: "Discontinued",
      stopDate: new Date().toISOString().slice(0, 10),
      history: [...m.history, `Discontinued ${new Date().toLocaleString()}`],
    });
  };
  return (
    <div className="stack">
      <div className="page-title">
        <span>
          <h2>Medications</h2>
          <p>All changes are manual and recorded in history.</p>
        </span>
        <Btn
          onClick={() =>
            setEditing({
              id: newId("med"),
              patientId: p.id,
              name: "",
              type: "Other",
              dose: "",
              frequency: "",
              startDate: new Date().toISOString().slice(0, 10),
              status: "Active",
              history: [],
            })
          }
        >
          <Plus /> Add Medication
        </Btn>
      </div>
      {meds.map((m) => (
        <section className="card med" key={m.id}>
          <i>{m.name[0] || "M"}</i>
          <span>
            <h3>{m.name}</h3>
            <p>
              {m.dose} · {m.frequency} · Started {fmt(m.startDate)}
              {m.stopDate && ` · Stopped ${fmt(m.stopDate)}`}
            </p>
            <Badge tone={m.status === "Active" ? "goal" : ""}>
              {m.status.toUpperCase()}
            </Badge>
          </span>
          <div className="row-actions">
            <button onClick={() => setEditing(clone(m))}>Edit</button>
            {m.status === "Active" && (
              <button onClick={() => discontinue(m)}>Discontinue</button>
            )}
          </div>
        </section>
      ))}
      {!meds.length && (
        <section className="card empty">No medications recorded.</section>
      )}
      {editing && (
        <MedicationModal
          med={editing}
          close={() => setEditing(null)}
          submit={submit}
        />
      )}
    </div>
  );
}
function MedicationModal({
  med,
  close,
  submit,
}: {
  med: Medication;
  close: () => void;
  submit: (m: Medication) => void;
}) {
  const [m, setM] = useState(med);
  return (
    <div className="overlay">
      <form
        className="small-modal"
        onSubmit={(e) => {
          e.preventDefault();
          submit({
            ...m,
            history: [
              ...m.history,
              `Saved manually ${new Date().toLocaleString()}`,
            ],
          });
        }}
      >
        <div className="modal-head">
          <h2>{med.name ? "Edit" : "Add"} Medication</h2>
          <button type="button" onClick={close}>
            <X />
          </button>
        </div>
        <div className="modal-body form-grid">
          <Field
            label="Medication"
            value={m.name}
            required
            onChange={(v) => setM({ ...m, name: v })}
          />
          <Select
            label="Type"
            value={m.type}
            items={[
              "Rapid acting",
              "Short acting",
              "Intermediate acting",
              "Long acting",
              "Metformin",
              "Other",
            ]}
            onChange={(v) => setM({ ...m, type: v })}
          />
          <Field
            label="Dose"
            value={m.dose}
            required
            onChange={(v) => setM({ ...m, dose: v })}
          />
          <Field
            label="Frequency / Timing"
            value={m.frequency}
            onChange={(v) => setM({ ...m, frequency: v })}
          />
          <Field
            label="Start Date"
            type="date"
            value={m.startDate}
            onChange={(v) => setM({ ...m, startDate: v })}
          />
          {[
            "Rapid acting",
            "Short acting",
            "Intermediate acting",
            "Long acting",
          ].includes(m.type) && (
            <>
              <Field
                label="Breakfast Dose"
                value={m.breakfastDose || ""}
                onChange={(v) => setM({ ...m, breakfastDose: v })}
              />
              <Field
                label="Lunch Dose"
                value={m.lunchDose || ""}
                onChange={(v) => setM({ ...m, lunchDose: v })}
              />
              <Field
                label="Dinner Dose"
                value={m.dinnerDose || ""}
                onChange={(v) => setM({ ...m, dinnerDose: v })}
              />
              <Field
                label="Bedtime Dose"
                value={m.bedtimeDose || ""}
                onChange={(v) => setM({ ...m, bedtimeDose: v })}
              />
              <Field
                label="Units"
                value={m.units || "units"}
                onChange={(v) => setM({ ...m, units: v })}
              />
            </>
          )}
        </div>
        <div className="modal-foot">
          <Btn kind="secondary" onClick={close}>
            Cancel
          </Btn>
          <Btn type="submit">Save Medication</Btn>
        </div>
      </form>
    </div>
  );
}
function PatientReports({
  reports,
  report,
}: {
  reports: ReportType[];
  report: () => void;
}) {
  return (
    <div className="stack">
      <div className="page-title">
        <span>
          <h2>Reports</h2>
          <p>Reports generated for this patient only.</p>
        </span>
        <Btn onClick={report}>
          <FileText /> Generate OB Report
        </Btn>
      </div>
      <section className="card report-row">
        <FileText />
        <span>
          <h3>GESTATIONAL DIABETES MANAGEMENT REPORT</h3>
          <p>
            {reports.length} saved report record
            {reports.length === 1 ? "" : "s"}
          </p>
        </span>
        <Btn kind="secondary" onClick={report}>
          View / Print
        </Btn>
      </section>
    </div>
  );
}

function PatientForm({
  mode,
  initial,
  data,
  close,
  submit,
}: {
  mode: "new" | "edit";
  initial?: Patient;
  data: AppData;
  close: () => void;
  submit: (p: Patient) => void;
}) {
  const blank: Patient = {
    id: newId("patient"),
    firstName: "",
    lastName: "",
    mrn: "",
    dob: "",
    edd: "",
    gravida: "",
    para: "",
    referringOb: "",
    obPractice: "",
    site: "",
    phone: "",
    language: "English",
    heightFeet: 5,
    heightInches: 5,
    preWeight: 0,
    currentWeight: 0,
    pregnancyType: "Singleton",
    classification: "Pending",
    therapy: "Diet controlled",
    diagnosisDate: "",
    notes: "",
    nextFollowUp: "",
    status: "NEW",
    archived: false,
  };
  const [p, setP] = useState(clone(initial || blank)),
    [error, setError] = useState("");
  const set = (k: keyof Patient, v: string | number | boolean) =>
    setP({ ...p, [k]: v });
  const saveForm = (e: React.FormEvent) => {
    e.preventDefault();
    if (
      data.patients.some(
        (x) => x.mrn.toLowerCase() === p.mrn.toLowerCase() && x.id !== p.id,
      )
    ) {
      setError("That MRN is already assigned to another patient.");
      return;
    }
    submit(p);
  };
  return (
    <div className="overlay">
      <form className="modal patient-form" onSubmit={saveForm}>
        <div className="modal-head">
          <span>
            <small>{mode === "new" ? "NEW PATIENT" : "EDIT PATIENT"}</small>
            <h2>{mode === "new" ? "Create Patient Record" : fullName(p)}</h2>
            <p>
              Age: {p.dob ? age(p.dob) : "—"} · Gestational age:{" "}
              {p.edd ? gestation(p.edd) : "—"} · BMI: {bmi(p)}
            </p>
          </span>
          <button type="button" onClick={close}>
            <X />
          </button>
        </div>
        <div className="modal-body">
          <Section title="Demographics & Pregnancy Information">
            <div className="form-grid triple">
              <Field
                label="First Name"
                value={p.firstName}
                required
                onChange={(v) => set("firstName", v)}
              />
              <Field
                label="Last Name"
                value={p.lastName}
                required
                onChange={(v) => set("lastName", v)}
              />
              <Field
                label="MRN"
                value={p.mrn}
                required
                onChange={(v) => set("mrn", v)}
              />
              <Field
                label="DOB"
                type="date"
                value={p.dob}
                required
                onChange={(v) => set("dob", v)}
              />
              <Field
                label="EDD"
                type="date"
                value={p.edd}
                required
                onChange={(v) => set("edd", v)}
              />
              <Field
                label="Phone"
                value={p.phone}
                onChange={(v) => set("phone", v)}
              />
              <Field
                label="Gravida"
                value={p.gravida}
                onChange={(v) => set("gravida", v)}
              />
              <Field
                label="Para"
                value={p.para}
                onChange={(v) => set("para", v)}
              />
              <Field
                label="Referring OB/GYN"
                value={p.referringOb}
                onChange={(v) => set("referringOb", v)}
              />
              <Field
                label="OB Practice"
                value={p.obPractice}
                onChange={(v) => set("obPractice", v)}
              />
              <Field
                label="Clinic / Site"
                value={p.site}
                onChange={(v) => set("site", v)}
              />
              <Field
                label="Preferred Language"
                value={p.language}
                onChange={(v) => set("language", v)}
              />
              <Field
                label="Height Feet"
                type="number"
                value={p.heightFeet}
                onChange={(v) => set("heightFeet", Number(v))}
              />
              <Field
                label="Height Inches"
                type="number"
                value={p.heightInches}
                onChange={(v) => set("heightInches", Number(v))}
              />
              <Field
                label="Pre-Pregnancy Weight"
                type="number"
                value={p.preWeight}
                onChange={(v) => set("preWeight", Number(v))}
              />
              <Field
                label="Current Weight"
                type="number"
                value={p.currentWeight}
                onChange={(v) => set("currentWeight", Number(v))}
              />
              <Select
                label="Pregnancy Type"
                value={p.pregnancyType}
                items={["Singleton", "Twins", "Other"]}
                onChange={(v) => set("pregnancyType", v)}
              />
              <Select
                label="GDM Classification"
                value={p.classification}
                items={["Pending", "A1GDM", "A2GDM"]}
                onChange={(v) => set("classification", v)}
              />
              <Field
                label="Current Therapy"
                value={p.therapy}
                onChange={(v) => set("therapy", v)}
              />
              <Field
                label="Date GDM Diagnosed"
                type="date"
                value={p.diagnosisDate}
                onChange={(v) => set("diagnosisDate", v)}
              />
              <Field
                label="Next Follow-Up"
                type="date"
                value={p.nextFollowUp}
                onChange={(v) => set("nextFollowUp", v)}
              />
              <label className="field wide">
                <span>Notes</span>
                <textarea
                  value={p.notes}
                  onChange={(e) => set("notes", e.target.value)}
                />
              </label>
            </div>
            {error && <p className="form-error">{error}</p>}
          </Section>
        </div>
        <div className="modal-foot">
          <div>
            {mode === "edit" && (
              <button
                type="button"
                className="archive-button"
                onClick={() => {
                  if (
                    confirm(
                      `${p.archived ? "Restore" : "Archive"} this patient?`,
                    )
                  )
                    submit({ ...p, archived: !p.archived });
                }}
              >
                <Archive /> {p.archived ? "Restore Patient" : "Archive Patient"}
              </button>
            )}
          </div>
          <div className="footer-actions">
            <Btn kind="secondary" onClick={close}>
              Cancel
            </Btn>
            <Btn type="submit">
              {mode === "new" ? "Save Patient" : "Save Changes"}
            </Btn>
          </div>
        </div>
      </form>
    </div>
  );
}

function VisitFlow({
  p,
  data,
  close,
  save,
  report,
}: {
  p: Patient;
  data: AppData;
  close: () => void;
  save: (d: AppData) => void;
  report: () => void;
}) {
  const readings = data.readings.filter((r) => r.patientId === p.id),
    stats = analyze(readings, data.settings),
    [step, setStep] = useState(1),
    [confirming, setConfirming] = useState(false),
    [type, setType] = useState("Follow-Up"),
    [blood, setBlood] = useState("Fasting elevations"),
    [diet, setDiet] = useState("Good"),
    [activity, setActivity] = useState("Regular activity"),
    [barriers, setBarriers] = useState<string[]>(["None"]),
    [history, setHistory] = useState(""),
    [therapy, setTherapy] = useState<string[]>([p.therapy]),
    [insulins, setInsulins] = useState<
      {
        id: string;
        name: string;
        type: string;
        breakfast: string;
        lunch: string;
        dinner: string;
        bedtime: string;
      }[]
    >([]),
    [weight, setWeight] = useState(String(p.currentWeight || "")),
    [bp, setBp] = useState(""),
    [hr, setHr] = useState(""),
    [edema, setEdema] = useState("None"),
    [exam, setExam] = useState(""),
    [classification, setClassification] = useState(p.classification),
    [control, setControl] = useState<string[]>([
      stats.atGoal >= 80
        ? "At goal — diet controlled"
        : "Improved but not fully at goal",
    ]),
    [assessment, setAssessment] = useState(
      `${age(p.dob)}-year-old G${p.gravida}P${p.para} at ${gestation(p.edd)} with ${p.classification} gestational diabetes presenting for follow-up. Review of the previous 7 days demonstrates ${stats.fasting.above} of ${stats.fasting.count} fasting values above target with ${stats.postAbove < 30 ? "predominantly controlled" : "recurrent elevated"} postprandial readings.`,
    ),
    [plan, setPlan] = useState<string[]>([
      "Continue current therapy",
      "Continue fasting/postprandial monitoring",
    ]),
    [education, setEducation] = useState<string[]>([]),
    [follow, setFollow] = useState(data.settings.defaultFollowUp),
    [nextDate, setNextDate] = useState(p.nextFollowUp),
    [medChange, setMedChange] = useState({
      medication: "",
      currentDose: "",
      newDose: "",
      timing: "",
      reason: "",
      comments: "",
      confirmed: false,
    }),
    [summary, setSummary] = useState(
      `${gestation(p.edd)} G${p.gravida}P${p.para} with ${p.classification}. Glucose log reviewed: ${stats.fasting.above}/${stats.fasting.count} fasting readings above goal; postprandial values ${stats.postAbove < 30 ? "predominantly controlled" : "require review"}. Continue monitoring and follow up ${follow}.`,
    );
  useEffect(() => {
    const timer = window.setTimeout(() => {
      clinicalDataApi.saveDraft(p.id, {
          step,
          type,
          blood,
          diet,
          activity,
          history,
          therapy,
          assessment,
          plan,
          follow,
          nextDate,
          summary,
      }).catch(() => {});
    }, 400);
    return () => window.clearTimeout(timer);
  }, [
    step,
    type,
    blood,
    diet,
    activity,
    history,
    therapy,
    assessment,
    plan,
    follow,
    nextDate,
    summary,
    p.id,
  ]);
  const needsChange =
    plan.includes("Initiate insulin") || plan.includes("Titrate insulin");
  const finalize = () => {
    if (needsChange && !medChange.confirmed) {
      alert("Please manually confirm the medication change before finalizing.");
      return;
    }
    const id = newId("visit"),
      v: Visit = {
        id,
        patientId: p.id,
        date: new Date().toISOString().slice(0, 10),
        type,
        gestationalAge: gestation(p.edd),
        classification,
        control: control.join(", "),
        provider: data.settings.displayName,
        status: "Finalized",
        intervalHistory:
          history || `${blood}; diet adherence ${diet}; ${activity}.`,
        maternalFindings: `Weight ${weight || "not recorded"}; BP ${bp || "not recorded"}; HR ${hr || "not recorded"}; edema ${edema}. ${exam}`,
        assessment,
        plan: plan.join("; "),
        medicationChanges: needsChange
          ? `${medChange.medication}: ${medChange.currentDose} → ${medChange.newDose}, ${medChange.timing}. ${medChange.reason}. ${medChange.comments}`
          : "None",
        followUp: follow,
        nextFollowUp: nextDate,
        summary,
        originalNote: summary,
      };
    let meds = data.medications;
    if (needsChange && medChange.medication) {
      meds = [
        ...meds,
        {
          id: newId("med"),
          patientId: p.id,
          name: medChange.medication,
          type: "Insulin",
          dose: medChange.newDose,
          frequency: medChange.timing,
          startDate: v.date,
          status: "Active",
          associatedVisitId: id,
          history: [`Manual change confirmed by ${data.settings.displayName}`],
        },
      ];
    }
    const updated = {
      ...p,
      classification: classification as Patient["classification"],
      nextFollowUp: nextDate,
      currentWeight: Number(weight) || p.currentWeight,
      therapy: therapy.join(" + "),
    };
    clinicalDataApi.deleteDraft(p.id).catch(() => {});
    save({
      ...data,
      patients: data.patients.map((x) => (x.id === p.id ? updated : x)),
      visits: [v, ...data.visits],
      medications: meds,
    });
    report();
  };
  if (confirming)
    return (
      <div className="overlay">
        <div className="modal">
          <div className="modal-head">
            <span>
              <small>FINAL REVIEW</small>
              <h2>Confirm Visit Documentation</h2>
              <p>
                {fullName(p)} · {gestation(p.edd)} · {type}
              </p>
            </span>
            <button onClick={() => setConfirming(false)}>
              <X />
            </button>
          </div>
          <div className="modal-body">
            <Section title="Glucose Data">
              <p>
                {stats.total} readings; {stats.atGoal}% at goal; fasting{" "}
                {stats.fasting.above}/{stats.fasting.count} above goal;
                postprandial {stats.postAbove}% above goal.
              </p>
            </Section>
            <Section title="Assessment">
              <p>{assessment}</p>
            </Section>
            <Section title="Medication Changes">
              <p>
                {needsChange
                  ? `${medChange.medication}: ${medChange.currentDose} → ${medChange.newDose}`
                  : "None"}
              </p>
            </Section>
            <Section title="Plan & Follow-Up">
              <p>
                {plan.join("; ")}. Follow-up {follow} on {fmt(nextDate)}.
              </p>
            </Section>
            <Section title="Clinician Summary / Comments">
              <p>{summary}</p>
            </Section>
          </div>
          <div className="modal-foot">
            <Btn kind="secondary" onClick={() => setConfirming(false)}>
              Back to Edit
            </Btn>
            <Btn onClick={finalize}>Finalize Visit</Btn>
          </div>
        </div>
      </div>
    );
  const steps = [
    "Interval History",
    "Current Therapy",
    "Maternal Findings",
    "Assessment",
    "Plan & Summary",
  ];
  return (
    <div className="overlay">
      <div className="modal visit-modal">
        <div className="modal-head">
          <span>
            <small>NEW VISIT · AUTO-SAVED DRAFT</small>
            <h2>{type}</h2>
            <p>
              {fullName(p)} · DOB {fmt(p.dob)} · MRN {p.mrn} ·{" "}
              {gestation(p.edd)} · G{p.gravida}P{p.para}
            </p>
          </span>
          <button onClick={close}>
            <X />
          </button>
        </div>
        <div className="steps">
          {steps.map((x, i) => (
            <button
              className={step === i + 1 ? "active" : step > i + 1 ? "done" : ""}
              onClick={() => setStep(i + 1)}
              key={x}
            >
              <b>{step > i + 1 ? "✓" : i + 1}</b>
              {x}
            </button>
          ))}
        </div>
        <div className="modal-body">
          {step === 1 && (
            <Section title="Interval History">
              <div className="form-grid">
                <Select
                  label="Visit Type"
                  value={type}
                  items={[
                    "Initial GDM Consultation",
                    "Follow-Up",
                    "Postpartum",
                  ]}
                  onChange={setType}
                />
                <Select
                  label="Blood Glucose"
                  value={blood}
                  items={[
                    "Mostly at goal",
                    "Fasting elevations",
                    "Breakfast elevations",
                    "Lunch elevations",
                    "Dinner elevations",
                    "Multiple elevations",
                    "Hypoglycemia",
                    "Variable",
                  ]}
                  onChange={setBlood}
                />
                <Select
                  label="Diet Adherence"
                  value={diet}
                  items={["Excellent", "Good", "Fair", "Poor"]}
                  onChange={setDiet}
                />
                <Select
                  label="Activity"
                  value={activity}
                  items={[
                    "Regular activity",
                    "Some activity",
                    "Minimal activity",
                    "None",
                    "Restricted by OB",
                  ]}
                  onChange={setActivity}
                />
                <div className="wide">
                  <h4>Barriers</h4>
                  <Checks
                    items={[
                      "None",
                      "Work schedule",
                      "Night shift",
                      "Nausea",
                      "Vomiting",
                      "Food aversion",
                      "Difficulty monitoring glucose",
                      "Medication access",
                      "Diet difficulty",
                      "Insulin injection difficulty",
                      "GI side effects",
                      "Hypoglycemia",
                      "Other",
                    ]}
                    selected={barriers}
                    onChange={setBarriers}
                  />
                </div>
                <label className="field wide">
                  <span>Interval History</span>
                  <textarea
                    rows={5}
                    value={history}
                    onChange={(e) => setHistory(e.target.value)}
                  />
                </label>
              </div>
            </Section>
          )}
          {step === 2 && (
            <Section title="Current Therapy">
              <Checks
                items={["Diet Controlled", "Metformin", "Insulin", "Other"]}
                selected={therapy}
                onChange={setTherapy}
              />
              {therapy.includes("Metformin") && (
                <div className="form-grid inset">
                  <Field label="Dose" value="" />
                  <Field label="Frequency" value="" />
                  <Field label="Adherence" value="" />
                  <Field label="Side Effects" value="" />
                </div>
              )}
              {therapy.includes("Insulin") && (
                <div className="inset">
                  <h4>Insulin Medications</h4>
                  {insulins.map((i, n) => (
                    <div className="form-grid triple insulin-row" key={i.id}>
                      <Field
                        label="Insulin Name"
                        value={i.name}
                        onChange={(v) =>
                          setInsulins(
                            insulins.map((x) =>
                              x.id === i.id ? { ...x, name: v } : x,
                            ),
                          )
                        }
                      />
                      <Select
                        label="Type"
                        value={i.type}
                        items={[
                          "Rapid acting",
                          "Short acting",
                          "Intermediate acting",
                          "Long acting",
                        ]}
                        onChange={(v) =>
                          setInsulins(
                            insulins.map((x) =>
                              x.id === i.id ? { ...x, type: v } : x,
                            ),
                          )
                        }
                      />
                      <Field label="Breakfast Dose" value={i.breakfast} />
                      <Field label="Lunch Dose" value={i.lunch} />
                      <Field label="Dinner Dose" value={i.dinner} />
                      <Field label="Bedtime Dose" value={i.bedtime} />
                    </div>
                  ))}
                  <Btn
                    kind="secondary"
                    onClick={() =>
                      setInsulins([
                        ...insulins,
                        {
                          id: newId("ins"),
                          name: "",
                          type: "Rapid acting",
                          breakfast: "",
                          lunch: "",
                          dinner: "",
                          bedtime: "",
                        },
                      ])
                    }
                  >
                    <Plus /> Add Insulin
                  </Btn>
                </div>
              )}
              <div className="safety">
                <AlertTriangle />
                <p>
                  No medication or dose is selected automatically. Manual
                  clinician entry and confirmation are required.
                </p>
              </div>
            </Section>
          )}
          {step === 3 && (
            <Section title="Maternal / Physical Findings">
              <div className="form-grid triple">
                <Field
                  label="Current Weight"
                  value={weight}
                  onChange={setWeight}
                />
                <Field label="Pre-Pregnancy Weight" value={p.preWeight} />
                <Field label="BMI" value={bmi(p)} />
                <Field label="Interval Weight Gain" value="" />
                <Field
                  label="Total Pregnancy Weight Gain"
                  value={p.currentWeight - p.preWeight}
                />
                <Field label="Blood Pressure" value={bp} onChange={setBp} />
                <Field label="Heart Rate" value={hr} onChange={setHr} />
                <Select
                  label="Edema"
                  value={edema}
                  items={["None", "Trace", "1+", "2+", "3+", "4+"]}
                  onChange={setEdema}
                />
                <label className="field wide">
                  <span>Physical Exam Notes</span>
                  <textarea
                    value={exam}
                    onChange={(e) => setExam(e.target.value)}
                  />
                </label>
              </div>
            </Section>
          )}
          {step === 4 && (
            <Section title="Assessment">
              <div className="form-grid">
                <Select
                  label="GDM Classification"
                  value={classification}
                  items={["A1GDM", "A2GDM", "Pending"]}
                  onChange={setClassification}
                />
              </div>
              <h4>Glycemic Control</h4>
              <Checks
                items={[
                  "At goal — diet controlled",
                  "At goal — medication controlled",
                  "Improved but not fully at goal",
                  "Not at goal",
                  "Fasting hyperglycemia",
                  "Postprandial hyperglycemia",
                  "Mixed fasting and postprandial hyperglycemia",
                  "Recurrent hypoglycemia",
                ]}
                selected={control}
                onChange={setControl}
              />
              <label className="field">
                <span>Assessment Narrative</span>
                <textarea
                  rows={6}
                  value={assessment}
                  onChange={(e) => setAssessment(e.target.value)}
                />
              </label>
            </Section>
          )}
          {step === 5 && (
            <>
              <Section title="Plan">
                <Checks
                  items={[
                    "Continue current therapy",
                    "Continue diet-controlled management",
                    "Continue current insulin",
                    "Continue metformin",
                    "Reinforce GDM diet",
                    "Reinforce carbohydrate distribution",
                    "Encourage post-meal activity",
                    "Registered Dietitian referral",
                    "Diabetes educator referral",
                    "Initiate insulin",
                    "Titrate insulin",
                    "Adjust metformin",
                    "Review hypoglycemia precautions",
                    "Review glucose monitoring",
                    "Continue fasting/postprandial monitoring",
                    "Coordinate with OB",
                    "Coordinate with MFM",
                    "New orders",
                    "Other",
                  ]}
                  selected={plan}
                  onChange={setPlan}
                />
                {needsChange && (
                  <div className="med-change">
                    <h4>Manual Medication Change</h4>
                    <div className="form-grid triple">
                      <Field
                        label="Medication"
                        value={medChange.medication}
                        onChange={(v) =>
                          setMedChange({ ...medChange, medication: v })
                        }
                      />
                      <Field
                        label="Current Dose"
                        value={medChange.currentDose}
                        onChange={(v) =>
                          setMedChange({ ...medChange, currentDose: v })
                        }
                      />
                      <Field
                        label="New Dose"
                        value={medChange.newDose}
                        onChange={(v) =>
                          setMedChange({ ...medChange, newDose: v })
                        }
                      />
                      <Field
                        label="Timing"
                        value={medChange.timing}
                        onChange={(v) =>
                          setMedChange({ ...medChange, timing: v })
                        }
                      />
                      <Field
                        label="Reason"
                        value={medChange.reason}
                        onChange={(v) =>
                          setMedChange({ ...medChange, reason: v })
                        }
                      />
                      <Field
                        label="Comments"
                        value={medChange.comments}
                        onChange={(v) =>
                          setMedChange({ ...medChange, comments: v })
                        }
                      />
                    </div>
                    <label className="confirm-check">
                      <input
                        type="checkbox"
                        checked={medChange.confirmed}
                        onChange={(e) =>
                          setMedChange({
                            ...medChange,
                            confirmed: e.target.checked,
                          })
                        }
                      />{" "}
                      I manually entered and confirm this medication change.
                    </label>
                  </div>
                )}
              </Section>
              <Section title="Patient Education">
                <Checks
                  items={[
                    "GDM diagnosis reviewed",
                    "glucose targets reviewed",
                    "glucose monitoring reviewed",
                    "diet counseling",
                    "exercise counseling",
                    "medication education",
                    "insulin injection teaching",
                    "hypoglycemia precautions",
                    "fetal risks reviewed",
                    "maternal risks reviewed",
                    "postpartum diabetes risk reviewed",
                    "postpartum testing reviewed",
                  ]}
                  selected={education}
                  onChange={setEducation}
                />
              </Section>
              <Section title="Clinician Summary / Comments">
                <div className="form-grid">
                  <Select
                    label="Follow-Up"
                    value={follow}
                    items={["3–4 days", "1 week", "2 weeks", "Other"]}
                    onChange={setFollow}
                  />
                  <Field
                    label="Specific Next Follow-Up Date"
                    type="date"
                    value={nextDate}
                    onChange={setNextDate}
                  />
                  <label className="field wide">
                    <span>Editable Clinician Summary / Comments</span>
                    <textarea
                      rows={6}
                      value={summary}
                      onChange={(e) => setSummary(e.target.value)}
                    />
                  </label>
                </div>
              </Section>
            </>
          )}
        </div>
        <div className="modal-foot">
          <Btn kind="secondary" onClick={close}>
            Save Draft & Close
          </Btn>
          <span>{step} of 5</span>
          {step < 5 ? (
            <Btn onClick={() => setStep(step + 1)}>Continue →</Btn>
          ) : (
            <Btn onClick={() => setConfirming(true)}>Review & Finalize</Btn>
          )}
        </div>
      </div>
    </div>
  );
}

function VisitFlowFast({
  p,
  data,
  savedDraft,
  close,
  save,
  report,
}: {
  p: Patient;
  data: AppData;
  savedDraft?: unknown;
  close: () => void;
  save: (d: AppData) => void | Promise<unknown>;
  report: () => void;
}) {
  const persistedDraft = savedDraft && typeof savedDraft === "object"
      ? savedDraft as { noMedChange?: boolean; medChange?: Partial<MedicationChangeDraft> }
      : undefined,
    prior = data.visits
      .filter((v) => v.patientId === p.id && v.status !== "Draft")
      .sort((a, b) => b.date.localeCompare(a.date))[0],
    activeMeds = data.medications.filter(
      (m) => m.patientId === p.id && m.status === "Active",
    ),
    allReadings = data.readings.filter((r) => r.patientId === p.id);
  const [therapyAtStart] = useState(() =>
    snapshotActiveTherapy(data.medications, p.id),
  );
  const [step, setStep] = useState(1),
    [confirming, setConfirming] = useState(false),
    [period, setPeriod] = useState("7"),
    [start, setStart] = useState(""),
    [end, setEnd] = useState(""),
    [type, setType] = useState("Follow-Up"),
    [diet, setDiet] = useState(prior?.dietAdherence || "Good"),
    [activity, setActivity] = useState(prior?.activity || "Regular activity"),
    [barriers, setBarriers] = useState<string[]>(prior?.barriers || ["None"]),
    [history, setHistory] = useState(prior?.intervalHistory || ""),
    [therapy, setTherapy] = useState<string[]>([p.therapy]),
    [weight, setWeight] = useState(String(p.currentWeight || "")),
    [bp, setBp] = useState(
      prior?.maternalFindings.match(/BP ([^;]+)/)?.[1] || "",
    ),
    [hr, setHr] = useState(
      prior?.maternalFindings.match(/HR ([^;]+)/)?.[1] || "",
    ),
    [edema, setEdema] = useState(
      prior?.maternalFindings.match(/edema ([^.;]+)/i)?.[1] || "None",
    ),
    [exam, setExam] = useState(prior?.maternalFindings || ""),
    [classification, setClassification] = useState(p.classification),
    [plan, setPlan] = useState<string[]>([
      "Continue current therapy",
      "Continue fasting and postprandial glucose monitoring",
    ]),
    [follow, setFollow] = useState(data.settings.defaultFollowUp),
    [nextDate, setNextDate] = useState(p.nextFollowUp),
    [reviewDate, setReviewDate] = useState(p.nextFollowUp),
    [noMedChange, setNoMedChange] = useState(persistedDraft?.noMedChange ?? true),
    [medChange, setMedChange] = useState(() => normalizeMedicationChangeDraft(
      persistedDraft?.medChange,
      {
        medication: therapyAtStart[0]?.medication || "",
        previousDose: therapyAtStart[0]?.dose || "",
        previousTiming: therapyAtStart[0]?.timing || therapyAtStart[0]?.frequency || "",
        newTiming: therapyAtStart[0]?.timing || therapyAtStart[0]?.frequency || "",
      },
    )),
    [dietUnchanged, setDietUnchanged] = useState(Boolean(prior)),
    [therapyUnchanged, setTherapyUnchanged] = useState(Boolean(prior)),
    [physicalUnchanged, setPhysicalUnchanged] = useState(Boolean(prior)),
    [modality, setModality] = useState(prior?.visitModality || "In-person"),
    [smbg, setSmbg] = useState(prior?.smbgAdherence || "4 checks/day"),
    [dietFactors, setDietFactors] = useState<string[]>(
      prior?.dietFactors || [],
    ),
    [symptoms, setSymptoms] = useState<string[]>(prior?.symptoms || []),
    [activityFrequency, setActivityFrequency] = useState(
      prior?.activityFrequency || "",
    ),
    [education, setEducation] = useState<string[]>(prior?.education || []),
    [educationNotes, setEducationNotes] = useState(prior?.educationNotes || ""),
    [fundalHeight, setFundalHeight] = useState(prior?.fundalHeight || ""),
    [fetalSurveillance, setFetalSurveillance] = useState(
      prior?.fetalSurveillance || "",
    ),
    [deliveryPlanning, setDeliveryPlanning] = useState(
      prior?.deliveryPlanning || "",
    );
  useEffect(() => {
    const timer = window.setTimeout(() => {
      clinicalDataApi.saveDraft(p.id, { kind: "weekly-follow-up", noMedChange, medChange }).catch(() => {});
    }, 400);
    return () => window.clearTimeout(timer);
  }, [p.id, noMedChange, medChange]);
  const reviewReadings = filterReviewReadings(allReadings, period, start, end),
    stats = analyze(reviewReadings, data.settings),
    pattern = glucosePattern(stats),
    periodLabel =
      period === "custom"
        ? `${fmt(start)} to ${fmt(end)}`
        : `previous ${period} days`;
  const presentationTherapy = formatTherapy(therapyAtStart),
    assessmentDraft = `${age(p.dob)}-year-old G${p.gravida}P${p.para} at ${gestation(p.edd)} with ${classification}${therapyAtStart.length ? ` on ${presentationTherapy}` : ""}, presenting for ${type === "Follow-Up" ? "follow-up" : type.toLowerCase()}. Review of the ${periodLabel} demonstrates ${pattern.toLowerCase()}${stats.fasting.count ? `, with ${stats.fasting.above} of ${stats.fasting.count} fasting readings above goal` : ""}. Overall, ${stats.atGoal}% of readings are within target. Diet adherence is ${diet.toLowerCase()} and patient reports ${activity.toLowerCase()}.`;
  const [assessment, setAssessment] = useState(assessmentDraft),
    [summary, setSummary] = useState(
      `${gestation(p.edd)} G${p.gravida}P${p.para} with ${classification}. ${period === "7" ? "Seven-day" : `${periodLabel[0].toUpperCase() + periodLabel.slice(1)}`} glucose log reviewed. Fasting values are above goal in ${stats.fasting.above}/${stats.fasting.count} readings while postprandial values are ${stats.postAbove < 30 ? "predominantly at goal" : "not fully at goal"}. Patient reports ${diet.toLowerCase()} dietary adherence and ${activity.toLowerCase()}. Continue ${p.therapy.toLowerCase()} and ${data.settings.monitoring} postprandial monitoring. Glucose log to be reviewed again ${follow}.`,
    );
  useEffect(() => {
    setAssessment(assessmentDraft);
  }, [period, start, end, diet, activity, classification, type]);
  const planGroups = {
    "Glucose Monitoring": [
      "Continue fasting and postprandial glucose monitoring",
      "Increase monitoring frequency",
      "Review glucose log in 3–4 days",
      "Review glucose log in 1 week",
    ],
    Lifestyle: [
      "Continue current diet",
      "Reinforce carbohydrate distribution",
      "Reinforce meal timing",
      "Encourage post-meal activity",
      "RD referral",
      "Diabetes educator referral",
    ],
    Medication: [
      "Continue current therapy",
      "Continue current insulin regimen",
      "Continue metformin",
      "Initiate insulin",
      "Titrate insulin",
      "Adjust other medication",
    ],
    Education: [
      "Hypoglycemia precautions reviewed",
      "Glucose targets reviewed",
      "Insulin technique reviewed",
      "GDM pregnancy risks reviewed",
      "Postpartum diabetes risk reviewed",
    ],
    "Coordination / Follow-Up": [
      "Coordinate with OB",
      "Coordinate with MFM",
      "Follow up in 3–4 days",
      "Follow up in 1 week",
      "Follow up in 2 weeks",
      "Other",
    ],
  };
  const medAction = plan.some((x) =>
    ["Initiate insulin", "Titrate insulin", "Adjust other medication"].includes(
      x,
    ),
  );
  useEffect(() => {
    if (!confirming) return;
    const base =
        therapyAtStart.find(
          (x) =>
            x.medication.toLowerCase() === medChange.medication.toLowerCase(),
        ) || therapyAtStart[0],
      change =
        noMedChange || !medChange.medication
          ? undefined
          : {
              medication: medChange.medication,
              from: {
                medication: medChange.medication,
                dose: medChange.previousDose,
                units: base?.units || "units",
                timing: medChange.previousTiming,
              },
              to: {
                medication: medChange.medication,
                dose: medChange.newDose,
                units: base?.units || "units",
                timing: medChange.newTiming || medChange.previousTiming,
              },
              reason: medChange.reason,
              comments: medChange.comments,
            },
      medText = change
        ? `${formatMedicationChange(change)}; Reason: ${change.reason}`
        : "No medication changes today",
      provisional: Visit = {
        id: "validation",
        patientId: p.id,
        date: new Date().toISOString().slice(0, 10),
        type,
        gestationalAge: gestation(p.edd),
        classification,
        control: pattern,
        provider: data.settings.displayName,
        status: "Draft",
        intervalHistory: history,
        maternalFindings: `Weight ${weight || "not recorded"}; BP ${bp || "not recorded"}; HR ${hr || "not recorded"}; edema ${edema}. ${exam}`,
        assessment,
        plan: plan.join("; "),
        medicationChanges: medText,
        followUp: follow,
        nextFollowUp: nextDate,
        summary,
        therapyAtStart,
        therapyAfterVisit: applyRegimenChange(therapyAtStart, change),
        medicationChangeDetails: change ? [change] : [],
        currentMedication: therapyAtStart[0],
        newMedication: change?.to,
        bloodPressure: bp,
        heartRate: hr,
        edema,
        glucosePeriod: period,
        glucosePattern: pattern,
        glucoseSnapshot: clone(reviewReadings),
        glucoseStatsSnapshot: stats,
        patientSnapshot: patientSnapshot(p),
      };
    const warnings = validateVisitConsistency(
      p,
      provisional,
      reviewReadings,
      activeMeds,
      data.settings,
    );
    if (warnings.length)
      alert(
        `Clinical consistency review:\n\n${warnings.map((x) => `• ${x}`).join("\n")}`,
      );
  }, [confirming]);
  const finalize = () => {
    if (!medicationChangeIsComplete(noMedChange, medChange)) {
      alert(
        "Complete and manually confirm the medication change, including pre-visit and post-visit timing, before finalizing.",
      );
      return;
    }
    const id = newId("visit"),
      date = new Date().toISOString().slice(0, 10),
      maternal = `Weight ${weight || "not recorded"}; BP ${bp || "not recorded"}; HR ${hr || "not recorded"}; edema ${edema}. ${exam}`,
      base =
        therapyAtStart.find(
          (x) =>
            x.medication.toLowerCase() === medChange.medication.toLowerCase(),
        ) || therapyAtStart[0],
      change = noMedChange
        ? undefined
        : {
            medication: medChange.medication,
            from: {
              medication: medChange.medication,
              dose: medChange.previousDose,
              units: base?.units || "units",
              timing: medChange.previousTiming,
              frequency: medChange.previousTiming,
              route: base?.route,
            },
            to: {
              medication: medChange.medication,
              dose: medChange.newDose,
              units: base?.units || "units",
              timing: medChange.newTiming,
              frequency: medChange.newTiming,
              route: base?.route,
            },
            reason: medChange.reason,
            comments: medChange.comments,
          },
      therapyAfterVisit = applyRegimenChange(therapyAtStart, change),
      medText = change
        ? `${formatMedicationChange(change)}; Reason: ${change.reason}${change.comments ? `; ${change.comments}` : ""}`
        : "No medication changes today",
      actualPlan = [
        ...plan,
        ...(change
          ? [
              `Insulin: ${change.medication} increased from ${[change.from.dose, change.from.units, change.from.timing].filter(Boolean).join(" ")} to ${[change.to.dose, change.to.units, change.to.timing].filter(Boolean).join(" ")}.`,
            ]
          : []),
      ];
    const v: Visit = {
      id,
      patientId: p.id,
      date,
      type,
      gestationalAge: gestation(p.edd),
      classification,
      control: pattern,
      provider: data.settings.displayName,
      status: "Finalized",
      intervalHistory: history,
      maternalFindings: maternal,
      assessment,
      plan: actualPlan.join("; "),
      medicationChanges: medText,
      followUp: follow,
      nextFollowUp: nextDate,
      summary,
      therapyAtStart: clone(therapyAtStart),
      therapyAfterVisit: clone(therapyAfterVisit),
      medicationChangeDetails: change ? [clone(change)] : [],
      currentMedication: therapyAtStart[0],
      newMedication: change?.to,
      currentTherapy: formatTherapy(therapyAtStart),
      patientSnapshot: patientSnapshot(p),
      glucosePeriod: period,
      glucoseStart: start,
      glucoseEnd: end,
      glucoseReviewDate: reviewDate,
      glucosePattern: pattern,
      glucoseSnapshot: clone(reviewReadings),
      glucoseStatsSnapshot: clone(stats),
      dietAdherence: diet,
      activity,
      visitModality: modality,
      smbgAdherence: smbg,
      dietFactors,
      activityFrequency,
      symptoms,
      barriers,
      education,
      educationNotes,
      fundalHeight,
      fetalSurveillance,
      deliveryPlanning,
      weight: Number(weight) || undefined,
      priorWeight: p.currentWeight || undefined,
      bloodPressure: bp,
      heartRate: hr,
      edema,
      originalNote: summary,
    };
    const meds = updateActiveMedicationList(
        data.medications,
        p.id,
        id,
        date,
        change,
        data.settings.displayName,
      ),
      updated = {
        ...p,
        currentWeight: Number(weight) || p.currentWeight,
        classification: classification as Patient["classification"],
        therapy: formatTherapy(therapyAfterVisit),
        nextFollowUp: nextDate,
      };
    const persistence = save({
      ...data,
      patients: data.patients.map((x) => (x.id === p.id ? updated : x)),
      visits: [v, ...data.visits],
      medications: meds,
    });
    Promise.resolve(persistence).then(() => clinicalDataApi.deleteDraft(p.id)).catch(() => {});
    report();
  };
  const SummaryBar = () => (
    <div className="visit-glucose-summary">
      <div className="summary-top">
        <span>
          <b>Glucose Review</b>
          <small>
            {periodLabel} · {stats.total} readings
          </small>
        </span>
        <div className="review-period">
          <select value={period} onChange={(e) => setPeriod(e.target.value)}>
            <option value="3">Last 3 days</option>
            <option value="7">Last 7 days</option>
            <option value="14">Last 14 days</option>
            <option value="custom">Custom date range</option>
          </select>
          {period === "custom" && (
            <>
              <input
                aria-label="Review Start Date"
                type="date"
                value={start}
                onChange={(e) => setStart(e.target.value)}
              />
              <input
                aria-label="Review End Date"
                type="date"
                value={end}
                onChange={(e) => setEnd(e.target.value)}
              />
            </>
          )}
        </div>
      </div>
      <div className="compact-glucose">
        {(["fasting", "breakfast", "lunch", "dinner"] as const).map((k) => (
          <span key={k}>
            <small>{k}</small>
            <b>{stats[k].avg || "—"}</b>
            <em>
              {stats[k].min || "—"}–{stats[k].max || "—"} · {stats[k].above}/
              {stats[k].count} above ({stats[k].pct}%)
            </em>
          </span>
        ))}
      </div>
      <div className="pattern-line">
        <b>Pattern: {pattern}</b>
        <span>
          {stats.atGoal}% overall at goal · {stats.hypo} hypoglycemic
        </span>
      </div>
    </div>
  );
  if (confirming)
    return (
      <div className="overlay">
        <div className="modal">
          <div className="modal-head">
            <span>
              <small>FINAL REVIEW</small>
              <h2>Confirm Visit Documentation</h2>
              <p>
                {fullName(p)} · {gestation(p.edd)} · {type}
              </p>
            </span>
            <button onClick={() => setConfirming(false)}>
              <X />
            </button>
          </div>
          <div className="modal-body">
            <SummaryBar />
            <Section
              title={
                noMedChange ? "Current Therapy" : "Therapy on Presentation"
              }
            >
              <p>{presentationTherapy}</p>
            </Section>
            <Section title="Assessment">
              <p>{assessment}</p>
            </Section>
            <Section title="Medication Changes">
              <p>
                {noMedChange
                  ? "No medication changes today."
                  : `${medChange.medication}: ${medChange.previousDose} ${medChange.previousTiming} → ${medChange.newDose} ${medChange.newTiming}. Reason: ${medChange.reason}`}
              </p>
              {!noMedChange && (
                <p>
                  <b>Updated regimen:</b> {medChange.medication}{" "}
                  {medChange.newDose} {medChange.newTiming}
                </p>
              )}
            </Section>
            <Section title="Plan & Follow-Up">
              <p>
                {plan.join("; ")}. Next visit {fmt(nextDate)}; glucose review{" "}
                {fmt(reviewDate)}.
              </p>
            </Section>
            <Section title="Clinician Summary / Comments">
              <p>{summary}</p>
            </Section>
          </div>
          <div className="modal-foot">
            <Btn kind="secondary" onClick={() => setConfirming(false)}>
              Back to Edit
            </Btn>
            <Btn onClick={finalize}>Finalize Visit</Btn>
          </div>
        </div>
      </div>
    );
  const unchanged = (
    label: string,
    value: boolean,
    setter: (x: boolean) => void,
  ) => (
    <label className="unchanged">
      <input
        type="checkbox"
        checked={value}
        onChange={(e) => setter(e.target.checked)}
      />{" "}
      {label}
    </label>
  );
  return (
    <div className="overlay">
      <div className="modal visit-modal">
        <div className="modal-head">
          <span>
            <small>NEW VISIT · PRIOR DATA CARRIED FORWARD</small>
            <h2>{type}</h2>
            <p>
              {fullName(p)} · MRN {p.mrn} · {gestation(p.edd)} · G{p.gravida}P
              {p.para} · {p.referringOb}, {p.obPractice}
            </p>
          </span>
          <button onClick={close}>
            <X />
          </button>
        </div>
        <SummaryBar />
        <div className="steps">
          {[
            "History",
            "Therapy",
            "Findings",
            "Assessment",
            "Plan & Summary",
          ].map((x, i) => (
            <button
              className={step === i + 1 ? "active" : step > i + 1 ? "done" : ""}
              onClick={() => setStep(i + 1)}
              key={x}
            >
              <b>{step > i + 1 ? "✓" : i + 1}</b>
              {x}
            </button>
          ))}
        </div>
        <div className="modal-body">
          {step === 1 && (
            <Section title="Interval History">
              <div className="section-inline-head">
                {unchanged(
                  "Diet/activity unchanged from prior visit",
                  dietUnchanged,
                  setDietUnchanged,
                )}
              </div>
              <div className="form-grid">
                <Select
                  label="Visit Modality"
                  value={modality}
                  items={["In-person", "Telehealth", "Phone / log review"]}
                  onChange={setModality}
                />
                <Field
                  label="SMBG Adherence (checks/day)"
                  value={smbg}
                  onChange={setSmbg}
                />
                <Select
                  label="Visit Type"
                  value={type}
                  items={[
                    "Initial GDM Consultation",
                    "Follow-Up",
                    "Postpartum",
                  ]}
                  onChange={setType}
                />
                <Select
                  label="Diet Adherence"
                  value={diet}
                  items={["Excellent", "Good", "Fair", "Poor"]}
                  onChange={setDiet}
                />
                <Select
                  label="Activity"
                  value={activity}
                  items={[
                    "Regular activity",
                    "Some activity",
                    "Minimal activity",
                    "None",
                    "Restricted by OB",
                  ]}
                  onChange={setActivity}
                />
                <div className="wide">
                  <h4>Nutrition patterns</h4>
                  <Checks
                    items={[
                      "Meal plan adherence",
                      "Carbohydrate distribution",
                      "Breakfast carbohydrate issue",
                      "Late-night eating",
                      "Sugary beverages",
                      "Frequent snacking",
                      "Post-meal activity",
                    ]}
                    selected={dietFactors}
                    onChange={setDietFactors}
                  />
                </div>
                <Field
                  label="Exercise Frequency"
                  value={activityFrequency}
                  onChange={setActivityFrequency}
                />
                <div className="wide">
                  <h4>Symptoms / safety review</h4>
                  <Checks
                    items={[
                      "None",
                      "Hypoglycemia symptoms",
                      "Hyperglycemia symptoms",
                      "Polyuria / polydipsia",
                      "Decreased fetal movement",
                      "Headache / vision changes",
                      "Preeclampsia symptoms",
                    ]}
                    selected={symptoms}
                    onChange={setSymptoms}
                  />
                </div>
                <div className="wide">
                  <h4>Barriers</h4>
                  <Checks
                    items={[
                      "None",
                      "Work schedule",
                      "Night shift",
                      "Nausea",
                      "Vomiting",
                      "Food aversion",
                      "Difficulty monitoring glucose",
                      "Medication access",
                      "Diet difficulty",
                      "Insulin injection difficulty",
                      "GI side effects",
                      "Hypoglycemia",
                      "Other",
                    ]}
                    selected={barriers}
                    onChange={setBarriers}
                  />
                </div>
                <label className="field wide">
                  <span>Interval History</span>
                  <textarea
                    rows={4}
                    value={history}
                    onChange={(e) => setHistory(e.target.value)}
                  />
                </label>
              </div>
            </Section>
          )}
          {step === 2 && (
            <Section title="Current Therapy & Medication Regimen">
              <div className="section-inline-head">
                {unchanged(
                  "Current therapy and medication regimen unchanged from prior visit",
                  therapyUnchanged,
                  setTherapyUnchanged,
                )}
              </div>
              <Checks
                items={["Diet controlled", "Metformin", "Insulin", "Other"]}
                selected={therapy}
                onChange={setTherapy}
              />
              {activeMeds.length > 0 && (
                <div className="carried-meds">
                  <b>Carried-forward active regimen</b>
                  {activeMeds.map((m) => (
                    <span key={m.id}>
                      {m.name}: {m.dose} · {m.frequency}
                    </span>
                  ))}
                </div>
              )}
              <div className="safety">
                <AlertTriangle />
                <p>
                  Carried-forward therapy is documentation only. The application
                  never chooses or changes a dose.
                </p>
              </div>
            </Section>
          )}
          {step === 3 && (
            <Section title="Maternal / Physical Findings">
              <div className="section-inline-head">
                {unchanged(
                  "Physical findings unchanged from prior visit",
                  physicalUnchanged,
                  setPhysicalUnchanged,
                )}
              </div>
              <div className="form-grid triple">
                <Field
                  label="Current Weight"
                  value={weight}
                  onChange={setWeight}
                />
                <Field label="Pre-Pregnancy Weight" value={p.preWeight} />
                <Field label="BMI" value={bmi(p)} />
                <Field
                  label="Interval Weight Gain"
                  value={
                    weight && p.currentWeight
                      ? String(Number(weight) - p.currentWeight)
                      : ""
                  }
                />
                <Field
                  label="Total Pregnancy Weight Gain"
                  value={
                    weight && p.preWeight
                      ? String(Number(weight) - p.preWeight)
                      : ""
                  }
                />
                <Field
                  label="Fundal Height"
                  value={fundalHeight}
                  onChange={setFundalHeight}
                />
                <Field label="Blood Pressure" value={bp} onChange={setBp} />
                <Field label="Heart Rate" value={hr} onChange={setHr} />
                <Select
                  label="Edema"
                  value={edema}
                  items={["None", "Trace", "1+", "2+", "3+", "4+"]}
                  onChange={setEdema}
                />
                <label className="field wide">
                  <span>
                    Fetal / Obstetric Surveillance (growth, EFW percentile, AFI,
                    NST/BPP)
                  </span>
                  <textarea
                    value={fetalSurveillance}
                    onChange={(e) => setFetalSurveillance(e.target.value)}
                  />
                </label>
                <label className="field wide">
                  <span>Delivery Planning (per OB/MFM)</span>
                  <textarea
                    value={deliveryPlanning}
                    onChange={(e) => setDeliveryPlanning(e.target.value)}
                  />
                </label>
                <label className="field wide">
                  <span>Physical Exam Notes</span>
                  <textarea
                    value={exam}
                    onChange={(e) => setExam(e.target.value)}
                  />
                </label>
              </div>
            </Section>
          )}
          {step === 4 && (
            <Section title="Assessment">
              <div className="form-grid">
                <Select
                  label="GDM Classification"
                  value={classification}
                  items={["A1GDM", "A2GDM", "Pending"]}
                  onChange={setClassification}
                />
              </div>
              <p className="draft-note">
                Automatically generated from entered facts. Review and edit
                before finalizing.
              </p>
              <label className="field">
                <span>Assessment Narrative</span>
                <textarea
                  rows={7}
                  value={assessment}
                  onChange={(e) => setAssessment(e.target.value)}
                />
              </label>
            </Section>
          )}
          {step === 5 && (
            <>
              <Section title="Plan">
                {Object.entries(planGroups).map(([group, items]) => (
                  <div className="plan-group" key={group}>
                    <h4>{group}</h4>
                    <Checks items={items} selected={plan} onChange={setPlan} />
                  </div>
                ))}
              </Section>
              <Section title="Medication Changes">
                <label className="no-change">
                  <input
                    type="checkbox"
                    checked={noMedChange}
                    onChange={(e) => setNoMedChange(e.target.checked)}
                  />
                  <b>No medication changes today</b>
                </label>
                {(!noMedChange || medAction) && (
                  <div className="med-change prominent">
                    <h3>MEDICATION CHANGE THIS VISIT</h3>
                    <div className="form-grid triple">
                      <Field
                        label="Medication"
                        value={medChange.medication}
                        onChange={(v) =>
                          setMedChange({ ...medChange, medication: v })
                        }
                      />
                      <Field
                        label="Previous Dose"
                        value={medChange.previousDose}
                        onChange={(v) =>
                          setMedChange({ ...medChange, previousDose: v })
                        }
                      />
                      <Field
                        label="Previous Timing"
                        value={medChange.previousTiming}
                        onChange={(v) =>
                          setMedChange({ ...medChange, previousTiming: v })
                        }
                      />
                      <Field
                        label="New Dose"
                        value={medChange.newDose}
                        onChange={(v) =>
                          setMedChange({ ...medChange, newDose: v })
                        }
                      />
                      <Field
                        label="New Timing"
                        value={medChange.newTiming}
                        onChange={(v) =>
                          setMedChange({ ...medChange, newTiming: v })
                        }
                      />
                      <Field
                        label="Reason for Change"
                        value={medChange.reason}
                        onChange={(v) =>
                          setMedChange({ ...medChange, reason: v })
                        }
                      />
                      <Field
                        label="Comments"
                        value={medChange.comments}
                        onChange={(v) =>
                          setMedChange({ ...medChange, comments: v })
                        }
                      />
                    </div>
                    <label className="confirm-check">
                      <input
                        type="checkbox"
                        checked={medChange.confirmed}
                        onChange={(e) =>
                          setMedChange({
                            ...medChange,
                            confirmed: e.target.checked,
                          })
                        }
                      />{" "}
                      I manually entered and confirm this medication change.
                    </label>
                  </div>
                )}
              </Section>
              <Section title="Patient Education">
                <Checks
                  items={[
                    "GDM pathophysiology / risks",
                    "Glucometer teach-back",
                    "SMBG timing and targets",
                    "Glucose log use",
                    "Diet / carbohydrate distribution",
                    "Post-meal activity",
                    "Hypoglycemia precautions",
                    "Hyperglycemia / when to call",
                    "Ketone / illness-day guidance",
                    "Postpartum OGTT / diabetes risk",
                  ]}
                  selected={education}
                  onChange={setEducation}
                />
                <label className="field wide">
                  <span>Education / Teach-Back Notes</span>
                  <textarea
                    value={educationNotes}
                    onChange={(e) => setEducationNotes(e.target.value)}
                  />
                </label>
              </Section>
              <Section title="Clinician Summary / Comments">
                <div className="form-grid triple">
                  <Select
                    label="Follow-Up"
                    value={follow}
                    items={["3–4 days", "1 week", "2 weeks", "Other"]}
                    onChange={setFollow}
                  />
                  <Field
                    label="Next GDM Follow-Up"
                    type="date"
                    value={nextDate}
                    onChange={setNextDate}
                  />
                  <Field
                    label="Glucose Log Review"
                    type="date"
                    value={reviewDate}
                    onChange={setReviewDate}
                  />
                  <label className="field wide">
                    <span>Editable summary for referring OB</span>
                    <textarea
                      rows={6}
                      value={summary}
                      onChange={(e) => setSummary(e.target.value)}
                    />
                  </label>
                </div>
              </Section>
            </>
          )}
        </div>
        <div className="modal-foot">
          <Btn kind="secondary" onClick={close}>
            Save Draft & Close
          </Btn>
          <span>{step} of 5</span>
          {step < 5 ? (
            <Btn onClick={() => setStep(step + 1)}>Continue →</Btn>
          ) : (
            <Btn onClick={() => setConfirming(true)}>Review & Finalize</Btn>
          )}
        </div>
      </div>
    </div>
  );
}

function GlobalVisits({
  data,
  openPatient,
  openVisit,
}: {
  data: AppData;
  openPatient: (id: string) => void;
  openVisit: (id: string) => void;
}) {
  const [q, setQ] = useState(""),
    [status, setStatus] = useState("All");
  const rows = data.visits.filter((v) => {
    const p = data.patients.find((x) => x.id === v.patientId);
    return (
      p &&
      [fullName(p), v.type, v.provider].some((x) =>
        x.toLowerCase().includes(q.toLowerCase()),
      ) &&
      (status === "All" || v.status === status)
    );
  });
  return (
    <div className="stack">
      <div className="page-title">
        <span>
          <h1>Visits</h1>
          <p>Visits across all patients</p>
        </span>
      </div>
      <section className="card filters">
        <label className="search">
          <Search />
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Search patient, type, provider…"
          />
        </label>
        <select value={status} onChange={(e) => setStatus(e.target.value)}>
          <option>All</option>
          <option>Draft</option>
          <option>Finalized</option>
          <option>Amended</option>
        </select>
      </section>
      <section className="card table-wrap">
        <table>
          <thead>
            <tr>
              <th>Date</th>
              <th>Patient</th>
              <th>Gestational Age</th>
              <th>Visit Type</th>
              <th>GDM Classification</th>
              <th>Glucose Control</th>
              <th>Provider</th>
              <th>Status</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((v) => {
              const p = data.patients.find((x) => x.id === v.patientId)!;
              return (
                <tr
                  className="click-row"
                  key={v.id}
                  onClick={() => openVisit(v.id)}
                >
                  <td>{fmt(v.date)}</td>
                  <td>
                    <button
                      className="table-link"
                      onClick={(e) => {
                        e.stopPropagation();
                        openPatient(p.id);
                      }}
                    >
                      {fullName(p)}
                    </button>
                  </td>
                  <td>{v.gestationalAge || gestation(p.edd)}</td>
                  <td>{v.type}</td>
                  <td>{v.classification}</td>
                  <td>{v.control}</td>
                  <td>{v.provider}</td>
                  <td>
                    <Badge tone="goal">{v.status}</Badge>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </section>
    </div>
  );
}

function VersionedVisitDetail({
  visit,
  patient,
  data,
  save,
  close,
}: {
  visit: Visit;
  patient: Patient | null;
  data: AppData;
  save: (d: AppData) => void;
  close: () => void;
}) {
  const [mode, setMode] = useState<
      "view" | "confirm" | "edit" | "review" | "version"
    >("view"),
    [draft, setDraft] = useState<Visit>(() => clone(visit)),
    [viewed, setViewed] = useState<Visit | null>(null),
    [reason, setReason] = useState(""),
    [otherReason, setOtherReason] = useState(""),
    [notes, setNotes] = useState(""),
    [medSync, setMedSync] = useState<"yes" | "no" | "">("");
  const originalAt =
      visit.originalFinalizedAt ||
      visit.finalizedAt ||
      `${visit.date}T12:00:00`,
    currentVersion = visit.version || 1,
    provider = visit.finalizedBy || visit.provider || data.settings.displayName;
  const baseVersions = visit.versions?.length
    ? visit.versions
    : [
        {
          version: 1,
          finalizedAt: visit.finalizedAt || originalAt,
          provider,
          revisionReason: "Original",
          originalFinalizedAt: originalAt,
          snapshot: JSON.stringify({ ...visit, versions: undefined }),
        },
      ];
  const set = (key: keyof Visit, value: string | string[]) =>
    setDraft({ ...draft, [key]: value });
  const medicationChanged =
    (draft.medicationChanges || "") !== (visit.medicationChanges || "") ||
    (draft.currentTherapy || patient?.therapy || "") !==
      (visit.currentTherapy || patient?.therapy || "");
  const startEdit = () => {
    const glucoseSnapshot =
      visit.glucoseSnapshot ||
      clone(data.readings.filter((r) => r.patientId === visit.patientId));
    setDraft({
      ...clone(visit),
      status: "Editing Finalized Visit",
      editStartedAt: new Date().toISOString(),
      editedBy: data.settings.displayName,
      currentTherapy: visit.currentTherapy || patient?.therapy || "",
      glucoseSnapshot,
    });
    setMode("edit");
  };
  const cancelRevision = () => {
    if (
      confirm(
        "Discard all unsaved revision changes? No new version will be created.",
      )
    ) {
      setDraft(clone(visit));
      setMode("view");
    }
  };
  const refinalize = () => {
    const finalReason = reason === "Other" ? otherReason.trim() : reason;
    if (!finalReason) {
      alert("Reason for Revision is required.");
      return;
    }
    if (medicationChanged && !medSync) {
      alert(
        "Choose whether this documentation revision should update the patient's current medication list.",
      );
      return;
    }
    const now = new Date().toISOString(),
      version = currentVersion + 1,
      updated: Visit = {
        ...draft,
        status: "Refinalized",
        version,
        finalizedAt: now,
        originalFinalizedAt: originalAt,
        finalizedBy: data.settings.displayName,
        revisionReason: finalReason,
        revisionNotes: notes,
        provider: data.settings.displayName,
      };
    const versionRecord = {
      version,
      finalizedAt: now,
      provider: data.settings.displayName,
      revisionReason: finalReason,
      revisionNotes: notes,
      editedBy: data.settings.displayName,
      editStartedAt: draft.editStartedAt,
      originalFinalizedAt: originalAt,
      snapshot: JSON.stringify({ ...updated, versions: undefined }),
    };
    updated.versions = [...baseVersions, versionRecord];
    let patients = data.patients;
    if (patient) {
      const latest = data.visits
          .filter((v) => v.patientId === patient.id && v.id !== visit.id)
          .sort((a, b) =>
            (b.date + b.finalizedAt).localeCompare(a.date + a.finalizedAt),
          )[0],
        isMostRecent =
          !latest ||
          (visit.date + (visit.finalizedAt || "")).localeCompare(
            latest.date + (latest.finalizedAt || ""),
          ) >= 0;
      patients = patients.map((p) =>
        p.id !== patient.id
          ? p
          : {
              ...p,
              ...(medicationChanged && medSync === "yes"
                ? { therapy: draft.currentTherapy || p.therapy }
                : {}),
              ...(isMostRecent && draft.nextFollowUp !== visit.nextFollowUp
                ? { nextFollowUp: draft.nextFollowUp }
                : {}),
            },
      );
    }
    let medications = data.medications;
    if (medicationChanged && medSync === "yes")
      medications = medications.map((m) =>
        m.patientId === visit.patientId && m.status === "Active"
          ? {
              ...m,
              history: [
                ...m.history,
                `Visit version ${version} revision confirmed by ${data.settings.displayName}: ${finalReason}`,
              ],
            }
          : m,
      );
    save({
      ...data,
      patients,
      medications,
      visits: data.visits.map((v) => (v.id === visit.id ? updated : v)),
    });
    setMode("view");
  };
  const showVersion = (snapshot: string) => {
    try {
      setViewed(JSON.parse(snapshot));
      setMode("version");
    } catch {
      alert("This historical version could not be opened.");
    }
  };
  if (mode === "confirm")
    return (
      <div className="overlay">
        <div className="small-modal">
          <div className="modal-head">
            <span>
              <small>FINALIZED</small>
              <h2>Edit Finalized Visit?</h2>
            </span>
            <button onClick={() => setMode("view")}>
              <X />
            </button>
          </div>
          <div className="modal-body">
            <div className="revision-warning">
              <AlertTriangle />
              <p>
                This visit has already been finalized. Any changes will create a
                new finalized version while preserving the previous version in
                the visit history.
              </p>
            </div>
          </div>
          <div className="modal-foot">
            <Btn kind="secondary" onClick={() => setMode("view")}>
              Cancel
            </Btn>
            <Btn onClick={startEdit}>Edit Visit</Btn>
          </div>
        </div>
      </div>
    );
  if (mode === "version" && viewed)
    return (
      <div className="overlay">
        <div className="small-modal">
          <div className="modal-head">
            <span>
              <small>
                READ-ONLY HISTORICAL VERSION · VERSION {viewed.version || 1}
              </small>
              <h2>{viewed.type}</h2>
              <p>
                {fmt(viewed.finalizedAt || viewed.date)} ·{" "}
                {viewed.finalizedBy || viewed.provider}
              </p>
            </span>
            <button onClick={() => setMode("view")}>
              <X />
            </button>
          </div>
          <VisitReadOnly visit={viewed} />
          <div className="modal-foot">
            <Btn kind="secondary" onClick={() => setMode("view")}>
              Back to Current Version
            </Btn>
          </div>
        </div>
      </div>
    );
  if (mode === "review") {
    const finalReason = reason === "Other" ? otherReason : reason;
    return (
      <div className="overlay">
        <div className="modal revision-modal">
          <div className="modal-head">
            <span>
              <small>REFINALIZE VISIT · VERSION {currentVersion + 1}</small>
              <h2>Confirm Revised Documentation</h2>
              <p>
                {patient ? fullName(patient) : "Patient visit"} ·{" "}
                {fmt(visit.date)}
              </p>
            </span>
            <button onClick={() => setMode("edit")}>
              <X />
            </button>
          </div>
          <div className="modal-body">
            <div className="revision-meta">
              <span>
                <small>Original finalized</small>
                <b>{new Date(originalAt).toLocaleString()}</b>
              </span>
              <span>
                <small>Current version</small>
                <b>Version {currentVersion}</b>
              </span>
            </div>
            {[
              ["Assessment", draft.assessment],
              ["Plan", draft.plan],
              ["Medication Changes", draft.medicationChanges],
              [
                "Follow-Up",
                `${draft.followUp}${draft.nextFollowUp ? ` · ${fmt(draft.nextFollowUp)}` : ""}`,
              ],
              ["Clinician Summary / Comments", draft.summary],
            ].map(([title, value]) => (
              <Section key={title} title={title}>
                <p>{value || "Not documented"}</p>
              </Section>
            ))}
            <Section title="Revision Documentation">
              <div className="form-grid">
                <Select
                  label="Reason for Revision *"
                  value={reason}
                  items={[
                    "",
                    "Corrected documentation",
                    "Added information received after visit",
                    "Corrected medication dose",
                    "Corrected glucose interpretation",
                    "Corrected follow-up plan",
                    "Other",
                  ]}
                  onChange={setReason}
                />
                {reason === "Other" && (
                  <Field
                    label="Other Reason *"
                    value={otherReason}
                    onChange={setOtherReason}
                  />
                )}
                <label className="field wide">
                  <span>Revision Notes (optional)</span>
                  <textarea
                    rows={4}
                    value={notes}
                    onChange={(e) => setNotes(e.target.value)}
                  />
                </label>
              </div>
              {medicationChanged && (
                <div className="medication-safety">
                  <b>
                    This revision changes medication information. Update the
                    patient&apos;s current medication list as well?
                  </b>
                  <label>
                    <input
                      type="radio"
                      name="med-sync"
                      checked={medSync === "yes"}
                      onChange={() => setMedSync("yes")}
                    />{" "}
                    Yes, update current medications
                  </label>
                  <label>
                    <input
                      type="radio"
                      name="med-sync"
                      checked={medSync === "no"}
                      onChange={() => setMedSync("no")}
                    />{" "}
                    No, documentation correction only
                  </label>
                </div>
              )}
            </Section>
          </div>
          <div className="modal-foot">
            <Btn kind="secondary" onClick={() => setMode("edit")}>
              Back to Edit
            </Btn>
            <Btn
              disabled={
                !finalReason.trim() || Boolean(medicationChanged && !medSync)
              }
              onClick={refinalize}
            >
              Refinalize Visit
            </Btn>
          </div>
        </div>
      </div>
    );
  }
  if (mode === "edit")
    return (
      <div className="overlay">
        <div className="modal revision-modal">
          <div className="modal-head">
            <span>
              <small>EDITING FINALIZED VISIT</small>
              <h2>{draft.type}</h2>
              <p>
                Originally finalized: {new Date(originalAt).toLocaleString()} ·
                Originally finalized by: {provider} · Current Version: Version{" "}
                {currentVersion}
              </p>
            </span>
            <button onClick={cancelRevision}>
              <X />
            </button>
          </div>
          <div className="modal-body">
            <div className="locked-note">
              Source glucose readings remain unchanged. This revision updates
              only the finalized visit documentation and its preserved snapshot.
            </div>
            <div className="form-grid">
              <Select
                label="Glucose Review Period"
                value={draft.glucosePeriod || "7"}
                items={["3", "7", "14", "custom"]}
                onChange={(v) => set("glucosePeriod", v)}
              />
              <Field
                label="Glucose Interpretation"
                value={draft.control}
                onChange={(v) => set("control", v)}
              />
              <Select
                label="Diet Adherence"
                value={draft.dietAdherence || "Good"}
                items={["Excellent", "Good", "Fair", "Poor"]}
                onChange={(v) => set("dietAdherence", v)}
              />
              <Field
                label="Activity"
                value={draft.activity || ""}
                onChange={(v) => set("activity", v)}
              />
              <Field
                label="Current Therapy"
                value={draft.currentTherapy || patient?.therapy || ""}
                onChange={(v) => set("currentTherapy", v)}
              />
              <Field
                label="Follow-Up Interval"
                value={draft.followUp}
                onChange={(v) => set("followUp", v)}
              />
              <Field
                label="Next Follow-Up Date"
                type="date"
                value={draft.nextFollowUp}
                onChange={(v) => set("nextFollowUp", v)}
              />
              <label className="field wide">
                <span>Interval History</span>
                <textarea
                  rows={4}
                  value={draft.intervalHistory}
                  onChange={(e) => set("intervalHistory", e.target.value)}
                />
              </label>
              <label className="field wide">
                <span>Barriers / Side Effects (one per line)</span>
                <textarea
                  rows={3}
                  value={(draft.barriers || []).join("\n")}
                  onChange={(e) =>
                    set("barriers", e.target.value.split("\n").filter(Boolean))
                  }
                />
              </label>
              <label className="field wide">
                <span>Medication Information / Changes</span>
                <textarea
                  rows={4}
                  value={draft.medicationChanges}
                  onChange={(e) => set("medicationChanges", e.target.value)}
                />
              </label>
              <label className="field wide">
                <span>Maternal / Physical Findings</span>
                <textarea
                  rows={4}
                  value={draft.maternalFindings}
                  onChange={(e) => set("maternalFindings", e.target.value)}
                />
              </label>
              <label className="field wide">
                <span>Assessment</span>
                <textarea
                  rows={5}
                  value={draft.assessment}
                  onChange={(e) => set("assessment", e.target.value)}
                />
              </label>
              <label className="field wide">
                <span>Plan</span>
                <textarea
                  rows={5}
                  value={draft.plan}
                  onChange={(e) => set("plan", e.target.value)}
                />
              </label>
              <label className="field wide">
                <span>Patient Education (one per line)</span>
                <textarea
                  rows={3}
                  value={(draft.education || []).join("\n")}
                  onChange={(e) =>
                    set("education", e.target.value.split("\n").filter(Boolean))
                  }
                />
              </label>
              <label className="field wide">
                <span>Clinician Summary / Comments</span>
                <textarea
                  rows={5}
                  value={draft.summary}
                  onChange={(e) => set("summary", e.target.value)}
                />
              </label>
            </div>
          </div>
          <div className="modal-foot">
            <Btn kind="secondary" onClick={cancelRevision}>
              Cancel Revision
            </Btn>
            <Btn onClick={() => setMode("review")}>Review & Refinalize</Btn>
          </div>
        </div>
      </div>
    );
  return (
    <div className="overlay">
      <div className="small-modal">
        <div className="modal-head">
          <span>
            <small>{visit.status.toUpperCase()}</small>
            <h2>{visit.type}</h2>
            <p>
              {patient ? fullName(patient) : "Patient visit"} ·{" "}
              {fmt(visit.date)} · {visit.provider}
            </p>
          </span>
          <button onClick={close}>
            <X />
          </button>
        </div>
        <div className="modal-body">
          <div className="current-version">
            <b>CURRENT FINALIZED VERSION</b>
            <span>Version {currentVersion}</span>
          </div>
          <VisitReadOnly visit={visit} />
          <Section title="Version History">
            <div className="version-history">
              {[...baseVersions]
                .sort((a, b) => b.version - a.version)
                .map((v) => (
                  <div key={v.version}>
                    <span>
                      <b>Version {v.version}</b>
                      <small>{new Date(v.finalizedAt).toLocaleString()}</small>
                    </span>
                    <span>
                      <b>{v.provider}</b>
                      <small>{v.revisionReason}</small>
                    </span>
                    <Btn
                      kind="secondary"
                      onClick={() => showVersion(v.snapshot)}
                    >
                      View Version
                    </Btn>
                  </div>
                ))}
            </div>
          </Section>
        </div>
        <div className="modal-foot">
          <Btn kind="secondary" onClick={close}>
            Close
          </Btn>
          <Btn onClick={() => setMode("confirm")}>Edit Finalized Visit</Btn>
        </div>
      </div>
    </div>
  );
}

function VisitReadOnly({ visit }: { visit: Visit }) {
  return (
    <div className="visit-readonly">
      <div className="locked-note">
        Finalized content is read-only. The current version and all prior
        versions are preserved.
      </div>
      <Section title="Interval History">
        <p>{visit.intervalHistory || "Not documented"}</p>
      </Section>
      <Section title="Maternal Findings">
        <p>{visit.maternalFindings || "Not documented"}</p>
      </Section>
      <Section title="Assessment">
        <p>{visit.assessment || "Not documented"}</p>
      </Section>
      <Section title="Plan">
        <p>{visit.plan || "Not documented"}</p>
      </Section>
      <Section title="Medication Changes">
        <p>{visit.medicationChanges || "None"}</p>
      </Section>
      <Section title="Follow-Up">
        <p>
          {visit.followUp}
          {visit.nextFollowUp && ` · ${fmt(visit.nextFollowUp)}`}
        </p>
      </Section>
      <Section title="Clinician Summary / Comments">
        <p>{visit.summary || visit.originalNote || "Not documented"}</p>
      </Section>
      {visit.revisionReason && (
        <Section title="Revision">
          <p>
            <b>{visit.revisionReason}</b>
            {visit.revisionNotes && ` · ${visit.revisionNotes}`}
          </p>
        </Section>
      )}
    </div>
  );
}
function VisitDetail({
  visit,
  patient,
  close,
  amend,
}: {
  visit: Visit;
  patient: Patient | null;
  close: () => void;
  amend?: (text: string, reason?: string) => void;
}) {
  const [text, setText] = useState(""),
    [reason, setReason] = useState(""),
    [creating, setCreating] = useState(false);
  return (
    <div className="overlay">
      <div className="small-modal">
        <div className="modal-head">
          <span>
            <small>{visit.status.toUpperCase()} · LOCKED</small>
            <h2>{visit.type}</h2>
            <p>
              {patient ? fullName(patient) : "Patient visit"} ·{" "}
              {fmt(visit.date)} · {visit.provider}
            </p>
          </span>
          <button onClick={close}>
            <X />
          </button>
        </div>
        <div className="modal-body">
          <div className="locked-note">
            Finalized content is read-only. The original note will never be
            overwritten.
          </div>
          <Section title="Interval History">
            <p>{visit.intervalHistory}</p>
          </Section>
          <Section title="Maternal Findings">
            <p>{visit.maternalFindings}</p>
          </Section>
          <Section title="Assessment">
            <p>{visit.assessment}</p>
          </Section>
          <Section title="Plan">
            <p>{visit.plan}</p>
          </Section>
          <Section title="Clinician Summary / Comments">
            <p>{visit.originalNote || visit.summary}</p>
          </Section>
          {visit.amendments?.map((a, i) => (
            <Section key={i} title={`Amendment ${fmt(a.date)}`}>
              <p>
                <b>{a.amendedBy}</b>
                {a.reason && ` · Reason: ${a.reason}`}
              </p>
              <p>{a.text}</p>
            </Section>
          ))}
          {amend && creating && (
            <Section title="Create Amendment">
              <div className="form-grid">
                <Field
                  label="Reason for Amendment"
                  value={reason}
                  onChange={setReason}
                />
                <label className="field wide">
                  <span>New Information</span>
                  <textarea
                    rows={5}
                    value={text}
                    onChange={(e) => setText(e.target.value)}
                  />
                </label>
              </div>
            </Section>
          )}
        </div>
        <div className="modal-foot">
          <Btn kind="secondary" onClick={close}>
            Close
          </Btn>
          {amend && !creating && (
            <Btn onClick={() => setCreating(true)}>Create Amendment</Btn>
          )}
          {amend && creating && (
            <Btn
              disabled={!text.trim() || !reason.trim()}
              onClick={() => amend(text, reason)}
            >
              Save Amendment
            </Btn>
          )}
        </div>
      </div>
    </div>
  );
}

function GlobalReports({
  data,
  openReport,
}: {
  data: AppData;
  openReport: (reportId: string) => void;
}) {
  return (
    <div className="stack">
      <div className="page-title">
        <span>
          <h1>Reports</h1>
          <p>Generated reports across all patients</p>
        </span>
      </div>
      <section className="card table-wrap">
        <table>
          <thead>
            <tr>
              <th>Date</th>
              <th>Patient</th>
              <th>Report Type</th>
              <th>Visit Version</th>
              <th>Referring OB</th>
              <th>Status</th>
              <th>Actions</th>
            </tr>
          </thead>
          <tbody>
            {data.reports.map((r) => {
              const p = data.patients.find((x) => x.id === r.patientId)!;
              return (
                <tr key={r.id}>
                  <td>{fmt(r.date)}</td>
                  <td>{fullName(p)}</td>
                  <td>{r.type}</td>
                  <td>
                    {r.visitId ? `Version ${r.visitVersion || 1}` : "Current"}
                  </td>
                  <td>{r.snapshot?.patient.referringOb || p.referringOb}</td>
                  <td>
                    <Badge tone="goal">{r.status}</Badge>
                  </td>
                  <td>
                    <button
                      className="table-link"
                      onClick={() => openReport(r.id)}
                    >
                      View / Print / PDF
                    </button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </section>
    </div>
  );
}

function SettingsPage({
  data,
  save,
}: {
  data: AppData;
  save: (d: AppData) => void;
}) {
  const [s, setS] = useState(clone(data.settings)),
    file = useRef<HTMLInputElement>(null);
  const commit = () => save({ ...data, settings: s });
  const exportData = () => {
    const a = document.createElement("a");
    a.href = URL.createObjectURL(
      new Blob([JSON.stringify(data, null, 2)], { type: "application/json" }),
    );
    a.download = `gdm-prototype-backup-${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    URL.revokeObjectURL(a.href);
  };
  const importData = (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0];
    if (!f) return;
    const r = new FileReader();
    r.onload = () => {
      try {
        const parsed = JSON.parse(String(r.result));
        if (!parsed.patients || !parsed.settings) throw Error();
        if (confirm("Replace all prototype data with this backup?"))
          save(parsed);
      } catch {
        alert("This is not a valid GDM prototype backup.");
      }
    };
    r.readAsText(f);
  };
  const signature = (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0];
    if (!f) return;
    if (f.size > 500000) {
      alert("Please select an image under 500 KB.");
      return;
    }
    const r = new FileReader();
    r.onload = () => setS({ ...s, signature: String(r.result) });
    r.readAsDataURL(f);
  };
  return (
    <div className="stack">
      <div className="page-title">
        <span>
          <h1>Settings</h1>
          <p>Provider, clinical targets, monitoring, and prototype data</p>
        </span>
        <Btn onClick={commit}>Save Settings</Btn>
      </div>
      <Section title="Provider">
        <div className="form-grid triple">
          <Field
            label="Name"
            value={s.providerName}
            onChange={(v) => setS({ ...s, providerName: v })}
          />
          <Field
            label="Credentials"
            value={s.credentials}
            onChange={(v) => setS({ ...s, credentials: v })}
          />
          <Field
            label="Display Name"
            value={s.displayName}
            onChange={(v) => setS({ ...s, displayName: v })}
          />
          <Field
            label="Practice"
            value={s.practice}
            onChange={(v) => setS({ ...s, practice: v })}
          />
          <Field
            label="NPI"
            value={s.npi}
            onChange={(v) => setS({ ...s, npi: v })}
          />
          <Field
            label="Phone"
            value={s.phone}
            onChange={(v) => setS({ ...s, phone: v })}
          />
          <Field
            label="Fax"
            value={s.fax}
            onChange={(v) => setS({ ...s, fax: v })}
          />
          <label className="field">
            <span>Optional Signature Image</span>
            <input type="file" accept="image/*" onChange={signature} />
          </label>
          {s.signature && (
            <img
              className="signature-preview"
              src={s.signature}
              alt="Stored clinician signature"
            />
          )}
        </div>
      </Section>
      <Section title="Glucose Targets">
        <div className="form-grid triple">
          <Field
            label="Fasting mg/dL"
            type="number"
            value={s.fastingTarget}
            onChange={(v) => setS({ ...s, fastingTarget: Number(v) })}
          />
          <Field
            label="1-hour mg/dL"
            type="number"
            value={s.oneHourTarget}
            onChange={(v) => setS({ ...s, oneHourTarget: Number(v) })}
          />
          <Field
            label="2-hour mg/dL"
            type="number"
            value={s.twoHourTarget}
            onChange={(v) => setS({ ...s, twoHourTarget: Number(v) })}
          />
          <Select
            label="Default Post-Meal Measurement"
            value={s.monitoring}
            items={["1 hour", "2 hour"]}
            onChange={(v) =>
              setS({ ...s, monitoring: v as Settings["monitoring"] })
            }
          />
        </div>
      </Section>
      <Section title="Application">
        <div className="form-grid">
          <Field
            label="Clinic / Site Names"
            value={s.sites}
            onChange={(v) => setS({ ...s, sites: v })}
          />
          <Select
            label="Default Follow-Up Interval"
            value={s.defaultFollowUp}
            items={["3–4 days", "1 week", "2 weeks", "Other"]}
            onChange={(v) => setS({ ...s, defaultFollowUp: v })}
          />
          <label className="portal-setting wide">
            <input
              type="checkbox"
              checked={s.showPatientPortalTargets !== false}
              onChange={(e) =>
                setS({ ...s, showPatientPortalTargets: e.target.checked })
              }
            />
            <span>
              Show configured glucose targets on the prototype patient portal
            </span>
          </label>
        </div>
      </Section>
      <Section title="Prototype Data Backup">
        <div className="backup-actions">
          <Btn kind="secondary" onClick={exportData}>
            <Download /> Export Prototype Data
          </Btn>
          <Btn kind="secondary" onClick={() => file.current?.click()}>
            <Upload /> Import Prototype Data
          </Btn>
          <input
            ref={file}
            hidden
            type="file"
            accept="application/json"
            onChange={importData}
          />
          <Btn
            kind="danger-button"
            onClick={() => {
              if (
                confirm(
                  "Reset all local changes and restore the three fictional demo patients?",
                )
              )
                save(clone(demoData));
            }}
          >
            Reset Demo Data
          </Btn>
        </div>
      </Section>
    </div>
  );
}

function ReportView({
  data,
  p,
  close,
  saveReport,
}: {
  data: AppData;
  p: Patient;
  close: () => void;
  saveReport: (r: ReportType) => void;
}) {
  const readings = data.readings.filter((x) => x.patientId === p.id),
    s = analyze(readings, data.settings),
    visit = data.visits.find((v) => v.patientId === p.id),
    meds = data.medications.filter(
      (m) => m.patientId === p.id && m.status === "Active",
    ),
    r: ReportType = {
      id: `report-${p.id}-${new Date().toISOString().slice(0, 10)}`,
      patientId: p.id,
      visitId: visit?.id,
      date: new Date().toISOString().slice(0, 10),
      type: "GDM Management Report",
      status: "Final",
    };
  useEffect(() => saveReport(r), []);
  return (
    <div className="overlay report-overlay">
      <div className="report-shell">
        <div className="toolbar">
          <span>
            <b>OB Report Preview</b>
            <small>Browser print dialog supports Print and Save as PDF</small>
          </span>
          <Btn kind="secondary" onClick={close}>
            Close
          </Btn>
          <Btn onClick={() => window.print()}>Print / Save as PDF</Btn>
        </div>
        <article className="report">
          <div className="report-head">
            <span>
              <HeartPulse />
              <b>GDM Clinical</b>
            </span>
            <div>
              <h1>GESTATIONAL DIABETES MANAGEMENT REPORT</h1>
              <p>Clinical Summary</p>
            </div>
          </div>
          {p.mock && (
            <div className="report-demo">SAMPLE / NOT A REAL PATIENT</div>
          )}
          <div className="patient-grid">
            {[
              ["Patient", fullName(p)],
              ["DOB", fmt(p.dob)],
              ["MRN", p.mrn],
              ["Date of Visit", fmt(visit?.date || r.date)],
              ["EDD", fmt(p.edd)],
              ["Gestational Age", gestation(p.edd)],
              ["Gravida / Para", `G${p.gravida}P${p.para}`],
              ["Referring OB/GYN", p.referringOb],
              ["OB Practice", p.obPractice],
            ].map((x) => (
              <span key={x[0]}>
                <small>{x[0]}</small>
                <b>{x[1]}</b>
              </span>
            ))}
          </div>
          <R title="Current Therapy">
            <p>
              <b>
                {p.classification} — {p.therapy}.
              </b>{" "}
              {meds.length
                ? meds
                    .map((m) => `${m.name} ${m.dose} ${m.frequency}`)
                    .join("; ")
                : "No active glucose-lowering medication documented."}
            </p>
          </R>
          <R title="Glucose Summary">
            <table>
              <thead>
                <tr>
                  <th>Category</th>
                  <th>Average</th>
                  <th>Range</th>
                  <th>Above Goal</th>
                  <th>% Above Goal</th>
                </tr>
              </thead>
              <tbody>
                {(["fasting", "breakfast", "lunch", "dinner"] as const).map(
                  (k) => (
                    <tr key={k}>
                      <td>{k[0].toUpperCase() + k.slice(1)}</td>
                      <td>{s[k].avg || "—"}</td>
                      <td>{s[k].count ? `${s[k].min}–${s[k].max}` : "—"}</td>
                      <td>
                        {s[k].above} / {s[k].count}
                      </td>
                      <td>{s[k].pct}%</td>
                    </tr>
                  ),
                )}
              </tbody>
            </table>
          </R>
          <R title="Glucose Trend Graph">
            <Trend readings={readings} settings={data.settings} range="14" />
          </R>
          <div className="report-cols">
            <R title="Interval History">
              <p>
                {visit?.intervalHistory ||
                  "No finalized interval history documented."}
              </p>
            </R>
            <R title="Maternal Findings">
              <p>
                {visit?.maternalFindings ||
                  `Current weight ${p.currentWeight} lb; pre-pregnancy weight ${p.preWeight} lb.`}
              </p>
            </R>
          </div>
          <R title="Assessment">
            <p>
              {visit?.assessment ||
                `${p.classification} at ${gestation(p.edd)}; clinician review required.`}
            </p>
          </R>
          <R title="Plan">
            <p>{visit?.plan || "No finalized plan documented."}</p>
          </R>
          <R title="Medication Changes">
            <p>{visit?.medicationChanges || "None documented."}</p>
          </R>
          <R title="Clinician Summary / Comments">
            <p>
              {visit?.summary ||
                `${gestation(p.edd)} G${p.gravida}P${p.para} with ${p.classification}. ${s.fasting.above}/${s.fasting.count} fasting readings above goal; ${s.postAbove}% postprandial readings above goal. Clinician review required.`}
            </p>
          </R>
          <R title="Follow-Up">
            <p>
              {visit?.followUp || "Not documented"} · Next date{" "}
              {fmt(p.nextFollowUp)}
            </p>
          </R>
          <div className="signature">
            <span>
              <small>Treating Clinician</small>
              <b>Daniel Riboh, PA-C</b>
              <p>
                {data.settings.practice}
                {data.settings.phone && ` · ${data.settings.phone}`}
                {data.settings.fax && ` · Fax ${data.settings.fax}`}
              </p>
              {data.settings.signature && (
                <img src={data.settings.signature} alt="Clinician signature" />
              )}
            </span>
            <span>
              <small>Clinician Signature</small>
              <b>__________________________</b>
              <p>Date: __________________</p>
              <p>Electronically signed by Daniel Riboh, PA-C</p>
            </span>
          </div>
          <footer>
            Clinical decision support only — all assessments and treatment
            decisions must be reviewed and approved by the treating clinician.
          </footer>
        </article>
      </div>
    </div>
  );
}
function ReportViewEnhanced({
  data,
  p,
  close,
  backToVisit,
  saveReport,
}: {
  data: AppData;
  p: Patient;
  close: () => void;
  backToVisit: () => void;
  saveReport: (r: ReportType) => void;
}) {
  const visit = data.visits
      .filter((v) => v.patientId === p.id && v.status !== "Draft")
      .sort((a, b) => b.date.localeCompare(a.date))[0],
    all = data.readings.filter((x) => x.patientId === p.id),
    period = visit?.glucosePeriod || "7",
    readings = filterReviewReadings(
      all,
      period,
      visit?.glucoseStart,
      visit?.glucoseEnd,
    ),
    s = analyze(readings, data.settings),
    pattern = glucosePattern(s),
    meds = data.medications.filter(
      (m) => m.patientId === p.id && m.status === "Active",
    ),
    reportRecord: ReportType = {
      id: `report-${p.id}-${visit?.id || new Date().toISOString().slice(0, 10)}`,
      patientId: p.id,
      visitId: visit?.id,
      date: new Date().toISOString().slice(0, 10),
      type: "GDM Management Report",
      status: "Final",
    };
  useEffect(() => saveReport(reportRecord), []);
  const headerFields = [
      ["Patient Name", fullName(p)],
      ["MRN", p.mrn],
      ["DOB", fmt(p.dob)],
      ["EDD", fmt(p.edd)],
      ["Gestational Age", gestation(p.edd)],
      ["Gravida / Para", `G${p.gravida}P${p.para}`],
      ["Visit Date", fmt(visit?.date || reportRecord.date)],
      ["Referring OB/GYN", p.referringOb],
      ["OB Practice", p.obPractice],
    ].filter(([, v]) => v && v !== "—"),
    maternal = [
      p.currentWeight && `Weight ${p.currentWeight} lb`,
      `BMI ${bmi(p)}`,
      p.currentWeight &&
        p.preWeight &&
        `Total pregnancy weight gain ${p.currentWeight - p.preWeight} lb`,
      visit?.maternalFindings.match(/BP ([^;]+)/)?.[1] &&
        !visit.maternalFindings.includes("BP not recorded") &&
        `BP ${visit.maternalFindings.match(/BP ([^;]+)/)?.[1]}`,
      visit?.maternalFindings.match(/edema ([^.;]+)/i)?.[1] &&
        !visit.maternalFindings.includes("edema not recorded") &&
        `Edema ${visit.maternalFindings.match(/edema ([^.;]+)/i)?.[1]}`,
    ].filter(Boolean),
    planText = (visit?.plan || "")
      .split(";")
      .filter(Boolean)
      .map(
        (x) =>
          `${x
            .trim()
            .replace(
              /^Continue fasting and postprandial glucose monitoring$/,
              "Continue fasting and postprandial glucose monitoring",
            )
            .replace(
              /^RD referral$/,
              "Registered Dietitian referral placed",
            )}.`,
      )
      .join(" ");
  const noChange =
    !visit?.medicationChanges ||
    visit.medicationChanges.toLowerCase().includes("no medication");
  return (
    <div className="overlay report-overlay">
      <div className="report-shell">
        <div className="toolbar">
          <span>
            <b>OB Report Preview</b>
            <small>Review before printing or saving</small>
          </span>
          <Btn kind="secondary" onClick={backToVisit}>
            Back to Visit
          </Btn>
          <Btn onClick={() => window.print()}>Print / Save as PDF</Btn>
          <Btn kind="secondary" onClick={close}>
            Close
          </Btn>
        </div>
        <article className="report compact-report">
          <div className="report-head">
            <span>
              <HeartPulse />
              <b>GDM Clinical</b>
            </span>
            <div>
              <h1>GESTATIONAL DIABETES MANAGEMENT REPORT</h1>
            </div>
          </div>
          {p.mock && (
            <div className="report-demo">SAMPLE / NOT A REAL PATIENT</div>
          )}
          <div className="patient-grid compact">
            {headerFields.map(([label, value]) => (
              <span key={label}>
                <small>{label}</small>
                <b>{value}</b>
              </span>
            ))}
          </div>
          <R title="Current Therapy">
            <div className="therapy-report">
              <p>
                <b>GDM Classification:</b> {p.classification}
              </p>
              <p>
                <b>Current Therapy:</b> {p.therapy}
              </p>
              {meds.map((m) => (
                <p key={m.id}>
                  {m.name} {m.dose} {m.frequency}
                </p>
              ))}
            </div>
          </R>
          <R title="Glucose Summary">
            <div className="no-break">
              <table>
                <thead>
                  <tr>
                    <th>Category</th>
                    <th>Average</th>
                    <th>Range</th>
                    <th>Above Goal</th>
                    <th>% Above Goal</th>
                  </tr>
                </thead>
                <tbody>
                  {(["fasting", "breakfast", "lunch", "dinner"] as const).map(
                    (k) => (
                      <tr key={k}>
                        <td>{k[0].toUpperCase() + k.slice(1)}</td>
                        <td>{s[k].avg || "—"}</td>
                        <td>{s[k].count ? `${s[k].min}–${s[k].max}` : "—"}</td>
                        <td>
                          {s[k].above} / {s[k].count}
                        </td>
                        <td>{s[k].pct}%</td>
                      </tr>
                    ),
                  )}
                </tbody>
              </table>
              <p className="glucose-pattern">
                <b>Glucose Pattern:</b> {pattern}.
              </p>
            </div>
          </R>
          <R title="Glucose Trend Graph">
            <div className="report-chart">
              <Trend readings={readings} settings={data.settings} range="all" />
            </div>
          </R>
          {visit?.intervalHistory && (
            <R title="Interval History">
              <p>
                {visit.dietAdherence &&
                  `Patient reports ${visit.dietAdherence.toLowerCase()} dietary adherence. `}
                {visit.activity &&
                  `Activity: ${visit.activity.toLowerCase()}. `}
                {visit.intervalHistory}
              </p>
            </R>
          )}
          {maternal.length > 0 && (
            <R title="Maternal Findings">
              <p>{maternal.join(" · ")}</p>
            </R>
          )}
          {visit?.assessment && (
            <R title="Assessment">
              <p>{visit.assessment}</p>
            </R>
          )}
          {planText && (
            <R title="Plan">
              <p>{planText}</p>
            </R>
          )}
          <section
            className={`r medication-report ${noChange ? "" : "changed"}`}
          >
            <h2>Medication Changes</h2>
            {noChange ? (
              <p>
                <b>Medication Changes: None</b>
              </p>
            ) : (
              <>
                <h3>MEDICATION CHANGE THIS VISIT</h3>
                {visit?.medicationChanges
                  .split(";")
                  .filter(Boolean)
                  .map((line, i) => (
                    <p key={i}>{line.trim()}</p>
                  ))}
              </>
            )}
          </section>
          {visit?.summary && (
            <section className="r clinician-summary">
              <h2>Clinician Summary / Comments</h2>
              <p>{visit.summary}</p>
            </section>
          )}
          <R title="Follow-Up">
            <p>
              {visit?.nextFollowUp && (
                <>
                  Next GDM Follow-Up: <b>{fmt(visit.nextFollowUp)}</b>
                </>
              )}
              {visit?.glucoseReviewDate && (
                <>
                  {" "}
                  · Glucose Log Review: <b>{fmt(visit.glucoseReviewDate)}</b>
                </>
              )}
            </p>
          </R>
          {visit?.amendments?.length ? (
            <R title="Amendments">
              {visit.amendments.map((a, i) => (
                <div className="amendment" key={i}>
                  <b>
                    {fmt(a.date)} · {a.amendedBy || data.settings.displayName}
                  </b>
                  {a.reason && <p>Reason: {a.reason}</p>}
                  <p>{a.text}</p>
                </div>
              ))}
            </R>
          ) : null}
          <div className="signature">
            <span>
              <small>Treating Clinician</small>
              <b>Daniel Riboh, PA-C</b>
              {data.settings.signature && (
                <img src={data.settings.signature} alt="Clinician signature" />
              )}
            </span>
            <span>
              <small>Clinician Signature</small>
              <b>__________________________</b>
              <p>Electronically signed by Daniel Riboh, PA-C</p>
              <p>Date / Time: {new Date().toLocaleString()}</p>
            </span>
          </div>
          <footer>
            Draft clinical documentation until reviewed and finalized by the
            treating clinician. Clinical decision support only.
          </footer>
        </article>
      </div>
    </div>
  );
}
function R({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="r">
      <h2>{title}</h2>
      {children}
    </section>
  );
}

function ClinicalSummaryEditor({
  value,
  onChange,
  done,
}: {
  value: ClinicalSummaryData;
  onChange: (v: ClinicalSummaryData) => void;
  done: () => void;
}) {
  const set = (k: keyof ClinicalSummaryData, v: string) =>
    onChange({ ...value, [k]: v });
  const fields =
    value.visitKind === "Initial"
      ? [
          ["Reason for Referral / Diagnosis", "reason"],
          ["Current Therapy", "therapy"],
          ["Glucose Status", "pattern"],
          ["Primary Clinical Impression", "impression"],
          ["Medication Change", "medicationChange"],
          ["Next Follow-Up", "nextFollowUp"],
        ]
      : [
          ["Current Therapy", "therapy"],
          ["Glucose Review Period", "reviewPeriod"],
          ["Key Glucose Pattern", "pattern"],
          ["Fasting", "fasting"],
          ["Breakfast", "breakfast"],
          ["Lunch", "lunch"],
          ["Dinner", "dinner"],
          ["Overall Control", "overallControl"],
          ["Medication Change Today", "medicationChange"],
          ["Next Follow-Up", "nextFollowUp"],
        ];
  return (
    <section className="clinical-summary-editor no-print">
      <div>
        <span>
          <b>Edit GDM Clinical Summary</b>
          <small>
            Changes apply to this report preview and downloaded PDF.
          </small>
        </span>
        <Btn onClick={done}>Done Editing</Btn>
      </div>
      <div className="form-grid">
        {fields.map(([label, key]) => (
          <Field
            key={key}
            label={label}
            value={String(value[key as keyof ClinicalSummaryData] || "")}
            onChange={(v) => set(key as keyof ClinicalSummaryData, v)}
          />
        ))}
        <label className="field wide">
          <span>Plan Today — one item per line</span>
          <textarea
            rows={5}
            value={value.plan.join("\n")}
            onChange={(e) =>
              onChange({
                ...value,
                plan: e.target.value
                  .split("\n")
                  .map((x) => x.trim())
                  .filter(Boolean),
              })
            }
          />
        </label>
      </div>
    </section>
  );
}

function ReportViewPdf({
  data,
  p,
  reportId,
  close,
  backToVisit,
  saveReport,
}: {
  data: AppData;
  p: Patient;
  reportId?: string;
  close: () => void;
  backToVisit: () => void;
  saveReport: (r: ReportType) => void;
}) {
  const reportRef = useRef<HTMLElement>(null),
    [downloading, setDownloading] = useState(false),
    [pdfError, setPdfError] = useState(""),
    [editingSummary, setEditingSummary] = useState(false);
  const selectedReport = reportId
      ? data.reports.find((r) => r.id === reportId)
      : undefined,
    selectedIsCurrent = selectedReport?.snapshot?.schemaVersion === 4,
    latestVisit = selectedReport?.visitId
      ? data.visits.find((v) => v.id === selectedReport.visitId)
      : data.visits
          .filter(
            (v) =>
              v.patientId === p.id &&
              v.status !== "Draft" &&
              v.status !== "Editing Finalized Visit",
          )
          .sort((a, b) =>
            (b.date + (b.finalizedAt || "")).localeCompare(
              a.date + (a.finalizedAt || ""),
            ),
          )[0],
    latestVersion = selectedIsCurrent
      ? selectedReport?.visitVersion || latestVisit?.version || 1
      : latestVisit?.version || 1;
  const existing = selectedIsCurrent
    ? selectedReport
    : data.reports.find(
        (r) =>
          r.patientId === p.id &&
          r.visitId === latestVisit?.id &&
          (r.visitVersion || r.snapshot?.visit?.version || 1) ===
            latestVersion &&
          r.snapshot?.schemaVersion === 4,
      );
  const snapshotRef = useRef<ReportSnapshot | null>(null);
  if (!snapshotRef.current) {
    const frozenPatient = latestVisit?.patientSnapshot
      ? {
          ...p,
          ...latestVisit.patientSnapshot,
          currentWeight: latestVisit.weight || p.currentWeight,
        }
      : p;
    snapshotRef.current = existing?.snapshot || {
      patient: clone(frozenPatient),
      visit: latestVisit ? clone(latestVisit) : undefined,
      readings: clone(
        latestVisit?.glucoseSnapshot ||
          data.readings.filter((x) => x.patientId === p.id),
      ),
      medications: [],
      settings: clone(data.settings),
      generatedAt: new Date().toISOString(),
      schemaVersion: 4,
    };
  }
  const snapshot = snapshotRef.current,
    rp = snapshot.patient,
    settings = snapshot.settings;
  let visit = snapshot.visit
    ? {
        ...snapshot.visit,
        status:
          snapshot.visit.status === "Refinalized"
            ? ("Finalized" as const)
            : snapshot.visit.status,
      }
    : undefined;
  const period = visit?.glucosePeriod || "7",
    readings = filterReviewReadings(
      snapshot.readings,
      period,
      visit?.glucoseStart,
      visit?.glucoseEnd,
    ),
    model = buildReportModel(
      rp,
      visit,
      readings,
      snapshot.medications,
      settings,
    ),
    s = model.stats,
    pattern = model.pattern,
    meds = snapshot.medications.filter((m) => m.status === "Active");
  if (visit)
    visit = {
      ...visit,
      gestationalAge: model.gestationalAge,
      assessment: model.assessment,
      summary: model.summary,
      medicationChanges: model.medicationChange,
      currentTherapy: model.currentTherapy,
    };
  const [clinicalSummary, setClinicalSummary] = useState<ClinicalSummaryData>(
    () =>
      snapshot.clinicalSummary ||
      buildClinicalSummary(rp, visit, snapshot.medications, s, period),
  );
  const generatedDate = snapshot.generatedAt.slice(0, 10),
    safe = (value: string) =>
      value
        .normalize("NFKD")
        .replace(/[\u0300-\u036f]/g, "")
        .replace(/[^A-Za-z0-9_-]+/g, "_")
        .replace(/^_+|_+$/g, "") || "Patient",
    fileName = `GDM_Report_${safe(rp.lastName)}_${safe(rp.firstName)}_${generatedDate}.pdf`;
  const reportRecord: ReportType = {
    id: `report-${rp.id}-${visit?.id || generatedDate}-v${visit?.version || 1}`,
    patientId: rp.id,
    visitId: visit?.id,
    visitVersion: visit?.version || 1,
    date: generatedDate,
    type: "GDM Management Report",
    status: "Final",
    generatedBy: settings.displayName || "Daniel Riboh, PA-C",
    fileName,
    snapshot: { ...snapshot, clinicalSummary },
  };
  const headerFields = [
    ["Patient Name", fullName(rp)],
    ["MRN", rp.mrn],
    ["DOB", fmt(rp.dob)],
    ["EDD", fmt(rp.edd)],
    ["Gestational Age", model.gestationalAge],
    [
      "Gravida / Para",
      rp.gravida || rp.para ? `G${rp.gravida}P${rp.para}` : "",
    ],
    ["Visit Date", fmt(visit?.date || generatedDate)],
    ["Referring OB/GYN", rp.referringOb],
    ["OB Practice", rp.obPractice],
  ].filter(([, value]) => value && value !== "—");
  const maternal = [model.maternalFindings].filter(Boolean);
  const planText = reportPlanItems(rp, visit)
      .map(
        (x) =>
          `${x.replace(/^RD referral$/, "Registered Dietitian referral placed").replace(/[.!?]+$/g, "")}.`,
      )
      .join(" "),
    noChange =
      !visit?.medicationChanges ||
      visit.medicationChanges.toLowerCase().includes("no medication") ||
      visit.medicationChanges.toLowerCase() === "none",
    followUpParts = [
      visit?.followUp && `Interval: ${visit.followUp}`,
      visit?.nextFollowUp && `Next GDM Follow-Up: ${fmt(visit.nextFollowUp)}`,
      visit?.glucoseReviewDate &&
        `Glucose Log Review: ${fmt(visit.glucoseReviewDate)}`,
      visit &&
        visit.version &&
        visit.version > 1 &&
        `Revised: ${new Date(visit.finalizedAt || snapshot.generatedAt).toLocaleString()} · Reason: ${visit.revisionReason || "Documentation revision"} · Visit Version: ${visit.version}`,
    ].filter(Boolean);
  const downloadPdf = async () => {
    if (!reportRef.current || downloading) return;
    setDownloading(true);
    setPdfError("");
    let chartCanvas: HTMLCanvasElement | null = null,
      chartImage: HTMLImageElement | null = null;
    try {
      await document.fonts?.ready;
      await new Promise<void>((resolve) =>
        requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
      );
      await new Promise((resolve) => setTimeout(resolve, 1200));
      const source = reportRef.current;
      chartCanvas = source.querySelector("canvas");
      if (chartCanvas) {
        if (!chartCanvas.width || !chartCanvas.height)
          throw new Error("Glucose chart has not finished rendering");
        const bounds = chartCanvas.getBoundingClientRect();
        chartImage = document.createElement("img");
        chartImage.src = chartCanvas.toDataURL("image/png", 1);
        chartImage.alt = "Glucose trend graph";
        chartImage.className = "pdf-chart-image";
        chartImage.style.width = `${bounds.width}px`;
        chartImage.style.height = `${bounds.height}px`;
        chartCanvas.replaceWith(chartImage);
      }
      const html2pdf = (await import("html2pdf.js")).default;
      await html2pdf()
        .set({
          margin: [0.3, 0.35, 0.3, 0.35],
          filename: fileName,
          image: { type: "jpeg", quality: 0.98 },
          html2canvas: {
            scale: 2,
            useCORS: true,
            backgroundColor: "#ffffff",
            logging: false,
          },
          jsPDF: { unit: "in", format: "letter", orientation: "portrait" },
        })
        .from(source)
        .save();
      saveReport(reportRecord);
    } catch (error) {
      console.error("Local PDF generation failed", error);
      setPdfError(
        "PDF generation failed. Please use Print while this prototype is being reviewed.",
      );
    } finally {
      if (chartCanvas && chartImage?.isConnected)
        chartImage.replaceWith(chartCanvas);
      setDownloading(false);
    }
  };
  return (
    <div className="overlay report-overlay">
      <div className="report-shell">
        <div className="toolbar">
          <span>
            <b>OB Report Preview</b>
            <small>PDF generation occurs locally in this browser</small>
          </span>
          <Btn
            kind="secondary"
            onClick={() => setEditingSummary(!editingSummary)}
          >
            {editingSummary ? "Cancel Edit" : "Edit Summary"}
          </Btn>
          <Btn kind="secondary" onClick={backToVisit}>
            Back to Visit
          </Btn>
          <Btn kind="secondary" onClick={() => window.print()}>
            Print
          </Btn>
          <Btn onClick={downloadPdf} disabled={downloading}>
            <Download /> {downloading ? "Preparing PDF…" : "Download PDF"}
          </Btn>
          <Btn kind="secondary" onClick={close}>
            Close
          </Btn>
        </div>
        {pdfError && (
          <div className="pdf-error" role="alert">
            {pdfError}
          </div>
        )}
        {editingSummary && (
          <ClinicalSummaryEditor
            value={clinicalSummary}
            onChange={setClinicalSummary}
            done={() => setEditingSummary(false)}
          />
        )}
        <article ref={reportRef} className="report compact-report">
          <div className="report-head">
            <span>
              <HeartPulse />
              <b>GDM Clinical</b>
            </span>
            <div>
              <h1>GESTATIONAL DIABETES MANAGEMENT REPORT</h1>
            </div>
          </div>
          {rp.mock && (
            <div className="report-demo">SAMPLE / NOT A REAL PATIENT</div>
          )}
          <div className="patient-grid compact">
            {headerFields.map(([label, value]) => (
              <span key={label}>
                <small>{label}</small>
                <b>{value}</b>
              </span>
            ))}
          </div>
          <GdmClinicalSummary summary={clinicalSummary} />
          <R title="Glucose Summary">
            <div className="no-break">
              <table>
                <thead>
                  <tr>
                    <th>Category</th>
                    <th>Average</th>
                    <th>Range</th>
                    <th>Above Goal</th>
                    <th>% Above Goal</th>
                  </tr>
                </thead>
                <tbody>
                  {(["fasting", "breakfast", "lunch", "dinner"] as const).map(
                    (k) => (
                      <tr key={k}>
                        <td>{k[0].toUpperCase() + k.slice(1)}</td>
                        <td>{s[k].count ? s[k].avg : "—"}</td>
                        <td>{s[k].count ? `${s[k].min}–${s[k].max}` : "—"}</td>
                        <td>
                          {s[k].above} / {s[k].count}
                        </td>
                        <td>{s[k].pct}%</td>
                      </tr>
                    ),
                  )}
                </tbody>
              </table>
              <p className="glucose-pattern">
                <b>Glucose Pattern:</b> {pattern}.
              </p>
            </div>
          </R>
          {readings.length > 0 && (
            <R title="Glucose Trend Graph">
              <div className="report-chart">
                <Trend readings={readings} settings={settings} range="all" />
              </div>
            </R>
          )}
          {visit?.intervalHistory && (
            <R title="Interval History">
              <p>
                {visit.dietAdherence &&
                  `Diet adherence: ${visit.dietAdherence}. `}
                {visit.dietFactors?.length
                  ? `Nutrition review: ${visit.dietFactors.join(", ")}. `
                  : ""}
                {visit.activity &&
                  `Activity: ${visit.activity}${visit.activityFrequency ? ` (${visit.activityFrequency})` : ""}. `}
                {visit.intervalHistory}
              </p>
            </R>
          )}
          {maternal.length > 0 && (
            <R title="Maternal Findings">
              <p>{maternal.join(" · ")}</p>
            </R>
          )}
          {visit?.education?.length ? (
            <R title="Education">
              <p>Education reviewed: {visit.education.join(", ")}.</p>
            </R>
          ) : null}
          {visit?.assessment && (
            <R title="Assessment">
              <p>{visit.assessment}</p>
            </R>
          )}
          {planText && (
            <R title="Plan">
              <p>{planText}</p>
            </R>
          )}
          {visit && (
            <section
              className={`r medication-report ${noChange ? "" : "changed"}`}
            >
              <h2>Medication Changes</h2>
              {noChange ? (
                <p>
                  <b>None</b>
                </p>
              ) : (
                <>
                  <h3>MEDICATION CHANGE THIS VISIT</h3>
                  {visit.medicationChanges
                    .split(";")
                    .map((x) => x.trim())
                    .filter(Boolean)
                    .map((line, index) => (
                      <p key={index}>{line}</p>
                    ))}
                </>
              )}
            </section>
          )}
          {visit?.summary && (
            <section className="r clinician-summary">
              <h2>Clinician Summary / Comments</h2>
              <p>{visit.summary}</p>
            </section>
          )}
          {followUpParts.length > 0 && (
            <R title="Follow-Up">
              <p>{followUpParts.join(" · ")}</p>
            </R>
          )}
          {visit?.amendments?.length ? (
            <R title="Amendments">
              {visit.amendments.map((amendment, index) => (
                <div className="amendment" key={index}>
                  <b>
                    {fmt(amendment.date)} ·{" "}
                    {amendment.amendedBy || settings.displayName}
                  </b>
                  {amendment.reason && <p>Reason: {amendment.reason}</p>}
                  <p>{amendment.text}</p>
                </div>
              ))}
            </R>
          ) : null}
          <div className="signature">
            <span>
              <small>Treating Clinician</small>
              <b>Daniel Riboh, PA-C</b>
              {settings.practice && <p>{settings.practice}</p>}
              {settings.signature && (
                <img src={settings.signature} alt="Clinician signature" />
              )}
            </span>
            <span>
              <small>Clinician Signature</small>
              <b>__________________________</b>
              <p>Electronically signed by Daniel Riboh, PA-C</p>
              <p>
                Date / Time: {new Date(snapshot.generatedAt).toLocaleString()}
              </p>
            </span>
          </div>
          <footer>
            {visit?.status === "Finalized" || visit?.status === "Amended"
              ? "Finalized clinical documentation."
              : "Draft clinical documentation until reviewed and finalized by the treating clinician."}{" "}
            Clinical decision support only.
          </footer>
        </article>
      </div>
    </div>
  );
}
