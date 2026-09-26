"use client";

import { useLiveQuery } from "dexie-react-hooks";
import { db } from "@/lib/db/local";
import type { MatchRow, PlayerRow, TeamRow, TournamentRow } from "@/lib/db/types";
import { toMatchEvent } from "@/lib/match/rows";
import { setPref, usePref } from "./prefs";

/** Lecturas reactivas de la base local (`useLiveQuery`): la UI nunca espera a la red. */

const alive = <T extends { deleted_at: string | null }>(rows: T[]) => rows.filter((r) => !r.deleted_at);
const byName = (a: { name: string }, b: { name: string }) => a.name.localeCompare(b.name, "es");

export function useTeams(): TeamRow[] | undefined {
  return useLiveQuery(async () => alive(await db().teams.toArray()).sort(byName));
}

export function usePlayers(teamId: string | null | undefined): PlayerRow[] | undefined {
  return useLiveQuery(
    async () => (teamId ? alive(await db().players.where("team_id").equals(teamId).toArray()) : []),
    [teamId],
  )?.sort((a, b) => (a.shirt_number ?? 999) - (b.shirt_number ?? 999) || byName(a, b));
}

export function useTournaments(teamId: string | null | undefined): TournamentRow[] | undefined {
  return useLiveQuery(
    async () => (teamId ? alive(await db().tournaments.where("team_id").equals(teamId).toArray()) : []),
    [teamId],
  )?.sort((a, b) => (b.starts_on ?? b.created_at).localeCompare(a.starts_on ?? a.created_at));
}

export function useMatches(tournamentId: string | null | undefined): MatchRow[] | undefined {
  return useLiveQuery(
    async () => (tournamentId ? alive(await db().matches.where("tournament_id").equals(tournamentId).toArray()) : []),
    [tournamentId],
  )?.sort((a, b) => (a.kickoff_at ?? a.created_at).localeCompare(b.kickoff_at ?? b.created_at));
}

export function useMatch(id: string | null) {
  return useLiveQuery(async () => (id ? ((await db().matches.get(id)) ?? null) : null), [id]);
}

export function useMatchPlayers(matchId: string | null) {
  return useLiveQuery(async () => (matchId ? db().match_players.where("match_id").equals(matchId).toArray() : []), [matchId]);
}

export function usePlan(matchId: string | null) {
  return useLiveQuery(async () => {
    if (!matchId) return null;
    const rows = await db().match_plans.where("match_id").equals(matchId).toArray();
    return rows.sort((a, b) => b.version - a.version)[0] ?? null;
  }, [matchId]);
}

export function useEvents(matchId: string | null) {
  return useLiveQuery(async () => {
    if (!matchId) return [];
    return (await db().match_events.where("match_id").equals(matchId).toArray()).map(toMatchEvent);
  }, [matchId]);
}

export function useTeamStats(teamId: string | null | undefined) {
  return useLiveQuery(
    async () => (teamId ? db().match_player_stats.where("team_id").equals(teamId).toArray() : []),
    [teamId],
  );
}

/** Equipo y torneo actuales: el guardado en el dispositivo, o el primero disponible. */
export function useCurrent() {
  const teams = useTeams();
  const teamPref = usePref("team");
  const team = teams?.find((t) => t.id === teamPref) ?? teams?.[0] ?? null;
  const tournaments = useTournaments(team?.id);
  const tournamentPref = usePref(`tournament:${team?.id ?? ""}`);
  const tournament = tournaments?.find((t) => t.id === tournamentPref) ?? tournaments?.[0] ?? null;
  return {
    loading: teams === undefined || (team !== null && tournaments === undefined),
    teams: teams ?? [],
    team,
    tournaments: tournaments ?? [],
    tournament,
    selectTeam: (id: string) => setPref("team", id),
    selectTournament: (id: string) => team && setPref(`tournament:${team.id}`, id),
  };
}
