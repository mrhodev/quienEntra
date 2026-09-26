"use client";

import { saveMatchStats, updateMatch } from "@/lib/db/repo";
import type { MatchRow } from "@/lib/db/types";
import { effectiveEvents, type MatchEvent } from "@/lib/match/events";
import type { AttendanceState } from "@/lib/match/live";
import { matchPlayerStats } from "@/lib/stats/match";

/** Cierra el partido: guarda los minutos de cada jugador y el resultado, y lo marca como finalizado (RF-25). */
export async function finalizeMatch(
  match: MatchRow,
  events: MatchEvent[],
  attendance: [string, AttendanceState][],
  goalkeeperRotates: boolean,
) {
  const stats = matchPlayerStats(events, new Map(attendance), goalkeeperRotates);
  await saveMatchStats(match, [...stats.values()]);
  const eff = effectiveEvents(events);
  await updateMatch(match, {
    status: "finished",
    goals_for: eff.filter((e) => e.type === "goal_for").length,
    goals_against: eff.filter((e) => e.type === "goal_against").length,
  });
}
