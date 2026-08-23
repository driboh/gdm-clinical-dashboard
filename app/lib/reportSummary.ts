import {ClinicalSummaryData,Medication,Patient,Visit} from "./data";
import {analyze,fmt,gestationAt} from "./clinical";
import {regimenText} from "./reportModel";
import {formatMedicationChange,formatTherapy} from "./medicationTimeline.ts";

type Stats=ReturnType<typeof analyze>;

function patternFor(s:Stats){
 if(s.hypo)return "Recurrent hypoglycemia";
 const elevated=(["breakfast","lunch","dinner"] as const).filter(k=>s[k].count&&s[k].pct>=30);
 if(s.fasting.count&&s.fasting.pct>=30)return elevated.length?"Mixed fasting and postprandial hyperglycemia":"Persistent fasting elevations";
 if(elevated.length>1)return "Recurrent postprandial elevations";
 if(elevated.length===1)return `Recurrent post-${elevated[0]} elevations`;
 return "Values predominantly within target";
}

function mealLine(s:Stats,key:"fasting"|"breakfast"|"lunch"|"dinner"){const x=s[key];return x.count?`${x.above}/${x.count} above goal — ${x.pct}%`:"No readings available"}
function medicationText(meds:Medication[],fallback:string){const active=meds.filter(m=>m.status==="Active");return active.length?active.map(m=>[m.name,m.dose,m.frequency].filter(Boolean).join(" ")).join("; "):fallback||"Diet controlled — no medication"}
function planItems(v?:Visit){return (v?.plan||"").split(";").map(x=>x.trim()).filter(Boolean).slice(0,5)}

export function buildClinicalSummary(p:Patient,v:Visit|undefined,meds:Medication[],stats:Stats,period:string):ClinicalSummaryData{
 const initial=!v||v.type==="Initial GDM Consultation",hasData=stats.total>0,pattern=v?.glucosePattern||patternFor(stats),medChange=!v?.medicationChanges||/^(none|no medication)/i.test(v.medicationChanges)?"None":v.medicationChanges;
 const plans=planItems(v);
 return {
  visitKind:initial?"Initial":"Follow-Up",
  gestationalAge:gestationAt(p.edd,v?.date||new Date().toISOString().slice(0,10)),classification:v?.classification==="A1GDM"&&(v.currentTherapy||p.therapy).toLowerCase().includes("diet")?"A1GDM — diet controlled":v?.classification==="A2GDM"?"A2GDM — medication treated":v?.classification||p.classification,
  reason:initial?(p.diagnosisTiming||`Newly diagnosed gestational diabetes after abnormal diagnostic testing${p.diagnosisDate?` on ${fmt(p.diagnosisDate)}`:""}.`):"",
  therapy:v?.therapyAtStart?.length?formatTherapy(v.therapyAtStart):regimenText(v?.currentMedication)||medicationText(meds,v?.currentTherapy||p.therapy),therapyLabel:v?.medicationChangeDetails?.length?"Therapy on Presentation":"Current Therapy",updatedTherapy:v?.medicationChangeDetails?.length&&v.therapyAfterVisit?.length?formatTherapy(v.therapyAfterVisit):"",reviewPeriod:period==="custom"?"Custom date range":`Last ${period} days`,
  pattern:initial?(hasData?pattern:"Newly starting home glucose monitoring"):pattern,
  fasting:mealLine(stats,"fasting"),breakfast:mealLine(stats,"breakfast"),lunch:mealLine(stats,"lunch"),dinner:mealLine(stats,"dinner"),
  overallControl:hasData?`${stats.atGoal}% of readings at goal`:"",
  impression:initial?(v?.assessment||"Appropriate for clinician-directed nutrition therapy and home glucose monitoring."):"",
  plan:plans.length?plans:(initial?["Begin fasting and postprandial glucose monitoring","Reinforce GDM diet and carbohydrate distribution","Encourage post-meal activity as obstetrically appropriate"]:[]),
  medicationChange:v?.medicationChangeDetails?.length?formatMedicationChange(v.medicationChangeDetails[0]):medChange,nextFollowUp:v?.nextFollowUp?fmt(v.nextFollowUp):(v?.followUp||(p.nextFollowUp?fmt(p.nextFollowUp):""))
 };
}
