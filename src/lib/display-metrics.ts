import type { Beach,MetricKey } from "./types";
import { jellyfishObservationCompact } from "./jellyfish-display";

export type DisplayMetric={icon:string;value:string;label:string;origin?:string};
const number=(value:number|undefined,digits=0)=>value===undefined?"—":value.toFixed(digits);
const origin=(beach:Beach,key:MetricKey)=>beach.metricMetadata?.[key]?.origin==="forecast"?"Pred.":beach.metricMetadata?.[key]?.origin==="observed"?"Obs.":undefined;

export function getBeachSummaryMetrics(beach:Beach):DisplayMetric[]{
  return [
    beach.waterTemperature!==undefined
      ? {icon:"°",value:`${number(beach.waterTemperature,1)}°`,label:"Agua",origin:origin(beach,"waterTemperature")}
      : {icon:"☀",value:`${number(beach.airTemperature)}°`,label:"Aire",origin:origin(beach,"airTemperature")},
    {icon:"↝",value:beach.windSpeed===undefined?"—":`${number(beach.windSpeed)} km/h`,label:"Viento",origin:origin(beach,"windSpeed")},
    beach.waveHeight!==undefined
      ? {icon:"≈",value:`${number(beach.waveHeight,1)} m`,label:"Olas",origin:origin(beach,"waveHeight")}
      : {icon:"↠",value:beach.windGust===undefined?"—":`${number(beach.windGust)} km/h`,label:"Rachas",origin:origin(beach,"windGust")},
    beach.jellyfishObservation
      ? {icon:"🪼",value:jellyfishObservationCompact(beach.jellyfishObservation.status),label:"Medusas",origin:"Obs."}
      : beach.jellyfishRisk!==undefined
      ? {icon:"♨",value:`${number(beach.jellyfishRisk)}%`,label:"Medusas",origin:origin(beach,"jellyfishRisk")}
      : {icon:"☂",value:beach.rainProbability===undefined?"—":`${number(beach.rainProbability)}%`,label:"Lluvia",origin:origin(beach,"rainProbability")},
  ];
}
