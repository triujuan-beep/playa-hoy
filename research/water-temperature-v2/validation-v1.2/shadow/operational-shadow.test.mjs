import assert from "node:assert/strict";
import {createHash} from "node:crypto";
import {mkdtemp,readFile} from "node:fs/promises";
import {tmpdir} from "node:os";
import {dirname,join,resolve} from "node:path";
import {fileURLToPath} from "node:url";
import test from "node:test";
import {POINTS,buildFreshSnapshot,buildUnknownSnapshot,summarize,writeSnapshotExclusive} from "./operational-shadow-core.mjs";

const dates=Array.from({length:15},(_,index)=>`2026-08-${String(12+index).padStart(2,"0")}`);
const copernicusInput={status:"ok",sourceDate:"2026-08-26",sourceAge:1,points:POINTS.map(point=>({...point,daily:dates.map((date,index)=>({date,sstC:26-index*0.3}))}))};
const marineRaw=POINTS.map(()=>({hourly:{time:dates.flatMap(date=>[`${date}T00:00`,`${date}T12:00`]),sea_surface_temperature:dates.flatMap((_,index)=>[26-index*0.2,26-index*0.2])}}));
const windRaw=POINTS.map(()=>({hourly:{time:dates.flatMap(date=>Array.from({length:24},(_,hour)=>`${date}T${String(hour).padStart(2,"0")}:00`)),wind_speed_10m:dates.flatMap(()=>Array(24).fill(14)),wind_direction_10m:dates.flatMap(()=>Array(24).fill(264))}}));

test("frozen detector has the approved SHA-256",async()=>{const path=resolve(dirname(fileURLToPath(import.meta.url)),"..","frozen","water-confidence-v1.2.mjs"),hash=createHash("sha256").update(await readFile(path)).digest("hex").toUpperCase();assert.equal(hash,"E5B251686A394A936C5440C20FC6095F73899E5C0A1D6022DB18A1EC6D43204F")});
test("fresh snapshot evaluates exactly nine points",()=>{const snapshot=buildFreshSnapshot({executionDate:"2026-08-27",generatedAt:"2026-08-27T06:23:00Z",detectorHash:"test",copernicusInput,marineRaw,windRaw});assert.equal(snapshot.points.length,9);assert.equal(snapshot.sourceFreshness,"fresh")});
test("stale Copernicus yields nine neutral UNKNOWN points",()=>{const snapshot=buildUnknownSnapshot({executionDate:"2026-08-27",generatedAt:"2026-08-27T06:23:00Z",detectorHash:"test",copernicusInput:{...copernicusInput,sourceAge:3},reason:"stale_copernicus_data"});assert.equal(snapshot.points.length,9);assert.ok(snapshot.points.every(point=>point.confidence==="UNKNOWN"&&!point.coastalCoolingAlert));assert.deepEqual(summarize(snapshot),{alerts:0,LOW:0,MEDIUM:0,HIGH:0,UNKNOWN:9})});
test("provider failure is not interpreted as no cooling",()=>{const snapshot=buildUnknownSnapshot({executionDate:"2026-08-27",generatedAt:"2026-08-27T06:23:00Z",detectorHash:"test",copernicusInput:{status:"error"},reason:"copernicus_provider_error",errors:[{code:"COPERNICUS_UNAVAILABLE"}]});assert.equal(snapshot.points[0].reasons[0],"copernicus_provider_error");assert.equal(snapshot.errors.length,1)});
test("snapshot history writer refuses overwrite",async()=>{const directory=await mkdtemp(join(tmpdir(),"water-confidence-shadow-")),path=join(directory,"2026-08-27.json"),snapshot={executionDate:"2026-08-27"};await writeSnapshotExclusive(path,snapshot);assert.equal(JSON.parse(await readFile(path,"utf8")).executionDate,"2026-08-27");await assert.rejects(writeSnapshotExclusive(path,snapshot),error=>error.code==="EEXIST")});
