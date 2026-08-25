import assert from "node:assert/strict";
import test from "node:test";
import sanitaryRecords from "../src/data/sanitary-status.json" with {type:"json"};
import {beaches} from "../src/lib/mock-beaches.ts";
import {runIndependentBatches,splitIntoBatches,retryAfterMilliseconds} from "../src/lib/provider-utils.ts";
import {calculateBeachScore,calculateDataCompleteness,getBeachExclusion} from "../src/lib/scoring.ts";
import {AEMET_MUNICIPALITY_CODES} from "../src/lib/aemet-config.ts";
import {getGoogleMapsDirectionsUrl} from "../src/lib/maps.ts";
import {getTodayTimeOptions,selectForecastDate} from "../src/lib/hourly-options.ts";
import {degreesToCardinal,formatCardinalDegrees,formatDecimal} from "../src/lib/number-format.ts";
import {jellyfishObservationAge} from "../src/lib/jellyfish-display.ts";
import {formatDataAge} from "../src/lib/time.ts";

const expectedMunicipalities=["Algarrobo","Benalmádena","Casares","Estepona","Fuengirola","Málaga","Manilva","Marbella","Mijas","Nerja","Rincón de la Victoria","Torremolinos","Torrox","Vélez-Málaga"];

test("el catálogo v2 contiene 58 playas válidas en 14 municipios",()=>{assert.equal(beaches.length,58);assert.deepEqual([...new Set(beaches.map(beach=>beach.municipality))].sort(),expectedMunicipalities.sort());assert.equal(new Set(beaches.map(beach=>beach.id)).size,58);assert.equal(new Set(beaches.map(beach=>beach.slug)).size,58);for(const beach of beaches){assert.ok(beach.latitude>=36.3&&beach.latitude<=36.8,beach.id);assert.ok(beach.longitude>=-5.3&&beach.longitude<=-3.7,beach.id)}});

test("AEMET y Google Maps cubren las 58 playas",()=>{assert.deepEqual(Object.keys(AEMET_MUNICIPALITY_CODES).sort(),expectedMunicipalities.sort());for(const beach of beaches){assert.ok(AEMET_MUNICIPALITY_CODES[beach.municipality],beach.id);const url=new URL(getGoogleMapsDirectionsUrl(beach.latitude,beach.longitude));assert.equal(url.hostname,"www.google.com");assert.equal(url.searchParams.get("destination"),`${beach.latitude},${beach.longitude}`)}});

test("los alias históricos no colisionan y Las Dunas conserva su excepción",()=>{const aliases=beaches.flatMap(beach=>beach.legacySlugs??[]);assert.equal(new Set(aliases).size,aliases.length);const lasDunas=beaches.find(beach=>beach.id==="torrox-las-dunas-la-carraca");assert.equal(lasDunas?.latitude,36.73493);assert.equal(lasDunas?.longitude,-3.98423);assert.ok(lasDunas?.legacySlugs?.includes("las-dunas"))});

test("el snapshot sanitario cubre 56 playas y solo deja dos unknown",()=>{assert.equal(Object.keys(sanitaryRecords).length,56);const unknown=beaches.filter(beach=>!(beach.id in sanitaryRecords)).map(beach=>beach.id).sort();assert.deepEqual(unknown,["malaga-misericordia","mijas-el-faro"]);assert.equal(sanitaryRecords["torrox-las-dunas-la-carraca"].sanitaryAssociation,"associated");assert.match(sanitaryRecords["torrox-las-dunas-la-carraca"].message,/Cenicero–Las Lindes/)});

test("los diez casos de aceptación tienen detalle, Maps y sanidad mapeada",()=>{const ids=["nerja-burriana","torrox-las-dunas-la-carraca","velez-malaga-torre-del-mar","malaga-la-malagueta","torremolinos-la-carihuela","benalmadena-santa-ana","fuengirola-los-boliches-gaviotas","marbella-artola-cabopino","estepona-la-rada","manilva-sabinillas"];for(const id of ids){const beach=beaches.find(item=>item.id===id);assert.ok(beach,id);assert.ok(id in sanitaryRecords,id);assert.match(getGoogleMapsDirectionsUrl(beach.latitude,beach.longitude),/^https:\/\/www\.google\.com\/maps\/dir\//)}});

test("Open-Meteo se divide en 20, 20 y 18 y un fallo no cancela los demás",async()=>{const batches=splitIntoBatches(beaches,20);assert.deepEqual(batches.map(batch=>batch.length),[20,20,18]);const completed=[];const results=await runIndependentBatches(batches,async(_batch,index)=>{if(index===1)throw new Error("fallo simulado");completed.push(index);return index});assert.deepEqual(completed,[0,2]);assert.deepEqual(results,[0,undefined,2])});

test("Retry-After admite segundos, fecha y backoff acotado",()=>{assert.equal(retryAfterMilliseconds("3",0),3000);assert.equal(retryAfterMilliseconds("Wed, 21 Oct 2015 07:28:10 GMT",0,Date.parse("Wed, 21 Oct 2015 07:28:00 GMT")),10000);assert.equal(retryAfterMilliseconds(null,2),4000)});

test("unknown sanitario sigue siendo elegible y no altera el score",()=>{const base=beaches.find(beach=>beach.id==="malaga-misericordia");assert.ok(base);const unknown={...base,sanitaryStatus:"unknown"};const safe={...base,sanitaryStatus:"safe"};assert.equal(getBeachExclusion(unknown),undefined);assert.equal(calculateBeachScore(unknown),calculateBeachScore(safe))});

test("una respuesta MedusApp sin reportes cuenta como dato disponible",()=>{const base=beaches[0];const without=calculateDataCompleteness({...base,jellyfishRisk:undefined,jellyfishObservation:undefined});const withObservation=calculateDataCompleteness({...base,jellyfishRisk:undefined,jellyfishObservation:{status:"no_recent_reports",origin:"observed",source:"MedusApp",sourceType:"crowdsourced",reportCount:0,noSightingReportCount:0,pendingReportCount:0,nearestDistanceKm:null,latestReportAt:null,abundance:null,radiusKm:5,windowHours:48,updatedAt:"2026-08-25T10:00:00+02:00"}});assert.equal(withObservation-without,17)});

test("Voy más tarde ofrece Ahora, +2, +4 y +6 sin nuevas fuentes",()=>{const hourlyConditions=Array.from({length:12},(_,index)=>({time:`2026-08-25T${String(index+9).padStart(2,"0")}:00`,windSpeed:8,waveHeight:.3}));const sample={...beaches[0],hourlyConditions};const options=getTodayTimeOptions([sample],new Date("2026-08-25T08:00:00Z"));assert.deepEqual(options.map(item=>item.label),["Ahora","+2 h","+4 h","+6 h"])});

test("una única referencia temporal estabiliza Voy más tarde al cruzar de hora",()=>{const hourlyConditions=Array.from({length:12},(_,index)=>({time:`2026-08-25T${String(index+9).padStart(2,"0")}:00`,waterTemperature:24,windSpeed:8,waveHeight:.3,rainProbability:0}));const sample={...beaches[0],hourlyConditions};const before=new Date("2026-08-25T14:59:59Z");const after=new Date("2026-08-25T15:00:00Z");const beforeLabels=getTodayTimeOptions([sample],before).map(item=>item.label);assert.deepEqual(beforeLabels,["Ahora","+2 h","+4 h"]);assert.deepEqual(getTodayTimeOptions([sample],new Date(before.toISOString())).map(item=>item.label),beforeLabels);assert.deepEqual(getTodayTimeOptions([sample],after).map(item=>item.label),["Ahora","+2 h"])});

test("los textos relativos usan la misma referencia serializada",()=>{const referenceTime="2026-08-25T17:00:00.000Z";assert.equal(formatDataAge("2026-08-25T15:00:00.000Z",referenceTime),"actualizado hace 2 h");const observation={status:"recent_sighting",origin:"observed",source:"MedusApp",sourceType:"crowdsourced",reportCount:1,noSightingReportCount:0,pendingReportCount:0,nearestDistanceKm:1,latestReportAt:"2026-08-25T15:00:00.000Z",abundance:null,radiusKm:5,windowHours:48,updatedAt:referenceTime};assert.equal(jellyfishObservationAge(observation,referenceTime),"Hace 2 h")});

test("Evolución prioriza hoy aunque la serie empiece el día anterior",()=>{const times=["2026-08-24T23:00",...Array.from({length:15},(_,index)=>`2026-08-25T${String(index+8).padStart(2,"0")}:00`)];assert.equal(selectForecastDate(times,new Date("2026-08-25T10:00:00Z")),"2026-08-25")});

test("la dirección marina cubre los ocho cardinales y el wrap de Norte",()=>{const examples=[[0,"N"],[45,"NE"],[90,"E"],[135,"SE"],[180,"S"],[225,"SO"],[270,"O"],[315,"NO"],[359,"N"]];for(const[degrees,expected]of examples)assert.equal(degreesToCardinal(degrees),expected);assert.equal(degreesToCardinal(22),"N");assert.equal(degreesToCardinal(23),"NE");assert.equal(degreesToCardinal(337),"NO");assert.equal(degreesToCardinal(338),"N")});

test("el detalle marino conserva grados y usa decimal español",()=>{assert.equal(formatCardinalDegrees(203),"SO (203°)");assert.equal(formatDecimal(3.3,1),"3,3");assert.equal(formatDecimal(.1,1),"0,1");assert.equal(formatDecimal(1.3,1),"1,3")});
