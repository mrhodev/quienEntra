import type { StintData } from "@/lib/db/types";
import type { StatsRow } from "./tournament";

/**
 * Datos de estadísticas de un equipo, normalizados. Los arma la app del DT (desde la base local)
 * y la vista pública (desde `public_team_stats`), y los consume la misma interfaz.
 */
export interface StatsDataset {
  teamName: string;
  color: string;
  tournaments: { id: string; name: string }[];
  matches: {
    id: string;
    tournamentId: string;
    opponent: string | null;
    kickoffAt: string | null;
    goalsFor: number;
    goalsAgainst: number;
  }[];
  players: { id: string; name: string; number: number | null }[];
  rows: (StatsRow & { stints: StintData[] })[];
}

/** Fila de `public_team_stats(slug)` (supabase/migrations). */
export interface PublicStatsRow {
  team_name: string;
  team_color: string;
  tournament_id: string;
  tournament_name: string;
  match_id: string;
  kickoff_at: string | null;
  opponent: string | null;
  goals_for: number;
  goals_against: number;
  player_id: string;
  player_name: string;
  shirt_number: number | null;
  field_seconds: number;
  goalkeeper_seconds: number;
  target_seconds: number;
  available_seconds: number;
  goals: number;
  stints: StintData[] | null;
}

export function datasetFromPublic(rows: PublicStatsRow[], fallbackName = ""): StatsDataset {
  const tournaments = new Map<string, string>();
  const matches = new Map<string, StatsDataset["matches"][number]>();
  const players = new Map<string, StatsDataset["players"][number]>();
  for (const r of rows) {
    tournaments.set(r.tournament_id, r.tournament_name);
    matches.set(r.match_id, {
      id: r.match_id,
      tournamentId: r.tournament_id,
      opponent: r.opponent,
      kickoffAt: r.kickoff_at,
      goalsFor: r.goals_for,
      goalsAgainst: r.goals_against,
    });
    players.set(r.player_id, { id: r.player_id, name: r.player_name, number: r.shirt_number });
  }
  return {
    teamName: rows[0]?.team_name ?? fallbackName,
    color: rows[0]?.team_color ?? "#16a34a",
    tournaments: [...tournaments].map(([id, name]) => ({ id, name })),
    matches: [...matches.values()].sort((a, b) => (a.kickoffAt ?? "").localeCompare(b.kickoffAt ?? "")),
    players: [...players.values()].sort((a, b) => a.name.localeCompare(b.name, "es")),
    rows: rows.map((r) => ({
      match_id: r.match_id,
      player_id: r.player_id,
      field_seconds: r.field_seconds,
      goalkeeper_seconds: r.goalkeeper_seconds,
      target_seconds: r.target_seconds,
      available_seconds: r.available_seconds,
      goals: r.goals,
      stints: r.stints ?? [],
    })),
  };
}

/** Posiciones jugadas por un jugador (RF-29), por minutos, de mayor a menor. */
export function positionsPlayed(stints: StintData[]): { position: string; minutes: number }[] {
  const acc = new Map<string, number>();
  for (const s of stints) acc.set(s.position, (acc.get(s.position) ?? 0) + (s.endMs - s.startMs) / 60_000);
  return [...acc].map(([position, minutes]) => ({ position, minutes })).sort((a, b) => b.minutes - a.minutes);
}

/** Resultados del torneo: ganados, empatados y perdidos. */
export function record(matches: StatsDataset["matches"]): { won: number; drawn: number; lost: number } {
  let won = 0;
  let drawn = 0;
  let lost = 0;
  for (const m of matches) {
    if (m.goalsFor > m.goalsAgainst) won++;
    else if (m.goalsFor === m.goalsAgainst) drawn++;
    else lost++;
  }
  return { won, drawn, lost };
}
