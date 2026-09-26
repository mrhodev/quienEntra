import type { Metadata } from "next";
import { Suspense } from "react";
import { Onboarding } from "./onboarding";

export const metadata: Metadata = { title: "Bienvenida · quienEntra" };

export default function Page() {
  return (
    <Suspense>
      <Onboarding />
    </Suspense>
  );
}
