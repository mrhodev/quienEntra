import type { MatchEventRow } from "@/lib/db/types";
import type { MatchEvent } from "./events";

/** Fila de `match_events` → evento de dominio (el payload va aplanado). */
export function toMatchEvent(row: MatchEventRow): MatchEvent {
  return {
    ...(row.payload as object),
    id: row.id,
    matchId: row.match_id,
    seq: row.seq,
    type: row.type,
    matchTimeMs: Number(row.match_time_ms),
    wallTime: Date.parse(row.wall_time),
    deviceId: row.device_id,
  } as MatchEvent;
}
