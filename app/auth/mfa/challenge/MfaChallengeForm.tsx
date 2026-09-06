"use client";

import { FormEvent, useState } from "react";
import { ShieldCheck } from "lucide-react";
import { authClient } from "../../../lib/auth/client";

export function MfaChallengeForm() {
  const [backupMode, setBackupMode] = useState(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setPending(true);
    setError("");
    const code = String(new FormData(event.currentTarget).get("code") || "").trim();
    const result = backupMode
      ? await authClient.twoFactor.verifyBackupCode({ code, trustDevice: false })
      : await authClient.twoFactor.verifyTotp({ code: code.replace(/\s/g, ""), trustDevice: false });
    if (result.error) {
      setError(result.error.message || (backupMode ? "The recovery code was not accepted." : "The authenticator code was not accepted."));
      setPending(false);
      return;
    }
    window.location.assign("/");
  }

  return (
    <main className="auth-page"><section className="auth-card">
      <div className="auth-mark"><ShieldCheck /></div>
      <p className="auth-eyebrow">GDM Clinical Dashboard</p>
      <h1>Verify your identity</h1>
      <p className="auth-copy">{backupMode ? "Enter one unused recovery code." : "Enter the current 6-digit code from your authenticator app."}</p>
      <div className="auth-warning"><b>PROTOTYPE — DO NOT ENTER REAL PHI</b><br />Authentication does not make this prototype HIPAA compliant.</div>
      <form onSubmit={submit}>
        <label>{backupMode ? "Recovery code" : "Authenticator code"}<input name="code" inputMode={backupMode ? "text" : "numeric"} autoComplete="one-time-code" pattern={backupMode ? undefined : "[0-9]{6}"} required /></label>
        {error && <p className="auth-error" role="alert">{error}</p>}
        <button disabled={pending} type="submit">{pending ? "Verifying…" : "Verify"}</button>
      </form>
      <button className="auth-switch" type="button" onClick={() => { setBackupMode((value) => !value); setError(""); }}>
        {backupMode ? "Use authenticator code" : "Use a recovery code instead"}
      </button>
    </section></main>
  );
}
