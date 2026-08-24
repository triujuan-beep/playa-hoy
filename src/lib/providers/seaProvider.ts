import "server-only";

const API_URL="https://marine-api.open-meteo.com/v1/marine";
export const OPEN_METEO_MARINE_DOCS="https://open-meteo.com/en/docs/marine-weather-api";
export const OPEN_METEO_ATTRIBUTION_URL="https://open-meteo.com/";
export const MARINE_CACHE_SECONDS=1800;
export const MARINE_BATCH_SIZE=20;
const TIMEZONE="Europe/Madrid";
const HOURLY_VARIABLES=[
 "sea_surface_temperature","wave_height","wave_direction","wave_period",
 "swell_wave_height","swell_wave_direction","swell_wave_period",
 "ocean_current_velocity","ocean_current_direction",
] as const;

export type MarineBeach={id:string;latitude:number;longitude:number};
export type SeaResult={
 waterTemperature?:number;waveHeight?:number;waveDirection?:number;wavePeriod?:number;
 swellWaveHeight?:number;swellWaveDirection?:number;swellWavePeriod?:number;
 oceanCurrentVelocity?:number;oceanCurrentDirection?:number;
 validFor?:string;source:string;sourceUrl:string;
};
type Hourly={time?:string[];sea_surface_temperature?:Array<number|null>;wave_height?:Array<number|null>;wave_direction?:Array<number|null>;wave_period?:Array<number|null>;swell_wave_height?:Array<number|null>;swell_wave_direction?:Array<number|null>;swell_wave_period?:Array<number|null>;ocean_current_velocity?:Array<number|null>;ocean_current_direction?:Array<number|null>};
type MarineResponse={location_id?:number;hourly?:Hourly};

function localIsoHour(now:Date,timeZone:string){
 const parts=new Intl.DateTimeFormat("en-CA",{timeZone,year:"numeric",month:"2-digit",day:"2-digit",hour:"2-digit",minute:"2-digit",hourCycle:"h23"}).formatToParts(now);
 const part=(type:Intl.DateTimeFormatPartTypes)=>parts.find(item=>item.type===type)?.value??"00";
 return `${part("year")}-${part("month")}-${part("day")}T${part("hour")}:${part("minute")}`;
}

export function getClosestHourlyIndex(times:string[],now=new Date(),timeZone=TIMEZONE){
 if(!times.length)return -1;
 const target=Date.parse(`${localIsoHour(now,timeZone)}:00Z`);
 return times.reduce((best,time,index)=>Math.abs(Date.parse(`${time}:00Z`)-target)<Math.abs(Date.parse(`${times[best]}:00Z`)-target)?index:best,0);
}

const valueAt=(values:Array<number|null>|undefined,index:number)=>{const value=values?.[index];return typeof value==="number"&&Number.isFinite(value)?value:undefined};

function normalize(response:MarineResponse):SeaResult|null{
 const hourly=response.hourly;const times=hourly?.time??[];const index=getClosestHourlyIndex(times);
 if(!hourly||index<0)return null;
 const result:SeaResult={
  waterTemperature:valueAt(hourly.sea_surface_temperature,index),waveHeight:valueAt(hourly.wave_height,index),waveDirection:valueAt(hourly.wave_direction,index),wavePeriod:valueAt(hourly.wave_period,index),
  swellWaveHeight:valueAt(hourly.swell_wave_height,index),swellWaveDirection:valueAt(hourly.swell_wave_direction,index),swellWavePeriod:valueAt(hourly.swell_wave_period,index),
  oceanCurrentVelocity:valueAt(hourly.ocean_current_velocity,index),oceanCurrentDirection:valueAt(hourly.ocean_current_direction,index),
  validFor:times[index],source:"Open-Meteo Marine · DWD",sourceUrl:OPEN_METEO_MARINE_DOCS,
 };
 return result.waterTemperature!==undefined||result.waveHeight!==undefined?result:null;
}

async function fetchBatch(beaches:MarineBeach[]){
 const params=new URLSearchParams({
  latitude:beaches.map(beach=>beach.latitude).join(","),longitude:beaches.map(beach=>beach.longitude).join(","),
  hourly:HOURLY_VARIABLES.join(","),forecast_days:"2",timezone:TIMEZONE,cell_selection:"sea",
 });
 const response=await fetch(`${API_URL}?${params}`,{next:{revalidate:MARINE_CACHE_SECONDS,tags:["open-meteo-marine"]}});
 if(!response.ok)throw new Error(`Open-Meteo Marine ${response.status}`);
 const payload=await response.json() as MarineResponse|MarineResponse[];
 return Array.isArray(payload)?payload:[payload];
}

export async function getMarineForecastForBeaches(beaches:MarineBeach[]):Promise<Record<string,SeaResult>>{
 const result:Record<string,SeaResult>={};
 try{
  for(let start=0;start<beaches.length;start+=MARINE_BATCH_SIZE){
   const batch=beaches.slice(start,start+MARINE_BATCH_SIZE);const responses=await fetchBatch(batch);
   responses.forEach((response,index)=>{const beach=batch[response.location_id??index];const normalized=normalize(response);if(beach&&normalized)result[beach.id]=normalized});
  }
 }catch(error){console.error("[seaProvider] No se pudieron cargar predicciones de Open-Meteo Marine",error instanceof Error?error.message:"Error desconocido")}
 return result;
}
