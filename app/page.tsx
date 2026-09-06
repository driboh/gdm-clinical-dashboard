import { redirect } from "next/navigation";
import DashboardClient from "./DashboardClient";
import { getAuthenticatedClinicianIdentity, getClinicianContext } from "./lib/auth/authorization";

export const dynamic = "force-dynamic";

export default async function Page() {
  const identity = await getAuthenticatedClinicianIdentity();
  if (!identity) redirect("/auth/sign-in");
  if (!identity.twoFactorEnabled) redirect("/auth/mfa/setup");
  const clinician = await getClinicianContext();
  if (!clinician) redirect("/access-denied");
  return <DashboardClient />;
}
