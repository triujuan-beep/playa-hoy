import "server-only";
import { randomUUID } from "node:crypto";
import { getCache } from "@vercel/functions";
import { unstable_cache } from "next/cache";
import { after } from "next/server";
import { cache } from "react";
import { beaches as catalog } from "../mock-beaches";
import { calculateDataCompleteness } from "../scoring";
import type { Beach,BeachHourlyConditions,DataSourceInfo,MetricMetadata } from "../types";
import { getWeather,type WeatherResult } from "../providers/weatherProvider";
import { getMarineForecastForBeaches,OPEN_METEO_MARINE_DOCS,type SeaResult } from "../providers/seaProvider";
import { getAllSanitaryStatuses } from "../providers/sanitaryProvider";
import { getMedusAppObservationsForBeaches,MEDUSAPP_LICENSE,MEDUSAPP_SOURCE_URL } from "../providers/medusAppProvider";

export type BeachDataSnapshot={beaches:Beach[];referenceTime:string;refreshedAt:string};
const SNAPSHOT_KEY="all-beaches-v21-63";
const SNAPSHOT_REFRESH_LOCK_KEY=`${SNAPSHOT_KEY}:refresh-lock`;
const SNAPSHOT_REFRESH_SECONDS=15*60;
const SNAPSHOT_TTL_SECONDS=7*24*60*60;
const SNAPSHOT_REFRESH_LOCK_SECONDS=5*60;
const SNAPSHOT_REFRESH_LOCK_SETTLE_MS=250;
const SNAPSHOT_REFRESH_LOCK_CONFIRM_ATTEMPTS=8;
const SNAPSHOT_REFRESH_POLL_MS=500;
const SNAPSHOT_REFRESH_WAIT_MS=4*60*1000;
let memorySnapshot:BeachDataSnapshot|undefined;
let refreshInFlight:Promise<void>|null=null;
let seedInFlight:Promise<BeachDataSnapshot>|null=null;
type SnapshotRefreshLock={token:string;expiresAt:number};

const mockSource=(label:string):DataSourceInfo=>({state:"mock",origin:"unknown",label,source:"Datos de demostración"});
function asMock(beach:Beach):Beach{return{...beach,dataMode:"mock",dataCompleteness:100,sources:{weather:mockSource("Meteorología"),sea:mockSource("Estado del mar"),sanitary:mockSource("Estado sanitario"),jellyfish:mockSource("Medusas"),occupancy:mockSource("Ocupación")}}}

function previousWeather(municipality:string,previous:Beach[]|undefined):WeatherResult|undefined{
 const beach=previous?.find(item=>item.municipality===municipality&&item.sources?.weather?.state!=="unavailable");if(!beach)return undefined;
 return{airTemperature:beach.airTemperature,windSpeed:beach.windSpeed,windGust:beach.windGust,windDirection:beach.windDirection,rainProbability:beach.rainProbability,hourly:(beach.hourlyConditions??[]).map(item=>({time:item.time,airTemperature:item.airTemperature,windSpeed:item.windSpeed,windGust:item.windGust,windDirection:item.windDirection,rainProbability:item.rainProbability})),updatedAt:beach.sources?.weather?.updatedAt,validFor:beach.sources?.weather?.validFor,source:beach.sources?.weather?.source??"AEMET OpenData",sourceUrl:beach.sources?.weather?.sourceUrl??"https://opendata.aemet.es/dist/index.html",stale:true};
}

function previousSea(id:string,previous:Beach[]|undefined):SeaResult|undefined{
 const beach=previous?.find(item=>item.id===id&&item.sources?.sea?.state!=="unavailable");if(!beach)return undefined;
 return{waterTemperature:beach.waterTemperature,waveHeight:beach.waveHeight,waveDirection:beach.waveDirection,wavePeriod:beach.wavePeriod,swellWaveHeight:beach.swellWaveHeight,swellWaveDirection:beach.swellWaveDirection,swellWavePeriod:beach.swellWavePeriod,oceanCurrentVelocity:beach.oceanCurrentVelocity,oceanCurrentDirection:beach.oceanCurrentDirection,hourly:(beach.hourlyConditions??[]).map(item=>({time:item.time,waterTemperature:item.waterTemperature,waveHeight:item.waveHeight,waveDirection:item.waveDirection,wavePeriod:item.wavePeriod,swellWaveHeight:item.swellWaveHeight,swellWaveDirection:item.swellWaveDirection,swellWavePeriod:item.swellWavePeriod,oceanCurrentVelocity:item.oceanCurrentVelocity,oceanCurrentDirection:item.oceanCurrentDirection})),validFor:beach.sources?.sea?.validFor,source:beach.sources?.sea?.source??"Open-Meteo Marine · DWD",sourceUrl:beach.sources?.sea?.sourceUrl??OPEN_METEO_MARINE_DOCS};
}

async function loadRealData(previous?:Beach[]):Promise<Beach[]> {
 const municipalities=[...new Set(catalog.map(beach=>beach.municipality))];
 const weatherPromise=(async()=>{const startedAt=Date.now();const entries=await Promise.all(municipalities.map(async municipality=>[municipality,await getWeather(municipality)] as const));console.info(`[AEMET] ${municipalities.length} municipios resueltos · ${Date.now()-startedAt} ms`);return entries})();
 const [weatherEntries,marineLive,sanitary,jellyfishByBeach]=await Promise.all([weatherPromise,getMarineForecastForBeaches(catalog),getAllSanitaryStatuses(catalog.map(beach=>beach.id)),getMedusAppObservationsForBeaches(catalog)]);
 const weatherByMunicipality=new Map(weatherEntries);
 return catalog.map(base=>{
  const liveWeather=weatherByMunicipality.get(base.municipality);const weather=liveWeather??previousWeather(base.municipality,previous);
  const liveSea=marineLive[base.id];const sea=liveSea??previousSea(base.id,previous);const seaStale=!liveSea&&Boolean(sea);
  const health=sanitary[base.id];const jellyfish=jellyfishByBeach[base.id];
  const weatherHours=new Map(weather?.hourly.map(item=>[item.time.slice(0,16),item])??[]);const seaHours=new Map(sea?.hourly.map(item=>[item.time.slice(0,16),item])??[]);const times=[...new Set([...weatherHours.keys(),...seaHours.keys()])].sort();
  const hourlyConditions:BeachHourlyConditions[]=times.map(time=>{const weatherHour=weatherHours.get(time);const seaHour=seaHours.get(time);return{time,airTemperature:weatherHour?.airTemperature,windSpeed:weatherHour?.windSpeed,windGust:weatherHour?.windGust,windDirection:weatherHour?.windDirection,rainProbability:weatherHour?.rainProbability,waterTemperature:seaHour?.waterTemperature,waveHeight:seaHour?.waveHeight,waveDirection:seaHour?.waveDirection,wavePeriod:seaHour?.wavePeriod,swellWaveHeight:seaHour?.swellWaveHeight,swellWaveDirection:seaHour?.swellWaveDirection,swellWavePeriod:seaHour?.swellWavePeriod,oceanCurrentVelocity:seaHour?.oceanCurrentVelocity,oceanCurrentDirection:seaHour?.oceanCurrentDirection}});
  const weatherMeta:MetricMetadata={origin:weather?"forecast":"unknown",source:"AEMET OpenData",sourceUrl:"https://opendata.aemet.es/dist/index.html",updatedAt:weather?.updatedAt,validFor:weather?.validFor,stale:weather?.stale,note:weather?.stale?"Último dato válido conservado temporalmente por un fallo de AEMET.":undefined};
  const seaMeta:MetricMetadata={origin:sea?"forecast":"unknown",source:"Open-Meteo Marine",sourceUrl:OPEN_METEO_MARINE_DOCS,validFor:sea?.validFor,stale:seaStale,note:seaStale?"Último dato válido conservado temporalmente por un fallo de Open-Meteo.":undefined};
  const sanitaryMeta:MetricMetadata={origin:health.status==="unknown"?"unknown":"observed",source:health.source,sourceUrl:health.sourceUrl,updatedAt:health.updatedAt,validFor:health.effectiveUntil};
  const jellyfishMeta:MetricMetadata={origin:jellyfish.status==="unknown"?"unknown":"observed",source:`MedusApp · ${MEDUSAPP_LICENSE}`,sourceUrl:MEDUSAPP_SOURCE_URL,updatedAt:jellyfish.updatedAt,stale:jellyfish.stale,note:jellyfish.stale?"Última observación válida conservada temporalmente por un fallo de MedusApp.":undefined};
  const unknownMeta:MetricMetadata={origin:"unknown"};
  const beach:Beach={id:base.id,slug:base.slug,legacySlugs:base.legacySlugs,aliases:base.aliases,name:base.name,municipality:base.municipality,province:base.province,autonomousCommunity:base.autonomousCommunity,coastZone:base.coastZone,latitude:base.latitude,longitude:base.longitude,
   airTemperature:weather?.airTemperature,windSpeed:weather?.windSpeed,windGust:weather?.windGust,windDirection:weather?.windDirection,rainProbability:weather?.rainProbability,
   waterTemperature:sea?.waterTemperature,waveHeight:sea?.waveHeight,waveDirection:sea?.waveDirection,wavePeriod:sea?.wavePeriod,swellWaveHeight:sea?.swellWaveHeight,swellWaveDirection:sea?.swellWaveDirection,swellWavePeriod:sea?.swellWavePeriod,oceanCurrentVelocity:sea?.oceanCurrentVelocity,oceanCurrentDirection:sea?.oceanCurrentDirection,
   sanitaryStatus:health.status,sanitaryMessage:health.message,sanitaryZone:health.sanitaryZone,sanitaryAssociation:health.sanitaryAssociation,sanitaryEffectiveFrom:health.effectiveFrom,sanitaryEffectiveUntil:health.effectiveUntil,jellyfishObservation:jellyfish,dataMode:"real",hourlyConditions,
   metricMetadata:{waterTemperature:seaMeta,waveHeight:seaMeta,waveDirection:seaMeta,wavePeriod:seaMeta,swellWaveHeight:seaMeta,swellWaveDirection:seaMeta,swellWavePeriod:seaMeta,oceanCurrentVelocity:seaMeta,oceanCurrentDirection:seaMeta,airTemperature:weatherMeta,windSpeed:weatherMeta,windGust:weatherMeta,rainProbability:weatherMeta,sanitaryStatus:sanitaryMeta,jellyfishRisk:jellyfishMeta,occupancy:unknownMeta},
   sources:{
    weather:weather?{state:"live",origin:"forecast",label:"Meteorología",source:weather.source,sourceUrl:weather.sourceUrl,updatedAt:weather.updatedAt,validFor:weather.validFor,stale:weather.stale,message:weather.stale?"Se muestra el último dato válido mientras AEMET vuelve a estar disponible.":undefined}:{state:"unavailable",origin:"unknown",label:"Meteorología",source:"AEMET OpenData",sourceUrl:"https://opendata.aemet.es/dist/index.html",message:process.env.AEMET_API_KEY?"AEMET no respondió con datos utilizables.":"Falta configurar AEMET_API_KEY."},
    sea:sea?{state:"live",origin:"forecast",label:"Estado del mar",source:sea.source,sourceUrl:sea.sourceUrl,validFor:sea.validFor,stale:seaStale,message:seaStale?"Se muestra el último dato válido mientras Open-Meteo vuelve a estar disponible.":undefined}:{state:"unavailable",origin:"unknown",label:"Estado del mar",source:"Open-Meteo Marine",sourceUrl:OPEN_METEO_MARINE_DOCS,message:"Open-Meteo no respondió con una predicción marina utilizable."},
    sanitary:{state:health.status==="unknown"?"unavailable":"manual",origin:health.status==="unknown"?"unknown":"observed",label:"Estado sanitario",source:health.source,sourceUrl:health.sourceUrl,updatedAt:health.updatedAt,validFor:health.effectiveUntil,message:health.status==="unknown"?health.message:undefined},
    jellyfish:jellyfish.status==="unknown"?{state:"unavailable",origin:"unknown",sourceType:"crowdsourced",label:"Medusas",source:`MedusApp · ${MEDUSAPP_LICENSE}`,sourceUrl:MEDUSAPP_SOURCE_URL,updatedAt:jellyfish.updatedAt,message:"MedusApp no respondió con datos utilizables."}:{state:"live",origin:"observed",sourceType:"crowdsourced",label:"Medusas",source:`MedusApp · ${MEDUSAPP_LICENSE}`,sourceUrl:MEDUSAPP_SOURCE_URL,updatedAt:jellyfish.updatedAt,stale:jellyfish.stale,message:jellyfish.stale?"Se muestra la última observación válida mientras MedusApp vuelve a estar disponible.":undefined},
    occupancy:{state:"coming-soon",origin:"unknown",label:"Ocupación",message:"Fuente en proceso de integración."},
   }};
  beach.dataCompleteness=calculateDataCompleteness(beach);return beach;
 });
}

async function createSnapshot(previous?:BeachDataSnapshot):Promise<BeachDataSnapshot>{const beaches=await loadRealData(previous?.beaches);const referenceTime=new Date().toISOString();return{beaches,referenceTime,refreshedAt:referenceTime}}
const getSeedSnapshot=unstable_cache(async()=>createSnapshot(),["playa-hoy-beach-snapshot-seed-v21-63"],{revalidate:false,tags:["playa-hoy-beach-snapshot-seed"]});
function isSnapshot(value:unknown):value is BeachDataSnapshot{if(!value||typeof value!=="object")return false;const snapshot=value as BeachDataSnapshot;return typeof snapshot.referenceTime==="string"&&typeof snapshot.refreshedAt==="string"&&Array.isArray(snapshot.beaches)&&snapshot.beaches.length===catalog.length&&snapshot.beaches.every((beach,index)=>beach.id===catalog[index].id)}
async function readRuntimeSnapshot(){try{const value=await getCache({namespace:"playa-hoy"}).get(SNAPSHOT_KEY);if(isSnapshot(value))return value}catch(error){console.warn("[beachSnapshot] Runtime Cache read failed",error instanceof Error?error.message:"error desconocido")}return memorySnapshot}
async function persistRuntimeSnapshot(snapshot:BeachDataSnapshot){memorySnapshot=snapshot;try{await getCache({namespace:"playa-hoy"}).set(SNAPSHOT_KEY,snapshot,{ttl:SNAPSHOT_TTL_SECONDS,tags:["beach-data-snapshot"],name:"Playa Hoy beach data snapshot"})}catch(error){console.warn("[beachSnapshot] Runtime Cache write failed",error instanceof Error?error.message:"error desconocido")}}
function needsRefresh(snapshot:BeachDataSnapshot){return Date.now()-Date.parse(snapshot.refreshedAt)>=SNAPSHOT_REFRESH_SECONDS*1000}
const sleep=(milliseconds:number)=>new Promise(resolve=>setTimeout(resolve,milliseconds));
function isRefreshLock(value:unknown):value is SnapshotRefreshLock{if(!value||typeof value!=="object")return false;const lock=value as SnapshotRefreshLock;return typeof lock.token==="string"&&typeof lock.expiresAt==="number"}
async function readRefreshLock(){try{const value=await getCache({namespace:"playa-hoy"}).get(SNAPSHOT_REFRESH_LOCK_KEY);return isRefreshLock(value)&&value.expiresAt>Date.now()?value:null}catch(error){console.warn("[beachSnapshot] refresh lock read failed",error instanceof Error?error.message:"error desconocido");return null}}
async function acquireRefreshLock(){
 const cache=getCache({namespace:"playa-hoy"});
 const existing=await readRefreshLock();if(existing)return null;
 const lock:SnapshotRefreshLock={token:randomUUID(),expiresAt:Date.now()+SNAPSHOT_REFRESH_LOCK_SECONDS*1000};
 try{
 await cache.set(SNAPSHOT_REFRESH_LOCK_KEY,lock,{ttl:SNAPSHOT_REFRESH_LOCK_SECONDS,tags:["beach-data-refresh-lock"],name:"Playa Hoy beach data refresh lock"});
  for(let attempt=0;attempt<SNAPSHOT_REFRESH_LOCK_CONFIRM_ATTEMPTS;attempt+=1){
   await sleep(SNAPSHOT_REFRESH_LOCK_SETTLE_MS);
   const winner=await readRefreshLock();
   if(winner)return winner.token===lock.token?lock:null;
  }
  console.warn("[beachSnapshot] refresh lock could not be confirmed");return null;
 }catch(error){console.warn("[beachSnapshot] refresh lock acquire failed",error instanceof Error?error.message:"error desconocido");return lock}
}
async function releaseRefreshLock(lock:SnapshotRefreshLock){try{const current=await readRefreshLock();if(current?.token===lock.token)await getCache({namespace:"playa-hoy"}).delete(SNAPSHOT_REFRESH_LOCK_KEY)}catch(error){console.warn("[beachSnapshot] refresh lock release failed",error instanceof Error?error.message:"error desconocido")}}
async function waitForCoordinatedRefresh(previousRefreshedAt:string){
 const deadline=Date.now()+SNAPSHOT_REFRESH_WAIT_MS;
 while(Date.now()<deadline){
  const snapshot=await readRuntimeSnapshot();
  if(snapshot&&Date.parse(snapshot.refreshedAt)>Date.parse(previousRefreshedAt)){memorySnapshot=snapshot;return true}
  if(!(await readRefreshLock()))return false;
  await sleep(SNAPSHOT_REFRESH_POLL_MS);
 }
 return false;
}
async function waitForCoordinatedSeed(){
 const deadline=Date.now()+SNAPSHOT_REFRESH_WAIT_MS;
 while(Date.now()<deadline){
  const snapshot=await readRuntimeSnapshot();if(snapshot){memorySnapshot=snapshot;return snapshot}
  if(!(await readRefreshLock()))return null;
  await sleep(SNAPSHOT_REFRESH_POLL_MS);
 }
 return null;
}
async function createCoordinatedSeed(){if(seedInFlight)return seedInFlight;seedInFlight=(async()=>{const lock=await acquireRefreshLock();if(!lock){const shared=await waitForCoordinatedSeed();if(shared){console.info("[beachSnapshot] reused coordinated seed");return shared}console.warn("[beachSnapshot] coordinated seed unavailable; using local fallback");return getSeedSnapshot()}try{const existing=await readRuntimeSnapshot();if(existing)return existing;const snapshot=await getSeedSnapshot();await persistRuntimeSnapshot(snapshot);console.info(`[beachSnapshot] seeded ${snapshot.beaches.length} beaches`);return snapshot}finally{await releaseRefreshLock(lock)}})().finally(()=>{seedInFlight=null});return seedInFlight}
async function refreshSnapshot(previous:BeachDataSnapshot){if(refreshInFlight)return refreshInFlight;refreshInFlight=(async()=>{const startedAt=Date.now();const lock=await acquireRefreshLock();if(!lock){const reused=await waitForCoordinatedRefresh(previous.refreshedAt);console.info(`[beachSnapshot] ${reused?"reused coordinated refresh":"coordinated refresh unavailable"}`);return}try{const latest=await readRuntimeSnapshot();if(latest&&!needsRefresh(latest)){memorySnapshot=latest;console.info("[beachSnapshot] refresh skipped; snapshot already updated");return}const fresh=await createSnapshot(latest??previous);await persistRuntimeSnapshot(fresh);console.info(`[beachSnapshot] refreshed ${fresh.beaches.length} beaches · ${Date.now()-startedAt} ms`)}catch(error){console.error("[beachSnapshot] refresh failed; keeping last valid snapshot",error instanceof Error?error.message:"error desconocido")}finally{await releaseRefreshLock(lock)}})().finally(()=>{refreshInFlight=null});return refreshInFlight}

export const getAllBeachesSnapshot=cache(async():Promise<BeachDataSnapshot>=>{
 if(process.env.USE_MOCK_DATA?.toLowerCase()!=="false"){const referenceTime=new Date().toISOString();return{beaches:catalog.map(asMock),referenceTime,refreshedAt:referenceTime}}
 let snapshot=await readRuntimeSnapshot();if(!snapshot)snapshot=await createCoordinatedSeed();
 return snapshot;
});
export function scheduleBeachDataRefresh(snapshot:BeachDataSnapshot){if(process.env.NEXT_PHASE!=="phase-production-build"&&process.env.USE_MOCK_DATA?.toLowerCase()==="false"&&needsRefresh(snapshot))after(()=>refreshSnapshot(snapshot))}
export const getAllBeachesData=cache(async()=>(await getAllBeachesSnapshot()).beaches);
export const getBeachData=cache(async(idOrSlug:string)=>(await getAllBeachesData()).find(beach=>beach.id===idOrSlug||beach.slug===idOrSlug||beach.legacySlugs?.includes(idOrSlug))??null);
export const getBeachSnapshot=cache(async(idOrSlug:string)=>{const snapshot=await getAllBeachesSnapshot();return{beach:snapshot.beaches.find(beach=>beach.id===idOrSlug||beach.slug===idOrSlug||beach.legacySlugs?.includes(idOrSlug))??null,referenceTime:snapshot.referenceTime}});
