import { NextRequest, NextResponse } from "next/server";
import { auth } from "./app/lib/auth/server";

export async function middleware(request: NextRequest) {
  const session = await auth.api.getSession({ headers: request.headers });
  if (!session) return NextResponse.redirect(new URL("/auth/sign-in", request.url));
  return NextResponse.next();
}

export const config = {
  matcher: [
    "/",
    "/access-denied",
  ],
  runtime: "nodejs",
};
