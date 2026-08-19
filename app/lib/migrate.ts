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
  visits:Array.isArray(raw.visits)?raw.visits.map(v=>({...v,dietFactors:v.dietFactors||[],symptoms:v.symptoms||[],barriers:v.barriers||[],education:v.education||[]})):demoData.visits,
  reports:Array.isArray(raw.reports)?raw.reports:demoData.reports,
  settings
 };
}
