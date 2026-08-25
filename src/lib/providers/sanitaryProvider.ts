import "server-only";
import records from "@/data/sanitary-status.json";
import type { SanitaryStatus } from "../types";

export type SanitaryResult={status:SanitaryStatus;message?:string;updatedAt?:string;source?:string;sourceUrl?:string;effectiveFrom?:string;effectiveUntil?:string};
type SanitaryRecord=Omit<SanitaryResult,"status">&{status:"safe"|"warning"|"closed"};
const SOURCE_URL="https://www.juntadeandalucia.es/organismos/presidenciasanidadyemergencias/areas/sanidad/entornos-saludables/salud-ambiental/paginas/zonas-bano.html";

function isCurrent(record:SanitaryRecord){const now=Date.now();if(record.effectiveFrom&&new Date(record.effectiveFrom).getTime()>now)return false;if(record.effectiveUntil&&new Date(record.effectiveUntil).getTime()<now)return false;return true}
async function loadRemote():Promise<Record<string,SanitaryRecord>>{const url=process.env.SANITARY_DATA_URL;if(!url)return{};try{const response=await fetch(url,{next:{revalidate:3600,tags:["sanitary-status"]}});if(!response.ok)throw new Error(`HTTP ${response.status}`);return await response.json() as Record<string,SanitaryRecord>}catch(error){console.error("[sanitaryProvider] No se pudo cargar el feed sanitario",error instanceof Error?error.message:"Error desconocido");return{}}}
function normalize(record?:SanitaryRecord):SanitaryResult{if(!record||!isCurrent(record))return{status:"unknown",message:"Sin dato sanitario individual reciente. Esta ausencia no implica una incidencia ni un cierre.",source:"Junta de Andalucía · Aguas de baño",sourceUrl:SOURCE_URL};return{...record,source:record.source??"Fuente oficial verificada",sourceUrl:record.sourceUrl}}
export async function getSanitaryStatus(beachId:string):Promise<SanitaryResult>{const remote=await loadRemote();return normalize(remote[beachId]??(records as Record<string,SanitaryRecord>)[beachId])}
export async function getAllSanitaryStatuses(beachIds:string[]):Promise<Record<string,SanitaryResult>>{const remote=await loadRemote();return Object.fromEntries(beachIds.map(id=>[id,normalize(remote[id]??(records as Record<string,SanitaryRecord>)[id])]))}
