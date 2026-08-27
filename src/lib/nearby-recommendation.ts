import type { Beach,Priority } from "./types";
import { calculateBeachScore,calculateBeachScorePrecise,getBeachExclusion } from "./scoring.ts";
import { distanceInKm } from "./distance.ts";

export type NearbyRecommendation={beach:Beach;score:number;distance:number;reason:string};
export type NearbyRecommendationOptions={excludeId?:string;priorities?:Priority[]};

// La calidad pesa un 70 % y la cercanía un 30 %. Solo compiten playas a menos de
// 60 km y a un máximo de 20 puntos de la mejor: evita recomendar la más cercana
// cuando sus condiciones son claramente peores.
export function findNearbyRecommendation(beaches:Beach[],location:{lat:number;lon:number},options:NearbyRecommendationOptions={}):NearbyRecommendation|undefined{const priorities=options.priorities??[];const candidates=beaches.filter(beach=>beach.id!==options.excludeId&&!getBeachExclusion(beach)).map(beach=>({beach,preciseScore:calculateBeachScorePrecise(beach,priorities),score:calculateBeachScore(beach,priorities),distance:distanceInKm(location.lat,location.lon,beach.latitude,beach.longitude)})).filter(item=>item.distance<=60);if(!candidates.length)return undefined;const bestScore=Math.max(...candidates.map(item=>item.preciseScore));const viable=candidates.filter(item=>item.preciseScore>=bestScore-20);const maxDistance=Math.max(1,...viable.map(item=>item.distance));const chosen=viable.map(item=>({...item,utility:item.preciseScore*.7+(1-item.distance/maxDistance)*100*.3})).sort((a,b)=>b.utility-a.utility)[0];return chosen?{beach:chosen.beach,score:chosen.score,distance:chosen.distance,reason:`Buena combinación de condiciones (${chosen.score}/100) y cercanía (${chosen.distance.toFixed(1)} km).`}:undefined}
