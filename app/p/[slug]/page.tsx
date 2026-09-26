import { createClient } from "@supabase/supabase-js";
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { datasetFromPublic, type PublicStatsRow } from "@/lib/stats/dataset";
import { PublicStats } from "./public-stats";

/**
 * Vista pública (RF-31). Se consulta en cada visita, sin caché: así un link desactivado o
 * regenerado deja de funcionar al instante (CA-07). Con ISR, la primera visita después del
 * cambio todavía podía recibir la página vieja. No usa datos offline.
 */
export const dynamic = "force-dynamic";

function anonClient() {
  return createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!, {
    auth: { persistSession: false },
  });
}

async function load(slug: string) {
  const supabase = anonClient();
  const [{ data: info }, { data: rows }] = await Promise.all([
    supabase.rpc("public_team_info", { p_slug: slug }),
    supabase.rpc("public_team_stats", { p_slug: slug }),
  ]);
  const team = (info as { team_name: string; team_color: string }[] | null)?.[0];
  if (!team) return null;
  const data = datasetFromPublic((rows as PublicStatsRow[] | null) ?? [], team.team_name);
  data.color = team.team_color;
  return data;
}

export async function generateMetadata({ params }: PageProps<"/p/[slug]">): Promise<Metadata> {
  const { slug } = await params;
  const data = await load(slug);
  return { title: data ? `${data.teamName} · quienEntra` : "quienEntra", robots: { index: false } };
}

export default async function PublicPage({ params }: PageProps<"/p/[slug]">) {
  const { slug } = await params;
  const data = await load(slug);
  if (!data) notFound();
  return <PublicStats data={data} />;
}
