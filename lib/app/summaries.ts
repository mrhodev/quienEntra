import type { GanttRow } from "@/components/charts";
import type { PlayerRow, StintData } from "@/lib/db/types";

/** Cortes de período (ms efectivos) a partir de los stints: el final de cada período salvo el último. */
export function periodCuts(stints: StintData[]): number[] {
  const ends = new Map<number, number>();
  for (const s of stints) ends.set(s.periodIndex, Math.max(ends.get(s.periodIndex) ?? 0, s.endMs));
  return [...ends.entries()]
    .sort((a, b) => a[0] - b[0])
    .slice(0, -1)
    .map(([, t]) => t);
}

export interface PlayerMinutesRow {
  playerId: string;
  fieldSeconds: number;
  goalkeeperSeconds: number;
  stints: StintData[];
}

export function ganttRows(rows: PlayerMinutesRow[], byId: Map<string, PlayerRow>, nameOf: (p: PlayerRow | undefined) => string): GanttRow[] {
  return rows
    .filter((r) => r.fieldSeconds + r.goalkeeperSeconds > 0)
    .map((r) => ({
      id: r.playerId,
      name: nameOf(byId.get(r.playerId)),
      minutes: (r.fieldSeconds + r.goalkeeperSeconds) / 60,
      stints: r.stints.map((s) => ({ startMs: s.startMs, endMs: s.endMs, role: s.role })),
    }))
    .sort((a, b) => (a.stints[0]?.startMs ?? 0) - (b.stints[0]?.startMs ?? 0) || b.minutes - a.minutes);
}

/** Dato de equidad del partido (RF-36): rango de minutos de campo entre los que jugaron solo de campo. */
export function matchEquityText(rows: PlayerMinutesRow[]): string {
  const field = rows.filter((r) => r.goalkeeperSeconds === 0 && r.fieldSeconds > 0).map((r) => Math.round(r.fieldSeconds / 60));
  if (!field.length) return "Sin minutos registrados";
  const lo = Math.min(...field);
  const hi = Math.max(...field);
  return lo === hi ? `Todos jugaron ${lo}'` : `Todos jugaron entre ${lo}' y ${hi}'`;
}
