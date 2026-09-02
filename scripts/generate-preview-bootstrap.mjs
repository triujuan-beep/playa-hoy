import { createHash } from "node:crypto";
import { writeFile } from "node:fs/promises";
import { beaches as mockCatalog } from "../src/lib/mock-beaches.ts";
import { AEMET_MUNICIPALITY_CODES } from "../src/lib/aemet-config.ts";

const AEMET_API = "https://opendata.aemet.es/opendata/api";
const AEMET_SOURCE = "https://opendata.aemet.es/dist/index.html";
const MARINE_API = "https://marine-api.open-meteo.com/v1/marine";
const MARINE_SOURCE = "https://open-meteo.com/en/docs/marine-weather-api";
const PROJECT_ID = "prj_RWUJkPtyREVihsWwSPUgf54lckzV";
const TIMEZONE = "Europe/Madrid";
const AEMET_REQUEST_INTERVAL_MS = 10_000;
const AEMET_RETRY_BACKOFF_MS = [60_000, 120_000, 240_000];
const MARINE_FIELDS = ["sea_surface_temperature", "wave_height", "wave_direction", "wave_period", "swell_wave_height", "swell_wave_direction", "swell_wave_period", "ocean_current_velocity", "ocean_current_direction"];
const output = process.argv[2];
const commitSha = process.env.GITHUB_SHA ?? process.env.VERCEL_GIT_COMMIT_SHA;
const apiKey = process.env.AEMET_API_KEY;
if (!output) throw new Error("Usage: generate-preview-bootstrap.mjs <output.json>");
if (!apiKey) throw new Error("AEMET_API_KEY is required.");
if (!commitSha || !/^[0-9a-f]{40}$/i.test(commitSha)) throw new Error("A 40-character commit SHA is required.");

const catalog = mockCatalog.map(({ id, slug, legacySlugs, aliases, name, municipality, province, autonomousCommunity, coastZone, latitude, longitude }) => ({ id, slug, legacySlugs, aliases, name, municipality, province, autonomousCommunity, coastZone, latitude, longitude }));
if (catalog.length !== 63) throw new Error(`Expected 63 catalog beaches; found ${catalog.length}.`);
const municipalities = [...new Set(catalog.map((beach) => beach.municipality))];
if (municipalities.length !== 15) throw new Error(`Expected 15 municipalities; found ${municipalities.length}.`);
const sha256 = (value) => createHash("sha256").update(value).digest("hex");
const wait = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));
let nextAemetRequestAt = 0;
async function paceAemetRequest() {
  const delay = Math.max(0, nextAemetRequestAt - Date.now());
  if (delay) await wait(delay);
  nextAemetRequestAt = Date.now() + AEMET_REQUEST_INTERVAL_MS;
}
function retryAfterMilliseconds(value) {
  if (!value) return undefined;
  const seconds = Number(value);
  if (Number.isFinite(seconds) && seconds >= 0) return seconds * 1000;
  const date = Date.parse(value);
  return Number.isFinite(date) ? Math.max(0, date - Date.now()) : undefined;
}
const jitterMilliseconds = () => 1_000 + Math.floor(Math.random() * 2_001);
const valueAt = (values, index) => typeof values?.[index] === "number" && Number.isFinite(values[index]) ? values[index] : undefined;
const first = (value) => Array.isArray(value) ? value[0] : value;
const number = (value) => { const parsed = Number(first(value)); return value !== undefined && value !== null && value !== "" && Number.isFinite(parsed) ? parsed : undefined; };
const periodStart = (period) => { const parsed = Number(period?.length === 4 ? period.slice(0, 2) : period); return Number.isFinite(parsed) ? parsed : undefined; };
const distance = (a, b) => Math.min(Math.abs(a - b), 24 - Math.abs(a - b));
const closest = (values, hour) => values?.filter((item) => periodStart(item.periodo) !== undefined).reduce((best, item) => !best || distance(periodStart(item.periodo), hour) < distance(periodStart(best.periodo), hour) ? item : best, undefined);
const inInterval = (period, hour) => /^\d{4}$/.test(period ?? "") && (Number(period.slice(0, 2)) < Number(period.slice(2)) ? hour >= Number(period.slice(0, 2)) && hour < Number(period.slice(2)) : hour >= Number(period.slice(0, 2)) || hour < Number(period.slice(2)));
const compass = (value) => ({ N: 0, NE: 45, E: 90, SE: 135, S: 180, SO: 225, O: 270, NO: 315 })[first(value)];

function madridParts(now = new Date()) {
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone: TIMEZONE, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).formatToParts(now);
  const part = (type) => parts.find((item) => item.type === type)?.value ?? "00";
  return { date: `${part("year")}-${part("month")}-${part("day")}`, hour: Number(part("hour")), minute: Number(part("minute")) };
}

async function checkedFetch(url, provider) {
  let lastError;
  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      const response = await fetch(url, { cache: "no-store", signal: AbortSignal.timeout(15_000) });
      if (response.status === 429) throw new Error(`${provider} HTTP 429; bootstrap aborted.`);
      if (response.ok || response.status < 500) return response;
      lastError = new Error(`${provider} HTTP ${response.status}`);
    } catch (error) {
      if (String(error?.message).includes("HTTP 429")) throw error;
      lastError = error;
    }
    if (attempt < 2) await wait(1_000 * (attempt + 1));
  }
  throw lastError instanceof Error ? lastError : new Error(`${provider} unavailable.`);
}

async function checkedAemetFetch(url, provider) {
  let lastError;
  for (let attempt = 0; attempt < 4; attempt += 1) {
    await paceAemetRequest();
    try {
      const response = await fetch(url, { cache: "no-store", signal: AbortSignal.timeout(15_000) });
      if (response.ok || response.status < 500 && response.status !== 429) return response;
      lastError = new Error(`${provider} HTTP ${response.status}`);
      if (attempt === 3) break;
      const retryAfter = response.status === 429 ? retryAfterMilliseconds(response.headers.get("retry-after")) : undefined;
      const baseDelay = retryAfter ?? (response.status === 429 ? AEMET_RETRY_BACKOFF_MS[attempt] : 1_000 * 2 ** attempt);
      const delay = baseDelay + jitterMilliseconds();
      console.warn(`[preview-bootstrap] ${provider} HTTP ${response.status}; retry ${attempt + 1}/3 in ${Math.ceil(delay / 1000)} s${retryAfter !== undefined ? " (Retry-After)" : ""}`);
      await wait(delay);
      continue;
    } catch (error) {
      lastError = error;
      if (attempt === 3) break;
      const delay = 1_000 * 2 ** attempt + jitterMilliseconds();
      console.warn(`[preview-bootstrap] ${provider} network error; retry ${attempt + 1}/3 in ${Math.ceil(delay / 1000)} s`);
      await wait(delay);
    }
  }
  throw lastError instanceof Error ? new Error(`${lastError.message}; bootstrap aborted after 4 attempts.`) : new Error(`${provider} unavailable after 4 attempts.`);
}

function parseWeather(payload) {
  const root = payload?.[0];
  const days = root?.prediccion?.dia ?? [];
  if (!days.length) throw new Error("AEMET parser: forecast has no days.");
  const local = madridParts();
  const target = madridParts(new Date(Date.now() + (local.minute >= 30 ? 3_600_000 : 0)));
  const hourly = days.flatMap((day) => {
    const date = day.fecha?.slice(0, 10);
    if (!date) return [];
    return Array.from({ length: 24 }, (_, hour) => {
      const temperature = closest(day.temperatura, hour);
      const probability = day.probPrecipitacion?.find((item) => inInterval(item.periodo, hour)) ?? closest(day.probPrecipitacion, hour);
      const wind = closest(day.vientoAndRachaMax?.filter((item) => item.velocidad !== undefined), hour);
      const gust = closest(day.vientoAndRachaMax?.filter((item) => item.value !== undefined), hour);
      return { time: `${date}T${String(hour).padStart(2, "0")}:00`, airTemperature: number(temperature?.value), windSpeed: number(wind?.velocidad), windGust: number(gust?.value), windDirection: compass(wind?.direccion), rainProbability: number(probability?.value) };
    });
  }).filter((point) => [point.airTemperature, point.windSpeed, point.windGust, point.windDirection, point.rainProbability].some((value) => value !== undefined));
  const targetTime = `${target.date}T${String(target.hour).padStart(2, "0")}:00`;
  const current = hourly.reduce((best, item) => !best || Math.abs(Date.parse(`${item.time}:00Z`) - Date.parse(`${targetTime}:00Z`)) < Math.abs(Date.parse(`${best.time}:00Z`) - Date.parse(`${targetTime}:00Z`)) ? item : best, undefined);
  if (!current) throw new Error("AEMET parser: no usable hourly metrics.");
  return { ...current, hourly, updatedAt: root.elaborado ?? root.origen?.elaborado, validFor: current.time, source: "AEMET OpenData", sourceUrl: AEMET_SOURCE };
}

async function fetchWeather(municipality) {
  const code = AEMET_MUNICIPALITY_CODES[municipality];
  if (!code) throw new Error(`No AEMET code for ${municipality}.`);
  const metadataResponse = await checkedAemetFetch(`${AEMET_API}/prediccion/especifica/municipio/horaria/${code}?api_key=${encodeURIComponent(apiKey)}`, `AEMET ${municipality} metadata`);
  if (!metadataResponse.ok) throw new Error(`AEMET ${municipality} metadata HTTP ${metadataResponse.status}.`);
  const metadata = await metadataResponse.json();
  if (!metadata.datos) throw new Error(`AEMET ${municipality} returned no data URL.`);
  const dataResponse = await checkedAemetFetch(metadata.datos, `AEMET ${municipality} data`);
  if (!dataResponse.ok) throw new Error(`AEMET ${municipality} data HTTP ${dataResponse.status}.`);
  return parseWeather(await dataResponse.json());
}

function normalizeMarine(response) {
  const hourly = response.hourly;
  const times = hourly?.time ?? [];
  if (!times.length) return null;
  const local = madridParts();
  const target = Date.parse(`${local.date}T${String(local.hour).padStart(2, "0")}:00:00Z`);
  const index = times.reduce((best, time, itemIndex) => Math.abs(Date.parse(`${time}:00Z`) - target) < Math.abs(Date.parse(`${times[best]}:00Z`) - target) ? itemIndex : best, 0);
  const series = times.map((time, itemIndex) => ({ time, waterTemperature: valueAt(hourly.sea_surface_temperature, itemIndex), waveHeight: valueAt(hourly.wave_height, itemIndex), waveDirection: valueAt(hourly.wave_direction, itemIndex), wavePeriod: valueAt(hourly.wave_period, itemIndex), swellWaveHeight: valueAt(hourly.swell_wave_height, itemIndex), swellWaveDirection: valueAt(hourly.swell_wave_direction, itemIndex), swellWavePeriod: valueAt(hourly.swell_wave_period, itemIndex), oceanCurrentVelocity: valueAt(hourly.ocean_current_velocity, itemIndex), oceanCurrentDirection: valueAt(hourly.ocean_current_direction, itemIndex) }));
  return { ...series[index], hourly: series, validFor: times[index], source: "Open-Meteo Marine · DWD", sourceUrl: MARINE_SOURCE };
}

async function fetchMarineBatch(batch) {
  const params = new URLSearchParams({ latitude: batch.map((beach) => beach.latitude).join(","), longitude: batch.map((beach) => beach.longitude).join(","), hourly: MARINE_FIELDS.join(","), forecast_days: "2", timezone: TIMEZONE, cell_selection: "sea" });
  const response = await checkedFetch(`${MARINE_API}?${params}`, "Open-Meteo Marine");
  if (!response.ok) throw new Error(`Open-Meteo Marine HTTP ${response.status}.`);
  const body = await response.json();
  return (Array.isArray(body) ? body : [body]).map((item, index) => [batch[item.location_id ?? index]?.id, normalizeMarine(item)]);
}

const weatherByMunicipality = new Map();
for (const municipality of municipalities) {
  const result = await fetchWeather(municipality);
  weatherByMunicipality.set(municipality, result);
  console.log(`[preview-bootstrap] AEMET ${municipality}: OK`);
}
if (weatherByMunicipality.size !== 15) throw new Error(`AEMET coverage is ${weatherByMunicipality.size}/15.`);

const marineEntries = (await Promise.all(Array.from({ length: Math.ceil(catalog.length / 20) }, (_, index) => catalog.slice(index * 20, (index + 1) * 20)).map(fetchMarineBatch))).flat();
const marineByBeach = new Map(marineEntries.filter(([id, sea]) => id && sea));
if (marineByBeach.size !== 63) throw new Error(`Marine coverage is ${marineByBeach.size}/63.`);

const generatedAt = new Date();
const snapshot = {
  beaches: catalog.map((base) => {
    const weather = weatherByMunicipality.get(base.municipality);
    const sea = marineByBeach.get(base.id);
    const weatherHours = new Map(weather.hourly.map((item) => [item.time.slice(0, 16), item]));
    const seaHours = new Map(sea.hourly.map((item) => [item.time.slice(0, 16), item]));
    const times = [...new Set([...weatherHours.keys(), ...seaHours.keys()])].sort();
    const hourlyConditions = times.map((time) => ({ time, ...weatherHours.get(time), ...seaHours.get(time) }));
    const weatherMeta = { origin: "forecast", source: "AEMET OpenData", sourceUrl: AEMET_SOURCE, updatedAt: weather.updatedAt, validFor: weather.validFor };
    const seaMeta = { origin: "forecast", source: "Open-Meteo Marine", sourceUrl: MARINE_SOURCE, validFor: sea.validFor };
    return {
      ...base,
      airTemperature: weather.airTemperature, windSpeed: weather.windSpeed, windGust: weather.windGust, windDirection: weather.windDirection, rainProbability: weather.rainProbability,
      waterTemperature: sea.waterTemperature, waveHeight: sea.waveHeight, waveDirection: sea.waveDirection, wavePeriod: sea.wavePeriod, swellWaveHeight: sea.swellWaveHeight, swellWaveDirection: sea.swellWaveDirection, swellWavePeriod: sea.swellWavePeriod, oceanCurrentVelocity: sea.oceanCurrentVelocity, oceanCurrentDirection: sea.oceanCurrentDirection,
      sanitaryStatus: "unknown", sanitaryMessage: "No hay un informe sanitario oficial vigente disponible.", dataMode: "real", dataCompleteness: 50, hourlyConditions,
      metricMetadata: { waterTemperature: seaMeta, waveHeight: seaMeta, waveDirection: seaMeta, wavePeriod: seaMeta, swellWaveHeight: seaMeta, swellWaveDirection: seaMeta, swellWavePeriod: seaMeta, oceanCurrentVelocity: seaMeta, oceanCurrentDirection: seaMeta, airTemperature: weatherMeta, windSpeed: weatherMeta, windGust: weatherMeta, rainProbability: weatherMeta, sanitaryStatus: { origin: "unknown" }, jellyfishRisk: { origin: "unknown" }, occupancy: { origin: "unknown" } },
      sources: {
        weather: { state: "live", origin: "forecast", label: "Meteorología", source: weather.source, sourceUrl: weather.sourceUrl, updatedAt: weather.updatedAt, validFor: weather.validFor },
        sea: { state: "live", origin: "forecast", label: "Estado del mar", source: sea.source, sourceUrl: sea.sourceUrl, validFor: sea.validFor },
        sanitary: { state: "unavailable", origin: "unknown", label: "Estado sanitario", message: "No hay un informe sanitario oficial vigente disponible." },
        jellyfish: { state: "unavailable", origin: "unknown", sourceType: "crowdsourced", label: "Medusas", source: "MedusApp · CC BY-NC-SA 4.0", message: "El bootstrap Preview no incorpora observaciones de MedusApp." },
        occupancy: { state: "coming-soon", origin: "unknown", label: "Ocupación", message: "Fuente en proceso de integración." }
      }
    };
  }),
  referenceTime: generatedAt.toISOString(),
  refreshedAt: generatedAt.toISOString()
};
const catalogHash = sha256(JSON.stringify(catalog.map(({ id, slug, municipality, latitude, longitude }) => ({ id, slug, municipality, latitude, longitude }))));
const seed = { schemaVersion: 1, targetEnvironment: "preview", projectId: PROJECT_ID, commitSha, catalogHash, generatedAt: generatedAt.toISOString(), expiresAt: new Date(generatedAt.getTime() + 30 * 60 * 1000).toISOString(), snapshotHash: sha256(JSON.stringify(snapshot)), snapshot };
await writeFile(output, `${JSON.stringify(seed, null, 2)}\n`, "utf8");
console.log(`[preview-bootstrap] seed ready · AEMET 15/15 · marine 63/63 · snapshot ${seed.snapshotHash}`);
