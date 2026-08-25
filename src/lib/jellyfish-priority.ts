import type { Beach,JellyfishObservationStatus,Priority } from "./types";

const priorityByStatus:Record<JellyfishObservationStatus,number>={
  recent_no_sightings:1,
  no_recent_reports:0,
  unknown:0,
  recent_sighting:-1,
  multiple_recent_sightings:-2,
  strong_recent_presence:-3,
};

export const jellyfishObservationPriority=(beach:Pick<Beach,"jellyfishObservation">)=>beach.jellyfishObservation?priorityByStatus[beach.jellyfishObservation.status]:0;
export const compareJellyfishObservationPriority=(left:Pick<Beach,"jellyfishObservation">,right:Pick<Beach,"jellyfishObservation">)=>jellyfishObservationPriority(right)-jellyfishObservationPriority(left);
export const prioritiesForScoring=(priorities:Priority[])=>priorities.filter(priority=>priority!=="lowJellyfish");
