import type { JellyfishObservation,JellyfishObservationStatus } from "../types";

export const MEDUSAPP_RADIUS_KM=5;
export const MEDUSAPP_WINDOW_HOURS=48;

type ReportType="sighting"|"no_sighting"|"pending"|"unknown";
type ValidationStatus="certified"|"pending"|"not_certified";
export type MedusAppReport={id:string;latitude:number;longitude:number;timestamp:string|null;species:string|null;abundance:string|null;abundanceSeverity:number;validationStatus:ValidationStatus;reportType:ReportType};
type GeoJsonFeature={geometry?:{coordinates?:unknown[]};properties?:Record<string,unknown>};

const normalize=(value:string|null|undefined)=>value?.normalize("NFD").replace(/[\u0300-\u036f]/g,"").toLowerCase().replace(/\s+/g," ").trim()??"";
const decodeHtml=(value:string)=>value.replace(/&#(\d+);/g,(_,code)=>String.fromCodePoint(Number(code))).replace(/&#x([0-9a-f]+);/gi,(_,code)=>String.fromCodePoint(Number.parseInt(code,16))).replace(/&nbsp;/gi," ").replace(/&amp;/gi,"&").replace(/&quot;/gi,'"').replace(/&#39;|&apos;/gi,"'").replace(/&lt;/gi,"<").replace(/&gt;/gi,">");
const text=(html:string)=>decodeHtml(html.replace(/<[^>]*>/g," ")).replace(/\s+/g," ").trim();
const dataAttribute=(html:string,name:string)=>html.match(new RegExp(`${name}=["']([^"']+)["']`,"i"))?.[1]??null;
const classContent=(html:string,className:string)=>{const expression=new RegExp(`<([a-z0-9]+)[^>]*class=["'][^"']*\\b${className}\\b[^"']*["'][^>]*>([\\s\\S]*?)<\\/\\1>`,"i");return text(html.match(expression)?.[2]??"")||null};
const statValue=(html:string,labels:string[])=>{const stats=html.match(/<[^>]+class=["'][^"']*\bstat\b[^"']*["'][^>]*>[\s\S]*?<\/[^>]+>\s*<\/[^>]+>/gi)??[];for(const stat of stats){const label=normalize(classContent(stat,"type"));if(labels.some(item=>label.includes(item)))return classContent(stat,"value")}return null};

function abundanceSeverity(value:string|null){if(!value)return 1;const numbers=[...normalize(value).matchAll(/\d+/g)].map(match=>Number(match[0]));const upper=numbers.length?Math.max(...numbers):1;if(upper<=1)return 1;if(upper<=5)return 1.25;if(upper<=10)return 1.5;if(upper<=99)return 2;if(upper<=1000)return 3;return 4}

function madridTimestamp(value:unknown):string|null{
 if(typeof value!=="string")return null;
 const match=value.trim().match(/^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2}):(\d{2})$/);if(!match)return null;
 const parts=match.slice(1).map(Number);const base=Date.UTC(parts[0],parts[1]-1,parts[2],parts[3],parts[4],parts[5]);
 const offsetAt=(instant:number)=>{const zone=new Intl.DateTimeFormat("en",{timeZone:"Europe/Madrid",timeZoneName:"longOffset"}).formatToParts(new Date(instant)).find(part=>part.type==="timeZoneName")?.value??"GMT+00:00";const offset=zone.match(/GMT([+-])(\d{2}):(\d{2})/);return offset?(offset[1]==="-"?-1:1)*(Number(offset[2])*60+Number(offset[3])):0};
 let instant=base-offsetAt(base)*60_000;instant=base-offsetAt(instant)*60_000;return new Date(instant).toISOString();
}

export function parseMedusAppFeature(feature:GeoJsonFeature):MedusAppReport|null{
 const coordinates=feature.geometry?.coordinates;if(!Array.isArray(coordinates)||coordinates.length<2)return null;const longitude=Number(coordinates[0]);const latitude=Number(coordinates[1]);if(!Number.isFinite(latitude)||!Number.isFinite(longitude))return null;
 const properties=feature.properties??{};const popup=typeof properties.popup==="string"?properties.popup:"";const popupText=normalize(text(popup));let species=classContent(popup,"infoMedusa")?.replace(/^[^\p{L}\p{N}]+/u,"").trim()||null;
 const id=dataAttribute(popup,"data-codigo")||String(properties.nomfich??"")||`${latitude}|${longitude}|${String(properties.fecha??"")}`;const medusaId=dataAttribute(popup,"data-idmedusa");
 const abundance=statValue(popup,["cantidad","abundancia","ejemplares","# num","numero"]);const pending=popupText.includes("validando")||popupText.includes("pendiente de validacion");const noSighting=["playa libre de medusas","sin medusas","no avistamiento","ausencia de medusas"].some(phrase=>popupText.includes(phrase));
 const nonJellyfish=["mancha de aceite","manchas de aceite","espuma","plastico","basura","residuo","tronco","madera","otros objetos","ctenoforo","salpa"].some(term=>normalize(species).includes(term));const classes=normalize([...popup.matchAll(/class=["']([^"']+)["']/gi)].map(match=>match[1]).join(" "));const certified=["verified","certified","check-circle","seal-check"].some(marker=>classes.includes(marker))||["avistamiento certificado","observacion certificada"].some(phrase=>popupText.includes(phrase));
 let reportType:ReportType="unknown";if(pending)reportType="pending";else if(noSighting)reportType="no_sighting";else if(nonJellyfish)reportType="unknown";else if(medusaId&&species)reportType="sighting";if(noSighting||pending||nonJellyfish)species=null;
 return{id,latitude,longitude,timestamp:madridTimestamp(properties.fecha),species,abundance,abundanceSeverity:abundanceSeverity(abundance),validationStatus:certified?"certified":pending?"pending":"not_certified",reportType};
}

export function parseMedusAppFeatureCollection(payload:unknown):MedusAppReport[]{
 if(!payload||typeof payload!=="object"||(payload as {type?:unknown}).type!=="FeatureCollection")throw new Error("MedusApp response is not a GeoJSON FeatureCollection");const features=(payload as {features?:unknown}).features;if(!Array.isArray(features))return[];return features.map(feature=>parseMedusAppFeature(feature as GeoJsonFeature)).filter((report):report is MedusAppReport=>Boolean(report));
}

export const haversineKm=(lat1:number,lon1:number,lat2:number,lon2:number)=>{const earth=6371.0088;const radians=(value:number)=>value*Math.PI/180;const dLat=radians(lat2-lat1);const dLon=radians(lon2-lon1);const value=Math.sin(dLat/2)**2+Math.cos(radians(lat1))*Math.cos(radians(lat2))*Math.sin(dLon/2)**2;return earth*2*Math.atan2(Math.sqrt(value),Math.sqrt(1-value))};
const recencyWeight=(age:number)=>age<=12?1:age<=24?0.8:0.5;
const distanceWeight=(distance:number)=>distance<=2?1:.7;

export function aggregateMedusAppReports(reports:MedusAppReport[],beach:{latitude:number;longitude:number},now=new Date()):JellyfishObservation{
 const unique=new Map(reports.map(report=>[report.id,report]));const selected=[...unique.values()].flatMap(report=>{if(!report.timestamp)return[];const age=(now.getTime()-new Date(report.timestamp).getTime())/3_600_000;const distance=haversineKm(beach.latitude,beach.longitude,report.latitude,report.longitude);return age>=0&&age<=MEDUSAPP_WINDOW_HOURS&&distance<=MEDUSAPP_RADIUS_KM?[{...report,age,distance}]:[]});
 const positive=selected.filter(item=>item.reportType==="sighting");const negative=selected.filter(item=>item.reportType==="no_sighting");const pending=selected.filter(item=>item.reportType==="pending");const score=positive.reduce((sum,item)=>sum+recencyWeight(item.age)*distanceWeight(item.distance)*item.abundanceSeverity*(item.validationStatus==="certified"?1.2:1),0);const negativeScore=negative.reduce((sum,item)=>sum+recencyWeight(item.age)*distanceWeight(item.distance)*(item.validationStatus==="certified"?1.2:1),0);const net=score-.6*negativeScore;const closeFresh=positive.some(item=>item.age<=24&&item.distance<=5);
 let status:JellyfishObservationStatus;if(score>=4&&net>=2)status="strong_recent_presence";else if(positive.length>=2&&score>=.4&&net>=0)status="multiple_recent_sightings";else if(positive.length&&(!negative.length||net>=0||closeFresh))status="recent_sighting";else if(negative.length&&(!positive.length||net<0))status="recent_no_sightings";else if(pending.length&&!positive.length&&!negative.length)status="unknown";else if(!positive.length&&!negative.length&&!pending.length)status="no_recent_reports";else status="unknown";
 const relevant=[...positive,...negative,...pending];const latest=relevant.toSorted((a,b)=>b.timestamp!.localeCompare(a.timestamp!))[0];const nearest=relevant.length?Math.min(...relevant.map(item=>item.distance)):null;const abundance=positive.toSorted((a,b)=>b.abundanceSeverity-a.abundanceSeverity).find(item=>item.abundance)?.abundance??null;
 return{status,origin:"observed",source:"MedusApp",sourceType:"crowdsourced",reportCount:positive.length,noSightingReportCount:negative.length,pendingReportCount:pending.length,nearestDistanceKm:nearest,latestReportAt:latest?.timestamp??null,abundance,radiusKm:MEDUSAPP_RADIUS_KM,windowHours:MEDUSAPP_WINDOW_HOURS,updatedAt:now.toISOString()};
}

export function unknownMedusAppObservation(now=new Date()):JellyfishObservation{return{status:"unknown",origin:"observed",source:"MedusApp",sourceType:"crowdsourced",reportCount:0,noSightingReportCount:0,pendingReportCount:0,nearestDistanceKm:null,latestReportAt:null,abundance:null,radiusKm:MEDUSAPP_RADIUS_KM,windowHours:MEDUSAPP_WINDOW_HOURS,updatedAt:now.toISOString()}}
