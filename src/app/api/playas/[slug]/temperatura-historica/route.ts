import { NextResponse } from "next/server";
import { getAllBeachesSnapshot } from "@/lib/services/beachDataService";
import { getWaterTemperatureHistory } from "@/lib/providers/waterHistoryProvider";
import { madridDateAndHour } from "@/lib/water-temperature";

export async function GET(request: Request, { params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const snapshot = await getAllBeachesSnapshot();
  const beach = snapshot.beaches.find((item) => item.slug === slug || item.id === slug || item.legacySlugs?.includes(slug));
  if (!beach) return NextResponse.json({ error: "Playa no encontrada" }, { status: 404 });
  const requestedAnchor = new URL(request.url).searchParams.get("anchor");
  const candidateAnchor = requestedAnchor && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d{3})?Z?)?$/.test(requestedAnchor) ? requestedAnchor : undefined;
  const snapshotDate = madridDateAndHour(beach.sources?.sea?.validFor ?? snapshot.referenceTime).date;
  const candidateDate = candidateAnchor ? madridDateAndHour(candidateAnchor).date : undefined;
  const dayDistance = candidateDate ? Math.abs(Date.parse(`${candidateDate}T00:00:00Z`) - Date.parse(`${snapshotDate}T00:00:00Z`)) / 86_400_000 : Infinity;
  const validAnchor = dayDistance <= 1 ? candidateAnchor : undefined;
  try {
    const result = await getWaterTemperatureHistory({
      id: beach.id,
      latitude: beach.latitude,
      longitude: beach.longitude,
      referenceTime: snapshot.referenceTime,
      validFor: validAnchor ?? beach.sources?.sea?.validFor,
    });
    return NextResponse.json(result, { headers: { "Cache-Control": "public, s-maxage=86400, stale-while-revalidate=604800" } });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "No se pudo obtener el histórico" }, { status: 502 });
  }
}
