import assert from "node:assert/strict";
import test from "node:test";
import { madridDateAndHour, shiftDate, summarizeWaterTemperature, waterComfort, waterHistoryAvailability, waterHistoryCacheState, waterTrend } from "../src/lib/water-temperature.ts";
import { rankMapBeaches, toMapBeaches } from "../src/lib/beach-map.ts";

test("clasifica el confort en los límites aprobados", () => {
  assert.equal(waterComfort(20.9), "Fría");
  assert.equal(waterComfort(21), "Agradable");
  assert.equal(waterComfort(23.9), "Agradable");
  assert.equal(waterComfort(24), "Muy agradable");
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
