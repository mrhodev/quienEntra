import type { FieldPosition } from "@/lib/rotation";

interface BaseEvent {
  id: string;
  matchId: string;
  /** Orden dentro del partido (monótono por dispositivo; desempata por wallTime e id). */
  seq: number;
  /** Tiempo efectivo de partido (sin pausas), en ms. */
  matchTimeMs: number;
  /** Hora real (epoch ms) en que se registró. */
  wallTime: number;
  deviceId: string;
}

export type MatchEventPayload =
  | { type: "lineup_set"; goalkeeperId: string; field: { playerId: string; position: FieldPosition }[] }
  | { type: "period_start"; periodIndex: number }
  | { type: "period_end"; periodIndex: number }
  | { type: "pause" }
  | { type: "resume" }
  | { type: "sub"; outId: string | null; inId: string; position: FieldPosition }
  /** El nuevo arquero sale de donde esté y el anterior ocupa su lugar (campo o banco). */
  | { type: "gk_change"; toId: string }
  | { type: "injury"; playerId: string }
  | { type: "player_available"; playerId: string }
  | { type: "goal_for"; scorerId?: string }
  | { type: "goal_against" }
  | { type: "undo"; eventId: string }
  | { type: "match_end" };

export type MatchEvent = BaseEvent & MatchEventPayload;

export function sortEvents(events: MatchEvent[]): MatchEvent[] {
  return [...events].sort(
    (a, b) =>
      a.matchTimeMs - b.matchTimeMs ||
      a.wallTime - b.wallTime ||
      a.seq - b.seq ||
      (a.id < b.id ? -1 : a.id > b.id ? 1 : 0),
  );
}

/** Aplica los `undo`: elimina los eventos deshechos (y los propios undo). */
export function effectiveEvents(events: MatchEvent[]): MatchEvent[] {
  const undone = new Set(events.flatMap((e) => (e.type === "undo" ? [e.eventId] : [])));
  return sortEvents(events.filter((e) => e.type !== "undo" && !undone.has(e.id)));
}
