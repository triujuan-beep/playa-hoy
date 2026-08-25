import "server-only";
import { cache } from "react";
import { beaches as catalog } from "../mock-beaches";
import { calculateDataCompleteness } from "../scoring";
import type { Beach,BeachHourlyConditions,DataSourceInfo,MetricMetadata } from "../types";
import { getWeather } from "../providers/weatherProvider";
import { getMarineForecastForBeaches,OPEN_METEO_MARINE_DOCS } from "../providers/seaProvider";
import { getAllSanitaryStatuses } from "../providers/sanitaryProvider";
import { getMedusAppObservationsForBeaches,MEDUSAPP_LICENSE,MEDUSAPP_SOURCE_URL } from "../providers/medusAppProvider";

const mockSource=(label:string):DataSourceInfo=>({state:"mock",origin:"unknown",label,source:"Datos de demostración"});
function asMock(beach:Beach):Beach{return{...beach,dataMode:"mock",dataCompleteness:100,sources:{weather:mockSource("Meteorología"),sea:mockSource("Estado del mar"),sanitary:mockSource("Estado sanitario"),jellyfish:mockSource("Medusas"),occupancy:mockSource("Ocupación")}}}

async function loadRealData():Promise<Beach[]> {
 const municipalities=[...new Set(catalog.map(beach=>beach.municipality))];
 const weatherEntries:Array<readonly [string,Awaited<ReturnType<typeof getWeather>>]>=[];
 const seaPromise=getMarineForecastForBeaches(catalog);
 const sanitaryPromise=getAllSanitaryStatuses(catalog.map(beach=>beach.id));
 const jellyfishPromise=getMedusAppObservationsForBeaches(catalog);
 // AEMET limita las ráfagas de peticiones: seis consultas secuenciales son más fiables que un Promise.all.
 for(const municipality of municipalities)weatherEntries.push([municipality,await getWeather(municipality)] as const);
 const [marineByBeach,sanitary,jellyfishByBeach]=await Promise.all([seaPromise,sanitaryPromise,jellyfishPromise]);
 const weatherByMunicipality=new Map(weatherEntries);
 return catalog.map(base=>{
  const weather=weatherByMunicipality.get(base.municipality);const sea=marineByBeach[base.id];const health=sanitary[base.id];const jellyfish=jellyfishByBeach[base.id];
  const weatherHours=new Map(weather?.hourly.map(item=>[item.time.slice(0,16),item])??[]);const seaHours=new Map(sea?.hourly.map(item=>[item.time.slice(0,16),item])??[]);const times=[...new Set([...weatherHours.keys(),...seaHours.keys()])].sort();
  const hourlyConditions:BeachHourlyConditions[]=times.map(time=>{const weatherHour=weatherHours.get(time);const seaHour=seaHours.get(time);return{time,airTemperature:weatherHour?.airTemperature,windSpeed:weatherHour?.windSpeed,windGust:weatherHour?.windGust,windDirection:weatherHour?.windDirection,rainProbability:weatherHour?.rainProbability,waterTemperature:seaHour?.waterTemperature,waveHeight:seaHour?.waveHeight,waveDirection:seaHour?.waveDirection,wavePeriod:seaHour?.wavePeriod,swellWaveHeight:seaHour?.swellWaveHeight,swellWaveDirection:seaHour?.swellWaveDirection,swellWavePeriod:seaHour?.swellWavePeriod,oceanCurrentVelocity:seaHour?.oceanCurrentVelocity,oceanCurrentDirection:seaHour?.oceanCurrentDirection}});
  const weatherMeta:MetricMetadata={origin:weather?"forecast":"unknown",source:"AEMET OpenData",sourceUrl:"https://opendata.aemet.es/dist/index.html",updatedAt:weather?.updatedAt,validFor:weather?.validFor,stale:weather?.stale,note:weather?.stale?"Último dato válido conservado temporalmente por un fallo de AEMET.":undefined};
  const seaMeta:MetricMetadata={origin:sea?"forecast":"unknown",source:"Open-Meteo Marine",sourceUrl:OPEN_METEO_MARINE_DOCS,validFor:sea?.validFor};
  const sanitaryMeta:MetricMetadata={origin:health.status==="unknown"?"unknown":"observed",source:health.source,sourceUrl:health.sourceUrl,updatedAt:health.updatedAt,validFor:health.effectiveUntil};
  const unknownMeta:MetricMetadata={origin:"unknown"};
  const beach:Beach={id:base.id,slug:base.slug,legacySlugs:base.legacySlugs,aliases:base.aliases,name:base.name,municipality:base.municipality,coastZone:base.coastZone,latitude:base.latitude,longitude:base.longitude,
   airTemperature:weather?.airTemperature,windSpeed:weather?.windSpeed,windGust:weather?.windGust,windDirection:weather?.windDirection,rainProbability:weather?.rainProbability,
   waterTemperature:sea?.waterTemperature,waveHeight:sea?.waveHeight,waveDirection:sea?.waveDirection,wavePeriod:sea?.wavePeriod,swellWaveHeight:sea?.swellWaveHeight,swellWaveDirection:sea?.swellWaveDirection,swellWavePeriod:sea?.swellWavePeriod,oceanCurrentVelocity:sea?.oceanCurrentVelocity,oceanCurrentDirection:sea?.oceanCurrentDirection,
   sanitaryStatus:health.status,sanitaryMessage:health.message,sanitaryZone:health.sanitaryZone,sanitaryAssociation:health.sanitaryAssociation,sanitaryEffectiveFrom:health.effectiveFrom,sanitaryEffectiveUntil:health.effectiveUntil,jellyfishObservation:jellyfish,dataMode:"real",hourlyConditions,
   metricMetadata:{waterTemperature:seaMeta,waveHeight:seaMeta,waveDirection:seaMeta,wavePeriod:seaMeta,swellWaveHeight:seaMeta,swellWaveDirection:seaMeta,swellWavePeriod:seaMeta,oceanCurrentVelocity:seaMeta,oceanCurrentDirection:seaMeta,airTemperature:weatherMeta,windSpeed:weatherMeta,windGust:weatherMeta,rainProbability:weatherMeta,sanitaryStatus:sanitaryMeta,jellyfishRisk:unknownMeta,occupancy:unknownMeta},
   sources:{
    weather:weather?{state:"live",origin:"forecast",label:"Meteorología",source:weather.source,sourceUrl:weather.sourceUrl,updatedAt:weather.updatedAt,validFor:weather.validFor,stale:weather.stale,message:weather.stale?"Se muestra el último dato válido mientras AEMET vuelve a estar disponible.":undefined}:{state:"unavailable",origin:"unknown",label:"Meteorología",source:"AEMET OpenData",sourceUrl:"https://opendata.aemet.es/dist/index.html",message:process.env.AEMET_API_KEY?"AEMET no respondió con datos utilizables.":"Falta configurar AEMET_API_KEY."},
    sea:sea?{state:"live",origin:"forecast",label:"Estado del mar",source:sea.source,sourceUrl:sea.sourceUrl,validFor:sea.validFor}:{state:"unavailable",origin:"unknown",label:"Estado del mar",source:"Open-Meteo Marine",sourceUrl:OPEN_METEO_MARINE_DOCS,message:"Open-Meteo no respondió con una predicción marina utilizable."},
    sanitary:{state:health.status==="unknown"?"unavailable":"manual",origin:health.status==="unknown"?"unknown":"observed",label:"Estado sanitario",source:health.source,sourceUrl:health.sourceUrl,updatedAt:health.updatedAt,validFor:health.effectiveUntil,message:health.status==="unknown"?health.message:undefined},
    jellyfish:jellyfish.status==="unknown"?{state:"unavailable",origin:"unknown",sourceType:"crowdsourced",label:"Medusas",source:`MedusApp · ${MEDUSAPP_LICENSE}`,sourceUrl:MEDUSAPP_SOURCE_URL,updatedAt:jellyfish.updatedAt,message:"MedusApp no respondió con datos utilizables."}:{state:"live",origin:"observed",sourceType:"crowdsourced",label:"Medusas",source:`MedusApp · ${MEDUSAPP_LICENSE}`,sourceUrl:MEDUSAPP_SOURCE_URL,updatedAt:jellyfish.updatedAt},occupancy:{state:"coming-soon",origin:"unknown",label:"Ocupación",message:"Fuente en proceso de integración."},
   }};
  beach.dataCompleteness=calculateDataCompleteness(beach);return beach;
 });
}

export const getAllBeachesData=cache(async()=>process.env.USE_MOCK_DATA?.toLowerCase()!=="false"?catalog.map(asMock):loadRealData());
export const getBeachData=cache(async(idOrSlug:string)=>(await getAllBeachesData()).find(beach=>beach.id===idOrSlug||beach.slug===idOrSlug||beach.legacySlugs?.includes(idOrSlug))??null);
