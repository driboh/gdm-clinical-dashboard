"use client";
import { useEffect, useMemo, useState } from "react";
import QRCode from "qrcode";
import {
  Copy,
  ExternalLink,
  Link as LinkIcon,
  QrCode,
  ShieldOff,
  X,
} from "lucide-react";
import type { AppData, Patient } from "../lib/data";
import { patientPortalApi } from "../lib/patientPortalApi";

export function PatientPortalCard({
  data,
  patient,
  save,
}: {
  data: AppData;
  patient: Patient;
  save: (data: AppData) => void;
}) {
  const access = data.portalAccess.find(
      (x) => x.patientId === patient.id && x.status === "Active",
    ),
    submissions = data.patientSubmissions.filter(
      (x) => x.patientId === patient.id,
    ),
    pending = submissions.filter((x) => x.status === "Pending").length,
    [origin] = useState(() =>
      typeof window === "undefined" ? "" : window.location.origin,
    ),
    [showQr, setShowQr] = useState(false),
    [qr, setQr] = useState(""),
    [notice, setNotice] = useState(""),
    [busy, setBusy] = useState(false);
  const url =
    access?.token && origin ? `${origin}/patient/submit/${access.token}` : "";
  useEffect(() => {
    if (!showQr || !url) return;
    QRCode.toDataURL(url, {
      width: 320,
      margin: 2,
      color: { dark: "#123f45", light: "#ffffff" },
    }).then(setQr);
  }, [showQr, url]);
  const lastSubmission = useMemo(
      () =>
        [...submissions].sort((a, b) =>
          b.submittedAt.localeCompare(a.submittedAt),
        )[0],
      [submissions],
    ),
    lastImported = useMemo(
      () =>
        submissions
          .filter((x) => x.status === "Imported")
          .sort((a, b) =>
            (b.approvedAt || "").localeCompare(a.approvedAt || ""),
          )[0],
      [submissions],
    );
  const create = async () => {
    setBusy(true);setNotice("");
    try {const result=await patientPortalApi.create(data,patient);save({...data,portalAccess:[result.access,...data.portalAccess.filter(x=>x.patientId!==patient.id)]});setNotice("Shared patient link created and persisted.");}
    catch(e){setNotice(e instanceof Error?e.message:"The shared link could not be created.")}
    finally{setBusy(false)}
  };
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(url);
      setNotice("Link copied.");
    } catch {
      setNotice(
        "Copy was blocked by the browser. Select the link shown with the QR code instead.",
      );
    }
  };
  const printQr = () => {
    if (!qr) return;
    const printWindow = window.open("", "_blank", "width=560,height=700");
    if (!printWindow) {
      setNotice("Allow pop-ups to print the QR code.");
      return;
    }
    printWindow.document.write(
      // Escaping the closing tag keeps it from being interpreted in the source template.
      // eslint-disable-next-line no-useless-escape
      `<!doctype html><html><head><title>Patient Glucose Portal QR Code</title><style>body{font-family:Arial,sans-serif;text-align:center;padding:40px;color:#18343c}img{width:320px;height:320px}p{overflow-wrap:anywhere}small{display:block;margin-top:24px;color:#9a5c20}</style></head><body><h1>Patient Glucose Portal</h1><p>Scan to open the fictional patient submission page.</p><img src="${qr}" alt="Patient portal QR code"><p>${url}</p><small>PROTOTYPE — DO NOT USE FOR REAL PHI</small><script>window.onload=()=>window.print()<\/script></body></html>`,
    );
    printWindow.document.close();
  };
  const disable = async () => {
    if (
      confirm(
        "Disable this prototype patient portal link? The existing token will stop working.",
      )
    ) {
      setBusy(true);try{await patientPortalApi.disable(patient.id,data.settings.displayName);save({...data,portalAccess:data.portalAccess.map(x=>x.patientId===patient.id?{...x,status:"Disabled",disabledAt:new Date().toISOString()}:x)});setNotice("Portal link disabled in the shared database.");}catch(e){setNotice(e instanceof Error?e.message:"The portal could not be disabled.")}finally{setBusy(false)}
    }
  };
  return (
    <section className="card portal-card">
      <div className="card-head">
        <span>
          <h3>Patient Glucose Portal</h3>
          <p>Prototype server-backed submission workflow</p>
        </span>
        <em className={`portal-status ${access ? "active" : "disabled"}`}>
          {access ? "Active" : "Disabled"}
        </em>
      </div>
      <div className="portal-status-grid">
        <span>
          <small>Last submission</small>
          <b>
            {lastSubmission
              ? new Date(lastSubmission.submittedAt).toLocaleString()
              : "None"}
          </b>
        </span>
        <span>
          <small>Pending submissions</small>
          <b>{pending}</b>
        </span>
        <span>
          <small>Last imported readings</small>
          <b>
            {lastImported
              ? new Date(
                  lastImported.approvedAt || lastImported.submittedAt,
                ).toLocaleString()
              : "None"}
          </b>
        </span>
      </div>
      <div className="portal-clinician-actions">
        {!access ? (
          <button className="primary" onClick={create} disabled={busy}>
            <LinkIcon /> Create Patient Link
          </button>
        ) : (
          <>
            {url&&<><button className="secondary" onClick={() => setShowQr(true)}><QrCode /> Show QR Code</button><button className="secondary" onClick={copy}><Copy /> Copy Link</button><a className="secondary portal-link-button" href={url} target="_blank" rel="noreferrer"><ExternalLink /> Open Portal</a></>}
            {!url&&<button className="secondary" onClick={create} disabled={busy}><LinkIcon/> Regenerate Link</button>}
            <button className="danger-button" onClick={disable} disabled={busy}>
              <ShieldOff /> Disable Link
            </button>
          </>
        )}
      </div>
      {notice && (
        <p className="portal-card-notice" role="status">
          {notice}
        </p>
      )}
      <p className="prototype-limit">
        <b>Fictional-data prototype:</b> submissions use a shared PostgreSQL
        database and can cross devices. Authentication, authorization, production
        security review, and appropriate vendor agreements are still required before PHI.
      </p>
      {showQr && (
        <div className="overlay">
          <div className="qr-modal">
            <button
              className="qr-close"
              onClick={() => setShowQr(false)}
              aria-label="Close QR code"
            >
              <X />
            </button>
            <h2>Patient Glucose Portal</h2>
            <p>Scan to open the fictional patient submission page.</p>
            {qr && <img src={qr} alt="QR code for patient glucose portal" />}
            <code>{url}</code>
            <div>
              <button className="secondary" onClick={printQr}>
                Print
              </button>
              <button className="primary" onClick={copy}>
                Copy Link
              </button>
            </div>
            <small>PROTOTYPE — DO NOT USE FOR REAL PHI</small>
          </div>
        </div>
      )}
    </section>
  );
}
