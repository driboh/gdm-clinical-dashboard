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

Prototype data is stored only in the browser's `localStorage`. It is not sent to
an API or cloud database. Storage is specific to each browser and web address,
so data saved on `localhost` will not automatically appear on a deployed Vercel
address. Use the dashboard's development-only export/import controls when you
need to transfer fictional test data.

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
