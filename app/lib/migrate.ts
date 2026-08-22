import {AppData,demoData} from "./data";

// Prototype-only local browser storage migration. A secure backend can replace
// this boundary later without changing the clinical components.
export function migrateData(input:unknown):AppData{
 const raw=(input&&typeof input==="object"?input:{}) as Partial<AppData>;
 const settings={...demoData.settings,...(raw.settings||{}),providerName:"Daniel Riboh",credentials:"PA-C",displayName:"Daniel Riboh, PA-C",role:"GDM Management"};
 return {
  patients:Array.isArray(raw.patients)?raw.patients:demoData.patients,
  readings:Array.isArray(raw.readings)?raw.readings:demoData.readings,
  medications:Array.isArray(raw.medications)?raw.medications.map(m=>({...m,history:Array.isArray(m.history)?m.history:[]})):demoData.medications,
  visits:(Array.isArray(raw.visits)?raw.visits:demoData.visits).map(v=>{const finalizedAt=v.finalizedAt||`${v.date}T12:00:00.000Z`,originalFinalizedAt=v.originalFinalizedAt||finalizedAt,version=v.version||1;const normalized={...v,status:v.status==="Editing Finalized Visit"?"Finalized":v.status,dietFactors:v.dietFactors||[],symptoms:v.symptoms||[],barriers:v.barriers||[],education:v.education||[],version,finalizedAt,originalFinalizedAt,finalizedBy:v.finalizedBy||v.provider||settings.displayName} as typeof v;return {...normalized,versions:v.versions?.length?v.versions:[{version:1,finalizedAt,provider:normalized.finalizedBy||settings.displayName,revisionReason:"Original",originalFinalizedAt,snapshot:JSON.stringify(normalized)}]}}),
  reports:Array.isArray(raw.reports)?raw.reports.map(r=>({...r,visitVersion:r.visitVersion||r.snapshot?.visit?.version||1})):demoData.reports,
  settings
 };
}
