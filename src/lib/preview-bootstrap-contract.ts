import { createHash } from "node:crypto";
import { beaches as catalog } from "./mock-beaches.ts";
import { assertWeatherCoverage } from "./snapshot-policy.ts";
import type { Beach } from "./types.ts";

export type BeachDataSnapshot = { beaches: Beach[]; referenceTime: string; refreshedAt: string };
export type PreviewBootstrapSeed = {
  schemaVersion: 1;
  targetEnvironment: "preview";
  projectId: string;
  commitSha: string;
  catalogHash: string;
  generatedAt: string;
  expiresAt: string;
  snapshotHash: string;
  snapshot: BeachDataSnapshot;
};
export type PreviewBootstrapContext = { environment?: string; projectId?: string; commitSha?: string; now?: number };

export const PREVIEW_BOOTSTRAP_SCHEMA_VERSION = 1;
export const PREVIEW_BOOTSTRAP_MAX_AGE_MS = 30 * 60 * 1000;
export const PLAYA_HOY_VERCEL_PROJECT_ID = "prj_RWUJkPtyREVihsWwSPUgf54lckzV";

const sha256 = (value: string) => createHash("sha256").update(value).digest("hex");
const catalogDescriptor = () => catalog.map(({ id, slug, municipality, latitude, longitude }) => ({ id, slug, municipality, latitude, longitude }));
export const currentCatalogHash = () => sha256(JSON.stringify(catalogDescriptor()));
export const beachSnapshotHash = (snapshot: BeachDataSnapshot) => sha256(JSON.stringify(snapshot));

function isSnapshot(value: unknown): value is BeachDataSnapshot {
  if (!value || typeof value !== "object") return false;
  const snapshot = value as BeachDataSnapshot;
  return typeof snapshot.referenceTime === "string"
    && typeof snapshot.refreshedAt === "string"
    && Array.isArray(snapshot.beaches)
    && snapshot.beaches.length === catalog.length
    && snapshot.beaches.every((beach, index) => beach.id === catalog[index].id);
}

function isConfiguredSeed(value: unknown): value is PreviewBootstrapSeed {
  if (!value || typeof value !== "object") return false;
  const seed = value as Partial<PreviewBootstrapSeed>;
  return seed.schemaVersion === PREVIEW_BOOTSTRAP_SCHEMA_VERSION
    && seed.targetEnvironment === "preview"
    && typeof seed.projectId === "string" && seed.projectId.length > 0
    && typeof seed.commitSha === "string" && /^[0-9a-f]{40}$/i.test(seed.commitSha)
    && typeof seed.catalogHash === "string"
    && typeof seed.generatedAt === "string"
    && typeof seed.expiresAt === "string"
    && typeof seed.snapshotHash === "string"
    && isSnapshot(seed.snapshot);
}

function validateMarineCoverage(snapshot: BeachDataSnapshot) {
  const missing = snapshot.beaches
    .filter((beach) => beach.sources?.sea?.state !== "live"
      || beach.waterTemperature === undefined
      || beach.waveHeight === undefined
      || !beach.hourlyConditions?.some((hour) => hour.waterTemperature !== undefined && hour.waveHeight !== undefined))
    .map((beach) => beach.id);
  if (missing.length) throw new Error(`Preview bootstrap seed has incomplete marine coverage: ${missing.join(", ")}`);
}

export function validatePreviewBootstrapSeed(raw: unknown, context: PreviewBootstrapContext): BeachDataSnapshot | undefined {
  if (!isConfiguredSeed(raw)) return undefined;
  const now = context.now ?? Date.now();
  if (context.environment !== "preview") throw new Error("Preview bootstrap seed rejected outside VERCEL_ENV=preview.");
  if (raw.projectId !== PLAYA_HOY_VERCEL_PROJECT_ID) throw new Error("Preview bootstrap seed projectId mismatch.");
  if (context.projectId && context.projectId !== raw.projectId) throw new Error("Preview bootstrap seed does not belong to this Vercel project.");
  if (context.commitSha && context.commitSha !== raw.commitSha) throw new Error("Preview bootstrap seed commit SHA mismatch.");
  if (raw.catalogHash !== currentCatalogHash()) throw new Error("Preview bootstrap seed catalog hash mismatch.");
  const generatedAt = Date.parse(raw.generatedAt);
  const expiresAt = Date.parse(raw.expiresAt);
  if (!Number.isFinite(generatedAt) || !Number.isFinite(expiresAt) || generatedAt > now + 60_000) throw new Error("Preview bootstrap seed has invalid timestamps.");
  if (now - generatedAt > PREVIEW_BOOTSTRAP_MAX_AGE_MS || now > expiresAt) throw new Error("Preview bootstrap seed is older than 30 minutes.");
  if (raw.snapshotHash !== beachSnapshotHash(raw.snapshot)) throw new Error("Preview bootstrap seed snapshot hash mismatch.");
  assertWeatherCoverage(raw.snapshot, [...new Set(catalog.map((beach) => beach.municipality))]);
  validateMarineCoverage(raw.snapshot);
  return raw.snapshot;
}
