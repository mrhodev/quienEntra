import type { MatchPlayerStatsRow, StintData } from "@/lib/db/types";
import { deriveMatch } from "@/lib/match/derive";
import { effectiveEvents, type MatchEvent } from "@/lib/match/events";
import type { AttendanceState } from "@/lib/match/live";
import { allocate } from "@/lib/rotation/allocate";

export type PlayerMatchStats = Omit<MatchPlayerStatsRow, "team_id" | "match_id" | "updated_at">;

/** Duración efectiva del partido: hasta `match_end`, o hasta el último evento si no terminó. */
export function matchEndMs(events: MatchEvent[]): number {
  const eff = effectiveEvents(events);
  const end = eff.find((e) => e.type === "match_end");
  return end ? end.matchTimeMs : Math.max(0, ...eff.map((e) => e.matchTimeMs));
}

/**
 * Tiempo disponible de cada jugador, en ms efectivos: desde el inicio (presentes) o desde que se
 * lo marcó disponible (llegó tarde, volvió de una lesión), hasta que se lesiona o termina el partido.
 */
export function availableMs(
  events: MatchEvent[],
  attendance: Map<string, AttendanceState>,
  endMs: number,
): Map<string, number> {
  const since = new Map<string, number>();
  const total = new Map<string, number>();
  for (const [id, a] of attendance) if (a === "present") since.set(id, 0);
  const close = (id: string, t: number) => {
    const s = since.get(id);
    if (s === undefined) return;
    total.set(id, (total.get(id) ?? 0) + Math.max(0, Math.min(t, endMs) - s));
    since.delete(id);
  };
  for (const e of effectiveEvents(events)) {
    if (e.type === "injury") close(e.playerId, e.matchTimeMs);
    if (e.type === "player_available" && !since.has(e.playerId)) since.set(e.playerId, e.matchTimeMs);
  }
  for (const id of [...since.keys()]) close(id, endMs);
  return total;
}

/**
 * Resultado de un partido por jugador (lo que se guarda en `match_player_stats`).
 * La cuota justa es el reparto parejo de los minutos de campo jugados, limitado por el tiempo
 * disponible de cada uno (§6.2, sin el ajuste del torneo): es la base del acumulado r_i.
 * Con el arquero fijo, sus minutos de arco cuentan como jugados y como cuota (RF-21).
 */
export function matchPlayerStats(
  events: MatchEvent[],
  attendance: Map<string, AttendanceState>,
  goalkeeperRotates: boolean,
): Map<string, PlayerMatchStats> {
  const endMs = matchEndMs(events);
  const state = deriveMatch(events);
  const available = availableMs(events, attendance, endMs);

  const stints = new Map<string, StintData[]>();
  const field = new Map<string, number>();
  const gk = new Map<string, number>();
  for (const st of state.stints) {
    const end = st.endMs ?? endMs;
    const d = Math.max(0, end - st.startMs);
    const acc = st.role === "field" ? field : gk;
    acc.set(st.playerId, (acc.get(st.playerId) ?? 0) + d);
    if (!stints.has(st.playerId)) stints.set(st.playerId, []);
    stints.get(st.playerId)!.push({
      role: st.role,
      position: st.position,
      periodIndex: st.periodIndex,
      startMs: st.startMs,
      endMs: end,
    });
  }

  const ids = [...new Set([...attendance.keys(), ...field.keys(), ...gk.keys()])].sort();
  const avail = (id: string) => Math.max(available.get(id) ?? 0, (field.get(id) ?? 0) + (gk.get(id) ?? 0));
  const played = (id: string) => (field.get(id) ?? 0) + (gk.get(id) ?? 0);

  let targets: number[];
  if (goalkeeperRotates) {
    const total = ids.reduce((a, id) => a + played(id), 0);
    targets = allocate(ids.map(() => 1), ids.map(avail), total);
  } else {
    const total = ids.reduce((a, id) => a + (field.get(id) ?? 0), 0);
    const fieldTargets = allocate(
      ids.map(() => 1),
      ids.map((id) => Math.max(0, avail(id) - (gk.get(id) ?? 0))),
      total,
    );
    targets = fieldTargets.map((t, i) => t + (gk.get(ids[i]) ?? 0));
  }

  const goals = new Map<string, number>();
  for (const [id, n] of state.scorers) goals.set(id, n);

  const out = new Map<string, PlayerMatchStats>();
  ids.forEach((id, i) => {
    out.set(id, {
      player_id: id,
      field_seconds: Math.round((field.get(id) ?? 0) / 1000),
      goalkeeper_seconds: Math.round((gk.get(id) ?? 0) / 1000),
      target_seconds: Math.round(targets[i] / 1000),
      available_seconds: Math.round((available.get(id) ?? 0) / 1000),
      goals: goals.get(id) ?? 0,
      stints: stints.get(id) ?? [],
    });
  });
  return out;
}
