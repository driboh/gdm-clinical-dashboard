# GDM Clinical Dashboard — Pre-PHI Security Checklist

Status: **prototype only — do not enter real PHI**. Authentication and database access controls are necessary safeguards, but they do not by themselves make this application HIPAA compliant.

## Implemented in this prototype

- Clinician authentication uses Neon Auth / Better Auth rather than application-defined passwords.
- The dashboard and clinician APIs require a server-validated session and an active role (`Admin`, `Clinician`, or `Read-only staff`).
- Patient portal access is separate, tokenized, hashed in storage, expiring, revocable, and regenerable.
- Security-relevant clinician and portal actions are written to PostgreSQL audit records.
- Secrets remain in deployment environment variables and `.env*` files are excluded from Git.
- The prototype warning remains visible.

## Required before any real PHI

- [ ] Obtain and review BAAs for every vendor and verify that the specific Vercel and Neon products, plan, regions, support paths, logs, and subprocessors used are HIPAA-eligible.
- [ ] Complete a formal security risk assessment and written risk-management plan.
- [ ] Enforce MFA for every workforce account; prohibit shared accounts; define strong password and account-recovery policies.
- [ ] Establish role approval, periodic access review, rapid offboarding, least privilege, and minimum-necessary access policies.
- [ ] Verify TLS for all traffic and documented encryption at rest for database, backups, logs, and provider-managed replicas.
- [ ] Configure tested backups, point-in-time recovery, restore drills, disaster recovery objectives, and business-continuity procedures.
- [ ] Define immutable audit-log retention, monitoring, alerting, review ownership, export, and legal retention requirements.
- [ ] Add rate limiting, abuse monitoring, alerting, and operational review for authentication and patient portal endpoints.
- [ ] Complete penetration testing, dependency/security scanning, secure code review, and remediation tracking.
- [ ] Define incident detection, containment, breach assessment/notification, evidence preservation, and vendor escalation procedures.
- [ ] Create data retention, correction, legal hold, export, and verified deletion procedures for clinical and audit data.
- [ ] Establish secure endpoint/device requirements: encryption, screen locks, patching, malware protection, remote wipe, and prohibited local/browser storage for PHI.
- [ ] Replace remaining browser `localStorage` clinical storage with authenticated server-side records and migration controls.
- [ ] Validate authorization for every patient and organization boundary; add automated negative/tenant-isolation tests.
- [ ] Review patient identity verification, portal-link delivery, expiration duration, revocation workflow, and support procedures.
- [ ] Execute workforce training, sanctions, privacy notices, policies, and documented approval by compliance/legal/security leadership.

Do not remove the prototype warning or authorize real patient use until every applicable item is completed and formally approved.
