import assert from "node:assert/strict";
import test from "node:test";
import {buildReportModel,maternalLine,validateVisitConsistency} from "../app/lib/reportModel.ts";
import {buildClinicalSummary,reportPlanItems} from "../app/lib/reportSummary.ts";
import {applyRegimenChange,formatMedicationChange,parseRecordedMedicationChange,repairLegacyMockVisitChronology,snapshotActiveTherapy,updateActiveMedicationList} from "../app/lib/medicationTimeline.ts";
import type {Medication,Patient,Reading,Settings,Visit} from "../app/lib/data.ts";

const settings:Settings={providerName:"Daniel Riboh",credentials:"PA-C",displayName:"Daniel Riboh, PA-C",role:"GDM Management",practice:"",npi:"",phone:"",fax:"",fastingTarget:95,oneHourTarget:140,twoHourTarget:120,monitoring:"1 hour",sites:"Main",defaultFollowUp:"1 week"};
const patient:Patient={id:"test-patient",firstName:"Test",lastName:"Patient",mrn:"DEMO-TEST",dob:"1993-05-12",edd:"2026-10-21",gravida:"2",para:"1001",referringOb:"Mock OB",obPractice:"Mock Practice",site:"Mock",phone:"",language:"English",heightFeet:5,heightInches:5,preWeight:125,currentWeight:145,pregnancyType:"Singleton",classification:"A1GDM",therapy:"Diet controlled",diagnosisDate:"2026-07-28",notes:"FICTIONAL",nextFollowUp:"2026-08-30",status:"MOCK",archived:false,mock:true};
const visit:Visit={id:"visit-test",patientId:patient.id,date:"2026-08-17",type:"Initial GDM Consultation",gestationalAge:"18w 3d",classification:"A1GDM",control:"At goal",provider:"Daniel Riboh, PA-C",status:"Finalized",intervalHistory:"Mock visit.",maternalFindings:"Weight 145 lb; BP 119/81; HR 77; edema None; Weight 145 lb; BP 119/81; HR 77; edema None.",assessment:"stale narrative",plan:"Continue nutrition therapy",medicationChanges:"None",followUp:"1 week",nextFollowUp:"2026-08-24",summary:"stale 0/0 text",weight:145,bloodPressure:"119/81",heartRate:"77",edema:"None",version:1,finalizedAt:"2026-08-17T16:15:00.000Z"};
const readings:Reading[]=Array.from({length:6},(_,index)=>({id:`r${index}`,patientId:patient.id,date:`2026-08-${String(10+index).padStart(2,"0")}`,fasting:[90,91,92,93,94,96][index],breakfast:120+index,lunch:121+index,dinner:122+index,notes:""}));

test("A: one report model supplies 1/6 and 17% everywhere",()=>{const model=buildReportModel(patient,visit,readings,[],settings);assert.equal(model.stats.fasting.count,6);assert.equal(model.stats.fasting.above,1);assert.equal(model.stats.fasting.pct,17);assert.match(model.statements.fasting,/1\/6 above goal \(17%\)/);assert.match(model.assessment,/1\/6 above goal \(17%\)/);assert.match(model.summary,/1\/6 above goal \(17%\)/);assert.doesNotMatch(model.summary,/0\/0/)});

test("B: medication titration preserves current and new regimen",()=>{const titration={...visit,type:"Follow-Up",classification:"A2GDM",currentTherapy:"Insulin",currentMedication:{medication:"Basaglar",dose:"5",units:"units",timing:"QHS"},newMedication:{medication:"Basaglar",dose:"7",units:"units",timing:"QHS"},medicationChanges:"Increase Basaglar to 7 units QHS"};const model=buildReportModel({...patient,classification:"A2GDM",therapy:"Insulin"},titration,readings,[],settings);assert.equal(model.currentTherapy,"Basaglar 5 units QHS");assert.equal(model.medicationChange,"Increase Basaglar to 7 units QHS");assert.doesNotMatch(`${model.currentTherapy} ${model.medicationChange} ${model.assessment} ${model.summary}`,/QAM/)});

test("C: gestational age is identical in every generated section",()=>{const model=buildReportModel(patient,visit,readings,[],settings);assert.notEqual(model.gestationalAge,visit.gestationalAge);assert.match(model.assessment,new RegExp(model.gestationalAge));assert.match(model.summary,new RegExp(model.gestationalAge))});

test("D: report finalization flags, signature, and footer are mutually consistent",()=>{const draft=buildReportModel(patient,{...visit,status:"Draft"},readings,[],settings),finalized=buildReportModel(patient,visit,readings,[],settings),revised=buildReportModel(patient,{...visit,status:"Refinalized",version:2,revisionReason:"Corrected documentation"},readings,[],settings);assert.equal(draft.isDraft,true);assert.equal(draft.isFinalized,false);assert.equal(draft.showSignature,false);assert.match(draft.footerText,/Draft/);assert.equal(finalized.isDraft,false);assert.equal(finalized.isFinalized,true);assert.equal(finalized.showSignature,true);assert.doesNotMatch(finalized.footerText,/Draft/);assert.equal(revised.isFinalized,true);assert.equal(revised.isRevised,true);assert.equal(revised.showSignature,true);assert.doesNotMatch(revised.footerText,/Draft/)});

test("E: maternal findings render each measurement once",()=>{const line=maternalLine(patient,visit);for(const token of ["Weight 145 lb","BP 119/81","HR 77","Edema: None"])assert.equal(line.split(token).length-1,1);assert.equal((line.match(/(?:^| · )Weight 145 lb(?: · |$)/g)||[]).length,1)});

test("finalization validation reports material inconsistencies",()=>{const warnings=validateVisitConsistency(patient,{...visit,assessment:"",plan:""},[],[] as Medication[],settings);assert.ok(warnings.some(x=>x.includes("Gestational age")));assert.ok(warnings.some(x=>x.includes("No glucose")));assert.ok(warnings.some(x=>x.includes("Assessment")));assert.ok(warnings.some(x=>x.includes("Plan")));assert.ok(warnings.some(x=>x.includes("duplicated")))});

test("medication chronology preserves presentation, change, updated regimen, and next-visit start",()=>{
 const active:Medication[]=[{id:"basaglar-5",patientId:patient.id,name:"Basaglar",type:"Insulin",dose:"5",units:"units",frequency:"QHS",startDate:"2026-08-01",status:"Active",history:[]}];
 const therapyAtStart=snapshotActiveTherapy(active,patient.id);
 const change={medication:"Basaglar",from:{...therapyAtStart[0]},to:{...therapyAtStart[0],dose:"7"},reason:"Persistent fasting hyperglycemia"};
 const therapyAfterVisit=applyRegimenChange(therapyAtStart,change);
 const followUpReadings:Reading[]=Array.from({length:6},(_,i)=>({id:`f${i}`,patientId:patient.id,date:`2026-08-${10+i}`,fasting:[96,97,98,99,100,101][i],breakfast:[120,121,122,123,124,125][i],lunch:[141,142,130,131,132,133][i],dinner:[141,142,143,144,130,131][i],notes:""}));
 const followUp:Visit={...visit,type:"Follow-Up",classification:"A2GDM",therapyAtStart,therapyAfterVisit,medicationChangeDetails:[change],currentMedication:therapyAtStart[0],newMedication:therapyAfterVisit[0],medicationChanges:`${formatMedicationChange(change)}; Reason: ${change.reason}`,glucoseSnapshot:followUpReadings,glucosePattern:"Mixed fasting and postprandial elevations"};
 const model=buildReportModel({...patient,classification:"A2GDM",therapy:"Basaglar 7 units QHS"},followUp,followUpReadings,active,settings);
 assert.equal(model.classification,"A2GDM — medication treated");
 assert.equal(model.therapyLabel,"Therapy on Presentation");
 assert.equal(model.currentTherapy,"Basaglar 5 units QHS");
 assert.equal(model.medicationChange,"Basaglar: 5 units QHS → 7 units QHS");
 assert.equal(model.newTherapy,"Basaglar 7 units QHS");
 assert.equal(model.stats.fasting.above,6);assert.equal(model.stats.breakfast.above,0);assert.equal(model.stats.lunch.above,2);assert.equal(model.stats.dinner.above,4);assert.equal(model.stats.atGoal,50);
 assert.doesNotMatch(`${model.currentTherapy} ${model.medicationChange} ${model.newTherapy} ${model.assessment} ${model.summary}`,/QAM|medication controlled/);
 const afterFirst=updateActiveMedicationList(active,patient.id,followUp.id,followUp.date,change,settings.displayName);
 assert.equal(snapshotActiveTherapy(afterFirst,patient.id)[0].dose,"7");
 const nextStart=snapshotActiveTherapy(afterFirst,patient.id),secondChange={...change,from:{...nextStart[0]},to:{...nextStart[0],dose:"9"}};
 updateActiveMedicationList(afterFirst,patient.id,"visit-3","2026-08-24",secondChange,settings.displayName);
 const historical=buildReportModel(patient,followUp,followUpReadings,[],settings);
 assert.equal(historical.currentTherapy,"Basaglar 5 units QHS");assert.equal(historical.newTherapy,"Basaglar 7 units QHS");
});

test("legacy mock visit is repaired from explicit history as Version 2 without changing Version 1",()=>{
 const legacy:Visit={...visit,id:"legacy-follow-up",type:"Follow-Up",classification:"A2GDM",currentTherapy:"Basaglar 7 units QAM",currentMedication:{medication:"Basaglar",dose:"7",units:"units",timing:"QAM"},newMedication:{medication:"Basaglar",dose:"7",units:"units",timing:"QAM"},medicationChanges:"Basaglar; Previous: 5; New: 7; Timing: QHS; Reason: Persistent fasting hyperglycemia"};
 const repaired=repairLegacyMockVisitChronology(legacy,patient,settings.displayName,"2026-08-23T12:00:00.000Z");
 assert.equal(repaired.version,2);assert.equal(repaired.status,"Refinalized");assert.equal(repaired.versions?.[0].version,1);assert.match(repaired.versions?.[0].snapshot||"",/QAM/);
 assert.equal(repaired.currentTherapy,"Basaglar 5 units QHS");assert.equal(repaired.therapyAtStart?.[0].dose,"5");assert.equal(repaired.therapyAtStart?.[0].timing,"QHS");assert.equal(repaired.therapyAfterVisit?.[0].dose,"7");assert.equal(repaired.therapyAfterVisit?.[0].timing,"QHS");
 const model=buildReportModel({...patient,classification:"A2GDM",therapy:"Basaglar 7 units QHS"},repaired,readings,[],settings);
 assert.equal(model.currentTherapy,"Basaglar 5 units QHS");assert.equal(model.medicationChange,"Basaglar: 5 units QHS → 7 units QHS");assert.equal(model.newTherapy,"Basaglar 7 units QHS");assert.doesNotMatch(`${model.currentTherapy} ${model.medicationChange} ${model.newTherapy}`,/QAM/);
});

test("legacy chronology is never guessed when the prior regimen is absent",()=>{
 assert.equal(parseRecordedMedicationChange("Increase Basaglar to 7 units QHS"),undefined);
 const ambiguous={...visit,type:"Follow-Up",currentMedication:{medication:"Basaglar",dose:"7",units:"units",timing:"QAM"},medicationChanges:"Increase Basaglar to 7 units QHS"};
 assert.deepEqual(repairLegacyMockVisitChronology(ambiguous,patient,settings.displayName),ambiguous);
});

test("initial A1GDM report uses proportionate glucose wording and a diet-specific plan",()=>{
 const mildBreakfast:Reading[]=readings.map((reading,index)=>({...reading,fasting:90,breakfast:[142,141,125,126,127,128][index],lunch:120,dinner:125}));
 const initial={...visit,currentTherapy:"Diet controlled",plan:"Continue current therapy; Reinforce carbohydrate distribution",glucosePattern:"Recurrent post-breakfast elevations"};
 const model=buildReportModel(patient,initial,mildBreakfast,[],settings),clinical=buildClinicalSummary(patient,initial,[],model.stats,"7"),plans=reportPlanItems(patient,initial);
 assert.equal(model.classification,"A1GDM — diet controlled");assert.equal(model.stats.breakfast.above,2);assert.equal(model.stats.breakfast.pct,33);
 assert.equal(model.pattern,"Intermittent post-breakfast elevations; otherwise predominantly at goal");assert.equal(clinical.pattern,model.pattern);
 assert.ok(plans.includes("Continue diet and lifestyle management"));assert.ok(!plans.includes("Continue current therapy"));
});

test("follow-up report fills presentation, change, updated regimen, and actual medication plan",()=>{
 const change={medication:"Basaglar",from:{medication:"Basaglar",dose:"5",units:"units",timing:"QHS"},to:{medication:"Basaglar",dose:"7",units:"units",timing:"QHS"},reason:"Persistent fasting hyperglycemia"};
 const followUp={...visit,type:"Follow-Up",classification:"A2GDM",currentTherapy:"Insulin",therapyAtStart:[change.from],therapyAfterVisit:undefined,medicationChangeDetails:[change],currentMedication:change.from,newMedication:undefined,medicationChanges:formatMedicationChange(change),plan:"Titrate insulin"};
 const model=buildReportModel({...patient,classification:"A2GDM",therapy:"Basaglar 7 units QHS"},followUp,readings,[],settings),clinical=buildClinicalSummary({...patient,classification:"A2GDM",therapy:"Basaglar 7 units QHS"},followUp,[],model.stats,"7");
 assert.equal(model.therapyLabel,"Therapy on Presentation");assert.equal(model.currentTherapy,"Basaglar 5 units QHS");assert.equal(model.newTherapy,"Basaglar 7 units QHS");assert.doesNotMatch(model.summary,/Updated regimen:\s*\./);
 assert.equal(clinical.therapyLabel,"Therapy on Presentation");assert.equal(clinical.updatedTherapy,"Basaglar 7 units QHS");assert.equal(clinical.medicationChange,"Basaglar: 5 units QHS → 7 units QHS");assert.ok(clinical.plan.includes("Increase Basaglar from 5 units QHS to 7 units QHS"));assert.doesNotMatch(`${model.summary} ${clinical.updatedTherapy}`,/QAM/);
});
