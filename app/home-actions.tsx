"use client";

import Link from "next/link";
import { useSession } from "@/lib/app/session";

export function HomeActions() {
  const { session, loading } = useSession();
  const href = session ? "/partidos" : "/login";
  return (
    <Link
      href={href}
      aria-busy={loading}
      className="rounded-2xl bg-accent px-5 py-4 text-center text-lg font-semibold text-accent-contrast shadow-sm transition active:scale-[0.98]"
    >
      {session ? "Ir a mis partidos" : "Ingresar"}
    </Link>
  );
}
