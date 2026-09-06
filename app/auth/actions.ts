"use server";

import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { recordAudit } from "../lib/audit";
import { getClinicianContext } from "../lib/auth/authorization";
import { auth } from "../lib/auth/server";

export async function signOut() {
  const actor = await getClinicianContext();
  if (actor) await recordAudit({ action: "clinician.logout", actor, entityType: "session" });
  await auth.api.signOut({ headers: await headers() });
  redirect("/auth/sign-in");
}
