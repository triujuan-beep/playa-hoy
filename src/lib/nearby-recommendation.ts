import type { Beach } from "./types";
import { calculateBeachScore,getBeachExclusion } from "./scoring";
import { distanceInKm } from "./distance";

export type NearbyRecommendation={beach:Beach;score:number;distance:number;reason:string};

// La calidad pesa un 70 % y la cercanía un 30 %. Solo compiten playas a menos de
// 60 km y a un máximo de 20 puntos de la mejor: evita recomendar la más cercana
// cuando sus condiciones son claramente peores.
export function findNearbyRecommendation(beaches:Beach[],location:{lat:number;lon:number},excludeId?:string):NearbyRecommendation|undefined{const candidates=beaches.filter(beach=>beach.id!==excludeId&&!getBeachExclusion(beach)).map(beach=>({beach,score:calculateBeachScore(beach),distance:distanceInKm(location.lat,location.lon,beach.latitude,beach.longitude)})).filter(item=>item.distance<=60);if(!candidates.length)return undefined;const bestScore=Math.max(...candidates.map(item=>item.score));const viable=candidates.filter(item=>item.score>=bestScore-20);const maxDistance=Math.max(1,...viable.map(item=>item.distance));const chosen=viable.map(item=>({...item,utility:item.score*.7+(1-item.distance/maxDistance)*100*.3})).sort((a,b)=>b.utility-a.utility)[0];return chosen?{beach:chosen.beach,score:chosen.score,distance:chosen.distance,reason:`Buena combinación de condiciones (${chosen.score}/100) y cercanía (${chosen.distance.toFixed(1)} km).`}:undefined}
