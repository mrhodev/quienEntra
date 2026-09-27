"use client";

import { useLiveQuery } from "dexie-react-hooks";
import { useMemo } from "react";
import { TournamentStats } from "@/components/stats-views";
import { useCurrent, usePlayers, useTeamStats } from "@/lib/app/data";
import { db } from "@/lib/db/local";
import type { StatsDataset } from "@/lib/stats/dataset";

/** Estadísticas del torneo actual para el DT (§8.8), desde la base local: funciona sin conexión. */
export function StatsPage() {
  const { team, tournament, tournaments } = useCurrent();
  const players = usePlayers(team?.id);
  const stats = useTeamStats(team?.id);
  const matches = useLiveQuery(
    async () => (team ? (await db().matches.where("team_id").equals(team.id).toArray()).filter((m) => !m.deleted_at && m.status === "finished") : []),
    [team?.id],
  );

  const data = useMemo<StatsDataset | null>(() => {
    if (!team || !players || !stats || !matches) return null;
    return {
      teamName: team.name,
      color: team.color,
      tournaments: tournaments.map((t) => ({ id: t.id, name: t.name })),
      matches: matches
        .map((m) => ({
          id: m.id,
          tournamentId: m.tournament_id,
          opponent: m.opponent,
          kickoffAt: m.kickoff_at ?? m.created_at,
          goalsFor: m.goals_for,
          goalsAgainst: m.goals_against,
        }))
        .sort((a, b) => (a.kickoffAt ?? "").localeCompare(b.kickoffAt ?? "")),
      players: players.map((p) => ({ id: p.id, name: p.nickname || p.name, number: p.shirt_number })),
      rows: stats,
    };
  }, [team, players, stats, matches, tournaments]);

  if (!data) return null;
  return (
    <div className="space-y-4">
      <h1 className="text-3xl">Estadísticas</h1>
      <TournamentStats data={data} tournamentId={tournament?.id ?? null} />
    </div>
  );
}
