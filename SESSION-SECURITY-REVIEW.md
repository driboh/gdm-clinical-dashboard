# Clinician Session Security Review

Status: fictional-data prototype; not authorization for PHI.

## Implemented

- Production is served only through the HTTPS Vercel URL.
- Clinician sessions are issued and validated by Neon Auth through the official server SDK.
- The SDK manages the session token in an HttpOnly cookie; JavaScript application code does not read the credential.
- Session cache data is signed with `NEON_AUTH_COOKIE_SECRET`, stored only in deployment environment variables, and cached for five minutes.
- Private pages require a server-validated session. Every private clinical API independently requires an active database role and returns JSON 401/403 instead of relying on hidden UI.
- Mutations are limited to `Admin` and `Clinician`; `Read-only staff` cannot mutate clinical state.
- Logout is a server action that records the event, invalidates the managed session, and redirects to sign-in.
- Neon Auth validates trusted origins for auth operations. The application does not contain a production localhost/debug identity bypass.

## Must be verified before PHI

- Require application-level MFA for all Admin and Clinician accounts and validate enrollment, recovery codes, reset, loss, and offboarding workflows.
- Confirm managed cookie `Secure` and `SameSite` behavior in production browser tests after every auth SDK upgrade.
- Obtain the provider's documented absolute and idle session expiration values; configure them to practice policy if the managed product permits it.
- Complete explicit CSRF and cross-origin negative testing for every state-changing endpoint. Keep Neon Auth trusted origins limited to approved production domains.
- Add rate limiting and alerting for failed authentication and sensitive mutations.
- Test session revocation from a second device and administrative offboarding.

## MFA limitation found

The installed managed Neon Auth SDK is powered by Better Auth, but it does not currently permit bringing custom Better Auth server plugins into the managed service. The available official material documents 2FA for Neon Console accounts, which is not the same as MFA for this dashboard's clinician accounts. No custom OTP implementation was added. Until the managed clinician-auth service provides supported MFA—or the application moves to a reviewed provider that does—real PHI remains prohibited.
