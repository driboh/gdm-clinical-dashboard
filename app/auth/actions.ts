"use server";
import { redirect } from "next/navigation";
import { recordAudit } from "../lib/audit";
import { getClinicianContext, isInitialAdminEmail, provisionInitialAdmin } from "../lib/auth/authorization";
import { clinicianAuth } from "../lib/auth/server";

export type AuthState = { error?: string };

const credentials = (formData: FormData) => ({
  email: String(formData.get("email") || "").trim().toLowerCase(),
  password: String(formData.get("password") || ""),
});

export async function signIn(_state: AuthState, formData: FormData): Promise<AuthState> {
  const { email, password } = credentials(formData);
  if (!isInitialAdminEmail(email)) return { error: "This account is not authorized for the clinician dashboard." };
  try {
    const result = await clinicianAuth().signIn.email({ email, password });
    if (result.error) return { error: "Email or password was not accepted." };
    const user = result.data?.user as { id: string; email: string; name?: string } | undefined;
    if (!user) return { error: "A secure session could not be created." };
    await provisionInitialAdmin(user);
    const actor = await getClinicianContext();
    if (actor) await recordAudit({ action: "clinician.login", actor, entityType: "session" });
  } catch {
    return { error: "Secure sign-in is temporarily unavailable." };
  }
  redirect("/");
}

export async function signUp(_state: AuthState, formData: FormData): Promise<AuthState> {
  const { email, password } = credentials(formData);
  if (!isInitialAdminEmail(email)) return { error: "This email is not authorized for initial clinician setup." };
  if (password.length < 12) return { error: "Use a password of at least 12 characters." };
  try {
    const result = await clinicianAuth().signUp.email({ email, password, name: "Daniel Riboh, PA-C" });
    if (result.error) return { error: result.error.message || "The clinician account could not be created." };
    const user = result.data?.user as { id: string; email: string; name?: string } | undefined;
    if (!user) return { error: "The clinician account was created but no session was returned." };
    await provisionInitialAdmin(user);
    const actor = await getClinicianContext();
    if (actor) await recordAudit({ action: "clinician.login", actor, entityType: "session", details: "Initial authorized account created" });
  } catch {
    return { error: "Secure account setup is temporarily unavailable." };
  }
  redirect("/");
}

export async function signOut() {
  const actor = await getClinicianContext();
  if (actor) await recordAudit({ action: "clinician.logout", actor, entityType: "session" });
  await clinicianAuth().signOut();
  redirect("/auth/sign-in");
}
