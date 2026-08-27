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

export function beachMatchesSearch(beach:Beach,query:string){
  const normalizedQuery=normalizeBeachSearch(query);
  if(!normalizedQuery)return true;
  const searchable=normalizeBeachSearch([beach.name,beach.municipality,...(beach.aliases??[]),...(beach.legacySlugs??[])].join(" "));
  return normalizedQuery.split(" ").every(term=>searchable.includes(term));
}
