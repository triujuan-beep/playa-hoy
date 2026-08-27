import {mkdir,writeFile} from "node:fs/promises";
import {dirname} from "node:path";
import {evaluateWaterConfidenceV12,segmentForPoint} from "../frozen/water-confidence-v1.2.mjs";

export const POINTS=Object.freeze([
 {point:"Estepona",region:"western",latitude:36.420739,longitude:-5.148896},
 {point:"Marbella",region:"western",latitude:36.506503,longitude:-4.886251},
 {point:"Fuengirola",region:"central-west",latitude:36.532737,longitude:-4.623467},
 {point:"Malaga",region:"Malaga Bay",latitude:36.715699,longitude:-4.411388},
 {point:"Benajarafe",region:"Axarquia-west",latitude:36.715436,longitude:-4.191691},
 {point:"Torrox",region:"Axarquia-central",latitude:36.728322,longitude:-3.962194},
 {point:"Maro",region:"Axarquia-east",latitude:36.753946,longitude:-3.834640},
 {point:"La Herradura",region:"Granada-west",latitude:36.733183,longitude:-3.744979},
 {point:"Almunecar",region:"Granada-central",latitude:36.730375,longitude:-3.686660},
]);

const finite=value=>Number.isFinite(value);
const mean=values=>values.length?values.reduce((sum,value)=>sum+value,0)/values.length:undefined;
const cooling=(current,past)=>finite(current)&&finite(past)?past-current:undefined;
const round=(value,digits=2)=>finite(value)?Number(value.toFixed(digits)):null;
const addDays=(value,days)=>{const date=new Date(`${value}T00:00:00Z`);date.setUTCDate(date.getUTCDate()+days);return date.toISOString().slice(0,10)};
const toHour=value=>Date.parse(`${value}:00Z`)/3600000;
const unknownPoint=(point,reason)=>({...point,confidence:"UNKNOWN",coastalCoolingAlert:false,upwellingEvidence:"none",reasons:[reason],signals:{openMeteoSstC:null,copernicusSstC:null,copernicusCooling48hC:null,copernicusCooling72hC:null}});

export function buildUnknownSnapshot({executionDate,generatedAt,detectorHash,copernicusInput,previousSourceDate,reason,errors=[]}){
 const sourceAge=Number.isFinite(copernicusInput?.sourceAge)?copernicusInput.sourceAge:null;
 return{executionDate,generatedAt,detectorVersion:"v1.2-frozen",detectorHash,copernicusSourceDate:copernicusInput?.sourceDate??null,sourceAge,sourceFreshness:reason==="stale_copernicus_data"?"stale":"unavailable",lastValidSnapshot:copernicusInput?.sourceDate??previousSourceDate??null,points:POINTS.map(point=>unknownPoint(point,reason)),errors};
}

export function buildFreshSnapshot({executionDate,generatedAt,detectorHash,copernicusInput,marineRaw,windRaw}){
 const marine=Array.isArray(marineRaw)?marineRaw:[marineRaw];
 const wind=Array.isArray(windRaw)?windRaw:[windRaw];
 if(copernicusInput.points.length!==POINTS.length||marine.length!==POINTS.length||wind.length!==POINTS.length)throw new Error("expected exactly nine point payloads");
 const output=[];
 for(let pointIndex=0;pointIndex<POINTS.length;pointIndex++){
  const point=POINTS[pointIndex],copPoint=copernicusInput.points.find(item=>item.point===point.point);
  if(!copPoint)throw new Error(`missing Copernicus point ${point.point}`);
  const marineHourly=marine[pointIndex].hourly,windHourly=wind[pointIndex].hourly;
  const marineDaily=new Map();
  for(let index=0;index<marineHourly.time.length;index++){const value=marineHourly.sea_surface_temperature[index];if(value===null)continue;const date=marineHourly.time[index].slice(0,10),values=marineDaily.get(date)??[];values.push(Number(value));marineDaily.set(date,values)}
  const windRows=windHourly.time.map((time,index)=>({time:toHour(time),speedKmh:Number(windHourly.wind_speed_10m[index]),directionFromDeg:Number(windHourly.wind_direction_10m[index])}));
  const copDaily=new Map(copPoint.daily.map(item=>[item.date,item.sstC])),dates=[...copDaily.keys()].sort();
  let previousAlert=false,finalOutcome,finalSignals;
  for(let index=0;index<dates.length;index++){
   const date=dates[index],endHour=toHour(`${date}T23:00`),cop=copDaily.get(date),prior=days=>copDaily.get(dates[index-days]),priorValues=dates.slice(Math.max(0,index-7),index).map(item=>copDaily.get(item)).filter(finite);
   const signals={openMeteoSstC:mean(marineDaily.get(date)??[]),copernicusSstC:cop,copernicusAgeDays:date===copernicusInput.sourceDate?copernicusInput.sourceAge:0,copCooling48C:cooling(cop,prior(2)),copCooling72C:cooling(cop,prior(3)),segment:segmentForPoint(point.point),windSamples:windRows.filter(item=>item.time>=endHour-71&&item.time<=endHour).map(item=>({...item,hoursBefore:endHour-item.time})),recentWarmBaselineC:priorValues.length?Math.max(...priorValues):undefined,previousAlert};
   const outcome=evaluateWaterConfidenceV12(signals);previousAlert=outcome.coastalCoolingAlert;
   if(date===copernicusInput.sourceDate){finalOutcome=outcome;finalSignals=signals}
  }
  if(!finalOutcome||!finalSignals)throw new Error(`source date absent for ${point.point}`);
  output.push({...point,confidence:finalOutcome.confidence,coastalCoolingAlert:finalOutcome.coastalCoolingAlert,upwellingEvidence:finalOutcome.upwellingEvidence,reasons:finalOutcome.reasons,signals:{openMeteoSstC:round(finalSignals.openMeteoSstC),copernicusSstC:round(finalSignals.copernicusSstC),copernicusCooling48hC:round(finalSignals.copCooling48C),copernicusCooling72hC:round(finalSignals.copCooling72C)}});
 }
 return{executionDate,generatedAt,detectorVersion:"v1.2-frozen",detectorHash,copernicusSourceDate:copernicusInput.sourceDate,sourceAge:copernicusInput.sourceAge,sourceFreshness:"fresh",lastValidSnapshot:copernicusInput.sourceDate,points:output,errors:[]};
}

export async function writeSnapshotExclusive(path,snapshot){await mkdir(dirname(path),{recursive:true});await writeFile(path,JSON.stringify(snapshot,null,2)+"\n",{encoding:"utf8",flag:"wx"})}

export function summarize(snapshot){const counts={alerts:0,LOW:0,MEDIUM:0,HIGH:0,UNKNOWN:0};for(const point of snapshot.points){if(point.coastalCoolingAlert)counts.alerts++;counts[point.confidence]++}return counts}

