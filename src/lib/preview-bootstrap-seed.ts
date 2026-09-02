import "server-only";
import seedFile from "../data/preview-bootstrap-seed.json";
import { validatePreviewBootstrapSeed,type BeachDataSnapshot } from "./preview-bootstrap-contract";
export type { BeachDataSnapshot } from "./preview-bootstrap-contract";

export function readPreviewBootstrapSeed(now = Date.now()): BeachDataSnapshot | undefined {
  return validatePreviewBootstrapSeed(seedFile, { environment: process.env.VERCEL_ENV, projectId: process.env.VERCEL_PROJECT_ID, commitSha: process.env.PLAYA_HOY_PREVIEW_SEED_ID ?? process.env.VERCEL_GIT_COMMIT_SHA, now });
}
