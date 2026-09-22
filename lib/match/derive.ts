import type { FieldPosition } from "@/lib/rotation";
import { effectiveEvents, type MatchEvent } from "./events";

export type StintRole = "field" | "goalkeeper";

export interface Stint {
  playerId: string;
  role: StintRole;
  position: FieldPosition | "ARQ";
  periodIndex: number;
  startMs: number;
  /** null si sigue en cancha. */
  endMs: number | null;
}

export interface PlayerMinutes {
  fieldMs: number;
  goalkeeperMs: number;
}

export interface MatchState {
  stints: Stint[];
  goalkeeperId: string | null;
  onField: Map<string, FieldPosition>;
  periodIndex: number | null;
  /** true entre period_start y period_end (independiente de las pausas). */
  inPeriod: boolean;
  ended: boolean;
  injured: Set<string>;
  goalsFor: number;
  goalsAgainst: number;
  scorers: Map<string, number>;
}

/**
 * Reconstruye el estado del partido a partir del log de eventos (fuente de verdad).
 * Los tiempos son efectivos: las pausas no suman (RF-15).
 */
export function deriveMatch(events: MatchEvent[]): MatchState {
  const s: MatchState = {
    stints: [],
    goalkeeperId: null,
    onField: new Map(),
    periodIndex: null,
    inPeriod: false,
    ended: false,
    injured: new Set(),
    goalsFor: 0,
    goalsAgainst: 0,
    scorers: new Map(),
  };
  const open = new Map<string, Stint>();

  const openStint = (playerId: string, role: StintRole, position: Stint["position"], t: number) => {
    if (!s.inPeriod || s.periodIndex === null) return;
    const st: Stint = { playerId, role, position, periodIndex: s.periodIndex, startMs: t, endMs: null };
    open.set(playerId, st);
    s.stints.push(st);
  };
  const closeStint = (playerId: string, t: number) => {
    const st = open.get(playerId);
    if (st) {
      st.endMs = t;
      open.delete(playerId);
    }
  };
  const openAll = (t: number) => {
    if (s.goalkeeperId) openStint(s.goalkeeperId, "goalkeeper", "ARQ", t);
    for (const [id, pos] of s.onField) openStint(id, "field", pos, t);
  };
  const closeAll = (t: number) => {
    for (const id of [...open.keys()]) closeStint(id, t);
  };

  for (const e of effectiveEvents(events)) {
    const t = e.matchTimeMs;
    switch (e.type) {
      case "lineup_set":
        closeAll(t);
        s.goalkeeperId = e.goalkeeperId;
        s.onField = new Map(e.field.map((f) => [f.playerId, f.position]));
        openAll(t);
        break;
      case "period_start":
        s.periodIndex = e.periodIndex;
        s.inPeriod = true;
        openAll(t);
        break;
      case "period_end":
        closeAll(t);
        s.inPeriod = false;
        break;
      case "sub":
        if (e.outId && s.onField.has(e.outId)) {
          s.onField.delete(e.outId);
          closeStint(e.outId, t);
        }
        if (!s.onField.has(e.inId) && e.inId !== s.goalkeeperId) {
          s.onField.set(e.inId, e.position);
          openStint(e.inId, "field", e.position, t);
        }
        break;
      case "gk_change": {
        const old = s.goalkeeperId;
        if (old === e.toId) break;
        const toPos = s.onField.get(e.toId);
        closeStint(e.toId, t);
        if (old) closeStint(old, t);
        s.onField.delete(e.toId);
        s.goalkeeperId = e.toId;
        openStint(e.toId, "goalkeeper", "ARQ", t);
        if (old && toPos) {
          s.onField.set(old, toPos);
          openStint(old, "field", toPos, t);
        }
        break;
      }
      case "injury":
        s.injured.add(e.playerId);
        // Sale de inmediato; el equipo queda con uno menos hasta que entre el reemplazo.
        if (s.onField.delete(e.playerId)) closeStint(e.playerId, t);
        break;
      case "player_available":
        s.injured.delete(e.playerId);
        break;
      case "goal_for":
        s.goalsFor++;
        if (e.scorerId) s.scorers.set(e.scorerId, (s.scorers.get(e.scorerId) ?? 0) + 1);
        break;
      case "goal_against":
        s.goalsAgainst++;
        break;
      case "match_end":
        closeAll(t);
        s.inPeriod = false;
        s.ended = true;
        break;
      case "pause":
      case "resume":
        break;
    }
  }
  return s;
}

/** Minutos por jugador; los stints abiertos se cuentan hasta `nowMs`. */
export function minutesByPlayer(stints: Stint[], nowMs: number): Map<string, PlayerMinutes> {
  const out = new Map<string, PlayerMinutes>();
  for (const st of stints) {
    const m = out.get(st.playerId) ?? { fieldMs: 0, goalkeeperMs: 0 };
    const d = Math.max(0, (st.endMs ?? nowMs) - st.startMs);
    if (st.role === "field") m.fieldMs += d;
    else m.goalkeeperMs += d;
    out.set(st.playerId, m);
  }
  return out;
}
