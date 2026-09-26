import type { MatchEventPayload } from "@/lib/match/events";
import type { ParsedPlayer } from "@/lib/roster/parse";
import type { PlanLock, RotationConfig } from "@/lib/rotation";
import { db, newId, nowIso, write } from "./local";
import type {
  Attendance,
  MatchEventRow,
  MatchPlanRow,
  MatchPlayerRow,
  MatchPlayerStatsRow,
  MatchRow,
  MatchStatus,
  PlayerRow,
  TeamRow,
  TournamentRow,
} from "./types";

/** Acciones de dominio: todas escriben primero en local y encolan el envío (§7.2). */

export const DEFAULT_CONFIG: RotationConfig = {
  playersOnField: 7,
  periods: [{ minutes: 25 }, { minutes: 25 }],
  windowMinutes: 5,
  minStintMinutes: 5,
  guaranteedMinutes: 5,
  formation: { DEF: 2, MED: 3, DEL: 1 },
  equityWeight: 0.3,
  goalkeeperRotates: false,
};

function slug(): string {
  const alphabet = "abcdefghijkmnpqrstuvwxyz23456789";
  const bytes = crypto.getRandomValues(new Uint8Array(10));
  return [...bytes].map((b) => alphabet[b % alphabet.length]).join("");
}

// ---------- Equipos ----------

export async function createTeam(ownerId: string, name: string, color: string): Promise<TeamRow> {
  const now = nowIso();
  const team: TeamRow = {
    id: newId(),
    owner_id: ownerId,
    name: name.trim(),
    color,
    public_slug: null,
    is_public: false,
    created_at: now,
    updated_at: now,
    deleted_at: null,
  };
  await write("teams", [team]);
  return team;
}

export async function updateTeam(team: TeamRow, patch: Partial<Pick<TeamRow, "name" | "color">>) {
  await write("teams", [{ ...team, ...patch, updated_at: nowIso() }]);
}

/** Link público (RF-03): al regenerarlo, el anterior deja de funcionar. */
export async function setPublicLink(team: TeamRow, enabled: boolean, regenerate = false) {
  const public_slug = regenerate || !team.public_slug ? slug() : team.public_slug;
  await write("teams", [{ ...team, is_public: enabled, public_slug, updated_at: nowIso() }]);
}

export async function archiveTeam(team: TeamRow) {
  await write("teams", [{ ...team, deleted_at: nowIso(), updated_at: nowIso() }]);
}

// ---------- Plantel ----------

export async function addPlayers(teamId: string, parsed: ParsedPlayer[]): Promise<PlayerRow[]> {
  const now = nowIso();
  const rows: PlayerRow[] = parsed.map((p) => ({
    id: newId(),
    team_id: teamId,
    name: p.name,
    nickname: null,
    shirt_number: p.shirtNumber,
    primary_position: p.primary,
    secondary_positions: p.secondary,
    active: true,
    created_at: now,
    updated_at: now,
    deleted_at: null,
  }));
  await write("players", rows);
  return rows;
}

export async function updatePlayer(player: PlayerRow, patch: Partial<PlayerRow>) {
  await write("players", [{ ...player, ...patch, updated_at: nowIso() }]);
}

// ---------- Torneos ----------

export async function createTournament(
  teamId: string,
  name: string,
  config: RotationConfig,
  dates: { starts_on?: string | null; ends_on?: string | null } = {},
): Promise<TournamentRow> {
  const now = nowIso();
  const t: TournamentRow = {
    id: newId(),
    team_id: teamId,
    name: name.trim(),
    starts_on: dates.starts_on ?? null,
    ends_on: dates.ends_on ?? null,
    default_config: config,
    created_at: now,
    updated_at: now,
    deleted_at: null,
  };
  await write("tournaments", [t]);
  return t;
}

export async function updateTournament(t: TournamentRow, patch: Partial<TournamentRow>) {
  await write("tournaments", [{ ...t, ...patch, updated_at: nowIso() }]);
}

// ---------- Partidos ----------

export async function createMatch(
  tournament: TournamentRow,
  players: PlayerRow[],
  data: { kickoff_at: string | null; opponent: string | null; is_home: boolean | null },
): Promise<MatchRow> {
  const now = nowIso();
  const match: MatchRow = {
    id: newId(),
    team_id: tournament.team_id,
    tournament_id: tournament.id,
    ...data,
    status: "draft",
    config: tournament.default_config,
    goals_for: 0,
    goals_against: 0,
    created_at: now,
    updated_at: now,
    deleted_at: null,
  };
  await write("matches", [match]);
  // Convocatoria inicial (RF-10): todo el plantel activo, presente.
  await write(
    "match_players",
    players
      .filter((p) => p.active && !p.deleted_at)
      .map((p) => ({
        team_id: match.team_id,
        match_id: match.id,
        player_id: p.id,
        attendance: "present" as Attendance,
        available_from_min: 0,
        available_until_min: null,
        updated_at: now,
      })),
  );
  return match;
}

export async function updateMatch(match: MatchRow, patch: Partial<MatchRow>) {
  await write("matches", [{ ...match, ...patch, updated_at: nowIso() }]);
}

export async function setMatchStatus(match: MatchRow, status: MatchStatus) {
  await updateMatch(match, { status });
}

export async function deleteMatch(match: MatchRow) {
  await updateMatch(match, { deleted_at: nowIso() });
}

export async function setAttendance(row: MatchPlayerRow, attendance: Attendance, fromMin = 0) {
  await write("match_players", [
    { ...row, attendance, available_from_min: attendance === "late" ? fromMin : 0, updated_at: nowIso() },
  ]);
}

/** Agrega a la convocatoria a jugadores dados de alta después de crear el partido. */
export async function ensureMatchPlayers(match: MatchRow, players: PlayerRow[]) {
  const existing = new Set((await db().match_players.where("match_id").equals(match.id).toArray()).map((r) => r.player_id));
  const now = nowIso();
  await write(
    "match_players",
    players
      .filter((p) => p.active && !p.deleted_at && !existing.has(p.id))
      .map((p) => ({
        team_id: match.team_id,
        match_id: match.id,
        player_id: p.id,
        attendance: "present" as Attendance,
        available_from_min: 0,
        available_until_min: null,
        updated_at: now,
      })),
  );
}

// ---------- Plan ----------

/** Guarda la previa (arquero y bloqueos) en la versión vigente del plan. */
export async function savePlan(
  match: MatchRow,
  current: MatchPlanRow | undefined,
  patch: { goalkeeperId?: string | null; locks?: PlanLock[] },
): Promise<void> {
  const now = nowIso();
  const row: MatchPlanRow = current
    ? {
        ...current,
        plan: { goalkeeperId: patch.goalkeeperId !== undefined ? patch.goalkeeperId : current.plan.goalkeeperId },
        locks: patch.locks ?? current.locks,
        updated_at: now,
      }
    : {
        id: newId(),
        team_id: match.team_id,
        match_id: match.id,
        version: 1,
        plan: { goalkeeperId: patch.goalkeeperId ?? null },
        locks: patch.locks ?? [],
        created_at: now,
        updated_at: now,
      };
  await write("match_plans", [row]);
}

/** Congela la versión vigente y abre una nueva (histórico del plan, §7.3). */
export async function snapshotPlan(current: MatchPlanRow): Promise<void> {
  const now = nowIso();
  await write("match_plans", [{ ...current, id: newId(), version: current.version + 1, created_at: now, updated_at: now }]);
}

// ---------- Eventos ----------

export function deviceId(): string {
  const key = "quienentra:device";
  try {
    let id = localStorage.getItem(key);
    if (!id) {
      id = newId();
      localStorage.setItem(key, id);
    }
    return id;
  } catch {
    return "sin-almacenamiento";
  }
}

export async function logEvents(match: MatchRow, matchTimeMs: number, payloads: MatchEventPayload[]) {
  const d = db();
  const seq0 = await d.match_events.where("match_id").equals(match.id).count();
  const now = nowIso();
  const device = deviceId();
  const rows: MatchEventRow[] = payloads.map((p, i) => {
    const { type, ...payload } = p;
    return {
      id: newId(),
      team_id: match.team_id,
      match_id: match.id,
      seq: seq0 + i,
      type,
      payload,
      match_time_ms: Math.max(0, Math.round(matchTimeMs)),
      wall_time: new Date(Date.now() + i).toISOString(),
      device_id: device,
      created_at: now,
      updated_at: now,
    };
  });
  await write("match_events", rows);
  return rows;
}

export async function saveMatchStats(match: MatchRow, stats: Omit<MatchPlayerStatsRow, "team_id" | "match_id" | "updated_at">[]) {
  const now = nowIso();
  await write(
    "match_player_stats",
    stats.map((s) => ({ ...s, team_id: match.team_id, match_id: match.id, updated_at: now })),
  );
}
