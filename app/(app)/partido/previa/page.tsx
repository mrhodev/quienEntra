import type { Metadata } from "next";
import { Suspense } from "react";
import { Pregame } from "./previa-view";

export const metadata: Metadata = { title: "Previa · quienEntra" };

export default function Page() {
  return (
    <Suspense>
      <Pregame />
    </Suspense>
  );
}
