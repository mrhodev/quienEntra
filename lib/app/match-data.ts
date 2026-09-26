"use client";

import { useMemo } from "react";
import type { MatchPlayerStatsRow, PlayerRow } from "@/lib/db/types";
import type { MatchEvent } from "@/lib/match/events";
import { liveRotationInput, type SquadEntry } from "@/lib/match/live";
import type { RotationPlayer } from "@/lib/rotation";
import { tournamentRatios } from "@/lib/stats/tournament";
import { useEvents, useMatch, useMatches, useMatchPlayers, usePlan, usePlayers, useTeamStats } from "./data";

/**
 * Arquero propuesto (RF-11): entre los presentes con ARQ de principal, el que más partidos atajó;
 * si no hay, alguien con ARQ de secundaria; si tampoco, ninguno.
 */
export function proposeGoalkeeper(present: PlayerRow[], stats: MatchPlayerStatsRow[]): string | null {
  const saves = (id: string) => stats.filter((s) => s.player_id === id && s.goalkeeper_seconds > 0).length;
  const byExperience = (list: PlayerRow[]) => [...list].sort((a, b) => saves(b.id) - saves(a.id) || a.name.localeCompare(b.name))[0];
  return (
    byExperience(present.filter((p) => p.primary_position === "ARQ"))?.id ??
    byExperience(present.filter((p) => p.secondary_positions.includes("ARQ")))?.id ??
    null
  );
}

/** Todo lo de un partido, desde la base local. */
export function useMatchData(matchId: string | null) {
  const match = useMatch(matchId);
  const players = usePlayers(match?.team_id);
  const matchPlayers = useMatchPlayers(matchId);
  const plan = usePlan(matchId);
  const events = useEvents(matchId);
  const tournamentMatches = useMatches(match?.tournament_id);
  const teamStats = useTeamStats(match?.team_id);

  return useMemo(() => {
    if (!match || !players || !matchPlayers || plan === undefined || !events || !tournamentMatches || !teamStats) {
      return { loading: true as const, match };
    }
    const byId = new Map(players.map((p) => [p.id, p]));
    // Acumulado del torneo (r_i): solo partidos finalizados, sin contar este.
    const finished = new Set(tournamentMatches.filter((m) => m.status === "finished" && m.id !== match.id).map((m) => m.id));
    const priorStats = teamStats.filter((s) => finished.has(s.match_id));
    const ratios = tournamentRatios(priorStats);

    const squad: SquadEntry[] = matchPlayers
      .filter((mp) => byId.has(mp.player_id))
      .map((mp) => {
        const p = byId.get(mp.player_id)!;
        const player: RotationPlayer = {
          id: p.id,
          primary: p.primary_position,
          secondary: p.secondary_positions,
          availableFromMin: 0,
          availableUntilMin: 999,
          tournamentRatio: ratios.get(p.id) ?? null,
        };
        return { player, attendance: mp.attendance, expectedFromMin: Number(mp.available_from_min) || 0 };
      })
      .sort((a, b) => {
        const pa = byId.get(a.player.id)!;
        const pb = byId.get(b.player.id)!;
        return (pa.shirt_number ?? 999) - (pb.shirt_number ?? 999) || pa.name.localeCompare(pb.name, "es");
      });

    const present = squad.filter((s) => s.attendance === "present" || s.attendance === "late").map((s) => byId.get(s.player.id)!);
    const goalkeeperId = plan?.plan.goalkeeperId ?? proposeGoalkeeper(present, teamStats);

    return {
      loading: false as const,
      match,
      players,
      byId,
      matchPlayers,
      planRow: plan,
      events,
      squad,
      goalkeeperId,
      locks: plan?.locks ?? [],
      teamStats,
      /** Entrada del motor en `nowMs` (0 antes del partido). */
      inputAt: (nowMs: number, evs: MatchEvent[] = events) =>
        liveRotationInput({
          config: match.config,
          squad,
          goalkeeperId,
          locks: plan?.locks ?? [],
          events: evs,
          nowMs,
        }),
    };
  }, [match, players, matchPlayers, plan, events, tournamentMatches, teamStats]);
}

export function displayName(p: PlayerRow | undefined): string {
  return p ? p.nickname || p.name : "—";
}
