"use client";

import type { PlanLock, Position, RotationPlan } from "@/lib/rotation";
import { POS_BG } from "./ui";

/** Minutos de cada módulo visual de la grilla (RF-12). */
const MODULE_MINUTES = 5;

export interface GridRow {
  id: string;
  name: string;
  position: Position;
  dim?: boolean;
}

/**
 * Grilla del plan (RF-12): ventanas (columnas) × jugadores (filas), con celdas por posición,
 * separadores cada 5 minutos y un corte más marcado entre períodos. Tocar una celda la fija (RF-13).
 */
export function PlanGrid({
  plan,
  rows,
  locks,
  goalkeeperId,
  onCell,
}: {
  plan: RotationPlan;
  rows: GridRow[];
  locks: PlanLock[];
  goalkeeperId: string | null;
  onCell?: (playerId: string, windowIndex: number) => void;
}) {
  const w = plan.windows;
  const moduleOf = (min: number) => Math.floor(min / MODULE_MINUTES + 1e-6);
  const sep = (i: number) =>
    i > 0 && w[i - 1].periodIndex !== w[i].periodIndex
      ? "border-l-2 border-foreground/30"
      : i > 0 && moduleOf(w[i].startMin) > moduleOf(w[i - 1].startMin)
        ? "border-l border-border"
        : "";
  const lockOf = new Map(locks.map((l) => [`${l.playerId}|${l.windowIndex}`, l.state]));

  return (
    <div className="overflow-x-auto rounded-2xl border border-border bg-surface">
      <table className="w-full border-collapse text-sm">
        <thead>
          <tr className="text-xs text-muted">
            <th className="sticky left-0 z-10 bg-surface px-2 py-2 text-left font-medium">Jugador</th>
            {w.map((win, i) => (
              <th key={win.index} className={`tabular px-px py-2 text-[10px] font-medium ${sep(i)}`}>
                {win.startMin}&apos;
              </th>
            ))}
            <th className="px-2 py-2 text-right font-medium">Min</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.id} className={`border-t border-border ${r.dim ? "opacity-40" : ""}`}>
              <th scope="row" className="sticky left-0 z-10 bg-surface px-2 py-1 text-left font-normal">
                <span className="flex items-center gap-1.5">
                  <span className={`size-2.5 shrink-0 rounded-full ${POS_BG[r.position]}`} aria-hidden />
                  <span className="max-w-20 truncate">{r.name}</span>
                </span>
              </th>
              {w.map((win, i) => {
                const pos =
                  win.goalkeeperId === r.id ? ("ARQ" as const) : win.field.find((f) => f.playerId === r.id)?.position;
                const lock = lockOf.get(`${r.id}|${win.index}`);
                const entering = win.subs.some((s) => s.inId === r.id);
                const disabled = !onCell || r.dim || r.id === goalkeeperId;
                return (
                  <td key={win.index} className={`px-px py-1 ${sep(i)}`}>
                    <button
                      disabled={disabled}
                      onClick={() => onCell?.(r.id, win.index)}
                      aria-label={`${r.name}, ${win.startMin}' a ${win.endMin}': ${pos ?? "banco"}${lock ? `, fijado en ${lock === "field" ? "cancha" : "banco"}` : ""}`}
                      className={`relative block h-7 w-full min-w-3.5 rounded-[5px] transition-all duration-300 ${pos ? POS_BG[pos] : "bg-border/60"} ${entering ? "ring-2 ring-foreground/60 ring-offset-1 ring-offset-surface" : ""}`}
                    >
                      {lock && (
                        <span className="absolute inset-0 grid place-items-center text-[9px] font-bold text-white mix-blend-difference" aria-hidden>
                          {lock === "field" ? "●" : "✕"}
                        </span>
                      )}
                    </button>
                  </td>
                );
              })}
              <td className="tabular px-1.5 py-1 text-right font-semibold">
                {r.dim ? "" : r.id === goalkeeperId ? "ARQ" : `${Math.round(plan.expectedFieldMinutes[r.id] ?? 0)}'`}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/** Ciclo de un bloqueo al tocar una celda: libre → en cancha → en el banco → libre. */
export function cycleLock(locks: PlanLock[], playerId: string, windowIndex: number): PlanLock[] {
  const rest = locks.filter((l) => !(l.playerId === playerId && l.windowIndex === windowIndex));
  const current = locks.find((l) => l.playerId === playerId && l.windowIndex === windowIndex)?.state;
  if (!current) return [...rest, { playerId, windowIndex, state: "field" }];
  if (current === "field") return [...rest, { playerId, windowIndex, state: "bench" }];
  return rest;
}
