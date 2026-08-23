import type {Medication,MedicationChange,MedicationRegimen} from "./data.ts";

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
