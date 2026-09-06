# GDM Clinical Dashboard — Pre-PHI Security Checklist

Status: **prototype only — do not enter real PHI**. Authentication and database access controls are necessary safeguards, but they do not by themselves make this application HIPAA compliant.

## Implemented in this prototype

- Clinician authentication uses Neon Auth / Better Auth rather than application-defined passwords.
- The dashboard and clinician APIs require a server-validated session and an active role (`Admin`, `Clinician`, or `Read-only staff`).
- Patient portal access is separate, tokenized, hashed in storage, expiring, revocable, and regenerable.
- Security-relevant clinician and portal actions are written to PostgreSQL audit records.
- Clinical patients, clinician-entered glucose readings, medications, visits, reports, provider settings, and visit drafts are stored in PostgreSQL. The former browser record is accepted only for a one-time fictional-data migration and is deleted after the server confirms persistence.
- Secrets remain in deployment environment variables and `.env*` files are excluded from Git.
- The prototype warning remains visible.

## Required before any real PHI

- [ ] Obtain and review BAAs for every vendor and verify that the specific Vercel and Neon products, plan, regions, support paths, logs, and subprocessors used are HIPAA-eligible.
- [ ] Complete a formal security risk assessment and written risk-management plan.
- [ ] Enforce MFA for every workforce account; prohibit shared accounts; define strong password and account-recovery policies.
- [ ] Disable Neon Auth's development-only `Allow Localhost` trusted-origin setting before production PHI use.
- [ ] Establish role approval, periodic access review, rapid offboarding, least privilege, and minimum-necessary access policies.
- [ ] Verify TLS for all traffic and documented encryption at rest for database, backups, logs, and provider-managed replicas.
- [ ] Configure tested backups, point-in-time recovery, restore drills, disaster recovery objectives, and business-continuity procedures.
- [ ] Define immutable audit-log retention, monitoring, alerting, review ownership, export, and legal retention requirements.
- [ ] Add rate limiting, abuse monitoring, alerting, and operational review for authentication and patient portal endpoints.
- [ ] Complete penetration testing, dependency/security scanning, secure code review, and remediation tracking.
- [ ] Define incident detection, containment, breach assessment/notification, evidence preservation, and vendor escalation procedures.
- [ ] Create data retention, correction, legal hold, export, and verified deletion procedures for clinical and audit data.
- [ ] Establish secure endpoint/device requirements: encryption, screen locks, patching, malware protection, remote wipe, and prohibited local/browser storage for PHI.
- [x] Replace persistent browser `localStorage` clinical storage with authenticated server-side records and migration controls for the prototype.
- [ ] Remove the temporary one-time legacy browser-data migration reader after all fictional prototype browsers have migrated.
- [ ] Validate authorization for every patient and organization boundary; add automated negative/tenant-isolation tests.
- [ ] Review patient identity verification, portal-link delivery, expiration duration, revocation workflow, and support procedures.
- [ ] Execute workforce training, sanctions, privacy notices, policies, and documented approval by compliance/legal/security leadership.

Do not remove the prototype warning or authorize real patient use until every applicable item is completed and formally approved.

## External vendor and BAA review — owner action required

Encryption or authentication alone does not establish that a service is eligible to process PHI. Obtain written confirmation and execute all required agreements before real patient use.

### Vercel

- [ ] Confirm the exact Vercel plan and every used service (hosting, serverless/edge execution, build/deployment logs, firewall, support, and subprocessors) are eligible for the intended PHI workflow.
- [ ] Execute and retain a Vercel BAA covering the actual account, project, plan, and services before PHI.

### Neon PostgreSQL

- [ ] Confirm the exact Neon plan, region, PostgreSQL compute/storage, branching, backups, logs, support paths, and subprocessors are eligible for PHI.
- [ ] Execute and retain a Neon BAA covering the production project and all enabled services before PHI.
- [ ] Verify backup retention and complete the isolated restore drill in `BACKUP-AND-RECOVERY.md`.

### Authentication provider

- [ ] Confirm Neon Auth / its managed Better Auth implementation is included in the applicable Neon eligibility statement and BAA.
- [ ] Require and validate application-level MFA for every Admin and Clinician. Neon Console account 2FA is separate and does not satisfy clinician-application MFA.
- [ ] Review password reset, recovery, session revocation, email delivery, identity proofing, and administrative support procedures.

### Other services and software in the data path

- [ ] GitHub: keep the repository private and confirm no PHI, database export, production secret, or generated report is committed. Source hosting must not become a clinical-data channel.
- [ ] Chart.js and html2pdf.js run in the browser; confirm production builds bundle them locally and no clinical data is transmitted to package/CDN vendors.
- [ ] Confirm no analytics, error-reporting, email, SMS, AI, browser-extension, support, or third-party PDF service receives patient data. If any is later added, complete security/BAA review before enabling it.
- [ ] Review clinician devices, browsers, password managers, downloaded PDFs, printers, email/fax delivery, and endpoint backups as part of the full data flow.
