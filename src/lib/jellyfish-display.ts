import type { JellyfishObservation,JellyfishObservationStatus } from "./types";

const labels:Record<JellyfishObservationStatus,string>={no_recent_reports:"Sin avistamientos recientes",recent_sighting:"Avistamiento reciente",multiple_recent_sightings:"Varios avistamientos recientes",strong_recent_presence:"Presencia reciente destacable",recent_no_sightings:"Reportes recientes sin medusas",unknown:"Sin información reciente"};
const compact:Record<JellyfishObservationStatus,string>={no_recent_reports:"Sin reportes",recent_sighting:"Avistamiento",multiple_recent_sightings:"Varios",strong_recent_presence:"Destacable",recent_no_sightings:"Reporte sin avist.",unknown:"Sin info."};
export const jellyfishObservationLabel=(status:JellyfishObservationStatus)=>labels[status];
export const jellyfishObservationCompact=(status:JellyfishObservationStatus)=>compact[status];
export const jellyfishObservationTone=(status:JellyfishObservationStatus)=>status==="strong_recent_presence"||status==="multiple_recent_sightings"?"attention":status==="recent_sighting"?"warning":"neutral";
export function jellyfishObservationAge(observation:JellyfishObservation){if(!observation.latestReportAt)return null;const hours=Math.max(0,Math.round((Date.now()-new Date(observation.latestReportAt).getTime())/3_600_000));return hours<1?"Hace menos de 1 h":`Hace ${hours} h`}
