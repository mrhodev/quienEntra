"use client";

import { useState, type CSSProperties } from "react";
import { TournamentStats } from "@/components/stats-views";
import { contrastOn } from "@/components/ui";
import type { StatsDataset } from "@/lib/stats/dataset";

/** Estadísticas públicas del equipo, en solo lectura (RF-31). */
export function PublicStats({ data }: { data: StatsDataset }) {
  // Por defecto, el torneo con el partido más reciente.
  const latest = data.matches.at(-1)?.tournamentId ?? data.tournaments[0]?.id ?? null;
  const [tournamentId, setTournamentId] = useState(latest);
  const style = { "--accent": data.color, "--accent-contrast": contrastOn(data.color) } as CSSProperties;
  return (
    <main style={style} className="mx-auto w-full max-w-md space-y-4 px-4 pb-16 pt-6">
      <header className="flex items-center gap-3">
        <span className="size-4 rounded-full bg-accent" aria-hidden />
        <h1 className="text-2xl font-bold">{data.teamName}</h1>
      </header>
      {data.tournaments.length > 1 && (
        <label className="block">
          <span className="sr-only">Torneo</span>
          <select
            value={tournamentId ?? ""}
            onChange={(e) => setTournamentId(e.target.value)}
            className="min-h-11 w-full rounded-xl border border-border bg-surface px-3"
          >
            {data.tournaments.map((t) => (
              <option key={t.id} value={t.id}>
                {t.name}
              </option>
            ))}
          </select>
        </label>
      )}
      {data.tournaments.length === 1 && <p className="text-muted">{data.tournaments[0].name}</p>}
      <TournamentStats data={data} tournamentId={tournamentId} />
      <p className="pt-4 text-center text-xs text-muted">Solo partidos finalizados · quienEntra</p>
    </main>
  );
}
