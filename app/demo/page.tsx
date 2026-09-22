import type { Metadata } from "next";
import { PlannerDemo } from "./planner-demo";

export const metadata: Metadata = { title: "Planificador · quienJuega" };

export default function DemoPage() {
  return <PlannerDemo />;
}
