import { redirect } from "next/navigation";
import { getClinicianContext } from "../../lib/auth/authorization";
import { AuthForm } from "./AuthForm";

export const dynamic = "force-dynamic";

export default async function SignInPage() {
  try {
    if (await getClinicianContext()) redirect("/");
  } catch {
    // The form displays even when auth configuration is incomplete.
  }
  return <AuthForm />;
}
