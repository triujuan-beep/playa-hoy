"use client";

import dynamic from "next/dynamic";
import type { RankedMapBeach } from "@/lib/beach-map";

const LeafletMap = dynamic(() => import("./BeachTemperatureMapLeaflet").then((module) => module.BeachTemperatureMapLeaflet), {
  ssr: false,
  loading: () => <div className="flex h-[420px] items-center justify-center rounded-2xl bg-[#edf4f2] text-sm font-bold text-[#647b86]">Cargando mapa…</div>,
});

export function BeachTemperatureMap(props: { beaches: RankedMapBeach[]; mapTilerKey?: string; selectedId?: string; onSelect?: (id: string) => void; className?: string }) {
  if (!props.mapTilerKey) return <div role="status" className="flex h-[420px] items-center justify-center rounded-2xl border border-amber-200 bg-amber-50 p-6 text-center text-sm font-bold text-amber-800">El mapa no está disponible temporalmente.</div>;
  return <LeafletMap {...props} mapTilerKey={props.mapTilerKey}/>;
}
