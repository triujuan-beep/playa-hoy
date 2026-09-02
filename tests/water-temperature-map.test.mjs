import assert from "node:assert/strict";
import test from "node:test";
import { madridDateAndHour, shiftDate, summarizeWaterTemperature, waterComfort, waterHistoryAvailability, waterHistoryCacheState, waterTrend } from "../src/lib/water-temperature.ts";
import { rankMapBeaches, toMapBeaches } from "../src/lib/beach-map.ts";
import { assertWeatherCoverage, requireSharedSnapshotForBuild, weatherCoverageRejection } from "../src/lib/snapshot-policy.ts";

const municipalities = Array.from({ length: 15 }, (_, index) => `Municipio ${index + 1}`);
const weatherSnapshot = (covered = municipalities, refreshedAt = "2026-09-01T12:00:00.000Z") => ({
  refreshedAt,
  beaches: municipalities.map((municipality) => ({
    municipality,
    sources: { weather: { state: covered.includes(municipality) ? "live" : "unavailable" } },
  })),
});

test("clasifica el confort en los límites aprobados", () => {
  assert.equal(waterComfort(20.9), "Fría");
  assert.equal(waterComfort(21), "Agradable");
  assert.equal(waterComfort(23.9), "Agradable");
  assert.equal(waterComfort(24), "Muy agradable");
});

test("el build reutiliza el snapshot compartido existente", () => {
  const snapshot = weatherSnapshot();
  assert.equal(requireSharedSnapshotForBuild(snapshot), snapshot);
});

test("el build reutiliza también un snapshot vencido", () => {
  const stale = weatherSnapshot(municipalities, "2026-08-01T00:00:00.000Z");
  assert.equal(requireSharedSnapshotForBuild(stale), stale);
});

test("una respuesta AEMET parcial no puede degradar la cobertura anterior", () => {
  assert.throws(
    () => assertWeatherCoverage(weatherSnapshot(municipalities.slice(0, 14)), municipalities),
    /Weather coverage would regress/,
  );
});

test("runtime puede rechazar un candidato parcial sin lanzar una excepción", () => {
  assert.match(weatherCoverageRejection(weatherSnapshot(municipalities.slice(0, 14)), municipalities) ?? "", /Municipio 15/);
  assert.equal(weatherCoverageRejection(weatherSnapshot(), municipalities), undefined);
});

test("sin snapshot previo se exige cobertura de los 15 municipios", () => {
  assert.throws(() => assertWeatherCoverage(weatherSnapshot(municipalities.slice(0, 14)), municipalities), /Municipio 15/);
  assert.doesNotThrow(() => assertWeatherCoverage(weatherSnapshot(), municipalities));
});

test("el build aborta si no existe ningún snapshot compartido", () => {
  assert.throws(() => requireSharedSnapshotForBuild(undefined), /aborting without calling providers/);
});

test("calcula tendencia con umbral inclusivo de 0,5 °C", () => {
  assert.equal(waterTrend([{ date: "a", value: 20 }, { date: "b", value: 20.1 }, { date: "c", value: 20.2 }, { date: "d", value: 20.5 }]).label, "Calentándose");
  assert.equal(waterTrend([{ date: "a", value: 20 }, { date: "b", value: 20 }, { date: "c", value: 20 }, { date: "d", value: 19.5 }]).label, "Enfriándose");
  assert.equal(waterTrend([{ date: "a", value: 20 }, { date: "b", value: 20 }, { date: "c", value: 20 }, { date: "d", value: 20.4 }]).label, "Estable");
});

test("resume sin inventar huecos", () => {
  const summary = summarizeWaterTemperature([{ date: "a", value: 20 }, { date: "b", value: null }, { date: "c", value: 21 }]);
  assert.equal(summary.today, 21);
  assert.equal(summary.yesterdayDelta, null);
  assert.equal(summary.minimum, 20);
  assert.equal(summary.maximum, 21);
});

test("maneja fechas y hora local de Madrid", () => {
  assert.equal(shiftDate("2026-03-01", -1), "2026-02-28");
  assert.deepEqual(madridDateAndHour("2026-08-26T12:00:00Z"), { date: "2026-08-26", hour: 14 });
  assert.deepEqual(madridDateAndHour("2026-08-26T23:00"), { date: "2026-08-26", hour: 23 });
});

test("distingue histórico fresh, stale, expirado y no disponible", () => {
  const now = Date.parse("2026-08-28T12:00:00Z");
  assert.equal(waterHistoryCacheState("2026-08-28T00:00:00Z", now), "fresh");
  assert.equal(waterHistoryCacheState("2026-08-26T00:00:00Z", now), "stale");
  assert.equal(waterHistoryCacheState("2026-08-20T00:00:00Z", now), "expired");
  assert.equal(waterHistoryAvailability(false, "fallo"), "unavailable");
});

test("el DTO del mapa elimina datos pesados y conserva el ranking preciso", () => {
  const base = { id: "a", slug: "a", name: "A", municipality: "M", province: "Málaga", autonomousCommunity: "Andalucía", coastZone: "centro", latitude: 36, longitude: -4, sanitaryStatus: "safe", waterTemperature: 23, windSpeed: 5, waveHeight: 0.2, hourlyConditions: [{ time: "2026-08-26T12:00", waterTemperature: 23 }], metricMetadata: {}, sources: {} };
  const beaches = toMapBeaches([base, { ...base, id: "b", slug: "b", name: "B", waterTemperature: 19 }]);
  assert.equal("hourlyConditions" in beaches[0], false);
  const ranked = rankMapBeaches(beaches, ["warmWater"]);
  assert.equal(ranked.find((beach) => beach.id === "a")?.rank, 1);
  assert.ok((ranked.find((beach) => beach.id === "a")?.score ?? 0) > (ranked.find((beach) => beach.id === "b")?.score ?? 0));
  const excluded = rankMapBeaches([{ ...beaches[0], id: "closed", slug: "closed", sanitaryStatus: "closed" }]);
  assert.equal(excluded[0].excluded, true);
  assert.equal(excluded[0].rank, null);
});
