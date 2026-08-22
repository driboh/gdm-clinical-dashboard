import {ClinicalSummaryData,Medication,Patient,Visit} from "./data";
import {analyze,fmt,gestation} from "./clinical";

type Stats=ReturnType<typeof analyze>;

function patternFor(s:Stats){
 if(s.hypo)return "Recurrent hypoglycemia";
 const elevated=(["breakfast","lunch","dinner"] as const).filter(k=>s[k].count&&s[k].pct>=30);
 if(s.fasting.count&&s.fasting.pct>=30)return elevated.length?"Mixed fasting and postprandial hyperglycemia":"Persistent fasting elevations";
 if(elevated.length>1)return "Recurrent postprandial elevations";
 if(elevated.length===1)return `Recurrent post-${elevated[0]} elevations`;
 return "Values predominantly within target";
}

function mealLine(s:Stats,key:"fasting"|"breakfast"|"lunch"|"dinner"){const x=s[key];return x.count?`${x.above}/${x.count} above goal — ${x.pct}%`:""}
function medicationText(meds:Medication[],fallback:string){const active=meds.filter(m=>m.status==="Active");return active.length?active.map(m=>[m.name,m.dose,m.frequency].filter(Boolean).join(" ")).join("; "):fallback||"Diet controlled — no medication"}
function planItems(v?:Visit){return (v?.plan||"").split(";").map(x=>x.trim()).filter(Boolean).slice(0,5)}

export function buildClinicalSummary(p:Patient,v:Visit|undefined,meds:Medication[],stats:Stats,period:string):ClinicalSummaryData{
 const initial=!v||v.type==="Initial GDM Consultation",hasData=stats.total>0,pattern=patternFor(stats),medChange=!v?.medicationChanges||/^(none|no medication)/i.test(v.medicationChanges)?"None":v.medicationChanges;
 const plans=planItems(v);
 return {
  visitKind:initial?"Initial":"Follow-Up",
  gestationalAge:v?.gestationalAge||gestation(p.edd),classification:v?.classification||p.classification,
  reason:initial?(p.diagnosisTiming||`Newly diagnosed gestational diabetes after abnormal diagnostic testing${p.diagnosisDate?` on ${fmt(p.diagnosisDate)}`:""}.`):"",
  therapy:medicationText(meds,p.therapy),reviewPeriod:initial?"":period==="custom"?"Custom date range":`Last ${period} days`,
  pattern:initial?(hasData?pattern:"Newly starting home glucose monitoring"):pattern,
  fasting:initial?"":mealLine(stats,"fasting"),breakfast:initial?"":mealLine(stats,"breakfast"),lunch:initial?"":mealLine(stats,"lunch"),dinner:initial?"":mealLine(stats,"dinner"),
  overallControl:hasData?`${stats.atGoal}% of readings at goal`:"",
  impression:initial?(v?.assessment||"Appropriate for clinician-directed nutrition therapy and home glucose monitoring."):"",
  plan:plans.length?plans:(initial?["Begin fasting and postprandial glucose monitoring","Reinforce GDM diet and carbohydrate distribution","Encourage post-meal activity as obstetrically appropriate"]:[]),
  medicationChange:medChange,nextFollowUp:v?.nextFollowUp?fmt(v.nextFollowUp):(v?.followUp||(p.nextFollowUp?fmt(p.nextFollowUp):""))
 };
}
