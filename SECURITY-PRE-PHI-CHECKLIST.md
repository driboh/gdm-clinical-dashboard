# GDM Clinical Dashboard — Pre-PHI Security Checklist

Status: **PROTOTYPE — DO NOT ENTER REAL PHI**. Technical safeguards alone do not make this application HIPAA compliant.

## COMPLETED TECHNICAL CONTROLS

- [x] Clinician authentication uses self-hosted Better Auth with required TOTP MFA and recovery codes.
- [x] The dashboard requires a server-validated session and active PostgreSQL role: `Admin`, `Clinician`, or `Read-only staff`.
- [x] Every private clinical API independently returns 401 for no session and 403 for insufficient role; mutating APIs allow only Admin/Clinician.
- [x] Patients, glucose readings, visits, visit versions, medications, medication changes, reports, provider settings, and drafts persist in PostgreSQL. No clinical `localStorage`, `sessionStorage`, or IndexedDB persistence remains.
- [x] Patient portal records, submissions, imported readings, clinician access, and audit records use dedicated PostgreSQL tables.
- [x] Portal tokens are high-entropy, stored only as hashes, expiring, revocable, and replaced on regeneration. Plaintext tokens are excluded from general clinical state.
- [x] Durable audit rows capture timestamp, actor ID when authenticated, action, entity identifiers, and outcome without intentionally copying full clinical content.
- [x] Production code contains no localhost, debug, trusted-browser, default-admin, or hard-coded identity authorization bypass. Initial Admin email comes from a server-only environment variable.
- [x] Auth secrets and database credentials remain in deployment environment variables; `.env*`, dependencies, build output, and local files are excluded from Git.
- [x] Production is HTTPS. Managed session cookies are server-controlled/HttpOnly; session cache data is signed. Logout invalidates the managed session.
- [x] PostgreSQL recovery and isolated restore-test procedure is documented in `BACKUP-AND-RECOVERY.md`.
- [x] Prototype/PHI warnings remain visible.

## STILL REQUIRES MANUAL BUSINESS / COMPLIANCE ACTION

- [ ] Complete a formal security risk analysis and written risk-management plan.
- [ ] Define access approval, least privilege, periodic review, offboarding, password recovery, sanctions, and workforce training.
- [ ] Define incident response, breach assessment/notification, evidence preservation, escalation, and downtime procedures.
- [ ] Define clinical/audit retention, correction, legal hold, export, and verified deletion policies.
- [ ] Establish managed-device requirements: encryption, patching, screen lock, malware protection, remote wipe, approved browsers, and safe handling of downloaded PDFs/printing/email/fax.
- [ ] Define audit retention, immutability expectations, monitoring, alerting, review ownership, and export procedures.
- [ ] Define recovery objectives and perform a documented restore drill only on an isolated non-production branch using fictional data.
- [ ] Complete penetration testing, dependency scanning, CSRF/cross-origin negative testing, tenant-isolation testing, and remediation review.
- [ ] Add reviewed rate limiting and abuse/security monitoring for authentication and portal endpoints.
- [ ] Review patient identity verification, portal-link delivery, expiration, revocation, loss, and support workflow.

### Vendor / BAA inventory — owner verification required

| Vendor/service | Data it can touch | Could receive PHI? | Required owner action |
|---|---|---:|---|
| Vercel | Requests, server execution, deployments, operational/build logs, support metadata | Yes | Confirm exact plan/services/regions/subprocessors are PHI-eligible and execute a BAA covering this account and project. |
| Neon PostgreSQL | Clinical database, audit data, branches, backups, logs, support artifacts | Yes | Confirm exact plan/region/features are PHI-eligible; execute a BAA; verify retention and restore capabilities. |
| Better Auth (self-hosted) | Clinician identity, sessions, authentication events | Stored in Neon | Maintain MFA/recovery/session controls and include this data in database security and recovery reviews. |
| GitHub | Application source and deployment metadata | Must not | Keep repository private; never commit PHI, exports, PDFs, logs, or secrets; verify organizational controls. |
| Chart.js | Browser-rendered glucose charts | Locally only | Confirm production bundle is local and no runtime CDN/request receives chart data. |
| html2pdf.js / html2canvas | Browser-generated clinical PDF | Locally only | Confirm generation remains local; review downloaded-file/device/printer handling. |
| Email/SMS | None currently configured | No currently | Any future provider requires security/data-flow review and BAA determination before enabling PHI. |
| Analytics/error monitoring | None currently configured | No currently | Do not add until minimum-necessary logging and BAA/PHI eligibility are reviewed. |
| AI/external clinical APIs | None configured | No | Do not transmit patient data without explicit architecture, security, privacy, and BAA approval. |

## BLOCKERS BEFORE REAL PHI

- [ ] Complete an independent review of the self-hosted Better Auth configuration, MFA enrollment/recovery, privileged-account reset, and emergency access procedures.
- [ ] Execute required Vercel and Neon agreements and obtain written confirmation that exact plans and enabled services are eligible for PHI.
- [ ] Verify and document Secure/SameSite cookie behavior, absolute and idle session expiration, session revocation, fixation resistance, and CSRF protection in production.
- [ ] Complete technical security tests, an isolated restore drill, the compliance program, policies, and formal approval described above.

Do not remove the prototype warning or enter real patient information until every applicable blocker is resolved and formally approved.
