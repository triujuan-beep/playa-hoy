"use client";

import dynamic from "next/dynamic";
import { useEffect, useMemo, useState } from "react";
import type { RankedMapBeach } from "@/lib/beach-map";
import { formatWaterTemperature, summarizeWaterTemperature, waterHistoryAvailability, type WaterTemperaturePoint } from "@/lib/water-temperature";
import { BeachTemperatureMap } from "./BeachTemperatureMap";

const WaterChart = dynamic(() => import("./WaterTemperatureChart").then((module) => module.WaterTemperatureChart), { ssr: false, loading: () => <div className="h-72 animate-pulse rounded-2xl bg-[#edf4f2]"/> });

type HistoryResponse = { points: WaterTemperaturePoint[]; stale: boolean; message?: string; error?: string };

export function WaterTemperaturePanel({ slug, currentTemperature, currentDate, anchorTime, mapBeaches, mapTilerKey, currentBeachId }: { slug: string; currentTemperature?: number; currentDate: string; anchorTime: string; mapBeaches: RankedMapBeach[]; mapTilerKey?: string; currentBeachId: string }) {
  const [tab, setTab] = useState<"chart" | "map">("chart");
  const [history, setHistory] = useState<HistoryResponse>();
  const [error, setError] = useState("");
  useEffect(() => {
    const controller = new AbortController();
    fetch(`/api/playas/${encodeURIComponent(slug)}/temperatura-historica?anchor=${encodeURIComponent(anchorTime)}`, { signal: controller.signal })
      .then(async (response) => { const body = await response.json() as HistoryResponse; if (!response.ok) throw new Error(body.error ?? "No se pudo cargar el histórico"); return body; })
      .then(setHistory).catch((reason) => { if (reason instanceof DOMException && reason.name === "AbortError") return; setError(reason instanceof Error ? reason.message : "No se pudo cargar el histórico"); });
    return () => controller.abort();
  }, [slug, anchorTime]);
  const points = useMemo(() => [...(history?.points ?? []), { date: currentDate, value: currentTemperature ?? null }], [history, currentDate, currentTemperature]);
  const summary = summarizeWaterTemperature(points);
  const availability = waterHistoryAvailability(Boolean(history), error);
  return <section className="mt-6 rounded-3xl border border-[#dce5e4] bg-white p-5 sm:p-8">
    <div className="flex flex-wrap items-end justify-between gap-4">
      <div><p className="text-xs font-extrabold uppercase tracking-[.16em] text-[#078679]">Temperatura del agua</p><h2 className="mt-2 text-2xl font-extrabold">Evolución reciente</h2></div>
      <div role="tablist" aria-label="Vista de temperatura" className="flex rounded-xl bg-[#edf4f2] p-1">
        <button role="tab" aria-selected={tab === "chart"} onClick={() => setTab("chart")} className={`min-h-10 rounded-lg px-4 text-sm font-extrabold ${tab === "chart" ? "bg-white text-[#075b78] shadow-sm" : "text-[#647b86]"}`}>Gráfico</button>
        <button role="tab" aria-selected={tab === "map"} onClick={() => setTab("map")} className={`min-h-10 rounded-lg px-4 text-sm font-extrabold ${tab === "map" ? "bg-white text-[#075b78] shadow-sm" : "text-[#647b86]"}`}>Mapa</button>
      </div>
    </div>
    {tab === "chart" ? <>
      <div className="mt-5 grid grid-cols-2 gap-3 sm:grid-cols-5">
        <Summary label="Hoy" value={summary.today === null ? "Dato no disponible." : formatWaterTemperature(summary.today)} />
        <Summary label="Ayer" value={formatWaterTemperature(summary.yesterday)} />
        <Summary label="Diferencia" value={summary.yesterdayDelta === null ? "—" : `${summary.yesterdayDelta > 0 ? "+" : ""}${summary.yesterdayDelta.toLocaleString("es-ES", { minimumFractionDigits: 1, maximumFractionDigits: 1 })} °C`} />
        <Summary label="Tendencia 3 días" value={summary.trend.label} />
        <Summary label="Mín. / Máx." value={`${formatWaterTemperature(summary.minimum).replace(" °C", "°")} / ${formatWaterTemperature(summary.maximum)}`} />
      </div>
      {availability === "available" ? <WaterChart points={points}/> : availability === "unavailable" ? <div role="status" className="mt-5 rounded-2xl bg-slate-50 p-5 text-sm font-bold text-[#647b86]">Histórico temporalmente no disponible. La temperatura actual sigue siendo válida.</div> : <div className="mt-5 h-72 animate-pulse rounded-2xl bg-[#edf4f2]"/>}
      {history?.stale && <p className="mt-2 text-xs font-bold text-amber-700">Dato histórico anterior · {history.message}</p>}
      <p className="mt-3 text-xs leading-5 text-[#647b86]">14 días anteriores a la misma hora local y el dato actual exacto de la ficha. Los huecos no se interpolan. Fuente histórica: Open-Meteo Marine.</p>
    </> : <div className="mt-5"><BeachTemperatureMap beaches={mapBeaches} mapTilerKey={mapTilerKey} selectedId={currentBeachId}/><p className="mt-3 text-xs leading-5 text-[#647b86]">Temperatura actual del mismo snapshot que la ficha. Toca un marcador para consultar la playa.</p></div>}
    <p className="mt-5 border-t border-[#e4ebe8] pt-4 text-xs leading-5 text-[#647b86]">Referencia orientativa de confort: menos de 18 °C, fría; de 18 a 22,9 °C, agradable; desde 23 °C, muy agradable. No indica calidad sanitaria ni seguridad para el baño.</p>
  </section>;
}

function Summary({ label, value }: { label: string; value: string }) { return <div className="rounded-2xl bg-[#f2f8f6] p-3"><p className="text-[10px] font-extrabold uppercase tracking-wide text-[#7a8e96]">{label}</p><p className="mt-1 text-sm font-extrabold text-[#075b78] sm:text-base">{value}</p></div>; }
