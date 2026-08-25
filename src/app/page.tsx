import { BeachExplorer } from "@/components/BeachExplorer";
import { getAllBeachesData } from "@/lib/services/beachDataService";
import { connection } from "next/server";
import { BATHING_WINDOW } from "@/lib/hourly";
import type { Beach } from "@/lib/types";

function localDate(referenceTime:string){return new Intl.DateTimeFormat("en-CA",{timeZone:"Europe/Madrid",year:"numeric",month:"2-digit",day:"2-digit"}).format(new Date(referenceTime))}
function prepareBeachesForHome(beaches:Beach[],referenceTime:string){const date=localDate(referenceTime);return beaches.map(beach=>({...beach,hourlyConditions:beach.hourlyConditions?.filter(point=>point.time.startsWith(date)&&Number(point.time.slice(11,13))>=BATHING_WINDOW.startHour&&Number(point.time.slice(11,13))<=BATHING_WINDOW.endHour).map(point=>({time:point.time,waterTemperature:point.waterTemperature,airTemperature:point.airTemperature,windSpeed:point.windSpeed,windGust:point.windGust,windDirection:point.windDirection,rainProbability:point.rainProbability,waveHeight:point.waveHeight}))}))}

export default async function Home() {
  await connection();
  const beaches = await getAllBeachesData();
  const referenceTime = new Date().toISOString();
  return <BeachExplorer initialBeaches={prepareBeachesForHome(beaches,referenceTime)} referenceTime={referenceTime} />;
}
