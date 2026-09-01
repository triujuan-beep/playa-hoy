"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { useSearchParams } from "next/navigation";
import { BeachFilters } from "./BeachFilters";
import { BeachTemperatureMap } from "./BeachTemperatureMap";
import { Header } from "./Header";
import { rankMapBeaches, type MapBeach } from "@/lib/beach-map";
import type { Priority } from "@/lib/types";

const allowed = new Set<Priority>(["warmWater", "lowWind", "calmSea", "lowJellyfish"]);

export function MapExplorer({ initialBeaches, referenceTime, mapTilerKey }: { initialBeaches: MapBeach[]; referenceTime: string; mapTilerKey?: string }) {
  const search = useSearchParams();
  const initialPriorities = useMemo(() => (search.get("priorities") ?? "").split(",").filter((value): value is Priority => allowed.has(value as Priority)), [search]);
  const [priorities, setPriorities] = useState<Priority[]>(initialPriorities);
  const [selectedId, setSelectedId] = useState<string>();
  const [location, setLocation] = useState<{ lat: number; lon: number }>();
  const [locating, setLocating] = useState(false);
  const [locationError, setLocationError] = useState("");
  const jellyfishAvailable = initialBeaches.some((beach) => beach.jellyfishObservation !== undefined);
  const ranked = useMemo(() => rankMapBeaches(initialBeaches, priorities), [initialBeaches, priorities]);
  const top = useMemo(() => ranked.filter((beach) => !beach.excluded).sort((a, b) => (a.rank ?? Infinity) - (b.rank ?? Infinity)).slice(0, 5), [ranked]);
  const selectedBeach = selectedId ? ranked.find((beach) => beach.id === selectedId) : undefined;
  const toggle = (priority: Priority) => setPriorities((current) => current.includes(priority) ? current.filter((item) => item !== priority) : [...current, priority]);
  const locate = () => {
    if (!navigator.geolocation) { setLocationError("Tu navegador no permite compartir la ubicación."); return; }
    setLocating(true); setLocationError("");
    navigator.geolocation.getCurrentPosition((position) => { setLocation({ lat: position.coords.latitude, lon: position.coords.longitude }); setLocating(false); }, () => { setLocationError("No hemos podido obtener tu ubicación. Revisa los permisos del navegador."); setLocating(false); });
  };
  return <><Header onLocate={locate} locating={locating} hasLocation={Boolean(location)}/><main className="min-h-screen bg-[#f6f4ec] pb-16">
    <section className="bg-[#075b78] text-white"><div className="mx-auto max-w-6xl px-4 pb-20 pt-10 sm:px-6"><p className="text-xs font-extrabold uppercase tracking-[.16em] text-[#a9e9df]">Explora la costa</p><h1 className="mt-2 text-4xl font-extrabold tracking-[-.04em] sm:text-5xl">Temperatura del agua</h1><p className="mt-3 max-w-2xl text-white/70">Compara las {initialBeaches.length} playas con el mismo snapshot y ranking de Playa Hoy.</p></div></section>
    <div className="mx-auto -mt-12 max-w-6xl px-4 sm:px-6"><BeachFilters selected={priorities} onToggle={toggle} jellyfishAvailable={jellyfishAvailable}/>{locationError && <p role="alert" className="mt-3 rounded-xl bg-red-50 px-4 py-3 text-sm font-bold text-red-700">{locationError}</p>}
      <div className="mt-6 grid gap-5 lg:grid-cols-[1fr_320px]"><section className="rounded-3xl border border-[#dce5e4] bg-white p-3 shadow-sm sm:p-5"><BeachTemperatureMap beaches={ranked} mapTilerKey={mapTilerKey} selectedId={selectedId} onSelect={setSelectedId} className="h-[58vh] min-h-[430px]"/><p className="mt-3 px-1 text-xs text-[#647b86]">Snapshot: {new Intl.DateTimeFormat("es-ES", { dateStyle: "medium", timeStyle: "short", timeZone: "Europe/Madrid" }).format(new Date(referenceTime))}. El color expresa confort térmico, no seguridad.</p></section>
      <aside className="rounded-3xl border border-[#dce5e4] bg-white p-4 sm:p-5">{selectedBeach && !top.some((beach) => beach.id === selectedBeach.id) && <div className="mb-5"><p className="text-xs font-extrabold uppercase tracking-[.14em] text-[#078679]">Playa seleccionada</p><BeachMapRow beach={selectedBeach} selected onSelect={setSelectedId}/></div>}<h2 className="text-xl font-extrabold">Top 5 actual</h2><div className="mt-4 grid gap-2">{top.map((beach) => <BeachMapRow key={beach.id} beach={beach} selected={selectedId === beach.id} onSelect={setSelectedId}/>)}</div><Link href="/" className="mt-5 inline-flex min-h-11 w-full items-center justify-center rounded-xl border border-[#075b78] text-sm font-extrabold text-[#075b78]">← Volver al ranking</Link></aside></div>
    </div></main></>;
}

function BeachMapRow({ beach, selected, onSelect }: { beach: ReturnType<typeof rankMapBeaches>[number]; selected: boolean; onSelect: (id: string) => void }) {
  return <button type="button" onClick={() => onSelect(beach.id)} className={`mt-2 w-full rounded-2xl border p-3 text-left ${selected ? "border-[#078679] bg-[#edf8f5]" : "border-[#e4ebe8] bg-[#fbfcfa]"}`}><span className="text-xs font-extrabold text-[#078679]">{beach.rank ? `#${beach.rank} · ` : ""}{beach.excluded ? "No recomendada" : `${beach.score}/100`}</span><span className="mt-1 block font-extrabold">{beach.name}</span><span className="text-xs text-[#647b86]">{beach.municipality} · {beach.waterTemperature === undefined ? "Dato no disponible." : `${beach.waterTemperature.toLocaleString("es-ES", { maximumFractionDigits: 1 })} °C`}</span></button>;
}
