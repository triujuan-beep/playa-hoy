"use client";

import { useEffect, useRef } from "react";
import L from "leaflet";
import "leaflet/dist/leaflet.css";
import type { RankedMapBeach } from "@/lib/beach-map";
import { waterComfort } from "@/lib/water-temperature";

const color = (temperature?: number) => temperature === undefined ? "#647b86" : temperature < 18 ? "#397fa7" : temperature < 23 ? "#078679" : "#df7c3c";
const label = (temperature?: number) => temperature === undefined ? "—" : `${temperature.toLocaleString("es-ES", { maximumFractionDigits: 1 })}°`;

export function BeachTemperatureMapLeaflet({ beaches, mapTilerKey, selectedId, onSelect, className }: { beaches: RankedMapBeach[]; mapTilerKey: string; selectedId?: string; onSelect?: (id: string) => void; className?: string }) {
  const nodeRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<L.Map | null>(null);
  const markersRef = useRef(new Map<string, L.Marker>());
  const onSelectRef = useRef(onSelect);

  useEffect(() => { onSelectRef.current = onSelect; }, [onSelect]);

  useEffect(() => {
    if (!nodeRef.current || mapRef.current) return;
    const map = L.map(nodeRef.current, { zoomControl: true, scrollWheelZoom: false }).setView([36.58, -4.55], 9);
    L.tileLayer(`https://api.maptiler.com/maps/streets-v4/256/{z}/{x}/{y}.png?key=${encodeURIComponent(mapTilerKey)}`, {
      maxZoom: 19,
      crossOrigin: true,
      attribution: '&copy; <a href="https://www.maptiler.com/copyright/">MapTiler</a> &copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
    }).addTo(map);
    mapRef.current = map;
    const markers = markersRef.current;
    return () => { map.remove(); mapRef.current = null; markers.clear(); };
  }, [mapTilerKey]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    markersRef.current.forEach((marker) => marker.remove());
    markersRef.current.clear();
    beaches.forEach((beach) => {
      const active = beach.id === selectedId;
      const icon = L.divIcon({
        className: "water-map-marker-wrap",
        html: `<span class="water-map-marker${active ? " is-selected" : ""}" style="--marker-color:${color(beach.waterTemperature)}">${label(beach.waterTemperature)}</span>`,
        iconSize: [48, 34], iconAnchor: [24, 34], popupAnchor: [0, -34],
      });
      const marker = L.marker([beach.latitude, beach.longitude], { icon, title: `${beach.name}: ${label(beach.waterTemperature)}`, alt: beach.name, keyboard: true }).addTo(map);
      const popup = document.createElement("div");
      const title = document.createElement("strong"); title.textContent = beach.name; popup.append(title);
      const detail = document.createElement("p"); detail.textContent = beach.waterTemperature === undefined ? "Dato no disponible." : `${label(beach.waterTemperature)} · ${waterComfort(beach.waterTemperature)}`; detail.style.margin = "6px 0 2px"; popup.append(detail);
      const ranking = document.createElement("p"); ranking.textContent = beach.excluded ? beach.exclusionReason ?? "No recomendada" : `Score ${beach.score}/100${beach.rank ? ` · #${beach.rank} del ranking` : ""} · ${beach.municipality}`; ranking.style.margin = "0 0 8px"; popup.append(ranking);
      const link = document.createElement("a"); link.href = `/playa/${beach.slug}`; link.textContent = "Ver ficha →"; link.style.fontWeight = "800"; link.style.color = "#075b78"; popup.append(link);
      marker.bindPopup(popup).on("click", () => onSelectRef.current?.(beach.id));
      markersRef.current.set(beach.id, marker);
    });
  }, [beaches, selectedId]);

  useEffect(() => {
    const marker = selectedId ? markersRef.current.get(selectedId) : undefined;
    if (marker) { marker.openPopup(); mapRef.current?.setView(marker.getLatLng(), Math.max(mapRef.current.getZoom(), 12)); }
  }, [selectedId]);

  return <div ref={nodeRef} className={`h-[420px] w-full overflow-hidden rounded-2xl bg-[#edf4f2] ${className ?? ""}`} aria-label="Mapa de temperatura del agua por playa"/>;
}
