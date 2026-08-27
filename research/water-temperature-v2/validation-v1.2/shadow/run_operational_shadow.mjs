#!/usr/bin/env node
import {createHash} from "node:crypto";
import {appendFile,readFile} from "node:fs/promises";
import {dirname,resolve} from "node:path";
import {fileURLToPath} from "node:url";
import {buildFreshSnapshot,buildUnknownSnapshot,summarize,writeSnapshotExclusive} from "./operational-shadow-core.mjs";

const root=resolve(dirname(fileURLToPath(import.meta.url)),"..");
const expectedHash="E5B251686A394A936C5440C20FC6095F73899E5C0A1D6022DB18A1EC6D43204F";
const detectorPath=resolve(root,"frozen","water-confidence-v1.2.mjs");
const actualHash=createHash("sha256").update(await readFile(detectorPath)).digest("hex").toUpperCase();
if(actualHash!==expectedHash)throw new Error(`frozen detector hash mismatch: expected ${expectedHash}, got ${actualHash}`);

const argument=name=>{const prefix=`--${name}=`;const inline=process.argv.find(value=>value.startsWith(prefix));if(inline)return inline.slice(prefix.length);const index=process.argv.indexOf(`--${name}`);return index>=0?process.argv[index+1]:undefined};
const executionDate=argument("execution-date"),copernicusPath=argument("copernicus-input"),previousPath=argument("previous-snapshot"),outputPath=argument("output");
if(!executionDate||!copernicusPath||!outputPath)throw new Error("execution-date, copernicus-input and output are required");
const generatedAt=new Date().toISOString();
const copernicusInput=JSON.parse(await readFile(copernicusPath,"utf8"));
let previousSourceDate=null;
if(previousPath){try{previousSourceDate=JSON.parse(await readFile(previousPath,"utf8")).lastValidSnapshot??null}catch(error){if(error.code!=="ENOENT")throw error}}
let snapshot;
if(copernicusInput.status!=="ok"){
 snapshot=buildUnknownSnapshot({executionDate,generatedAt,detectorHash:actualHash,copernicusInput,previousSourceDate,reason:"copernicus_provider_error",errors:[{provider:"Copernicus Marine Toolbox",code:"COPERNICUS_UNAVAILABLE",attempts:copernicusInput.attempts??[]}]});
}else if(copernicusInput.sourceAge>2){
 snapshot=buildUnknownSnapshot({executionDate,generatedAt,detectorHash:actualHash,copernicusInput,previousSourceDate,reason:"stale_copernicus_data"});
}else{
 const start=addDays(copernicusInput.sourceDate,-14),end=copernicusInput.sourceDate,coordinates={latitude:copernicusInput.points.map(item=>item.latitude).join(","),longitude:copernicusInput.points.map(item=>item.longitude).join(",")};
 const marineParams=new URLSearchParams({...coordinates,hourly:"sea_surface_temperature",start_date:start,end_date:end,timezone:"Europe/Madrid",cell_selection:"sea"});
 const windParams=new URLSearchParams({...coordinates,hourly:"wind_speed_10m,wind_direction_10m",start_date:start,end_date:end,timezone:"Europe/Madrid"});
 try{
  const [marineRaw,windRaw]=await Promise.all([fetchJson(`https://marine-api.open-meteo.com/v1/marine?${marineParams}`),fetchJson(`https://api.open-meteo.com/v1/forecast?${windParams}`)]);
  snapshot=buildFreshSnapshot({executionDate,generatedAt,detectorHash:actualHash,copernicusInput,marineRaw,windRaw});
 }catch(error){
  snapshot=buildUnknownSnapshot({executionDate,generatedAt,detectorHash:actualHash,copernicusInput,previousSourceDate,reason:"open_meteo_provider_error",errors:[{provider:"Open-Meteo",code:"OPEN_METEO_UNAVAILABLE",message:String(error.message).slice(0,300)}]});
 }
}
await writeSnapshotExclusive(outputPath,snapshot);
const counts=summarize(snapshot);
const summary=["## Water Confidence Shadow","",`Execution date: ${snapshot.executionDate}`,`Copernicus source date: ${snapshot.copernicusSourceDate??"unavailable"}`,`Source age: ${snapshot.sourceAge??"unknown"}`,`Detector hash: ${snapshot.detectorHash}`,`Points evaluated: ${snapshot.points.length}`,`Alerts: ${counts.alerts}`,`LOW: ${counts.LOW}`,`MEDIUM: ${counts.MEDIUM}`,`HIGH: ${counts.HIGH}`,`UNKNOWN: ${counts.UNKNOWN}`,`Errors: ${snapshot.errors.length?snapshot.errors.map(error=>error.code).join(", "):"none"}`,""] .join("\n");
if(process.env.GITHUB_STEP_SUMMARY)await appendFile(process.env.GITHUB_STEP_SUMMARY,summary,"utf8");
process.stdout.write(summary);

function addDays(value,days){const date=new Date(`${value}T00:00:00Z`);date.setUTCDate(date.getUTCDate()+days);return date.toISOString().slice(0,10)}
async function fetchJson(url){const response=await fetch(url,{headers:{"User-Agent":"PlayaHoy-water-confidence-v1.2-shadow/1.0"},signal:AbortSignal.timeout(30000)});if(!response.ok)throw new Error(`HTTP ${response.status}`);return response.json()}

