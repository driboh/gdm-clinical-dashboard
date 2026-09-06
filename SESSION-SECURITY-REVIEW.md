# Clinician Session Security Review

Status: fictional-data prototype; not authorization for PHI.

## Implemented

- Production is served only through the HTTPS Vercel URL.
- Clinician sessions are issued and validated by self-hosted Better Auth using dedicated tables in the existing Neon PostgreSQL database.
- Better Auth manages the session token in an HttpOnly cookie; JavaScript application code does not read the credential.
- Authentication secrets are stored only in deployment environment variables.
- Private pages require a server-validated session. Every private clinical API independently requires an active database role and returns JSON 401/403 instead of relying on hidden UI.
- Mutations are limited to `Admin` and `Clinician`; `Read-only staff` cannot mutate clinical state.
- Logout invalidates the Better Auth session and redirects to sign-in.
- Better Auth validates trusted origins for auth operations. The application does not contain a production localhost/debug identity bypass.
- Admin and Clinician accounts must complete TOTP MFA; encrypted recovery codes are supported.

## Must be verified before PHI

- Independently review MFA enrollment, recovery-code custody, privileged reset, loss, and offboarding workflows.
- Confirm cookie `Secure` and `SameSite` behavior in production browser tests after every Better Auth upgrade.
- Review absolute and idle session expiration values against practice policy.
- Complete explicit CSRF and cross-origin negative testing for every state-changing endpoint. Keep Neon Auth trusted origins limited to approved production domains.
- Add rate limiting and alerting for failed authentication and sensitive mutations.
- Test session revocation from a second device and administrative offboarding.

## Remaining limitation

MFA is implemented, but this application remains a fictional-data prototype. MFA alone does not establish HIPAA compliance or replace the operational, vendor, device, monitoring, testing, and policy work listed in the pre-PHI checklist.
