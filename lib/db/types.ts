import type { Position, RotationConfig } from "@/lib/rotation";

/** Filas tal como están en Postgres (spec §7.3); los ids se generan en el cliente. */

export interface TeamRow {
  id: string;
  owner_id: string;
  name: string;
  color: string;
  public_slug: string | null;
  is_public: boolean;
  created_at: string;
  updated_at: string;
  deleted_at: string | null;
}

export interface PlayerRow {
  id: string;
  team_id: string;
  name: string;
  nickname: string | null;
  shirt_number: number | null;
  primary_position: Position;
  secondary_positions: Position[];
  active: boolean;
  created_at: string;
  updated_at: string;
  deleted_at: string | null;
}

export interface TournamentRow {
  id: string;
  team_id: string;
  name: string;
  starts_on: string | null;
  ends_on: string | null;
  default_config: RotationConfig;
  created_at: string;
  updated_at: string;
  deleted_at: string | null;
}

export type MatchStatus = "draft" | "planned" | "live" | "finished";

export interface MatchRow {
  id: string;
  team_id: string;
  tournament_id: string;
  kickoff_at: string | null;
  opponent: string | null;
  is_home: boolean | null;
  status: MatchStatus;
  config: RotationConfig;
  goals_for: number;
  goals_against: number;
  created_at: string;
  updated_at: string;
  deleted_at: string | null;
}

export type Attendance = "present" | "absent" | "injured" | "late";

export interface MatchPlayerRow {
  team_id: string;
  match_id: string;
  player_id: string;
  attendance: Attendance;
  available_from_min: number;
  available_until_min: number | null;
  updated_at: string;
}

/** Lo que el DT decidió en la previa; el plan en sí se recalcula con el motor. */
export interface MatchPlanData {
  goalkeeperId: string | null;
}

export interface MatchPlanRow {
  id: string;
  team_id: string;
  match_id: string;
  version: number;
  plan: MatchPlanData;
  locks: { playerId: string; windowIndex: number; state: "field" | "bench" }[];
  created_at: string;
  updated_at: string;
}

export interface MatchEventRow {
  id: string;
  team_id: string;
  match_id: string;
  seq: number;
  type: string;
  payload: Record<string, unknown>;
  match_time_ms: number;
  wall_time: string;
  device_id: string;
  created_at: string;
  updated_at: string;
}

export interface StintData {
  role: "field" | "goalkeeper";
  position: string;
  periodIndex: number;
  startMs: number;
  endMs: number;
}

export interface MatchPlayerStatsRow {
  team_id: string;
  match_id: string;
  player_id: string;
  field_seconds: number;
  goalkeeper_seconds: number;
  target_seconds: number;
  available_seconds: number;
  goals: number;
  stints: StintData[];
  updated_at: string;
}

export interface TableRows {
  teams: TeamRow;
  players: PlayerRow;
  tournaments: TournamentRow;
  matches: MatchRow;
  match_players: MatchPlayerRow;
  match_plans: MatchPlanRow;
  match_events: MatchEventRow;
  match_player_stats: MatchPlayerStatsRow;
}

export type TableName = keyof TableRows;

/** Orden de envío y de descarga: los padres antes que los hijos (claves foráneas). */
export const TABLES: TableName[] = [
  "teams",
  "players",
  "tournaments",
  "matches",
  "match_players",
  "match_plans",
  "match_events",
  "match_player_stats",
];

/** Clave primaria de cada tabla (compuesta en las tablas de relación). */
export const PRIMARY_KEY: Record<TableName, string[]> = {
  teams: ["id"],
  players: ["id"],
  tournaments: ["id"],
  matches: ["id"],
  match_players: ["match_id", "player_id"],
  match_plans: ["id"],
  match_events: ["id"],
  match_player_stats: ["match_id", "player_id"],
};

export function rowKey(table: TableName, row: object): string {
  const r = row as Record<string, unknown>;
  return PRIMARY_KEY[table].map((k) => String(r[k])).join("|");
}
