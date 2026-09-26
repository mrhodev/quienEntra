import type { Metadata } from "next";
import { Matches } from "./matches";

export const metadata: Metadata = { title: "Partidos · quienEntra" };

export default function Page() {
  return <Matches />;
}
