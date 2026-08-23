import type {Medication,MedicationRegimen,Patient,Reading,Settings,Visit} from "./data.ts";
import {analyze,bmi,fmt,gestationAt} from "./clinical.ts";

export type ReportModel=ReturnType<typeof buildReportModel>;

const categoryNames={fasting:"Fasting",breakfast:"Breakfast",lunch:"Lunch",dinner:"Dinner"} as const;
const keys=Object.keys(categoryNames) as (keyof typeof categoryNames)[];

export function readingStatement(stats:ReturnType<typeof analyze>,key:keyof typeof categoryNames){
 const value=stats[key];
 return value.count?`${categoryNames[key]}: ${value.above}/${value.count} above goal (${value.pct}%)`:`${categoryNames[key]}: No readings available`;
}

export function regimenText(regimen?:MedicationRegimen){
 if(!regimen)return "";
 return [regimen.medication,regimen.dose,regimen.units,regimen.timing].map(x=>x?.trim()).filter(Boolean).join(" ").replace(/\bunits units\b/i,"units");
}

function activeMedicationText(medications:Medication[]){
 const active=medications.filter(m=>m.status==="Active");
 return active.map(m=>[m.name,m.dose,m.units,m.frequency].filter(Boolean).join(" ").replace(/\bunits units\b/i,"units")).join("; ");
}

function patternFor(stats:ReturnType<typeof analyze>){
 if(stats.hypo)return "Recurrent hypoglycemia";
 const post=( ["breakfast","lunch","dinner"] as const).filter(k=>stats[k].count&&stats[k].pct>=30);
 if(stats.fasting.count&&stats.fasting.pct>=30)return post.length?"Mixed fasting and postprandial elevations":"Persistent fasting elevations";
 if(post.length)return post.length===1?`Recurrent post-${post[0]} elevations`:"Recurrent postprandial elevations";
 return stats.total?"Values predominantly within target":"No glucose readings available";
}

function classificationText(patient:Patient,visit?:Visit){
 const classification=visit?.classification||patient.classification;
 const therapy=(visit?.currentTherapy||patient.therapy||"").toLowerCase();
 if(classification==="A1GDM"&&therapy.includes("diet"))return "A1GDM — diet controlled";
 if(classification==="A2GDM")return "A2GDM — medication controlled";
 return classification;
}

function extractValue(text:string,label:string){
 const match=text.match(new RegExp(`${label}\\s*([^;·.]+)`,"i"));
 return match?.[1]?.trim()||"";
}

export function maternalLine(patient:Patient,visit?:Visit){
 const source=visit?.maternalFindings||"";
 const weight=visit?.weight||patient.currentWeight;
 const bp=visit?.bloodPressure||extractValue(source,"BP");
 const hr=visit?.heartRate||extractValue(source,"HR");
 const edema=visit?.edema||extractValue(source,"edema");
 const total=weight&&patient.preWeight?weight-patient.preWeight:0;
 const details=[weight?`Weight ${weight} lb`:"",bmi(patient)!=="—"?`BMI ${bmi(patient)}`:"",total?`Total pregnancy weight gain ${total} lb`:"",bp&&!/not recorded/i.test(bp)?`BP ${bp}`:"",hr&&!/not recorded/i.test(hr)?`HR ${hr}`:"",edema&&!/not recorded/i.test(edema)?`Edema: ${edema.replace(/\s+$/g,"")}`:""];
 const note=source.replace(/(?:Weight|BP|HR|edema)\s*[^;·.]+[;·.]?/gi,"").replace(/\s+/g," ").replace(/^[;·.\s]+|[;·.\s]+$/g,"");
 if(note&&!details.some(x=>x.toLowerCase()===note.toLowerCase()))details.push(note);
 return [...new Set(details.filter(Boolean))].join(" · ");
}

export function buildReportModel(patient:Patient,visit:Visit|undefined,readings:Reading[],medications:Medication[],settings:Settings){
 const visitDate=visit?.date||new Date().toISOString().slice(0,10);
 const gestationalAge=gestationAt(patient.edd,visitDate);
 const stats=analyze(readings,settings);
 const statements=Object.fromEntries(keys.map(key=>[key,readingStatement(stats,key)])) as Record<typeof keys[number],string>;
 const currentTherapy=regimenText(visit?.currentMedication)||activeMedicationText(medications)||visit?.currentTherapy||patient.therapy||"Diet controlled — no medication";
 const newTherapy=regimenText(visit?.newMedication);
 const medicationChange=newTherapy?`Increase ${newTherapy.replace(/^([^ ]+)\s+/,"$1 to ")}`:(!visit?.medicationChanges||/^(none|no medication)/i.test(visit.medicationChanges)?"None":visit.medicationChanges);
 const classification=classificationText(patient,visit);
 const pattern=patternFor(stats);
 const glucoseText=keys.map(key=>statements[key]).join("; ")+`.`;
 const assessment=`${classification} at ${gestationalAge}. ${glucoseText} Pattern: ${pattern}.`;
 const summary=`${gestationalAge} G${patient.gravida}P${patient.para} with ${classification}. ${glucoseText} Current therapy: ${currentTherapy}.${medicationChange!=="None"?` Medication change today: ${medicationChange}.`:""}`;
 const isDraft=!visit||visit.status==="Draft"||visit.status==="Editing Finalized Visit";
 const isRevised=Boolean(visit?.version&&visit.version>1)||visit?.status==="Refinalized";
 const isFinalized=!isDraft;
 const footerText=isFinalized?"Finalized clinical documentation. Clinical decision support only.":"Draft clinical documentation. Not yet finalized by the treating clinician.";
 return {visitDate,gestationalAge,stats,statements,currentTherapy,newTherapy,medicationChange,classification,pattern,glucoseText,assessment,summary,maternalFindings:maternalLine(patient,visit),isDraft,isFinalized,isRevised,showSignature:isFinalized,footerText,finalizedAt:visit?.finalizedAt,originalFinalizedAt:visit?.originalFinalizedAt,revisionReason:visit?.revisionReason,version:visit?.version||1,followUp:visit?.nextFollowUp?fmt(visit.nextFollowUp):visit?.followUp||""};
}

export function validateVisitConsistency(patient:Patient,visit:Visit,readings:Reading[],medications:Medication[],settings:Settings){
 const model=buildReportModel(patient,visit,readings,medications,settings),warnings:string[]=[];
 if(visit.gestationalAge&&visit.gestationalAge!==model.gestationalAge)warnings.push(`Gestational age will be standardized to ${model.gestationalAge} from the EDD and visit date.`);
 if(!model.stats.total)warnings.push("No glucose readings are available for the selected review period.");
 if(!visit.assessment.trim())warnings.push("Assessment is missing.");
 if(!visit.plan.trim())warnings.push("Plan is missing.");
 if(!(visit.provider||settings.displayName).trim())warnings.push("Treating clinician is missing.");
 if(["Weight","BP","HR","edema"].some(label=>(visit.maternalFindings.match(new RegExp(`\\b${label}\\b`,"gi"))||[]).length>1))warnings.push("Maternal findings contain duplicated measurements.");
 if(visit.currentMedication&&visit.newMedication&&visit.currentMedication.medication.toLowerCase()!==visit.newMedication.medication.toLowerCase())warnings.push("The current and new medication names do not match.");
 if(visit.currentMedication&&visit.newMedication&&visit.currentMedication.timing&&visit.newMedication.timing&&visit.currentMedication.timing.toLowerCase()!==visit.newMedication.timing.toLowerCase())warnings.push("Medication timing differs between the current and new regimen; clinician confirmation is required.");
 return warnings;
}
