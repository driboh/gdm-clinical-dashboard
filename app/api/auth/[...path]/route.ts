import { clinicianAuth } from "../../../lib/auth/server";
import { isInitialAdminEmail } from "../../../lib/auth/authorization";

export const dynamic = "force-dynamic";
const handlers = clinicianAuth().handler();
export const { GET, PUT, DELETE, PATCH } = handlers;

type AuthRouteContext = { params: Promise<{ path: string[] }> };

export async function POST(request: Request, context: AuthRouteContext) {
  const pathname = new URL(request.url).pathname;

  // Enforce the clinician allowlist at the server boundary as well as in the UI
  // action. This prevents direct calls to the underlying email sign-up route
  // from creating unapproved workforce accounts.
  if (pathname.endsWith("/sign-up/email")) {
    let email = "";
    try {
      const body = (await request.clone().json()) as { email?: unknown };
      email = typeof body.email === "string" ? body.email : "";
    } catch {
      return Response.json({ error: "Invalid request" }, { status: 400 });
    }

    if (!isInitialAdminEmail(email)) {
      return Response.json({ error: "Account creation is not authorized" }, { status: 403 });
    }
  }

  return handlers.POST(request, context);
}
