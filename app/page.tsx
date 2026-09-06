import { redirect } from "next/navigation";
import DashboardClient from "./DashboardClient";
import { getClinicianContext } from "./lib/auth/authorization";

export const dynamic = "force-dynamic";

export default async function Page() {
  const clinician = await getClinicianContext();
  if (!clinician) redirect("/auth/sign-in");
  return <DashboardClient />;
}
