import {Patient,Reading} from "./data";
export const fmt=(s:string)=>new Date(s+"T12:00").toLocaleDateString("en-US",{month:"short",day:"numeric",year:"numeric"});
export const age=(s:string)=>Math.floor((Date.now()-new Date(s).getTime())/31557600000);
export const gestation=(edd:string)=>{const days=Math.max(0,280-Math.round((new Date(edd).getTime()-Date.now())/86400000));return`${Math.floor(days/7)}w ${days%7}d`};
const calc=(a:number[],g:number)=>{const above=a.filter(v=>v>=g).length;return{count:a.length,avg:Math.round(a.reduce((x,y)=>x+y,0)/a.length),min:Math.min(...a),max:Math.max(...a),above,pct:Math.round(above/a.length*100)}};
export const analyze=(r:Reading[],t:Patient["targets"])=>{const fasting=calc(r.map(x=>x.fasting),t.fasting),breakfast=calc(r.map(x=>x.breakfast),t.oneHour),lunch=calc(r.map(x=>x.lunch),t.oneHour),dinner=calc(r.map(x=>x.dinner),t.oneHour);const total=r.length*4,above=fasting.above+breakfast.above+lunch.above+dinner.above;return{fasting,breakfast,lunch,dinner,total,atGoal:Math.round((total-above)/total*100),postAbove:Math.round((breakfast.above+lunch.above+dinner.above)/(r.length*3)*100)}};
