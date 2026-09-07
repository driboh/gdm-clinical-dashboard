# GDM Clinical Dashboard — Pre-PHI Security Checklist

Status: **PROTOTYPE — DO NOT ENTER REAL PHI**. Technical safeguards alone do not make this application HIPAA compliant.

Audit date: 2026-09-06. Scope: source code, dependency manifest, Git working tree/history pattern scan, automated negative tests, and observable production behavior. This is a technical review, not a legal certification or HIPAA Security Risk Analysis.

## Production architecture and PHI flow

```text
Patient browser/phone
  -> opaque-token patient portal (HTTPS)
  -> Vercel CDN / Next.js route handlers
  -> Neon PostgreSQL portal/submission tables
  -> authenticated clinician review/import
  -> Neon PostgreSQL clinical tables
  -> clinician dashboard in browser
  -> Chart.js + html2pdf.js local report/PDF rendering

Clinician browser
  -> Better Auth password + TOTP/recovery challenge
  -> Better Auth and role tables in the same Neon database
  -> server-authorized clinical APIs
```

| Component | PHI relationship | Storage/logging boundary |
|---|---|---|
| Patient browser | Enters dates, glucose values, notes; sees first name, targets, and its recent submitted readings | Active page memory. No application local/session/IndexedDB persistence. Device/browser history contains the opaque portal URL. |
| Vercel / Next.js | Transmits and processes all web requests and clinical API responses | May retain operational/request/function/error metadata according to the account configuration. Source contains no intentional PHI logging; vendor settings and contract remain unverified. |
| Better Auth | Processes clinician identity, password hash, sessions, TOTP secret, and recovery codes | Self-hosted tables in Neon. Secure server cookies; no secrets in browser storage or source. |
| Neon PostgreSQL | Stores all clinical, portal, audit, draft, provider, and authentication records | Database/server boundary; connection string is server-only. Vendor backup/log/support boundaries require owner verification. |
| Clinician browser | Displays all authorized clinical data and generates reports | In-memory application state; downloaded PDFs and printed output persist on the clinician-controlled device/printer. |
| Chart.js | Processes glucose data in the clinician browser | Bundled dependency; no CDN/API transmission. |
| html2pdf.js/html2canvas | Converts the rendered report locally in the clinician browser | No external conversion service. Binary PDF is downloaded, not stored by the app. Report metadata/snapshot is stored in PostgreSQL. |
| qrcode | Converts the portal URL into a data-URL QR code locally | Bundled dependency; no external QR service. The QR/token can grant portal access and must be delivered securely. |
| GitHub | Stores source and deployment history; triggers Vercel builds | Must never receive PHI, exports, PDFs containing real data, secrets, or runtime database content. Repository privacy/organization controls require owner verification. |
| Vercel/Neon logs | Infrastructure operators may be able to view request/database metadata | Application avoids logging clinical payloads; exact vendor log content, access, region, and retention require manual verification. |
| Analytics/error monitoring/email/external APIs | None configured in application source | Do not receive PHI currently. Review before adding any service. |

## PHI/ePHI data inventory

| Category | Stored/transmitted | Access | URL/browser/log exposure |
|---|---|---|---|
| Name, MRN, DOB, phone, language | Patient JSON/relational patient row; HTTPS clinical API | Active Clinician/Admin; Read-only staff may read | Not placed in application URLs. In-memory clinician UI. Not intentionally logged. Patient portal returns first name only. |
| EDD, gestational age, gravida/para, pregnancy/OB/clinic data | Patient and visit records in PostgreSQL; HTTPS | Authorized clinical roles | Not intentionally logged or placed in URLs. |
| Height, weights, BMI, BP, heart rate, edema, fetal/obstetric findings | Patient/visit JSON in PostgreSQL; HTTPS | Authorized clinical roles | In-memory UI/report; not intentionally logged. |
| Glucose dates/values/notes and analytics | Submission/readings/visit snapshots in PostgreSQL; HTTPS | Portal holder sees only that portal's recent submissions; authorized clinical roles see patient data | Opaque token, not glucose, is in URL. Values are not intentionally logged. |
| Therapy, medications, insulin doses and medication changes | Medication, visit, version, report records in PostgreSQL | Authorized clinical roles; patient portal does not receive these | In-memory UI/report/PDF; not intentionally logged. |
| Interval history, diet/activity, barriers, education, assessment, plan, clinician comments | Visit/version/report records in PostgreSQL | Authorized clinical roles | Not exposed to patient portal or URLs; downloaded PDF may contain them. |
| Reports and signatures | Report record/snapshot metadata in PostgreSQL; rendered locally | Authorized clinical roles | Downloaded/printed artifact leaves app controls. PDF binary is not uploaded by the app. |
| Portal access and submissions | Token hash, expiration/status, submission/readings in PostgreSQL | Token holder for narrow portal view; Clinician/Admin for administration/review | Plain token exists in URL/QR and transient clinician UI, but only SHA-256 hash is stored server-side. Referrer policy is `no-referrer`. |
| Audit metadata | Timestamp, actor/source, action, entity/patient/submission IDs, outcome, limited details | Authorized dashboard API snapshot currently includes audit events through clinician portal | Avoid narrative PHI. Infrastructure logs may still contain route/status metadata. |
| Clinician identity/authentication | Better Auth and clinician-access tables | Authentication subsystem and authorized administration | Password hash/TOTP/recovery/session values remain server/database-side; secure HttpOnly cookie carries session. |

## API authorization matrix

| Route | Data/actions | Unauthenticated | Read-only staff | Admin/Clinician |
|---|---|---:|---:|---:|
| `/api/clinical-data` GET | patients, visits/versions, glucose, medications, reports, settings, own drafts | 401 | 200 | 200 |
| `/api/clinical-data` PUT/PATCH | clinical writes and drafts | 401 | 403 | 200/validated error |
| `/api/clinician-portal` GET | portal/submission/audit snapshot | 401 | 200 | 200 |
| `/api/clinician-portal` PATCH | review/edit/reject/import | 401 | 403 | 200/validated error |
| `/api/patient-portal/access` POST/PATCH | create/regenerate/revoke portal | 401 | 403 | 200/validated error |
| `/api/audit` POST | allowlisted client-originated audit events | 401 | 200 | 200 |
| `/api/patient-portal/[token]` GET/POST | narrow token-scoped portal/readings | opaque valid token required | Not role-based | Not role-based |
| `/api/auth/[...path]` | Better Auth operations | Endpoint-specific | Endpoint-specific | Endpoint-specific |

The patient endpoint intentionally does not require a clinician session. It requires a high-entropy token, checks active/expiry state server-side, uses server validation and shared PostgreSQL rate limiting, and never returns clinician notes, assessment, medication plan, other patients, internal alerts, or audit data.

## Logging and error handling findings

- No server `console.log` of clinical payloads was found. The only application `console.error` reports local PDF failure without including report data.
- Database errors returned to the portal are generalized. Authorization responses do not expose stacks or database details.
- Audit rows should contain IDs/action/outcome, not copied narrative. The client audit endpoint caps details but must remain restricted to nonclinical status text.
- Vercel and Neon infrastructure logging cannot be fully inspected from source. Manually verify whether query strings, IP addresses, user agents, request bodies, function exceptions, SQL statements, or support captures are retained and configure minimum necessary retention/access.

## Audit-event coverage

| Required event | Current status |
|---|---|
| Login / failed login / MFA failures | Partial: Better Auth enforces the events and lockout but durable application audit coverage of every failure is not yet independently verified. |
| Logout | Complete through the application sign-out action. |
| Patient access/create/edit | Complete via client access event plus server-authorized writes; access beacon delivery should be monitored. |
| Glucose import/edit/delete | Complete for import and persisted changes/deletes; event naming is not yet normalized into a formal audit taxonomy. |
| Visit create/finalize/refinalize | Present through server writes and allowlisted client events; formal completeness reconciliation is still required. |
| Medication change/report generation | Present through server writes/client event; formal completeness reconciliation is still required. |
| Portal create/regenerate/revoke/access/submission/approve/reject | Complete in server routes. |

Audit rows include database timestamp, actor/source, action, entity identifiers where available, and outcome. Before PHI, add an administrative audit export/review procedure, immutable-retention decision, alerts for security events, and a reconciliation test proving every required UI action produces exactly the expected durable event.

## Retention and deletion behavior

| Record | Current behavior | Required policy decision |
|---|---|---|
| Archived patients | Retained in PostgreSQL | Define retention, reactivation, export, and final deletion authority. |
| Clinician-entered glucose deletion | Hard delete with audit event | Decide whether clinical correction should instead retain a tombstone/version. |
| Portal-imported glucose | Protected from bulk clinician-state deletion path | Define correction/versioning rules. |
| Rejected submissions | Retained with status/timestamps | Define retention and purge schedule. |
| Visit versions | Retained; finalized versions are historical | Define immutable/legal retention period. |
| Reports | Metadata/snapshot retained; downloaded binary is device-side | Define supersession, amendment, export, and device-file policy. |
| Audit events | Retained; no automated purge | Define required duration, immutability, review, legal hold, and disposal. |
| Expired/revoked portal tokens | Hash/status retained | Define purge schedule while preserving minimum audit evidence. |
| Auth sessions | Better Auth expiration and logout invalidation | Define cleanup schedule and emergency global revocation procedure. |

Recommended model: immutable visit/audit/version history; status-based retention for submissions/tokens; controlled and audited correction rather than silent deletion; documented hard deletion only after the approved legal/clinical retention period.

## Production configuration classification

| Variable | Classification | Rule |
|---|---|---|
| `DATABASE_URL` / `POSTGRES_URL` | Secret, server-only | Production environment only; never `NEXT_PUBLIC_*`; rotate on suspected exposure. |
| `BETTER_AUTH_SECRET` | Secret, server-only | High entropy; production only; rotation requires session/recovery planning. |
| `BETTER_AUTH_URL` | Public configuration | Exact canonical HTTPS origin. |
| `CLINICIAN_ADMIN_EMAILS` | Sensitive server configuration | Server-only allowlist; not a credential. |
| `NODE_ENV`, `NEXT_PHASE` | Runtime configuration | Nonsecret. |

No `NEXT_PUBLIC_*` secrets were found. Only `.env.example` is tracked; real `.env*`, `.vercel`, keys, dependencies, and build output are ignored.

Production UI inspection found `BETTER_AUTH_SECRET`, `BETTER_AUTH_URL`, and `CLINICIAN_ADMIN_EMAILS` scoped to Production. The Neon integration also supplies `DATABASE_URL`, `DATABASE_URL_UNPOOLED`, `POSTGRES_PRISMA_URL`, `PGPASSWORD`, and related connection fields to All Environments. Vercel labels several Neon-supplied credential-bearing fields as Config rather than Secret. Before PHI, scope database credentials to only the environments that truly need them, confirm Preview/Development use isolated non-PHI databases, and ask Vercel/Neon how integration-managed values should be protected and rotated. Stale managed-auth variables (`NEON_AUTH_COOKIE_SECRET`, `NEON_AUTH_BASE_URL`, `VITE_NEON_AUTH_URL`) are no longer read by application code; remove them only after the rollback window is formally closed.

The Git history filename-only pattern scan found connection-string/secret patterns only in `.env.example` and an automated test fixture; both contain nonfunctional placeholders. No committed real `.env` file or private key was found. This scan supplements, but does not replace, GitHub secret scanning and an independent repository-history review.

## HIPAA Security Risk Analysis working checklist

| Domain | Status | Evidence / remaining work |
|---|---|---|
| Access control / unique users | Partially completed | Individual Better Auth identity and role table exist; formal provisioning/offboarding/access review required. |
| Password + MFA | Completed technically | Password hashing, required TOTP, recovery codes, MFA lockout tested; recovery/help-desk procedure requires review. |
| Role-based authorization | Completed technically | API-side 401/403 role enforcement; formal least-privilege review required. |
| Audit logging | Partially completed | Durable events exist; taxonomy, immutability, monitoring, export, and review policy incomplete. |
| Encryption at rest | Manual review required | Verify exact Neon service/plan/configuration and BAA in writing. |
| Transmission security | Partially completed | HTTPS/HSTS and server-only DB URL; vendor/network configuration must be verified. |
| Backups / disaster recovery | Manual review required | Runbook exists; retention/PITR/RPO/RTO and restore drill unverified. |
| Incident and breach response | Not completed | Written roles, escalation, evidence, assessment, notification, and exercises required. |
| Workforce access/training | Not completed | Approval, training, sanctions, termination, and periodic review policies required. |
| Device/media security | Not completed | Managed-device encryption, lock, updates, remote wipe, downloads/printing/fax/email handling required. |
| Data retention/disposal | Not completed | Approve record-class schedule and verified disposal process. |
| Vendor/subprocessor management | Manual review required | Vercel/Neon eligibility and BAAs; GitHub and dependency governance. |
| Availability/contingency operations | Partially completed | Git redeploy and draft restore plan exist; drills and downtime workflow required. |
| Periodic risk review | Not completed | Assign owner, cadence, change triggers, evidence, and remediation tracking. |

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
- [x] Security headers apply HSTS, MIME-sniffing protection, no-referrer policy, anti-framing controls, a restrictive permissions policy, and a same-origin Content Security Policy compatible with local chart/PDF/QR rendering.
- [x] Better Auth and patient portal endpoints use shared PostgreSQL-backed rate limiting across Vercel instances. Limiter keys are hashed and contain no raw credentials, tokens, email addresses, or clinical payloads.
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
- [ ] Add operational alerting and periodic review for rate-limit, authentication, portal abuse, and authorization events; tune thresholds using fictional-data tests.
- [ ] Review patient identity verification, portal-link delivery, expiration, revocation, loss, and support workflow.

### Vendor / BAA inventory — owner verification required

| Vendor / Component | Touches PHI? | Technical Status | BAA/PHI Verification Needed? | Manual Action |
|---|---:|---|---:|---|
| Vercel | Yes: HTTPS requests, server execution, potentially operational logs | Existing production project works; source minimizes payload logging | Yes | Confirm exact account plan, regions, services, subprocessors and log/support scope are PHI-eligible; execute a BAA covering this account/project. |
| Neon PostgreSQL | Yes: clinical, authentication, portal and audit database | Server-only TLS connection string; persistence works | Yes | Confirm exact plan/region/encryption/backups/PITR/support scope; execute BAA; approve database roles and network restrictions. |
| Better Auth (self-hosted) | Yes: clinician identity/session/MFA | Runs inside app, stores in Neon; TOTP, recovery, lockout and session tests pass | Covered through hosting/database review, not a hosted Better Auth service | Independently review recovery, emergency access and upgrade procedures. |
| GitHub | No by design | Source/deployment metadata only; ignored-secret checks pass | Governance verification required | Verify private visibility, MFA, branch protection, collaborators, secret scanning and dependency alerts. Never commit PHI. |
| Chart.js | Browser-local only | Bundled locally; no runtime service | No if kept local | Preserve local bundling and review dependency updates. |
| html2pdf.js/html2canvas | Browser-local PHI processing | Bundled local PDF generation | No if kept local | Establish managed-device/download/print/email/fax handling. |
| qrcode | Portal URL only, locally | Bundled local data-URL generation | No if kept local | Treat printed/shared QR as an access credential. |
| Analytics/error monitoring | No service configured | None found | Review required before future use | Do not enable until minimum-necessary data, eligibility and BAA are reviewed. |
| Email/SMS/AI/external clinical APIs | None configured | None found | Review required before future use | Do not add or transmit data without architecture, privacy, security and BAA approval. |

## BLOCKERS BEFORE REAL PHI

- [ ] Complete an independent review of the self-hosted Better Auth configuration, MFA enrollment/recovery, privileged-account reset, and emergency access procedures.
- [ ] Execute required Vercel and Neon agreements and obtain written confirmation that exact plans and enabled services are eligible for PHI.
- [ ] Verify and document Secure/SameSite cookie behavior, absolute and idle session expiration, session revocation, fixation resistance, and CSRF protection in production.
- [ ] Complete technical security tests, an isolated restore drill, the compliance program, policies, and formal approval described above.

Do not remove the prototype warning or enter real patient information until every applicable blocker is resolved and formally approved.
