import type { Metadata } from "next";
import { Roster } from "./roster";

export const metadata: Metadata = { title: "Plantel · quienEntra" };

export default function Page() {
  return <Roster />;
}
