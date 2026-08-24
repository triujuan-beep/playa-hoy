import { BeachExplorer } from "@/components/BeachExplorer";
import { getAllBeachesData } from "@/lib/services/beachDataService";

export const revalidate = 900;

export default async function Home() {
  const beaches = await getAllBeachesData();
  return <BeachExplorer initialBeaches={beaches} />;
}
