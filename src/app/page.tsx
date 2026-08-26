import { BeachExplorer } from "@/components/BeachExplorer";
import { getAllBeachesSnapshot,scheduleBeachDataRefresh } from "@/lib/services/beachDataService";
import { BATHING_WINDOW } from "@/lib/hourly";
import type { Beach } from "@/lib/types";

function localDate(referenceTime:string){return new Intl.DateTimeFormat("en-CA",{timeZone:"Europe/Madrid",year:"numeric",month:"2-digit",day:"2-digit"}).format(new Date(referenceTime))}
function prepareBeachesForHome(beaches:Beach[],referenceTime:string){const date=localDate(referenceTime);return beaches.map(beach=>({...beach,hourlyConditions:beach.hourlyConditions?.filter(point=>point.time.startsWith(date)&&Number(point.time.slice(11,13))>=BATHING_WINDOW.startHour&&Number(point.time.slice(11,13))<=BATHING_WINDOW.endHour).map(point=>({time:point.time,waterTemperature:point.waterTemperature,airTemperature:point.airTemperature,windSpeed:point.windSpeed,windGust:point.windGust,windDirection:point.windDirection,rainProbability:point.rainProbability,waveHeight:point.waveHeight}))}))}

export default async function Home() {
  const snapshot = await getAllBeachesSnapshot();
  scheduleBeachDataRefresh(snapshot);
  return <BeachExplorer initialBeaches={prepareBeachesForHome(snapshot.beaches,snapshot.referenceTime)} referenceTime={snapshot.referenceTime} />;
}

export const revalidate=900;
export const maxDuration=300;
