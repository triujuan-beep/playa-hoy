type WeatherSource = { state?: string };
type SnapshotBeach = { municipality: string; sources?: { weather?: WeatherSource } };
type SharedSnapshot = { beaches: SnapshotBeach[]; refreshedAt: string };

const weatherCoverage = (snapshot: SharedSnapshot) => new Set(
  snapshot.beaches
    .filter((beach) => beach.sources?.weather?.state === "live")
    .map((beach) => beach.municipality),
);

export function requireSharedSnapshotForBuild<T extends SharedSnapshot>(snapshot: T | undefined): T {
  if (!snapshot) throw new Error("No shared beach snapshot is available during production build; aborting without calling providers.");
  return snapshot;
}

export function weatherCoverageRejection(
  candidate: SharedSnapshot,
  expectedMunicipalities: readonly string[],
): string | undefined {
  const candidateCoverage = weatherCoverage(candidate);
  const missing = expectedMunicipalities.filter((municipality) => !candidateCoverage.has(municipality));
  return missing.length
    ? `Weather coverage would regress; snapshot not published. Missing: ${missing.join(", ")}`
    : undefined;
}

export function assertWeatherCoverage(
  candidate: SharedSnapshot,
  expectedMunicipalities: readonly string[],
) {
  const rejection = weatherCoverageRejection(candidate, expectedMunicipalities);
  if (rejection) throw new Error(rejection);
}
