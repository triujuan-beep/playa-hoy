"use client";

import { useMemo,useState } from "react";
import type { Beach } from "@/lib/types";
import { beachAtTime,getBestTimeWindow,getEvolution } from "@/lib/hourly";
import { getConditionTrend,getOverallConditionTrend,type TrendDirection,type TrendMetric } from "@/lib/condition-trends";

const trendMetrics:{metric:TrendMetric;label:string;unit:string;digits:number}[]=[
 {metric:"waterTemperature",label:"Agua",unit:"°C",digits:1},
 {metric:"windSpeed",label:"Viento",unit:"km/h",digits:0},
 {metric:"waveHeight",label:"Olas",unit:"m",digits:1},
 {metric:"rainProbability",label:"Lluvia",unit:"%",digits:0},
];
const trendView:Record<TrendDirection,{arrow:string;label:string;style:string}>={improving:{arrow:"↑",label:"Condiciones mejorando",style:"text-emerald-700"},worsening:{arrow:"↓",label:"Condiciones empeorando",style:"text-red-600"},stable:{arrow:"→",label:"Condiciones similares",style:"text-slate-500"},unavailable:{arrow:"—",label:"Sin comparación",style:"text-slate-400"}};

export function BeachEvolution({beach}:{beach:Beach}){
 const points=useMemo(()=>getEvolution(beach),[beach]);
 const bestWindow=useMemo(()=>getBestTimeWindow(beach),[beach]);
 const [selectedTime,setSelectedTime]=useState<string>();
 if(points.length<2)return null;
 const selected=points.find(point=>point.time===selectedTime)??points[0];
 const current=beachAtTime(beach,selected.time);
 const seriesIndex=beach.hourlyConditions?.findIndex(item=>item.time===selected.time)??-1;
 const previousTime=seriesIndex>0?beach.hourlyConditions?.[seriesIndex-1]?.time:undefined;
 const previous=previousTime?beachAtTime(beach,previousTime):undefined;
 const overall=getOverallConditionTrend(current,previous);
 return <section className="mt-6 rounded-3xl border border-[#dce5e4] bg-white p-5 sm:p-8"><p className="text-xs font-extrabold uppercase tracking-[.16em] text-[#078679]">Evolución de hoy</p><div className="mt-2 sm:flex sm:items-end sm:justify-between"><h2 className="text-2xl font-extrabold">Cómo cambian las condiciones</h2>{bestWindow?<p className="mt-2 text-sm font-bold text-[#075b78] sm:mt-0">Mejor momento para venir hoy: {bestWindow.label}</p>:<p className="mt-2 text-sm font-bold text-[#647b86] sm:mt-0">No quedan franjas recomendadas para baño hoy.</p>}</div><div className="mt-6 grid grid-cols-3 gap-2 sm:grid-cols-6">{points.map(point=>{const active=point.time===selected.time;return <button key={point.time} type="button" aria-pressed={active} aria-controls="evolution-detail" onMouseEnter={()=>setSelectedTime(point.time)} onFocus={()=>setSelectedTime(point.time)} onClick={()=>setSelectedTime(point.time)} className={`rounded-2xl border px-3 py-4 text-center transition ${active?"border-[#70d4c5] bg-[#e4f8f3] shadow-sm":"border-transparent bg-[#f2f8f6] hover:border-[#b9ddd5]"}`}><span className="text-xs font-bold text-[#647b86]">{point.time.slice(11,16)} h</span><span className={`mt-2 block text-xl font-extrabold ${point.excluded?"text-red-600":"text-[#075b78]"}`}>{point.excluded?"—":point.score}</span><span className="mx-auto mt-2 block h-12 w-2 overflow-hidden rounded-full bg-[#dce5e4]"><span className={`block w-full rounded-full ${point.excluded?"bg-red-400":"bg-[#70d4c5]"}`} style={{height:`${point.excluded?100:Math.max(8,point.score)}%`,marginTop:`${point.excluded?0:100-Math.max(8,point.score)}%`}}/></span></button>})}</div><div id="evolution-detail" aria-live="polite" className="mt-4 rounded-2xl border border-[#dce5e4] bg-[#fbfcfa] p-4 sm:p-5"><div className="flex flex-wrap items-center justify-between gap-2"><div><p className="text-xs font-extrabold uppercase tracking-[.12em] text-[#078679]">Detalle · {selected.time.slice(11,16)} h</p><p className="mt-1 text-xs text-[#647b86]">{previousTime?`Comparado con las ${previousTime.slice(11,16)} h.`:"Sin una hora anterior comparable."}</p></div>{overall!=="unavailable"&&<p className={`text-sm font-extrabold ${trendView[overall].style}`}>{trendView[overall].arrow} {trendView[overall].label}</p>}</div><div className="mt-4 grid grid-cols-2 gap-2 sm:grid-cols-4">{trendMetrics.map(item=><MetricTrend key={item.metric} beach={current} previous={previous} {...item}/>)}</div><div className="mt-4 flex flex-wrap gap-x-4 gap-y-2 border-t border-[#e4ebe8] pt-3 text-xs font-bold"><span className="text-emerald-700">↑ Condiciones mejorando</span><span className="text-red-600">↓ Condiciones empeorando</span><span className="text-slate-500">→ Condiciones similares</span></div></div><p className="mt-4 text-xs leading-5 text-[#647b86]">Predicción calculada con datos horarios de las fuentes disponibles.</p></section>
}

function MetricTrend({beach,previous,metric,label,unit,digits}:{beach:Beach;previous?:Beach;metric:TrendMetric;label:string;unit:string;digits:number}){const currentValue=beach[metric];const previousValue=previous?.[metric];const trend=getConditionTrend(metric,currentValue,previousValue);const view=trendView[trend];const delta=currentValue!==undefined&&previousValue!==undefined?currentValue-previousValue:undefined;const roundedDelta=delta!==undefined?Number(delta.toFixed(digits)):undefined;const value=currentValue===undefined?"—":`${currentValue.toFixed(digits)}${unit==="%"?"":" "}${unit}`;const deltaText=roundedDelta===undefined||roundedDelta===0?"":` (${roundedDelta>0?"+":""}${roundedDelta.toFixed(digits)}${unit==="%"?"":" "}${unit})`;return <div className="rounded-xl bg-white px-3 py-3"><p className="text-xs font-bold text-[#647b86]">{label}</p><p className="mt-1 text-sm font-extrabold"><span>{value}</span> <span className={view.style}>{view.arrow}</span><span className="font-bold text-[#7a8e96]">{deltaText}</span></p></div>}
