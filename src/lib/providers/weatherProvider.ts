import "server-only";
import { unstable_cache } from "next/cache";

export type WeatherHour={time:string;airTemperature?:number;windSpeed?:number;windGust?:number;windDirection?:number;rainProbability?:number};
export type WeatherResult={airTemperature?:number;windSpeed?:number;windGust?:number;windDirection?:number;rainProbability?:number;hourly:WeatherHour[];updatedAt?:string;validFor?:string;source:string;sourceUrl:string};

export const AEMET_MUNICIPALITY_CODES:Record<string,string>={Torrox:"29091",Nerja:"29075","Rincón de la Victoria":"29082",Málaga:"29067",Torremolinos:"29901",Mijas:"29070","La Cala de Mijas":"29070"};
const API_BASE="https://opendata.aemet.es/opendata/api";
const SOURCE_URL="https://opendata.aemet.es/dist/index.html";
const TIMEZONE="Europe/Madrid";
const CACHE_SECONDS=900;

type Scalar=number|string|null;
type TimedValue={periodo?:string;value?:Scalar;direccion?:string|string[];velocidad?:Scalar|Scalar[]};
type ForecastDay={fecha?:string;temperatura?:TimedValue[];probPrecipitacion?:TimedValue[];vientoAndRachaMax?:TimedValue[]};
type AemetPayload={origen?:{elaborado?:string};elaborado?:string;prediccion?:{dia?:ForecastDay[]}};
type MetadataResponse={datos?:string;estado?:number;descripcion?:string};

function localDateAndHour(now=new Date()){
 const parts=new Intl.DateTimeFormat("en-CA",{timeZone:TIMEZONE,year:"numeric",month:"2-digit",day:"2-digit",hour:"2-digit",minute:"2-digit",hourCycle:"h23"}).formatToParts(now);
 const part=(type:Intl.DateTimeFormatPartTypes)=>parts.find(item=>item.type===type)?.value??"00";
 return{date:`${part("year")}-${part("month")}-${part("day")}`,hour:Number(part("hour")),minute:Number(part("minute"))};
}

const periodStart=(period?:string)=>{if(!period)return undefined;const value=period.length===4?period.slice(0,2):period;const parsed=Number(value);return Number.isFinite(parsed)?parsed:undefined};
const circularHourDistance=(a:number,b:number)=>Math.min(Math.abs(a-b),24-Math.abs(a-b));
const closestInstant=(values:TimedValue[]|undefined,hour:number)=>values?.filter(item=>periodStart(item.periodo)!==undefined).reduce<TimedValue|undefined>((best,item)=>!best||circularHourDistance(periodStart(item.periodo)!,hour)<circularHourDistance(periodStart(best.periodo)!,hour)?item:best,undefined);

function intervalContains(period:string,hour:number){
 if(!/^\d{4}$/.test(period))return false;
 const start=Number(period.slice(0,2));const end=Number(period.slice(2));
 return start<end?hour>=start&&hour<end:hour>=start||hour<end;
}

const closestProbability=(values:TimedValue[]|undefined,hour:number)=>values?.find(item=>item.periodo&&intervalContains(item.periodo,hour))??closestInstant(values,hour);
const first=(value:Scalar|Scalar[]|undefined):Scalar|undefined=>Array.isArray(value)?value[0]??undefined:value??undefined;
const asNumber=(value:Scalar|Scalar[]|undefined)=>{const candidate=first(value);if(candidate===undefined||candidate===null||candidate==="")return undefined;const parsed=Number(candidate);return Number.isFinite(parsed)?parsed:undefined};
const compassDegrees=(value:string|string[]|undefined)=>{const candidate=Array.isArray(value)?value[0]:value;if(!candidate)return undefined;const map:Record<string,number>={N:0,NE:45,E:90,SE:135,S:180,SO:225,O:270,NO:315};return map[candidate]};
const wait=(milliseconds:number)=>new Promise(resolve=>setTimeout(resolve,milliseconds));

async function fetchWithRetry(url:string){
 for(let attempt=0;attempt<3;attempt+=1){
  const response=await fetch(url,{cache:"no-store"});
  if(response.ok||attempt===2||response.status!==429&&response.status<500)return response;
  const retryAfter=Number(response.headers.get("retry-after"));
  await wait(Number.isFinite(retryAfter)?Math.min(retryAfter*1000,10000):1000*(attempt+1));
 }
 throw new Error("AEMET no respondió");
}

async function loadWeather(municipality:string,code:string):Promise<WeatherResult|null>{
 const apiKey=process.env.AEMET_API_KEY;if(!apiKey)throw new Error("AEMET_API_KEY configured: false");
 const endpoint=`${API_BASE}/prediccion/especifica/municipio/horaria/${code}?api_key=${encodeURIComponent(apiKey)}`;
 const metadataResponse=await fetchWithRetry(endpoint);
 if(!metadataResponse.ok)throw new Error(`fase metadata · HTTP ${metadataResponse.status}`);
 const metadata=await metadataResponse.json() as MetadataResponse;
 if(!metadata.datos)throw new Error(`fase metadata · respuesta sin URL datos${metadata.estado?` · estado ${metadata.estado}`:""}`);
 const dataResponse=await fetchWithRetry(metadata.datos);
 if(!dataResponse.ok)throw new Error(`fase datos · HTTP ${dataResponse.status}`);
 const payload=await dataResponse.json() as AemetPayload[];
 const root=payload[0];const days=root?.prediccion?.dia??[];const local=localDateAndHour();const target=localDateAndHour(new Date(Date.now()+(local.minute>=30?3600000:0)));
 if(!days.length)throw new Error("fase parser · predicción sin días");
 const hourly=days.flatMap(day=>{const date=day.fecha?.slice(0,10);if(!date)return[];return Array.from({length:24},(_,hour)=>{const temperature=closestInstant(day.temperatura,hour);const rain=closestProbability(day.probPrecipitacion,hour);const windItems=day.vientoAndRachaMax;const wind=closestInstant(windItems?.filter(item=>item.velocidad!==undefined),hour);const gust=closestInstant(windItems?.filter(item=>item.value!==undefined),hour);return{time:`${date}T${String(hour).padStart(2,"0")}:00`,airTemperature:asNumber(temperature?.value),windSpeed:asNumber(wind?.velocidad),windGust:asNumber(gust?.value),windDirection:compassDegrees(wind?.direccion),rainProbability:asNumber(rain?.value)}})}).filter(point=>[point.airTemperature,point.windSpeed,point.windGust,point.windDirection,point.rainProbability].some(value=>value!==undefined));
 const targetTime=`${target.date}T${String(target.hour).padStart(2,"0")}:00`;const current=hourly.reduce<WeatherHour|undefined>((best,item)=>!best||Math.abs(Date.parse(`${item.time}:00Z`)-Date.parse(`${targetTime}:00Z`))<Math.abs(Date.parse(`${best.time}:00Z`)-Date.parse(`${targetTime}:00Z`))?item:best,undefined);
 const result:WeatherResult={airTemperature:current?.airTemperature,windSpeed:current?.windSpeed,windGust:current?.windGust,windDirection:current?.windDirection,rainProbability:current?.rainProbability,hourly,updatedAt:root?.elaborado??root?.origen?.elaborado,validFor:current?.time,source:"AEMET OpenData",sourceUrl:SOURCE_URL};
 if([result.airTemperature,result.windSpeed,result.windGust,result.windDirection,result.rainProbability].every(value=>value===undefined))throw new Error("fase parser · sin métricas utilizables");
 console.info(`[AEMET] ${municipality}: OK`);
 return result;
}

const getCachedWeather=unstable_cache(loadWeather,["aemet-municipal-hourly-v4"],{revalidate:CACHE_SECONDS,tags:["aemet-weather"]});
const inFlight=new Map<string,Promise<WeatherResult|null>>();
let requestQueue:Promise<unknown>=Promise.resolve();

function schedule<T>(task:()=>Promise<T>){
 const run=requestQueue.then(task,task);
 requestQueue=run.then(()=>wait(250),()=>wait(250));
 return run;
}

export async function getWeather(municipality:string):Promise<WeatherResult|null>{
 const apiKeyConfigured=Boolean(process.env.AEMET_API_KEY);const code=AEMET_MUNICIPALITY_CODES[municipality];
 if(!apiKeyConfigured){console.error(`[AEMET] ${municipality}: ERROR AEMET_API_KEY configured: false`);return null}
 if(!code){console.error(`[AEMET] ${municipality}: ERROR municipio sin código AEMET`);return null}
 const pending=inFlight.get(code);if(pending)return pending;
 const request=schedule(()=>getCachedWeather(municipality,code)).catch(error=>{console.error(`[AEMET] ${municipality}: ERROR ${error instanceof Error?error.message:"desconocido"}`);return null}).finally(()=>inFlight.delete(code));
 inFlight.set(code,request);return request;
}
