import type {ClinicalSummaryData,Medication,Patient,Visit} from "./data.ts";
import {analyze,fmt,gestationAt} from "./clinical.ts";
import {regimenText} from "./reportModel.ts";
import {formatMedicationChange,formatRegimen,formatTherapy,parseRecordedMedicationChange} from "./medicationTimeline.ts";

type Stats=ReturnType<typeof analyze>;

function patternFor(s:Stats){
 if(s.hypo)return "Recurrent hypoglycemia";
 const elevated=(["breakfast","lunch","dinner"] as const).filter(k=>s[k].count&&s[k].pct>=30),mild=elevated.filter(k=>s[k].pct<50);
 if(s.fasting.count&&s.fasting.pct>=30)return elevated.length?"Mixed fasting and postprandial hyperglycemia":"Persistent fasting elevations";
 if(elevated.length===1&&mild.length===1)return `Intermittent post-${elevated[0]} elevations; otherwise predominantly at goal`;
 if(elevated.length>1&&mild.length===elevated.length)return "Intermittent postprandial elevations; otherwise predominantly at goal";
 if(elevated.length>1)return "Recurrent postprandial elevations";
 if(elevated.length===1)return `Recurrent post-${elevated[0]} elevations`;
 return "Values predominantly within target";
}

function mealLine(s:Stats,key:"fasting"|"breakfast"|"lunch"|"dinner"){const x=s[key];return x.count?`${x.above}/${x.count} above goal — ${x.pct}%`:"No readings available"}
function medicationText(meds:Medication[],fallback:string){const active=meds.filter(m=>m.status==="Active");return active.length?active.map(m=>[m.name,m.dose,m.frequency].filter(Boolean).join(" ")).join("; "):fallback||"Diet controlled — no medication"}
export function reportPlanItems(p:Patient,v?:Visit){
 const dietControlled=(v?.classification||p.classification)==="A1GDM"&&(v?.currentTherapy||p.therapy||"").toLowerCase().includes("diet");
 const change=v?.medicationChangeDetails?.[0]||parseRecordedMedicationChange(v?.medicationChanges||"");
 const plans=(v?.plan||"").split(";").map(x=>x.trim()).filter(Boolean).map(x=>dietControlled&&/^Continue current therapy$/i.test(x)?"Continue diet and lifestyle management":x);
 if(change){const before=formatRegimen(change.from).replace(`${change.medication} `,""),after=formatRegimen(change.to).replace(`${change.medication} `,""),verb=Number(change.to.dose)>Number(change.from.dose)?"Increase":Number(change.to.dose)<Number(change.from.dose)?"Decrease":"Change",actual=`${verb} ${change.medication} from ${before} to ${after}`;if(!plans.some(x=>x.includes(change.medication)&&x.includes(change.from.dose)&&x.includes(change.to.dose)))plans.push(actual)}
 return plans;
}

export function buildClinicalSummary(p:Patient,v:Visit|undefined,meds:Medication[],stats:Stats,period:string):ClinicalSummaryData{
 const initial=!v||v.type==="Initial GDM Consultation",hasData=stats.total>0,detectedPattern=patternFor(stats),mildPost=(["breakfast","lunch","dinner"] as const).some(key=>stats[key].above&&stats[key].pct<50),pattern=mildPost?detectedPattern:(v?.glucosePattern||detectedPattern),structuredChange=v?.medicationChangeDetails?.[0]||parseRecordedMedicationChange(v?.medicationChanges||""),medChange=structuredChange?formatMedicationChange(structuredChange):!v?.medicationChanges||/^(none|no medication)/i.test(v.medicationChanges)?"None":v.medicationChanges;
 const plans=reportPlanItems(p,v);
 return {
  visitKind:initial?"Initial":"Follow-Up",
  gestationalAge:gestationAt(p.edd,v?.date||new Date().toISOString().slice(0,10)),classification:v?.classification==="A1GDM"&&(v.currentTherapy||p.therapy).toLowerCase().includes("diet")?"A1GDM — diet controlled":v?.classification==="A2GDM"?"A2GDM — medication treated":v?.classification||p.classification,
  reason:initial?(p.diagnosisTiming||`Newly diagnosed gestational diabetes after abnormal diagnostic testing${p.diagnosisDate?` on ${fmt(p.diagnosisDate)}`:""}.`):"",
  therapy:v?.therapyAtStart?.length?formatTherapy(v.therapyAtStart):regimenText(structuredChange?.from)||regimenText(v?.currentMedication)||medicationText(meds,v?.currentTherapy||p.therapy),therapyLabel:structuredChange?"Therapy on Presentation":"Current Therapy",updatedTherapy:v?.therapyAfterVisit?.length?formatTherapy(v.therapyAfterVisit):regimenText(structuredChange?.to)||regimenText(v?.newMedication),reviewPeriod:period==="custom"?"Custom date range":`Last ${period} days`,
  pattern:initial?(hasData?pattern:"Newly starting home glucose monitoring"):pattern,
  fasting:mealLine(stats,"fasting"),breakfast:mealLine(stats,"breakfast"),lunch:mealLine(stats,"lunch"),dinner:mealLine(stats,"dinner"),
  overallControl:hasData?`${stats.atGoal}% of readings at goal`:"",
  impression:initial?(v?.assessment||"Appropriate for clinician-directed nutrition therapy and home glucose monitoring."):"",
  plan:plans.length?plans:(initial?["Begin fasting and postprandial glucose monitoring","Reinforce GDM diet and carbohydrate distribution","Encourage post-meal activity as obstetrically appropriate"]:[]),
  medicationChange:medChange,nextFollowUp:v?.nextFollowUp?fmt(v.nextFollowUp):(v?.followUp||(p.nextFollowUp?fmt(p.nextFollowUp):""))
 };
}
