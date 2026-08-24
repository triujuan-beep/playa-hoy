import { BeachExplorer } from "@/components/BeachExplorer";
import { getAllBeachesData } from "@/lib/services/beachDataService";
import { connection } from "next/server";

export default async function Home() {
  await connection();
  const beaches = await getAllBeachesData();
  return <BeachExplorer initialBeaches={beaches} />;
}
