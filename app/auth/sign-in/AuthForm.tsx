"use client";

import { FormEvent, useState } from "react";
import { LockKeyhole } from "lucide-react";
import { authClient } from "../../lib/auth/client";

const friendlyError = (message?: string) => {
  if (!message) return "Secure sign-in is temporarily unavailable.";
  if (/already exists/i.test(message)) return "An account already exists. Return to sign in.";
  if (/invalid|password|credential/i.test(message)) return "Email or password was not accepted.";
  return message;
};

export function AuthForm() {
  const [setup, setSetup] = useState(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setPending(true);
    setError("");
    const form = new FormData(event.currentTarget);
    const email = String(form.get("email") || "").trim().toLowerCase();
    const password = String(form.get("password") || "");
    try {
      if (setup) {
        const result = await authClient.signUp.email({ email, password, name: "Daniel Riboh, PA-C" });
        if (result.error) setError(friendlyError(result.error.message));
        else window.location.assign("/auth/mfa/setup");
      } else {
        const result = await authClient.signIn.email({ email, password });
        if (result.error) setError(friendlyError(result.error.message));
        else if (!(result.data as { twoFactorRedirect?: boolean } | null)?.twoFactorRedirect) window.location.assign("/auth/mfa/setup");
      }
    } catch {
      setError("Secure sign-in is temporarily unavailable.");
    } finally {
      setPending(false);
    }
  }

  return (
    <main className="auth-page">
      <section className="auth-card">
        <div className="auth-mark"><LockKeyhole /></div>
        <p className="auth-eyebrow">GDM Clinical Dashboard</p>
        <h1>{setup ? "Create replacement clinician credential" : "Clinician sign in"}</h1>
        <p className="auth-copy">Access is restricted to authorized clinical staff. Multi-factor authentication is required.</p>
        <div className="auth-warning"><b>PROTOTYPE — DO NOT ENTER REAL PHI</b><br />Authentication does not make this prototype HIPAA compliant.</div>
        <form onSubmit={submit}>
          <label>Email<input name="email" type="email" autoComplete="email" required /></label>
          <label>Password<input name="password" type="password" autoComplete={setup ? "new-password" : "current-password"} minLength={setup ? 12 : undefined} required /></label>
          {error && <p className="auth-error" role="alert">{error}</p>}
          <button disabled={pending} type="submit">{pending ? "Please wait…" : setup ? "Create credential and enroll MFA" : "Sign in"}</button>
        </form>
        <button className="auth-switch" type="button" onClick={() => { setSetup((value) => !value); setError(""); }}>
          {setup ? "Return to sign in" : "One-time Better Auth migration setup"}
        </button>
      </section>
    </main>
  );
}
