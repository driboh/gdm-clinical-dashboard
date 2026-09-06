import { clinicianAuth } from "./app/lib/auth/server";

export default clinicianAuth().middleware({ loginUrl: "/auth/sign-in" });

export const config = {
  matcher: [
    "/",
    "/access-denied",
    "/api/clinician-portal/:path*",
    "/api/audit/:path*",
    "/api/patient-portal/access/:path*",
  ],
};
