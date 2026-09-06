"use client";
import { useActionState, useState } from "react";
import { LockKeyhole } from "lucide-react";
import { signIn, signUp, type AuthState } from "../actions";

const initial: AuthState = {};

export function AuthForm() {
  const [setup, setSetup] = useState(false);
  const [state, action, pending] = useActionState(setup ? signUp : signIn, initial);
  return (
    <main className="auth-page">
      <section className="auth-card">
        <div className="auth-mark"><LockKeyhole /></div>
        <p className="auth-eyebrow">GDM Clinical Dashboard</p>
        <h1>{setup ? "Create clinician account" : "Clinician sign in"}</h1>
        <p className="auth-copy">Access is restricted to authorized clinical staff.</p>
        <div className="auth-warning"><b>PROTOTYPE — DO NOT ENTER REAL PHI</b><br />Authentication does not make this prototype HIPAA compliant.</div>
        <form action={action}>
          <label>Email<input name="email" type="email" autoComplete="email" required /></label>
          <label>Password<input name="password" type="password" autoComplete={setup ? "new-password" : "current-password"} minLength={setup ? 12 : undefined} required /></label>
          {state.error && <p className="auth-error" role="alert">{state.error}</p>}
          <button disabled={pending} type="submit">{pending ? "Please wait…" : setup ? "Create authorized account" : "Sign in"}</button>
        </form>
        <button className="auth-switch" type="button" onClick={() => setSetup((value) => !value)}>
          {setup ? "Return to sign in" : "First-time authorized clinician setup"}
        </button>
      </section>
    </main>
  );
}
