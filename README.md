# GDM Clinical Dashboard

**PROTOTYPE — FICTIONAL DATA ONLY**

This is a front-end clinical workflow prototype. Do not enter protected health
information until secure authentication, encryption, access controls, audit
logging, appropriate hosting, and business associate agreements are in place.

## Local development

Requires Node.js 22.13 or newer.

```bash
npm install
npm run dev
```

On macOS, you can instead double-click `START GDM APP.command`.

Verify the production build with:

```bash
npm run build
```

## Data storage

Most existing clinical prototype data remains in browser `localStorage`.
Patient portal invitations, submissions, review history, imported portal
readings, and portal audit events use the configured shared PostgreSQL database.
This allows the fictional portal workflow to cross devices after `DATABASE_URL`
is configured and the migration has been applied.

## Prototype patient submission portal

Each fictional patient record can create an opaque QR/link for a simplified
glucose-entry page. Submissions remain in a separate pending queue until a
clinician reviews and explicitly imports them. Imported readings are labeled
`Patient Portal`; possible duplicates always require a keep, replace, or skip
choice.

This demonstration now supports cross-device persistence through server-side
PostgreSQL, but remains fictional-data-only. Production use would require
authenticated patient and clinician sessions, encryption in transit and at
rest, authorization controls, durable
audit logs, monitoring, backups, a healthcare-appropriate database and hosting
environment, vendor review/business associate agreements, and formal security
and privacy review. Do not use this prototype for real PHI.

### Database setup

1. Connect a Neon PostgreSQL resource to the existing Vercel project using the
   free prototype plan.
2. Pull the Vercel development environment variables or set `DATABASE_URL` in
   an ignored `.env.local` file.
3. Run `npm run db:migrate:portal` once against each new database.
4. Deploy the application. The API returns success only after PostgreSQL has
   persisted a submission.

## Deploy with GitHub and Vercel

1. Create a GitHub repository without adding another README, license, or
   `.gitignore`.
2. Commit this existing project and push it to that repository.
3. In Vercel, choose **Add New > Project**, connect GitHub, and import the
   repository.
4. Keep the detected framework as **Next.js** and deploy with the repository
   root as the root directory.

Vercel configuration is provided in `vercel.json`. No cloud services,
credentials, analytics, authentication, or external patient-data APIs are
required by this prototype.
