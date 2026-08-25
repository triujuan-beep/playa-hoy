import "server-only";
import { unstable_cache } from "next/cache";
import type { Beach,JellyfishObservation } from "../types";
import { aggregateMedusAppReports,MEDUSAPP_RADIUS_KM,MEDUSAPP_WINDOW_HOURS,parseMedusAppFeatureCollection,unknownMedusAppObservation } from "./medusAppCore";

export const MEDUSAPP_SOURCE_URL="https://www.medusapp.net/acercade.html";
export const MEDUSAPP_LICENSE="CC BY-NC-SA 4.0";
const MAP_PAGE="https://www.medusapp.net/mapa/mapa-portada.php";
const ENDPOINT="https://www.medusapp.net/php/consultaMedusas.php";
const CACHE_SECONDS=30*60;
const TIMEOUT_MS=20_000;
let sessionPromise:Promise<string>|null=null;
const inFlight=new Map<string,Promise<JellyfishObservation>>();
const seenFetches=new Map<string,string>();

class MedusAppHttpError extends Error{constructor(readonly status:number){super(`HTTP ${status}`)}}
const pause=(milliseconds:number)=>new Promise(resolve=>setTimeout(resolve,milliseconds));
const dateInMadrid=(date:Date)=>new Intl.DateTimeFormat("sv-SE",{timeZone:"Europe/Madrid",year:"numeric",month:"2-digit",day:"2-digit"}).format(date);

async function warmSession(){
 if(sessionPromise)return sessionPromise;
 sessionPromise=(async()=>{const response=await fetch(MAP_PAGE,{cache:"no-store",headers:{"User-Agent":"Playa-Hoy/1.0"},signal:AbortSignal.timeout(TIMEOUT_MS)});if(!response.ok)throw new MedusAppHttpError(response.status);const raw=response.headers.get("set-cookie")??"";const cookie=raw.split(/,(?=[^;,\s]+=)/).map(value=>value.split(";",1)[0]?.trim()).filter(Boolean).join("; ");if(!cookie)throw new Error("MedusApp session cookie missing");return cookie})().catch(error=>{sessionPromise=null;throw error});
 return sessionPromise;
}

async function requestObservation(id:string,latitude:number,longitude:number):Promise<JellyfishObservation>{
 const now=new Date();const from=new Date(now.getTime()-MEDUSAPP_WINDOW_HOURS*3_600_000);let lastError:unknown;
 for(let attempt=0;attempt<2;attempt++)try{
  const cookie=await warmSession();const parameters=new URLSearchParams({especie:"",fechaIni:dateInMadrid(from),fechaFin:dateInMadrid(now),idioma:"es",versionApp:"web",dispositivo:"web",playaLat:latitude.toFixed(6),playaLon:longitude.toFixed(6),radio:String(MEDUSAPP_RADIUS_KM)});
  const response=await fetch(`${ENDPOINT}?${parameters}`,{cache:"no-store",headers:{Cookie:cookie,Referer:MAP_PAGE,"User-Agent":"Playa-Hoy/1.0"},signal:AbortSignal.timeout(TIMEOUT_MS)});if(!response.ok)throw new MedusAppHttpError(response.status);const payload:unknown=await response.json();if(payload&&typeof payload==="object"&&"error" in payload){if(attempt===0){sessionPromise=null;continue}throw new Error("MedusApp JSON error")};const observation=aggregateMedusAppReports(parseMedusAppFeatureCollection(payload),{latitude,longitude},now);console.info(`[MedusApp] request OK · beach ${id}`);return observation;
 }catch(error){lastError=error;if(error instanceof MedusAppHttpError&&error.status===429)break;if(error instanceof MedusAppHttpError&&error.status<500)break;if(attempt===0)await pause(500)}
 if(lastError instanceof DOMException&&lastError.name==="TimeoutError")console.error(`[MedusApp] timeout · beach ${id}`);else if(lastError instanceof MedusAppHttpError)console.error(`[MedusApp] HTTP ${lastError.status} · beach ${id}`);else if(lastError instanceof Error&&lastError.message.includes("GeoJSON"))console.error(`[MedusApp] parser error · beach ${id}`);else console.error(`[MedusApp] request failed · beach ${id}`,lastError instanceof Error?lastError.message:"Unknown error");throw lastError;
}

const cachedObservation=unstable_cache(requestObservation,["medusapp-observation-v1"],{revalidate:CACHE_SECONDS,tags:["medusapp-observations"]});

async function getObservation(beach:Pick<Beach,"id"|"latitude"|"longitude">){
 const key=`${beach.id}:${beach.latitude.toFixed(4)}:${beach.longitude.toFixed(4)}`;const current=inFlight.get(key);if(current)return current;
 const promise=cachedObservation(beach.id,beach.latitude,beach.longitude).then(observation=>{if(seenFetches.get(key)===observation.updatedAt)console.info(`[MedusApp] cache HIT · beach ${beach.id}`);seenFetches.set(key,observation.updatedAt);return observation}).finally(()=>inFlight.delete(key));inFlight.set(key,promise);return promise;
}

export async function getMedusAppObservationsForBeaches(beaches:Pick<Beach,"id"|"latitude"|"longitude">[]):Promise<Record<string,JellyfishObservation>>{
 const result:Record<string,JellyfishObservation>={};for(let index=0;index<beaches.length;index+=4){const batch=beaches.slice(index,index+4);const settled=await Promise.allSettled(batch.map(getObservation));settled.forEach((item,itemIndex)=>{result[batch[itemIndex].id]=item.status==="fulfilled"?item.value:unknownMedusAppObservation()});if(index+4<beaches.length)await pause(200)}return result;
}
