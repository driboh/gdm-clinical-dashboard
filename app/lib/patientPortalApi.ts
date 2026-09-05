import type {AppData,Patient,PatientPortalAccess,PatientSubmission,Reading,SubmittedReading} from "./data";
import type {DuplicateChoice} from "./patientPortalService";

async function request<T>(url:string,options?:RequestInit):Promise<T>{const response=await fetch(url,{...options,headers:{"Content-Type":"application/json",...(options?.headers||{})},cache:"no-store"});const payload=await response.json().catch(()=>({error:"Invalid server response"}));if(!response.ok)throw new Error(payload.error||"The shared database request failed.");return payload as T}

export type PortalSnapshot={patients:Patient[];portalAccess:PatientPortalAccess[];patientSubmissions:PatientSubmission[];auditEvents:AppData["auditEvents"];readings:Reading[]};
export const mergePortalSnapshot=(data:AppData,snapshot:PortalSnapshot):AppData=>{const localTokens=new Map(data.portalAccess.map(x=>[x.id,x.token])),serverIds=new Set(snapshot.readings.map(x=>x.id)),patients=new Map(data.patients.map(x=>[x.id,x]));snapshot.patients.forEach(x=>patients.set(x.id,x));return {...data,patients:[...patients.values()],portalAccess:snapshot.portalAccess.map(x=>({...x,token:localTokens.get(x.id)||x.token})),patientSubmissions:snapshot.patientSubmissions,auditEvents:snapshot.auditEvents,readings:[...data.readings.filter(x=>x.source!=="Patient Portal"&&!serverIds.has(x.id)),...snapshot.readings]}};
export const patientPortalApi={
 snapshot:()=>request<PortalSnapshot>("/api/clinician-portal"),
 sync:(data:AppData)=>request<{ok:true}>("/api/clinician-portal",{method:"POST",body:JSON.stringify({patients:data.patients,readings:data.readings.filter(x=>x.source!=="Patient Portal")})}),
 create:(data:AppData,patient:Patient)=>request<{access:PatientPortalAccess}>("/api/patient-portal/access",{method:"POST",body:JSON.stringify({patient,readings:data.readings.filter(x=>x.patientId===patient.id),showTargets:data.settings.showPatientPortalTargets!==false,fastingTarget:data.settings.fastingTarget,postMealTarget:data.settings.monitoring==="1 hour"?data.settings.oneHourTarget:data.settings.twoHourTarget,monitoring:data.settings.monitoring,clinician:data.settings.displayName})}),
 disable:(patientId:string,clinician:string)=>request<{ok:boolean}>("/api/patient-portal/access",{method:"PATCH",body:JSON.stringify({patientId,clinician})}),
 portal:(token:string)=>request<{firstName:string;monitoring:"1 hour"|"2 hour";showTargets:boolean;fastingTarget:number;postMealTarget:number;recent:SubmittedReading[]}>(`/api/patient-portal/${encodeURIComponent(token)}`),
 submit:(token:string,readings:SubmittedReading[])=>request<{submissionId:string;submittedAt:string;persisted:true}>(`/api/patient-portal/${encodeURIComponent(token)}`,{method:"POST",body:JSON.stringify({readings})}),
 action:(action:"view"|"edit"|"reject"|"import",submissionId:string,provider:string,extra:Record<string,unknown>={})=>request<PortalSnapshot>("/api/clinician-portal",{method:"PATCH",body:JSON.stringify({action,submissionId,provider,...extra})}),
 import:(submissionId:string,provider:string,choices:Record<string,DuplicateChoice>,clinicianReadings:Reading[]=[])=>patientPortalApi.action("import",submissionId,provider,{choices,clinicianReadings})
};
