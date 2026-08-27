import { calculateBeachScore,calculateBeachScorePrecise } from "./scoring.ts";
import type { Beach,Priority,SortOption } from "./types";

export type RankedBeach={beach:Beach;score:number;preciseScore:number;distance?:number};

export function scoreBeachForRanking(beach:Beach,priorities:Priority[]=[],distance?:number):RankedBeach{
  return{beach,score:calculateBeachScore(beach,priorities),preciseScore:calculateBeachScorePrecise(beach,priorities),distance};
}

export function sortRankedBeaches(beaches:RankedBeach[],sort:SortOption="score"){
  return[...beaches].sort((left,right)=>{
    if(sort==="warmest")return(right.beach.waterTemperature??-Infinity)-(left.beach.waterTemperature??-Infinity)||right.preciseScore-left.preciseScore;
    if(sort==="wind")return(left.beach.windSpeed??Infinity)-(right.beach.windSpeed??Infinity)||right.preciseScore-left.preciseScore;
    if(sort==="waves")return(left.beach.waveHeight??Infinity)-(right.beach.waveHeight??Infinity)||right.preciseScore-left.preciseScore;
    if(sort==="distance")return(left.distance??Infinity)-(right.distance??Infinity)||right.preciseScore-left.preciseScore;
    return right.preciseScore-left.preciseScore;
  });
}

export function normalizeBeachSearch(value:string){
  return value.normalize("NFD").replace(/[\u0300-\u036f]/g,"").toLocaleLowerCase("es").replace(/[^a-z0-9]+/g," ").trim().replace(/\s+/g," ");
}

function fieldMatchesSearch(value:string,normalizedQuery:string){
  const normalizedValue=normalizeBeachSearch(value);
  return normalizedQuery.split(" ").every(term=>normalizedValue.includes(term));
}

export function beachSearchRelevance(beach:Beach,query:string){
  const normalizedQuery=normalizeBeachSearch(query);
  if(!normalizedQuery)return 0;
  if(fieldMatchesSearch(beach.name,normalizedQuery))return 3;
  if([...(beach.aliases??[]),...(beach.legacySlugs??[])].some(alias=>fieldMatchesSearch(alias,normalizedQuery)))return 2;
  if(fieldMatchesSearch(beach.municipality,normalizedQuery))return 1;
  return 0;
}

export function beachMatchesSearch(beach:Beach,query:string){
  return !normalizeBeachSearch(query)||beachSearchRelevance(beach,query)>0;
}

export function searchRankedBeaches(beaches:RankedBeach[],query:string,sort:SortOption="score"){
  const normalizedQuery=normalizeBeachSearch(query);
  const sorted=sortRankedBeaches(beaches.filter(item=>!normalizedQuery||beachSearchRelevance(item.beach,normalizedQuery)>0),sort);
  if(!normalizedQuery||sort!=="score")return sorted;
  return sorted.sort((left,right)=>beachSearchRelevance(right.beach,normalizedQuery)-beachSearchRelevance(left.beach,normalizedQuery));
}
