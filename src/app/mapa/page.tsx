import type { Metadata } from "next";
import { Suspense } from "react";
import { MapExplorer } from "@/components/MapExplorer";
import { toMapBeaches } from "@/lib/beach-map";
import { getAllBeachesSnapshot, scheduleBeachDataRefresh } from "@/lib/services/beachDataService";

export const metadata: Metadata = { title: "Mapa de temperatura del agua · Playa Hoy", description: "Compara la temperatura actual del agua en las playas de la Costa del Sol y Almuñécar." };
export const revalidate = 900;

export default async function TemperatureMapPage() {
  const snapshot = await getAllBeachesSnapshot();
  scheduleBeachDataRefresh(snapshot);
  return <Suspense fallback={<main className="min-h-screen bg-[#f6f4ec]"/>}><MapExplorer initialBeaches={toMapBeaches(snapshot.beaches)} referenceTime={snapshot.referenceTime} mapTilerKey={process.env.NEXT_PUBLIC_MAPTILER_API_KEY}/></Suspense>;
}
