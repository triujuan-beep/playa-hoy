import assert from "node:assert/strict";
import test from "node:test";
import { beachMatchesSearch,beachSearchRelevance,scoreBeachForRanking,searchRankedBeaches,sortRankedBeaches } from "../src/lib/beach-ranking.ts";
import { beaches } from "../src/lib/mock-beaches.ts";
import { findNearbyRecommendation } from "../src/lib/nearby-recommendation.ts";
import { calculateBeachScore,calculateBeachScorePrecise } from "../src/lib/scoring.ts";

const beach=(id,overrides={})=>({id,slug:id,name:id,municipality:"Test",province:"Málaga",autonomousCommunity:"Andalucía",coastZone:"centro",latitude:36.7,longitude:-4.4,sanitaryStatus:"safe",waterTemperature:23,windSpeed:10,windGust:15,waveHeight:.4,rainProbability:0,...overrides});
const observation=status=>({status,origin:"observed",source:"MedusApp",sourceType:"crowdsourced",reportCount:status.includes("sighting")?1:0,noSightingReportCount:status==="recent_no_sightings"?1:0,pendingReportCount:0,nearestDistanceKm:1,latestReportAt:"2026-08-25T10:00:00.000Z",abundance:null,radiusKm:5,windowHours:48,updatedAt:"2026-08-25T12:00:00.000Z"});

test("el ranking usa precisión completa aunque el score visible empate",()=>{
 const burriana=beach("Burriana",{waterTemperature:23.7,windSpeed:5,windGust:9,waveHeight:1.02});
 const herradura=beach("La Herradura",{waterTemperature:22.9,windSpeed:2,windGust:9,waveHeight:.98});
 assert.equal(calculateBeachScore(burriana),69);
 assert.equal(calculateBeachScore(herradura),69);
 assert.ok(calculateBeachScorePrecise(herradura)>calculateBeachScorePrecise(burriana));
 assert.equal(sortRankedBeaches([scoreBeachForRanking(burriana),scoreBeachForRanking(herradura)])[0].beach.name,"La Herradura");
});

test("agua, viento y mar mantienen el multiplicador 1,65",()=>{
 const sample=beach("sample",{waterTemperature:24,windSpeed:12,windGust:18,waveHeight:.5,rainProbability:7});
 const factors={warmWater:{condition:(24-18)/8,weight:22},lowWind:{condition:1-12/30,weight:18},lowGust:{condition:1-18/45,weight:10},calmSea:{condition:1-.5/1.4,weight:18},lowRain:{condition:1-7/70,weight:10}};
 for(const priority of ["warmWater","lowWind","calmSea"]){const numerator=Object.entries(factors).reduce((sum,[key,factor])=>sum+factor.condition*factor.weight*(key===priority?1.65:1),0);const denominator=Object.entries(factors).reduce((sum,[key,factor])=>sum+factor.weight*(key===priority?1.65:1),0);assert.ok(Math.abs(calculateBeachScorePrecise(sample,[priority])-numerator/denominator*100)<1e-9)}
});

test("la preferencia de medusas es neutral sin datos, penaliza avistamientos y no domina el ranking",()=>{
 const excellent=beach("Excelente",{waterTemperature:25,windSpeed:4,windGust:7,waveHeight:.2,jellyfishObservation:observation("recent_sighting")});
 const mediocre=beach("Mediocre",{waterTemperature:19,windSpeed:24,windGust:38,waveHeight:1.1,jellyfishObservation:observation("no_recent_reports")});
 const unknown=beach("Unknown",{jellyfishObservation:observation("unknown")});
 const noReports=beach("No reports",{jellyfishObservation:observation("no_recent_reports")});
 assert.equal(calculateBeachScorePrecise(noReports,["lowJellyfish"]),calculateBeachScorePrecise(noReports));
 assert.equal(calculateBeachScorePrecise(unknown,["lowJellyfish"]),calculateBeachScorePrecise(unknown));
 assert.equal(calculateBeachScorePrecise(excellent,["lowJellyfish"]),calculateBeachScorePrecise(excellent)-4);
 assert.equal(sortRankedBeaches([scoreBeachForRanking(mediocre,["lowJellyfish"]),scoreBeachForRanking(excellent,["lowJellyfish"])])[0].beach.name,"Excelente");
});

test("el buscador ignora acentos, mayúsculas, espacios y guiones y usa aliases y municipio",()=>{
 const matches=query=>beaches.filter(item=>beachMatchesSearch(item,query)).map(item=>item.name);
 assert.deepEqual(matches("herradura"),["La Herradura"]);
 assert.deepEqual(matches("lindes"),["Cenicero–Las Lindes"]);
 assert.deepEqual(matches("almunecar"),matches("Almuñécar"));
 assert.equal(matches("mijas").length,4);
 assert.ok(matches("las   lindes").includes("Cenicero–Las Lindes"));
 assert.deepEqual(matches("playa-inexistente"),[]);
});

test("la búsqueda prioriza nombre, después alias y después municipio",()=>{
 const victoria=beaches.find(item=>item.slug==="rincon-playa-del-rincon-de-la-victoria");
 const municipal=beaches.find(item=>item.slug==="rincon-la-cala-del-moral");
 const alias=beach("Alias",{name:"Nombre alternativo",aliases:["Victoria"]});
 assert.ok(victoria&&municipal);
 assert.equal(beachSearchRelevance(victoria,"victoria"),3);
 assert.equal(beachSearchRelevance(alias,"victoria"),2);
 assert.equal(beachSearchRelevance(municipal,"victoria"),1);
 const results=searchRankedBeaches([scoreBeachForRanking(municipal),scoreBeachForRanking(alias),scoreBeachForRanking(victoria)],"victoria");
 assert.deepEqual(results.map(item=>item.beach.name),["Playa del Rincón de la Victoria","Nombre alternativo","La Cala del Moral"]);
 assert.equal(searchRankedBeaches(beaches.map(item=>scoreBeachForRanking(item)),"Maro")[0].beach.name,"Playa de Maro");
 assert.equal(searchRankedBeaches(beaches.map(item=>scoreBeachForRanking(item)),"herradura")[0].beach.name,"La Herradura");
});

test("la búsqueda devuelve todas las coincidencias y combina relevancia con la ordenación",()=>{
 const ranked=beaches.map(item=>scoreBeachForRanking(item));
 const plain=searchRankedBeaches(ranked,"almunecar");
 const accented=searchRankedBeaches(ranked,"Almuñécar");
 assert.equal(plain.length,5);
 assert.deepEqual(plain.map(item=>item.beach.id),accented.map(item=>item.beach.id));
 const nerjaByWater=searchRankedBeaches(ranked,"Nerja","warmest");
 assert.equal(nerjaByWater.length,6);
 assert.deepEqual(nerjaByWater.map(item=>item.beach.waterTemperature),[...nerjaByWater].map(item=>item.beach.waterTemperature).sort((a,b)=>(b??-Infinity)-(a??-Infinity)));
});

test("las ordenaciones estrictas siguen disponibles para explorar",()=>{
 const items=[beach("A",{waterTemperature:20,windSpeed:5,waveHeight:.8}),beach("B",{waterTemperature:25,windSpeed:12,waveHeight:.2})].map(item=>scoreBeachForRanking(item));
 assert.equal(sortRankedBeaches(items,"warmest")[0].beach.id,"B");
 assert.equal(sortRankedBeaches(items,"wind")[0].beach.id,"A");
 assert.equal(sortRankedBeaches(items,"waves")[0].beach.id,"B");
});

test("la alternativa cercana usa el score personalizado en el 70 por ciento de condiciones",()=>{
 const location={lat:36.7,lon:-4.4};
 const close=beach("Cerca",{latitude:36.7,longitude:-4.39,waterTemperature:19,windSpeed:5,windGust:8,waveHeight:.2});
 const warm=beach("Cálida",{latitude:36.7,longitude:-4.48,waterTemperature:26,windSpeed:13,windGust:18,waveHeight:.5});
 const normal=findNearbyRecommendation([close,warm],location);
 const personalized=findNearbyRecommendation([close,warm],location,{priorities:["warmWater"]});
 assert.ok(normal&&personalized);
 assert.equal(normal.beach.id,"Cerca");
 assert.equal(personalized.beach.id,"Cálida");
 assert.equal(personalized.score,calculateBeachScore(personalized.beach,["warmWater"]));
});
