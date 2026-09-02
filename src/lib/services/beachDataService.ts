import "server-only";
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
import { assertWeatherCoverage,requireSharedSnapshotForBuild,weatherCoverageRejection } from "../snapshot-policy";
import { readPreviewBootstrapSeed,type BeachDataSnapshot } from "../preview-bootstrap-seed";

export type { BeachDataSnapshot } from "../preview-bootstrap-seed";
type BeachDataSnapshotManifest={version:1;referenceTime:string;refreshedAt:string;chunkKeys:string[]};
const PREVIEW_SNAPSHOT_SCOPE=process.env.VERCEL_ENV==="preview"&&process.env.PLAYA_HOY_PREVIEW_SEED_ID?`:preview:${process.env.PLAYA_HOY_PREVIEW_SEED_ID}`:"";
const SNAPSHOT_KEY=`all-beaches-v22-63${PREVIEW_SNAPSHOT_SCOPE}`;
const SNAPSHOT_MANIFEST_KEY=`${SNAPSHOT_KEY}:manifest`;
const SNAPSHOT_CHUNK_SIZE=8;
const SNAPSHOT_REFRESH_SECONDS=15*60;
const SNAPSHOT_TTL_SECONDS=7*24*60*60;
const WEATHER_MUNICIPALITIES=[...new Set(catalog.map(beach=>beach.municipality))];
let memorySnapshot:BeachDataSnapshot|undefined;
let refreshInFlight:Promise<void>|null=null;

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

async function createSnapshot(previous?:BeachDataSnapshot):Promise<BeachDataSnapshot>{if(process.env.NEXT_PHASE==="phase-production-build")throw new Error("No cached beach snapshot is available during production build; aborting without calling providers.");const beaches=await loadRealData(previous?.beaches);const referenceTime=new Date().toISOString();return{beaches,referenceTime,refreshedAt:referenceTime}}
const getSeedSnapshot=unstable_cache(async()=>createSnapshot(),["playa-hoy-beach-snapshot-seed-v21-63"],{revalidate:false,tags:["playa-hoy-beach-snapshot-seed"]});
function isSnapshot(value:unknown):value is BeachDataSnapshot{if(!value||typeof value!=="object")return false;const snapshot=value as BeachDataSnapshot;return typeof snapshot.referenceTime==="string"&&typeof snapshot.refreshedAt==="string"&&Array.isArray(snapshot.beaches)&&snapshot.beaches.length===catalog.length&&snapshot.beaches.every((beach,index)=>beach.id===catalog[index].id)}
function isSnapshotManifest(value:unknown):value is BeachDataSnapshotManifest{if(!value||typeof value!=="object")return false;const manifest=value as BeachDataSnapshotManifest;return manifest.version===1&&typeof manifest.referenceTime==="string"&&typeof manifest.refreshedAt==="string"&&Array.isArray(manifest.chunkKeys)&&manifest.chunkKeys.length>0&&manifest.chunkKeys.every(key=>typeof key==="string")}
function isBeachChunk(value:unknown):value is Beach[]{return Array.isArray(value)&&value.every(beach=>beach&&typeof beach==="object"&&typeof (beach as Beach).id==="string")}
async function readRuntimeSnapshot(){try{const cache=getCache({namespace:"playa-hoy"});const manifestValue=await cache.get(SNAPSHOT_MANIFEST_KEY);if(!isSnapshotManifest(manifestValue))return memorySnapshot;const chunks=await Promise.all(manifestValue.chunkKeys.map(key=>cache.get(key)));if(!chunks.every(isBeachChunk))return memorySnapshot;const snapshot:BeachDataSnapshot={beaches:chunks.flat(),referenceTime:manifestValue.referenceTime,refreshedAt:manifestValue.refreshedAt};if(isSnapshot(snapshot)){memorySnapshot=snapshot;return snapshot}}catch(error){console.warn("[beachSnapshot] Runtime Cache read failed",error instanceof Error?error.message:"error desconocido")}return memorySnapshot}
async function persistRuntimeSnapshot(snapshot:BeachDataSnapshot,{onlyIfEmpty=false}:{onlyIfEmpty?:boolean}={}){const rejection=weatherCoverageRejection(snapshot,WEATHER_MUNICIPALITIES);if(rejection){console.warn("[beachSnapshot] candidate rejected; keeping last valid snapshot",rejection);return false}try{const cache=getCache({namespace:"playa-hoy"});if(onlyIfEmpty&&isSnapshotManifest(await cache.get(SNAPSHOT_MANIFEST_KEY))){console.info("[beachSnapshot] preview bootstrap skipped; shared manifest already exists");return false}const version=Date.parse(snapshot.refreshedAt).toString(36);const chunks=Array.from({length:Math.ceil(snapshot.beaches.length/SNAPSHOT_CHUNK_SIZE)},(_,index)=>snapshot.beaches.slice(index*SNAPSHOT_CHUNK_SIZE,(index+1)*SNAPSHOT_CHUNK_SIZE));const chunkKeys=chunks.map((_,index)=>`${SNAPSHOT_KEY}:${version}:${index}`);await Promise.all(chunks.map((chunk,index)=>cache.set(chunkKeys[index],chunk,{ttl:SNAPSHOT_TTL_SECONDS,tags:["beach-data-snapshot"],name:`Playa Hoy beach data snapshot ${index+1}/${chunks.length}`})));const manifest:BeachDataSnapshotManifest={version:1,referenceTime:snapshot.referenceTime,refreshedAt:snapshot.refreshedAt,chunkKeys};await cache.set(SNAPSHOT_MANIFEST_KEY,manifest,{ttl:SNAPSHOT_TTL_SECONDS,tags:["beach-data-snapshot"],name:"Playa Hoy beach data snapshot manifest"});memorySnapshot=snapshot;return true}catch(error){console.warn("[beachSnapshot] Runtime Cache write failed",error instanceof Error?error.message:"error desconocido");return false}}
function needsRefresh(snapshot:BeachDataSnapshot){return Date.now()-Date.parse(snapshot.refreshedAt)>=SNAPSHOT_REFRESH_SECONDS*1000}
async function refreshSnapshot(previous:BeachDataSnapshot){if(refreshInFlight)return refreshInFlight;refreshInFlight=(async()=>{const startedAt=Date.now();try{const fresh=await createSnapshot(previous);const published=await persistRuntimeSnapshot(fresh);if(published)console.info(`[beachSnapshot] refreshed ${fresh.beaches.length} beaches · ${Date.now()-startedAt} ms`)}catch(error){console.error("[beachSnapshot] refresh failed; keeping last valid snapshot",error instanceof Error?error.message:"error desconocido")}finally{refreshInFlight=null}})();return refreshInFlight}

export const getAllBeachesSnapshot=cache(async():Promise<BeachDataSnapshot>=>{
 if(process.env.USE_MOCK_DATA?.toLowerCase()!=="false"){const referenceTime=new Date().toISOString();return{beaches:catalog.map(asMock),referenceTime,refreshedAt:referenceTime}}
 let snapshot=await readRuntimeSnapshot();
 if(process.env.NEXT_PHASE==="phase-production-build"){snapshot=snapshot??readPreviewBootstrapSeed()??await getSeedSnapshot();assertWeatherCoverage(snapshot,WEATHER_MUNICIPALITIES);return requireSharedSnapshotForBuild(snapshot)}
 if(!snapshot){const previewSeed=readPreviewBootstrapSeed();snapshot=previewSeed??await getSeedSnapshot();await persistRuntimeSnapshot(snapshot,{onlyIfEmpty:Boolean(previewSeed)})}
 return snapshot;
});
// Home is the single ISR coordinator. Other routes consume the shared stale snapshot while it refreshes.
export function scheduleBeachDataRefresh(snapshot:BeachDataSnapshot){if(process.env.NEXT_PHASE!=="phase-production-build"&&process.env.USE_MOCK_DATA?.toLowerCase()==="false"&&needsRefresh(snapshot))after(()=>refreshSnapshot(snapshot))}
export const getAllBeachesData=cache(async()=>(await getAllBeachesSnapshot()).beaches);
export const getBeachData=cache(async(idOrSlug:string)=>(await getAllBeachesData()).find(beach=>beach.id===idOrSlug||beach.slug===idOrSlug||beach.legacySlugs?.includes(idOrSlug))??null);
export const getBeachSnapshot=cache(async(idOrSlug:string)=>{const snapshot=await getAllBeachesSnapshot();return{beach:snapshot.beaches.find(beach=>beach.id===idOrSlug||beach.slug===idOrSlug||beach.legacySlugs?.includes(idOrSlug))??null,referenceTime:snapshot.referenceTime}});
