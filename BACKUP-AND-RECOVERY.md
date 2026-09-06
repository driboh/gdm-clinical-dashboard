# PostgreSQL Backup and Recovery Runbook

Status: planning document for the fictional-data prototype. Do not enter real PHI.

## Current database

The production application uses the existing Neon PostgreSQL project connected to the existing Vercel project. Clinical state, portal data, clinician access, and audit events are stored in PostgreSQL. Neon Auth stores its managed identity/session data in the database's `neon_auth` schema.

## Items the owner must verify before PHI

1. Confirm the exact Neon plan's backup retention, point-in-time restore window, regional behavior, and whether those features are covered by an executed BAA.
2. Define recovery-point and recovery-time objectives appropriate for the practice.
3. Document who may initiate a restore and require two-person approval for production restoration.
4. Confirm backups, branches, exports, logs, and support artifacts follow the same retention and deletion policy as primary clinical data.

## Restore procedure

1. Declare an incident and stop writes if continuing writes could worsen data loss.
2. Record the desired recovery timestamp and current production branch identifier.
3. Use Neon Backup & Restore to create a recovery branch at the selected timestamp; do not overwrite production first.
4. Validate schema migrations, record counts, referential integrity, clinician authorization, audit continuity, and several fictional patient/report workflows on the recovery branch.
5. Obtain documented approval before promoting or reconnecting production.
6. Preserve the former production branch until reconciliation and incident review are complete.

## Restore testing

Perform scheduled restore drills only into an isolated non-production branch using fictional data. Record the date, participants, recovery point, elapsed restore time, validation results, and cleanup. Never run a destructive restore test against production without explicit approval.
