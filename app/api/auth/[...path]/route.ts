import { toNextJsHandler } from "better-auth/next-js";
import { auth } from "../../../lib/auth/server";
import { isInitialAdminEmail } from "../../../lib/auth/authorization";

export const dynamic = "force-dynamic";
const handlers = toNextJsHandler(auth);
export const GET = handlers.GET;

export async function POST(request: Request) {
  const pathname = new URL(request.url).pathname;
  if (pathname.endsWith("/sign-up/email")) {
    let email = "";
    try {
      const body = (await request.clone().json()) as { email?: unknown };
      email = typeof body.email === "string" ? body.email : "";
    } catch {
      return Response.json({ message: "Invalid request" }, { status: 400 });
    }
    if (!isInitialAdminEmail(email)) {
      return Response.json({ message: "Account creation is not authorized" }, { status: 403 });
    }
  }
  return handlers.POST(request);
}
