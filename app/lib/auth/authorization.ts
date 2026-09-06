import { portalDb } from "../../../db/portal";
import { clinicianAuth } from "./server";

export type ClinicianRole = "Admin" | "Clinician" | "Read-only staff";
export type ClinicianContext = {
  userId: string;
  email: string;
  displayName: string;
  role: ClinicianRole;
};

export class AuthorizationError extends Error {
  constructor(public status: 401 | 403, message: string) {
    super(message);
  }
}

const allowlistedEmails = () =>
  (process.env.CLINICIAN_ADMIN_EMAILS || "")
    .split(",")
    .map((email) => email.trim().toLowerCase())
    .filter(Boolean);

let schemaReady: Promise<void> | undefined;
function ensureSecuritySchema() {
  if (schemaReady) return schemaReady;
  schemaReady = (async () => {
    const sql = portalDb();
    await sql`CREATE TABLE IF NOT EXISTS clinician_access (
      id uuid PRIMARY KEY,
      auth_user_id text UNIQUE,
      email text NOT NULL UNIQUE,
      display_name text NOT NULL,
      role text NOT NULL CHECK (role IN ('Admin','Clinician','Read-only staff')),
      active boolean NOT NULL DEFAULT true,
      created_at timestamptz NOT NULL DEFAULT now(),
      last_login_at timestamptz
    )`;
    await sql`ALTER TABLE audit_events ALTER COLUMN patient_id DROP NOT NULL`;
    await sql`ALTER TABLE audit_events ADD COLUMN IF NOT EXISTS actor_id text`;
    await sql`ALTER TABLE audit_events ADD COLUMN IF NOT EXISTS source text NOT NULL DEFAULT 'Clinician'`;
    await sql`ALTER TABLE audit_events ADD COLUMN IF NOT EXISTS entity_type text`;
    await sql`ALTER TABLE audit_events ADD COLUMN IF NOT EXISTS entity_id text`;
    await sql`ALTER TABLE audit_events ADD COLUMN IF NOT EXISTS outcome text NOT NULL DEFAULT 'Success'`;
    await sql`CREATE INDEX IF NOT EXISTS audit_action_created_idx ON audit_events(action, created_at DESC)`;
    await sql`CREATE INDEX IF NOT EXISTS audit_actor_created_idx ON audit_events(actor_id, created_at DESC)`;
  })();
  return schemaReady;
}

export function isInitialAdminEmail(email: string) {
  return allowlistedEmails().includes(email.trim().toLowerCase());
}

export async function provisionInitialAdmin(user: { id: string; email: string; name?: string | null }) {
  const email = user.email.trim().toLowerCase();
  if (!isInitialAdminEmail(email)) throw new AuthorizationError(403, "This account is not authorized for the clinician dashboard.");
  await ensureSecuritySchema();
  const sql = portalDb();
  await sql`INSERT INTO clinician_access (id,auth_user_id,email,display_name,role,active,last_login_at)
    VALUES (${crypto.randomUUID()},${user.id},${email},${user.name || "Daniel Riboh, PA-C"},'Admin',true,now())
    ON CONFLICT (email) DO UPDATE SET auth_user_id=excluded.auth_user_id,active=true,last_login_at=now()`;
}

export async function getClinicianContext(): Promise<ClinicianContext | null> {
  const { data: session } = await clinicianAuth().getSession();
  const user = session?.user as { id?: string; email?: string; name?: string } | undefined;
  if (!user?.id || !user.email) return null;
  await ensureSecuritySchema();
  const sql = portalDb();
  const rows = await sql`SELECT auth_user_id,email,display_name,role,active FROM clinician_access
    WHERE auth_user_id=${user.id} OR lower(email)=lower(${user.email}) LIMIT 1`;
  const access = rows[0];
  if (!access || !access.active) return null;
  return {
    userId: String(access.auth_user_id || user.id),
    email: String(access.email),
    displayName: String(access.display_name),
    role: String(access.role) as ClinicianRole,
  };
}

export async function requireClinician(roles: ClinicianRole[] = ["Admin", "Clinician", "Read-only staff"]) {
  const { data: session } = await clinicianAuth().getSession();
  if (!session?.user) throw new AuthorizationError(401, "Sign-in required.");
  const context = await getClinicianContext();
  if (!context || !roles.includes(context.role)) throw new AuthorizationError(403, "You do not have access to this clinical resource.");
  return context;
}

export function authorizationResponse(error: unknown) {
  if (error instanceof AuthorizationError) return Response.json({ error: error.message }, { status: error.status });
  return null;
}
