export type WaterTemperaturePoint = { date: string; value: number | null };

export const WATER_COMFORT = {
  cold: 21,
  veryPleasant: 24,
} as const;

export function waterHistoryCacheState(fetchedAt: string, now = Date.now()) {
  const age = now - Date.parse(fetchedAt);
  if (!Number.isFinite(age) || age < 0) return "expired" as const;
  if (age <= 24 * 60 * 60 * 1000) return "fresh" as const;
  if (age <= 7 * 24 * 60 * 60 * 1000) return "stale" as const;
  return "expired" as const;
}

export function waterHistoryAvailability(loaded: boolean, error: string) {
  return loaded ? "available" as const : error ? "unavailable" as const : "loading" as const;
}

export function waterComfort(value: number | null | undefined) {
  if (value === null || value === undefined) return "Sin dato";
  if (value < WATER_COMFORT.cold) return "Fría";
  if (value < WATER_COMFORT.veryPleasant) return "Agradable";
  return "Muy agradable";
}

export function waterTrend(points: WaterTemperaturePoint[]) {
  const today = points.at(-1)?.value ?? null;
  const previous = points.at(-4)?.value ?? null;
  if (today === null || previous === null) return { label: "Sin tendencia", delta: null, tone: "neutral" as const };
  const delta = today - previous;
  if (delta >= 0.5) return { label: "Calentándose", delta, tone: "warmer" as const };
  if (delta <= -0.5) return { label: "Enfriándose", delta, tone: "cooler" as const };
  return { label: "Estable", delta, tone: "neutral" as const };
}

export function summarizeWaterTemperature(points: WaterTemperaturePoint[]) {
  const valid = points.filter((point): point is { date: string; value: number } => point.value !== null);
  const today = points.at(-1)?.value ?? null;
  const yesterday = points.at(-2)?.value ?? null;
  return {
    today,
    yesterday,
    yesterdayDelta: today !== null && yesterday !== null ? today - yesterday : null,
    minimum: valid.length ? Math.min(...valid.map((point) => point.value)) : null,
    maximum: valid.length ? Math.max(...valid.map((point) => point.value)) : null,
    trend: waterTrend(points),
  };
}

export const formatWaterTemperature = (value: number | null, digits = 1) =>
  value === null ? "—" : `${value.toLocaleString("es-ES", { minimumFractionDigits: digits, maximumFractionDigits: digits })} °C`;

export function madridDateAndHour(iso: string) {
  // Open-Meteo devuelve `validFor` como hora local sin offset cuando se solicita
  // timezone=Europe/Madrid. No debe reinterpretarse como UTC.
  if (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2})?$/.test(iso)) {
    return { date: iso.slice(0, 10), hour: Number(iso.slice(11, 13)) };
  }
  const date = new Date(iso);
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Europe/Madrid",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    hourCycle: "h23",
  }).formatToParts(date);
  const get = (type: Intl.DateTimeFormatPartTypes) => parts.find((part) => part.type === type)?.value ?? "";
  return { date: `${get("year")}-${get("month")}-${get("day")}`, hour: Number(get("hour")) };
}

export function shiftDate(date: string, days: number) {
  const [year, month, day] = date.split("-").map(Number);
  const shifted = new Date(Date.UTC(year, month - 1, day + days));
  return shifted.toISOString().slice(0, 10);
}
