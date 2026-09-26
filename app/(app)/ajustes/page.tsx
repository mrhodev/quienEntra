import type { Metadata } from "next";
import { Suspense } from "react";
import { Settings } from "./settings";

export const metadata: Metadata = { title: "Ajustes · quienEntra" };

export default function Page() {
  return (
    <Suspense>
      <Settings />
    </Suspense>
  );
}
