import "server-only";
import type { Occupancy } from "../types";
export type OccupancyResult={occupancy?:Occupancy;updatedAt?:string;source?:string};
export async function getOccupancy():Promise<OccupancyResult|null>{return null}
