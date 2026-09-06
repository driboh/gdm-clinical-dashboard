"use client";

import { FormEvent, useState } from "react";
import { LockKeyhole } from "lucide-react";
import QRCode from "qrcode";
import { authClient } from "../../../lib/auth/client";

type Enrollment = { uri: string; qr: string; backupCodes: string[] };

export function MfaSetupForm({ email }: { email: string }) {
  const [enrollment, setEnrollment] = useState<Enrollment | null>(null);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");

  async function begin(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setPending(true);
    setError("");
    const password = String(new FormData(event.currentTarget).get("password") || "");
    const result = await authClient.twoFactor.enable({ password, method: "totp", issuer: "GDM Clinical Dashboard" });
    if (result.error || result.data?.method !== "totp") {
      setError(result.error?.message || "MFA enrollment could not be started.");
    } else {
      const qr = await QRCode.toDataURL(result.data.totpURI, { width: 240, margin: 1 });
      setEnrollment({ uri: result.data.totpURI, qr, backupCodes: result.data.backupCodes });
    }
    setPending(false);
  }

  async function verify(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setPending(true);
    setError("");
    const code = String(new FormData(event.currentTarget).get("code") || "").replace(/\s/g, "");
    const result = await authClient.twoFactor.verifyTotp({ code, trustDevice: false });
    if (result.error) {
      setError(result.error.message || "The authenticator code was not accepted.");
      setPending(false);
      return;
    }
    window.location.assign("/");
  }

  return (
    <main className="auth-page"><section className="auth-card auth-card-wide">
      <div className="auth-mark"><LockKeyhole /></div>
      <p className="auth-eyebrow">GDM Clinical Dashboard</p>
      <h1>Enroll multi-factor authentication</h1>
      <p className="auth-copy">Required for {email}. Use Google Authenticator, Microsoft Authenticator, 1Password, or another TOTP app.</p>
      <div className="auth-warning"><b>PROTOTYPE — DO NOT ENTER REAL PHI</b><br />MFA improves account security but does not make this prototype HIPAA compliant.</div>
      {!enrollment ? (
        <form onSubmit={begin}>
          <label>Confirm your new password<input name="password" type="password" autoComplete="current-password" minLength={12} required /></label>
          {error && <p className="auth-error" role="alert">{error}</p>}
          <button disabled={pending} type="submit">{pending ? "Preparing…" : "Set up authenticator"}</button>
        </form>
      ) : (
        <>
          <div className="mfa-qr"><img src={enrollment.qr} alt="QR code for the GDM Clinical Dashboard authenticator enrollment" /></div>
          <details><summary>Can’t scan? Show setup address</summary><code className="mfa-uri">{enrollment.uri}</code></details>
          <section className="backup-codes" aria-labelledby="backup-heading">
            <h2 id="backup-heading">Save these recovery codes now</h2>
            <p>Each code works once. Store them in a password manager or another secure offline location. They will not be shown again here.</p>
            <ul>{enrollment.backupCodes.map((code) => <li key={code}><code>{code}</code></li>)}</ul>
          </section>
          <form onSubmit={verify}>
            <label>6-digit authenticator code<input name="code" inputMode="numeric" autoComplete="one-time-code" pattern="[0-9]{6}" required /></label>
            {error && <p className="auth-error" role="alert">{error}</p>}
            <button disabled={pending} type="submit">{pending ? "Verifying…" : "Verify and finish enrollment"}</button>
          </form>
        </>
      )}
    </section></main>
  );
}
