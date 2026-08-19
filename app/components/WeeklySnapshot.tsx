import {Medication,Reading,Settings} from "../lib/data";
import {analyze} from "../lib/clinical";

export function glucosePattern(stats:ReturnType<typeof analyze>){
 if(stats.hypo)return "Recurrent hypoglycemia";
 const meals=(["breakfast","lunch","dinner"] as const).filter(k=>stats[k].count&&stats[k].pct>=30);
 if(stats.fasting.count&&stats.fasting.pct>=30)return meals.length?"Mixed fasting and postprandial elevations":"Persistent fasting elevations";
 if(meals.length>1)return "Recurrent postprandial elevations at multiple meals";
 if(meals.length===1)return `Recurrent post-${meals[0]} elevations`;
 return "Values predominantly within target";
}

export function WeeklySnapshot({readings,settings,therapy,medicationChange="None",label="7-Day GDM Snapshot",compact=false}:{readings:Reading[];settings:Settings;therapy:string;medicationChange?:string;label?:string;compact?:boolean}){
 const stats=analyze(readings,settings),pattern=glucosePattern(stats);
 return <section className={`weekly-snapshot ${compact?"compact":""}`} aria-label={label}>
  <div className="weekly-title"><h3>{label}</h3><span>{stats.total} readings reviewed</span></div>
  <div className="weekly-meals">{(["fasting","breakfast","lunch","dinner"] as const).map(k=><div key={k}><span>{k}</span><b>{stats[k].above}/{stats[k].count} above goal</b><small>{stats[k].pct}%</small></div>)}</div>
  <div className="weekly-meta"><span><small>Overall at goal</small><b>{stats.atGoal}%</b></span><span><small>Hypoglycemia</small><b>{stats.hypo}</b></span><span><small>Therapy</small><b>{therapy||"Not documented"}</b></span><span><small>Medication change</small><b>{medicationChange||"None"}</b></span></div>
  <p><b>Pattern:</b> {pattern} <em>Clinician review required.</em></p>
 </section>;
}
