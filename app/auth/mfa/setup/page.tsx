import { redirect } from "next/navigation";
import { getAuthenticatedClinicianIdentity, isInitialAdminEmail } from "../../../lib/auth/authorization";
import { MfaSetupForm } from "./MfaSetupForm";

export const dynamic = "force-dynamic";

export default async function MfaSetupPage() {
  const identity = await getAuthenticatedClinicianIdentity();
  if (!identity) redirect("/auth/sign-in");
  if (!isInitialAdminEmail(identity.email)) redirect("/access-denied");
  if (identity.twoFactorEnabled) redirect("/");
  return <MfaSetupForm email={identity.email} />;
}
