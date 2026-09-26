import type { Metadata } from "next";
import { Suspense } from "react";
import { LiveMatch } from "./vivo-view";

export const metadata: Metadata = { title: "En vivo · quienEntra" };

export default function Page() {
  return (
    <Suspense>
      <LiveMatch />
    </Suspense>
  );
}
