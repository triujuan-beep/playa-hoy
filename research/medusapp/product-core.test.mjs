import assert from "node:assert/strict";
import test from "node:test";
import { aggregateMedusAppReports,parseMedusAppFeatureCollection,unknownMedusAppObservation } from "../../src/lib/providers/medusAppCore.ts";
import { calculateBeachScore,calculateBeachScorePrecise,getJellyfishPreferenceAdjustment } from "../../src/lib/scoring.ts";

const now=new Date("2026-08-25T12:00:00.000Z");
const popup=(id,species,extra="")=>`<div data-codigo="${id}"><div class="infoMedusa" data-idmedusa="7">${species}</div>${extra}</div>`;
const feature=(id,species,longitude=-4.404,latitude=36.718,fecha="2026-08-25 12:00:00",extra="")=>({type:"Feature",geometry:{type:"Point",coordinates:[longitude,latitude]},properties:{fecha,popup:popup(id,species,extra)}});

test("parses only the minimal structured MedusApp fields",()=>{
 const reports=parseMedusAppFeatureCollection({type:"FeatureCollection",features:[feature("42","Pelagia noctiluca",-4.404,36.718,"2026-08-25 12:00:00",'<div class="stat"><div class="type"># Num.</div><div class="value">6-10</div></div>')]});
 assert.equal(reports.length,1);assert.equal(reports[0].reportType,"sighting");assert.equal(reports[0].species,"Pelagia noctiluca");assert.equal(reports[0].abundance,"6-10");assert.equal("popup" in reports[0],false);assert.equal("user" in reports[0],false);
});

test("filters false positives and keeps explicit absence and pending distinct",()=>{
 const payload={type:"FeatureCollection",features:[feature("1","Manchas de aceite"),{...feature("2","Sin medusas"),properties:{fecha:"2026-08-25 12:00:00",popup:'<div data-codigo="2" class="infoMedusa">Playa libre de medusas</div>'}},{...feature("3","Pendiente"),properties:{fecha:"2026-08-25 12:00:00",popup:'<div data-codigo="3" class="infoMedusa">Validando...</div>'}}]};
 assert.deepEqual(parseMedusAppFeatureCollection(payload).map(item=>item.reportType),["unknown","no_sighting","pending"]);
});

test("deduplicates reports and applies the 5 km / 48 h boundary",()=>{
 const [report]=parseMedusAppFeatureCollection({type:"FeatureCollection",features:[feature("1","Pelagia noctiluca")]});const tooFar={...report,id:"far",longitude:-4.50};const tooOld={...report,id:"old",timestamp:"2026-08-22T10:00:00.000Z"};const observation=aggregateMedusAppReports([report,report,tooFar,tooOld],{latitude:36.718,longitude:-4.404},now);
 assert.equal(observation.status,"recent_sighting");assert.equal(observation.reportCount,1);assert.equal(observation.radiusKm,5);assert.equal(observation.windowHours,48);
});

test("distinguishes no reports, explicit absence, several sightings and source failure",()=>{
 const report=id=>({id,latitude:36.718,longitude:-4.404,timestamp:"2026-08-25T10:00:00.000Z",species:"Pelagia",abundance:null,abundanceSeverity:1,validationStatus:"not_certified",reportType:"sighting"});
 assert.equal(aggregateMedusAppReports([],{latitude:36.718,longitude:-4.404},now).status,"no_recent_reports");assert.equal(aggregateMedusAppReports([{...report("n"),reportType:"no_sighting"}],{latitude:36.718,longitude:-4.404},now).status,"recent_no_sightings");assert.equal(aggregateMedusAppReports([report("a"),report("b")],{latitude:36.718,longitude:-4.404},now).status,"multiple_recent_sightings");assert.equal(unknownMedusAppObservation(now).status,"unknown");
});

test("MedusApp observations do not affect score or ranking inputs",()=>{
 const beach={id:"1",slug:"test",name:"Test",municipality:"Málaga",latitude:36.718,longitude:-4.404,sanitaryStatus:"safe",waterTemperature:24,windSpeed:8,windGust:12,waveHeight:.3,rainProbability:2};const observation=aggregateMedusAppReports([],{latitude:beach.latitude,longitude:beach.longitude},now);
 assert.equal(calculateBeachScore(beach),calculateBeachScore({...beach,jellyfishObservation:observation}));
});

test("the optional MedusApp preference applies bounded categorical adjustments",()=>{
 const observation=status=>({status,origin:"observed",source:"MedusApp",sourceType:"crowdsourced",reportCount:0,noSightingReportCount:0,pendingReportCount:0,nearestDistanceKm:null,latestReportAt:null,abundance:null,radiusKm:5,windowHours:48,updatedAt:now.toISOString()});
 const beach={id:"1",slug:"test",name:"Test",municipality:"Málaga",latitude:36.718,longitude:-4.404,sanitaryStatus:"safe",waterTemperature:24,windSpeed:8,windGust:12,waveHeight:.3,rainProbability:2};
 for(const status of ["no_recent_reports","unknown"])assert.equal(calculateBeachScorePrecise({...beach,jellyfishObservation:observation(status)},["lowJellyfish"]),calculateBeachScorePrecise(beach));
 assert.equal(getJellyfishPreferenceAdjustment({jellyfishObservation:observation("recent_no_sightings")}),2);
 assert.equal(getJellyfishPreferenceAdjustment({jellyfishObservation:observation("recent_sighting")}),-4);
 assert.equal(getJellyfishPreferenceAdjustment({jellyfishObservation:observation("multiple_recent_sightings")}),-7);
 assert.equal(getJellyfishPreferenceAdjustment({jellyfishObservation:observation("strong_recent_presence")}),-10);
});
