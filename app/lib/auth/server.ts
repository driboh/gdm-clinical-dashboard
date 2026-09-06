import { betterAuth } from "better-auth";
import { nextCookies } from "better-auth/next-js";
import { twoFactor } from "better-auth/plugins";
import { Pool } from "pg";

const productionBuild = process.env.NEXT_PHASE === "phase-production-build";
const connectionString = process.env.DATABASE_URL || process.env.POSTGRES_URL;
const authSecret = process.env.BETTER_AUTH_SECRET;

if (!connectionString && !productionBuild) throw new Error("DATABASE_URL is required for clinician authentication.");
if (!authSecret && !productionBuild) throw new Error("BETTER_AUTH_SECRET is required for clinician authentication.");

const canonicalOrigin = "https://gdm-clinical-dashboard.vercel.app";
const configuredOrigin = process.env.BETTER_AUTH_URL?.replace(/\/$/, "");
const productionRuntime = process.env.NODE_ENV === "production";

/**
 * Self-hosted Better Auth uses separate prefixed tables in the existing Neon
 * database. The former managed Neon Auth schema is intentionally untouched as
 * a rollback artifact, but no production route reads it after this migration.
 */
export function createClinicianAuth(database: Pool, options?: { baseURL?: string; secret?: string; secureCookies?: boolean; skipSchemaValidation?: boolean }) {
  return betterAuth({
  appName: "GDM Clinical Dashboard",
  baseURL: options?.baseURL || configuredOrigin || (productionRuntime ? canonicalOrigin : undefined),
  secret: options?.secret || authSecret || "build-time-placeholder-that-is-never-used-at-runtime",
  trustedOrigins: [canonicalOrigin, configuredOrigin, options?.baseURL].filter((value): value is string => Boolean(value)),
  database,
  emailAndPassword: { enabled: true, minPasswordLength: 12, maxPasswordLength: 128 },
  user: {
    modelName: "clinician_auth_user",
    fields: { emailVerified: "email_verified", createdAt: "created_at", updatedAt: "updated_at" },
  },
  session: {
    modelName: "clinician_auth_session",
    fields: {
      expiresAt: "expires_at", createdAt: "created_at", updatedAt: "updated_at",
      ipAddress: "ip_address", userAgent: "user_agent", userId: "user_id",
    },
    expiresIn: 60 * 60 * 8,
    updateAge: 60 * 60,
  },
  account: {
    modelName: "clinician_auth_account",
    fields: {
      accountId: "account_id", providerId: "provider_id", userId: "user_id",
      accessToken: "access_token", refreshToken: "refresh_token", idToken: "id_token",
      accessTokenExpiresAt: "access_token_expires_at", refreshTokenExpiresAt: "refresh_token_expires_at",
      createdAt: "created_at", updatedAt: "updated_at",
    },
  },
  verification: {
    modelName: "clinician_auth_verification",
    fields: { expiresAt: "expires_at", createdAt: "created_at", updatedAt: "updated_at" },
  },
  advanced: {
    cookiePrefix: "gdm_clinician",
    useSecureCookies: options?.secureCookies ?? productionRuntime,
    database: { validateSchema: options?.skipSchemaValidation || productionBuild ? false : true },
  },
  plugins: [
    twoFactor({
      issuer: "GDM Clinical Dashboard",
      twoFactorTable: "clinician_auth_two_factor",
      schema: {
        user: { fields: { twoFactorEnabled: "two_factor_enabled" } },
        twoFactor: {
          fields: {
            backupCodes: "backup_codes", userId: "user_id",
            failedVerificationCount: "failed_verification_count", lockedUntil: "locked_until",
          },
        },
      },
      skipVerificationOnEnable: false,
      backupCodeOptions: { amount: 10, length: 12 },
      accountLockout: { enabled: true, maxFailedAttempts: 6, durationSeconds: 15 * 60 },
      twoFactorCookieMaxAge: 10 * 60,
    }),
    nextCookies(),
  ],
  });
}

export const auth = createClinicianAuth(new Pool({
  connectionString,
  max: 3,
  idleTimeoutMillis: 10_000,
  connectionTimeoutMillis: 10_000,
}));

export type AuthSession = typeof auth.$Infer.Session;
