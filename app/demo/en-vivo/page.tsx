import type { Metadata } from "next";
import { LiveDemo } from "./live-demo";

export const metadata: Metadata = { title: "En vivo · quienEntra" };

export default function LiveDemoPage() {
  return <LiveDemo />;
}
