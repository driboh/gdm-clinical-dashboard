import type {Medication,MedicationChange,MedicationRegimen,Patient,Visit,VisitVersion} from "./data.ts";

export function medicationToRegimen(medication:Medication):MedicationRegimen{
 return {medication:medication.name,dose:medication.dose,units:medication.units||"",timing:medication.frequency,frequency:medication.frequency,route:medication.type.toLowerCase().includes("insulin")?"subcutaneous":undefined};
}

export function snapshotActiveTherapy(medications:Medication[],patientId:string):MedicationRegimen[]{
 return medications.filter(m=>m.patientId===patientId&&m.status==="Active").map(medicationToRegimen).map(x=>({...x}));
}

export function formatRegimen(regimen:MedicationRegimen):string{
 return [regimen.medication,regimen.dose,regimen.units,regimen.timing||regimen.frequency].map(x=>x?.trim()).filter(Boolean).join(" ").replace(/\bunits units\b/i,"units");
}

export function formatTherapy(regimens:MedicationRegimen[]):string{
 return regimens.length?regimens.map(formatRegimen).join("; "):"Diet controlled — no medication";
}

export function formatMedicationChange(change:MedicationChange):string{
 const before=[change.from.dose,change.from.units,change.from.timing||change.from.frequency].filter(Boolean).join(" ").replace(/\bunits units\b/i,"units");
 const after=[change.to.dose,change.to.units,change.to.timing||change.to.frequency].filter(Boolean).join(" ").replace(/\bunits units\b/i,"units");
 return `${change.medication}: ${before} → ${after}`;
}

export function applyRegimenChange(start:MedicationRegimen[],change?:MedicationChange):MedicationRegimen[]{
 if(!change)return start.map(x=>({...x}));
 const key=change.medication.trim().toLowerCase(),remaining=start.filter(x=>x.medication.trim().toLowerCase()!==key);
 return [...remaining,{...change.to,medication:change.medication}];
}

export function updateActiveMedicationList(medications:Medication[],patientId:string,visitId:string,date:string,change:MedicationChange|undefined,provider:string):Medication[]{
 if(!change)return medications;
 const key=change.medication.trim().toLowerCase();
 const closed=medications.map(m=>m.patientId===patientId&&m.status==="Active"&&m.name.trim().toLowerCase()===key?{...m,status:"Discontinued" as const,stopDate:date,history:[...m.history,`Changed at visit ${visitId}: ${formatMedicationChange(change)}`]}:m);
 return [...closed,{id:`med-${visitId}`,patientId,name:change.medication,type:change.to.route||"Medication",dose:change.to.dose,units:change.to.units,frequency:change.to.timing||change.to.frequency||"",startDate:date,status:"Active",associatedVisitId:visitId,history:[`Manual change confirmed by ${provider}: ${formatMedicationChange(change)}`]}];
}

const regimen=(medication:string,dose:string,units:string,timing:string):MedicationRegimen=>({medication:medication.trim(),dose:dose.trim(),units:(units||"units").trim(),timing:timing.trim(),frequency:timing.trim()});

// Legacy visits stored medication changes as prose. Only recover chronology when
// the note explicitly contains both regimens; never infer a missing dose/timing
// from the patient's current medication list.
export function parseRecordedMedicationChange(text:string):MedicationChange|undefined{
 const reason=text.match(/Reason:\s*([^;]+)/i)?.[1]?.trim()||"";
 const previous=text.match(/Previous:\s*([^;]+)/i)?.[1]?.trim();
 const next=text.match(/New:\s*([^;]+)/i)?.[1]?.trim();
 const sharedTiming=text.match(/Timing:\s*([^;]+)/i)?.[1]?.trim();
 if(previous&&next&&sharedTiming){
  const medication=text.split(";")[0].replace(/:\s*$/," ").trim();
  if(!medication)return;
  const clean=(value:string)=>value.match(/^(\d+(?:\.\d+)?)\s*(units?)?$/i);
  const before=clean(previous),after=clean(next);
  if(before&&after)return {medication,from:regimen(medication,before[1],before[2]||"units",sharedTiming),to:regimen(medication,after[1],after[2]||"units",sharedTiming),reason};
 }
 const arrow=text.match(/^\s*([^:;]+):\s*(\d+(?:\.\d+)?)\s*(units?)?\s+([^;→]+?)\s*(?:→|->|\bto\b)\s*(\d+(?:\.\d+)?)\s*(units?)?\s+([^;]+?)(?=;|$)/i);
 if(!arrow)return;
 const medication=arrow[1].trim(),beforeTiming=arrow[4].trim(),afterTiming=arrow[7].trim();
 if(!beforeTiming||!afterTiming)return;
 return {medication,from:regimen(medication,arrow[2],arrow[3]||"units",beforeTiming),to:regimen(medication,arrow[5],arrow[6]||"units",afterTiming),reason};
}

const sameRegimen=(a:MedicationRegimen|undefined,b:MedicationRegimen)=>Boolean(a&&formatRegimen(a).toLowerCase()===formatRegimen(b).toLowerCase());

// Repairs only fictional/mock legacy records when their own medication-change
// note proves the pre- and post-visit regimens. Version 1 remains immutable.
export function repairLegacyMockVisitChronology(visit:Visit,patient:Patient|undefined,provider:string,finalizedAt=new Date().toISOString()):Visit{
 if(!patient?.mock||visit.status==="Draft"||visit.status==="Editing Finalized Visit")return visit;
 const change=parseRecordedMedicationChange(visit.medicationChanges||"");
 if(!change)return visit;
 const start=visit.therapyAtStart?.[0]||visit.currentMedication,after=visit.therapyAfterVisit?.find(x=>x.medication.toLowerCase()===change.medication.toLowerCase())||visit.newMedication;
 if(sameRegimen(start,change.from)&&sameRegimen(after,change.to)&&visit.medicationChangeDetails?.length)return visit;
 const originalFinalizedAt=visit.originalFinalizedAt||visit.finalizedAt||`${visit.date}T12:00:00.000Z`;
 const originalVersion:VisitVersion={version:visit.version||1,finalizedAt:visit.finalizedAt||originalFinalizedAt,provider:visit.finalizedBy||visit.provider||provider,revisionReason:visit.revisionReason||"Original",originalFinalizedAt,snapshot:JSON.stringify({...visit,versions:undefined})};
 const versions=visit.versions?.length?[...visit.versions]:[originalVersion],version=Math.max(1,...versions.map(x=>x.version))+1;
 const corrected:Visit={...visit,status:"Refinalized",version,finalizedAt,originalFinalizedAt,finalizedBy:provider,revisionReason:"Corrected legacy medication chronology from explicit visit history",therapyAtStart:[{...change.from}],therapyAfterVisit:[{...change.to}],medicationChangeDetails:[change],currentMedication:{...change.from},newMedication:{...change.to},currentTherapy:formatTherapy([change.from])};
 return {...corrected,versions:[...versions,{version,finalizedAt,provider,revisionReason:corrected.revisionReason||"Documentation revision",originalFinalizedAt,snapshot:JSON.stringify({...corrected,versions:undefined})}]};
}
