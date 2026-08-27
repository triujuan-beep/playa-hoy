export const V1_2_THRESHOLDS=Object.freeze({
 moderateCooling48C:1.5,
 moderateCooling72C:1.75,
 strongCooling48C:3,
 strongCooling72C:3.5,
 minimumWindSpeedKmh:12,
 compatibleWindHours72:8,
 windLookbackHours:72,
 windDirectionToleranceDeg:45,
 recoveryBelowBaselineC:1.5,
 maximumCopernicusAgeDays:2,
});

export const V1_2_SEGMENTS=Object.freeze({
 western:Object.freeze({points:Object.freeze(["Estepona","Marbella","Fuengirola"]),favourableWindFromDeg:252}),
 centralEast:Object.freeze({points:Object.freeze(["Malaga","Benajarafe","Torrox","Maro"]),favourableWindFromDeg:264}),
 granada:Object.freeze({points:Object.freeze(["La Herradura","Almunecar"]),favourableWindFromDeg:275}),
});

const finite=value=>Number.isFinite(value);
const angularDistance=(a,b)=>Math.abs(((a-b+540)%360)-180);

export function segmentForPoint(point){
 for(const [name,segment] of Object.entries(V1_2_SEGMENTS))if(segment.points.includes(point))return name;
 return undefined;
}

export function isCompatibleSegmentWind(sample,segmentName,thresholds=V1_2_THRESHOLDS){
 const segment=V1_2_SEGMENTS[segmentName];
 return Boolean(segment)&&finite(sample?.speedKmh)&&sample.speedKmh>=thresholds.minimumWindSpeedKmh&&finite(sample?.directionFromDeg)&&angularDistance(sample.directionFromDeg,segment.favourableWindFromDeg)<=thresholds.windDirectionToleranceDeg&&finite(sample?.hoursBefore)&&sample.hoursBefore>=0&&sample.hoursBefore<=thresholds.windLookbackHours;
}

export function evaluateWaterConfidenceV12(input,thresholds=V1_2_THRESHOLDS){
 if(!finite(input.copernicusSstC)||!finite(input.copernicusAgeDays)||input.copernicusAgeDays>thresholds.maximumCopernicusAgeDays){
  return{confidence:"UNKNOWN",coastalCoolingAlert:false,upwellingEvidence:"none",reasons:[finite(input.copernicusSstC)?"stale_copernicus_data":"missing_copernicus_data"]};
 }

 const moderateThermal=finite(input.copCooling48C)&&input.copCooling48C>=thresholds.moderateCooling48C||finite(input.copCooling72C)&&input.copCooling72C>=thresholds.moderateCooling72C;
 const strongThermal=finite(input.copCooling48C)&&input.copCooling48C>=thresholds.strongCooling48C||finite(input.copCooling72C)&&input.copCooling72C>=thresholds.strongCooling72C;
 const compatibleSamples=Array.isArray(input.windSamples)?input.windSamples.filter(sample=>isCompatibleSegmentWind(sample,input.segment,thresholds)):[];
 const windSupport=compatibleSamples.length>=thresholds.compatibleWindHours72;
 const precursorOnly=windSupport&&!compatibleSamples.some(sample=>sample.hoursBefore<=12);
 const primaryAlert=strongThermal||moderateThermal&&windSupport;
 const remainsBelowBaseline=finite(input.recentWarmBaselineC)&&input.recentWarmBaselineC-input.copernicusSstC>=thresholds.recoveryBelowBaselineC;
 const persistedAlert=Boolean(input.previousAlert)&&remainsBelowBaseline;
 const coastalCoolingAlert=primaryAlert||persistedAlert;
 const reasons=[];
 if(strongThermal)reasons.push("strong_thermal_anomaly");
 else if(moderateThermal)reasons.push("moderate_thermal_signal");
 if(windSupport)reasons.push(precursorOnly?"precursor_segment_wind_support":"segment_wind_support");
 if(persistedAlert&&!primaryAlert)reasons.push("coastal_cooling_not_recovered");

 if(coastalCoolingAlert)return{confidence:"LOW",coastalCoolingAlert:true,upwellingEvidence:windSupport?"moderate":"limited",reasons};
 if(!finite(input.openMeteoSstC))return{confidence:"UNKNOWN",coastalCoolingAlert:false,upwellingEvidence:"none",reasons:["insufficient_independent_data"]};
 return{confidence:"MEDIUM",coastalCoolingAlert:false,upwellingEvidence:windSupport?"moderate":"none",reasons:["no_coastal_cooling_alert_evidence"]};
}

