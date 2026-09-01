import { scoreBeachForRanking, sortRankedBeaches } from "./beach-ranking.ts";
import { getBeachExclusion } from "./scoring.ts";
import type { Beach, Priority } from "./types";

export type MapBeach = Omit<Beach, "hourlyConditions" | "metricMetadata" | "sources">;
export type RankedMapBeach = MapBeach & { score: number; rank: number | null; excluded: boolean; exclusionReason?: string };

export function toMapBeaches(beaches: Beach[]): MapBeach[] {
  return beaches.map((item) => {
    const beach = { ...item };
    delete beach.hourlyConditions;
    delete beach.metricMetadata;
    delete beach.sources;
    return beach;
  });
}

export function rankMapBeaches(beaches: MapBeach[], priorities: Priority[] = []) {
  const eligible = sortRankedBeaches(beaches.filter((beach) => !getBeachExclusion(beach)).map((beach) => scoreBeachForRanking(beach, priorities)));
  const positions = new Map(eligible.map((item, index) => [item.beach.id, { rank: index + 1, score: item.score }]));
  return beaches.map((beach): RankedMapBeach => {
    const position = positions.get(beach.id);
    const exclusion = getBeachExclusion(beach);
    return { ...beach, score: position?.score ?? 0, rank: position?.rank ?? null, excluded: Boolean(exclusion), exclusionReason: exclusion?.reason };
  });
}
