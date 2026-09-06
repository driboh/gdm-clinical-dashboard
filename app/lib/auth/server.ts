import { createNeonAuth } from "@neondatabase/auth/next/server";

let instance: ReturnType<typeof createNeonAuth> | undefined;

export function clinicianAuth() {
  if (instance) return instance;
  const productionBuild = process.env.NEXT_PHASE === "phase-production-build";
  const baseUrl = process.env.NEON_AUTH_BASE_URL || (productionBuild ? "https://build.invalid/auth" : undefined);
  const secret = process.env.NEON_AUTH_COOKIE_SECRET || (productionBuild ? "build-time-only-secret-never-used-at-runtime" : undefined);
  if (!baseUrl || !secret || secret.length < 32) {
    throw new Error("Clinician authentication is not configured securely.");
  }
  instance = createNeonAuth({
    baseUrl,
    cookies: { secret, sessionDataTtl: 300 },
    logLevel: "warn",
  });
  return instance;
}
