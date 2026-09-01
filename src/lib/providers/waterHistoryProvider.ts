import "server-only";
import { getCache } from "@vercel/functions";
import { madridDateAndHour, shiftDate, waterHistoryCacheState, type WaterTemperaturePoint } from "../water-temperature";

const API_URL = "https://marine-api.open-meteo.com/v1/marine";
const TTL_SECONDS = 7 * 24 * 60 * 60;

type CachedHistory = { fetchedAt: string; time: string[]; temperature: Array<number | null> };
export type WaterHistoryResult = {
  points: WaterTemperaturePoint[];
  source: "Open-Meteo Marine";
  fetchedAt: string;
  stale: boolean;
  message?: string;
};

const inFlight = new Map<string, Promise<CachedHistory>>();

function isCachedHistory(value: unknown): value is CachedHistory {
  if (!value || typeof value !== "object") return false;
  const item = value as CachedHistory;
  return typeof item.fetchedAt === "string" && Array.isArray(item.time) && Array.isArray(item.temperature);
}

async function fetchHistory(latitude: number, longitude: number, endDate: string) {
  const startDate = shiftDate(endDate, -13);
  const url = new URL(API_URL);
  url.searchParams.set("latitude", String(latitude));
  url.searchParams.set("longitude", String(longitude));
  url.searchParams.set("hourly", "sea_surface_temperature");
  url.searchParams.set("timezone", "Europe/Madrid");
  url.searchParams.set("cell_selection", "sea");
  url.searchParams.set("start_date", startDate);
  url.searchParams.set("end_date", endDate);
  const response = await fetch(url, { signal: AbortSignal.timeout(12_000), next: { revalidate: 86_400 } });
  if (!response.ok) throw new Error(`Open-Meteo Marine respondió HTTP ${response.status}`);
  const body = (await response.json()) as { hourly?: { time?: string[]; sea_surface_temperature?: Array<number | null> } };
  if (!body.hourly?.time || !body.hourly.sea_surface_temperature) throw new Error("Open-Meteo Marine no devolvió histórico utilizable");
  return { fetchedAt: new Date().toISOString(), time: body.hourly.time, temperature: body.hourly.sea_surface_temperature };
}

async function liveCollapsed(key: string, latitude: number, longitude: number, endDate: string) {
  const pending = inFlight.get(key);
  if (pending) return pending;
  const request = fetchHistory(latitude, longitude, endDate).finally(() => inFlight.delete(key));
  inFlight.set(key, request);
  return request;
}

function normalize(history: CachedHistory, endDate: string, hour: number) {
  const byTime = new Map(history.time.map((time, index) => [time.slice(0, 16), history.temperature[index] ?? null]));
  return Array.from({ length: 14 }, (_, index) => {
    const date = shiftDate(endDate, index - 13);
    const target = `${date}T${String(hour).padStart(2, "0")}:00`;
    return { date, value: byTime.get(target) ?? null };
  });
}

export async function getWaterTemperatureHistory({ id, latitude, longitude, referenceTime, validFor }: { id: string; latitude: number; longitude: number; referenceTime: string; validFor?: string }) {
  const reference = madridDateAndHour(validFor ?? referenceTime);
  const endDate = shiftDate(reference.date, -1);
  const key = `water-history-v1:${id}:${endDate}`;
  const cache = getCache({ namespace: "playa-hoy" });
  let cached: CachedHistory | undefined;
  try {
    const value = await cache.get(key);
    if (isCachedHistory(value)) cached = value;
  } catch (error) {
    console.warn("[waterHistory] Runtime Cache read failed", error instanceof Error ? error.message : "error desconocido");
  }
  const fresh = cached && waterHistoryCacheState(cached.fetchedAt) === "fresh";
  if (fresh && cached) return { points: normalize(cached, endDate, reference.hour), source: "Open-Meteo Marine", fetchedAt: cached.fetchedAt, stale: false } satisfies WaterHistoryResult;
  try {
    const live = await liveCollapsed(key, latitude, longitude, endDate);
    try { await cache.set(key, live, { ttl: TTL_SECONDS, tags: ["water-temperature-history"], name: "Historical water temperature" }); } catch (error) { console.warn("[waterHistory] Runtime Cache write failed", error instanceof Error ? error.message : "error desconocido"); }
    return { points: normalize(live, endDate, reference.hour), source: "Open-Meteo Marine", fetchedAt: live.fetchedAt, stale: false } satisfies WaterHistoryResult;
  } catch (error) {
    console.error("[waterHistory] fetch failed", error instanceof Error ? error.message : "error desconocido");
    if (cached && waterHistoryCacheState(cached.fetchedAt) === "stale") return { points: normalize(cached, endDate, reference.hour), source: "Open-Meteo Marine", fetchedAt: cached.fetchedAt, stale: true, message: "Se muestra el último histórico válido disponible." } satisfies WaterHistoryResult;
    throw error;
  }
}
