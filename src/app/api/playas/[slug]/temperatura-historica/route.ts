import { NextResponse } from "next/server";
import { getAllBeachesSnapshot, type BeachDataSnapshot } from "@/lib/services/beachDataService";
import { getWaterTemperatureHistory } from "@/lib/providers/waterHistoryProvider";
import { madridDateAndHour } from "@/lib/water-temperature";
import { beaches as catalog } from "@/lib/mock-beaches";

export async function GET(request: Request, { params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  let snapshot: BeachDataSnapshot | undefined;
  try {
    snapshot = await getAllBeachesSnapshot();
  } catch (error) {
    console.warn("[waterHistory] Shared snapshot unavailable; using catalog coordinates", error instanceof Error ? error.message : "error desconocido");
  }
  const snapshotBeach = snapshot?.beaches.find((item) => item.slug === slug || item.id === slug || item.legacySlugs?.includes(slug));
  const beach = snapshotBeach ?? catalog.find((item) => item.slug === slug || item.id === slug || item.legacySlugs?.includes(slug));
  if (!beach) return NextResponse.json({ error: "Playa no encontrada" }, { status: 404 });
  const referenceTime = snapshot?.referenceTime ?? new Date().toISOString();
  const seaValidFor = snapshotBeach?.sources?.sea?.validFor;
  const requestedAnchor = new URL(request.url).searchParams.get("anchor");
  const candidateAnchor = requestedAnchor && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d{3})?Z?)?$/.test(requestedAnchor) ? requestedAnchor : undefined;
  const snapshotDate = madridDateAndHour(seaValidFor ?? referenceTime).date;
  const candidateDate = candidateAnchor ? madridDateAndHour(candidateAnchor).date : undefined;
  const dayDistance = candidateDate ? Math.abs(Date.parse(`${candidateDate}T00:00:00Z`) - Date.parse(`${snapshotDate}T00:00:00Z`)) / 86_400_000 : Infinity;
  const validAnchor = dayDistance <= 1 ? candidateAnchor : undefined;
  try {
    const result = await getWaterTemperatureHistory({
      id: beach.id,
      latitude: beach.latitude,
      longitude: beach.longitude,
      referenceTime,
      validFor: validAnchor ?? seaValidFor,
    });
    return NextResponse.json(result, { headers: { "Cache-Control": "public, s-maxage=86400, stale-while-revalidate=604800" } });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "No se pudo obtener el histórico" }, { status: 502 });
  }
}
