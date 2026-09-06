import { signOut } from "../auth/actions";

export default function AccessDeniedPage() {
  return <main className="auth-page"><section className="auth-card"><h1>Access not authorized</h1><p className="auth-copy">This signed-in account does not have an active GDM Clinical Dashboard role.</p><form action={signOut}><button type="submit">Sign out</button></form></section></main>;
}
