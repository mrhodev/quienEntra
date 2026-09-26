import type { Metadata } from "next";
import { Suspense } from "react";
import { MatchSummary } from "./resumen-view";

export const metadata: Metadata = { title: "Resumen · quienEntra" };

export default function Page() {
  return (
    <Suspense>
      <MatchSummary />
    </Suspense>
  );
}
