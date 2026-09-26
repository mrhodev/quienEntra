import type { Metadata } from "next";
import { StatsPage } from "./stats-page";

export const metadata: Metadata = { title: "Estadísticas · quienEntra" };

export default function Page() {
  return <StatsPage />;
}
