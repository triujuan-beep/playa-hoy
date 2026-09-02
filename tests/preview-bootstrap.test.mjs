import assert from "node:assert/strict";
import test from "node:test";
import { beaches as catalog } from "../src/lib/mock-beaches.ts";
import { beachSnapshotHash, currentCatalogHash, PLAYA_HOY_VERCEL_PROJECT_ID, validatePreviewBootstrapSeed } from "../src/lib/preview-bootstrap-contract.ts";

const commitSha = "a".repeat(40);
const now = Date.parse("2026-09-02T10:00:00.000Z");
const snapshot = {
  beaches: catalog.map((beach) => ({ ...beach, sanitaryStatus: "unknown", waterTemperature: 23, waveHeight: 0.3, sources: { weather: { state: "live", origin: "forecast", label: "Meteorología" }, sea: { state: "live", origin: "forecast", label: "Estado del mar" } }, hourlyConditions: [{ time: "2026-09-02T12:00", waterTemperature: 23, waveHeight: 0.3 }] })),
  referenceTime: "2026-09-02T09:50:00.000Z",
  refreshedAt: "2026-09-02T09:50:00.000Z",
};
const validSeed = { schemaVersion: 1, targetEnvironment: "preview", projectId: PLAYA_HOY_VERCEL_PROJECT_ID, commitSha, catalogHash: currentCatalogHash(), generatedAt: "2026-09-02T09:50:00.000Z", expiresAt: "2026-09-02T10:20:00.000Z", snapshotHash: beachSnapshotHash(snapshot), snapshot };
const context = { environment: "preview", projectId: PLAYA_HOY_VERCEL_PROJECT_ID, commitSha, now };

test("accepts a fresh Preview-only 63-beach, 15-municipality seed", () => assert.equal(validatePreviewBootstrapSeed(validSeed, context), snapshot));
test("rejects the same seed outside Preview", () => assert.throws(() => validatePreviewBootstrapSeed(validSeed, { ...context, environment: "production" }), /outside VERCEL_ENV=preview/));
test("rejects expired seeds", () => assert.throws(() => validatePreviewBootstrapSeed(validSeed, { ...context, now: now + 31 * 60 * 1000 }), /older than 30 minutes/));
test("rejects partial AEMET coverage", () => {
  const partialSnapshot = { ...snapshot, beaches: snapshot.beaches.map((beach) => beach.municipality === "Málaga" ? { ...beach, sources: { ...beach.sources, weather: { ...beach.sources.weather, state: "unavailable" } } } : beach) };
  const seed = { ...validSeed, snapshot: partialSnapshot, snapshotHash: beachSnapshotHash(partialSnapshot) };
  assert.throws(() => validatePreviewBootstrapSeed(seed, context), /Missing: Málaga/);
});
test("rejects partial marine coverage", () => {
  const partialSnapshot = { ...snapshot, beaches: snapshot.beaches.map((beach, index) => index === 0 ? { ...beach, waveHeight: undefined } : beach) };
  const seed = { ...validSeed, snapshot: partialSnapshot, snapshotHash: beachSnapshotHash(partialSnapshot) };
  assert.throws(() => validatePreviewBootstrapSeed(seed, context), /incomplete marine coverage/);
});
