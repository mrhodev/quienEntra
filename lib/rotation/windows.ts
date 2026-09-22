import { EPS } from "./allocate";
import type { RotationConfig } from "./types";

export interface TimeWindow {
  index: number;
  startMin: number;
  endMin: number;
  periodIndex: number;
  /** true si la ventana empieza con el período (los cambios en el entretiempo son libres). */
  periodStart: boolean;
}

export function matchDuration(config: RotationConfig): number {
  return config.periods.reduce((a, p) => a + p.minutes, 0);
}

export function periodBounds(config: RotationConfig): { start: number; end: number }[] {
  let t = 0;
  return config.periods.map((p) => {
    const b = { start: t, end: t + p.minutes };
    t += p.minutes;
    return b;
  });
}

/**
 * Ventanas del partido completo: un corte al inicio de cada período, cada `windowMinutes`
 * desde ese inicio, y en cada minuto extra recibido (por ejemplo, un cambio de arquero planificado).
 */
export function buildWindows(config: RotationConfig, extraCuts: number[] = []): TimeWindow[] {
  const b = config.windowMinutes;
  if (!(b > 0)) throw new Error("windowMinutes debe ser > 0");
  const windows: TimeWindow[] = [];

  periodBounds(config).forEach(({ start, end }, periodIndex) => {
    const cuts = new Set<number>();
    for (let t = start; t < end - EPS; t += b) cuts.add(round(t));
    for (const c of extraCuts) if (c > start + EPS && c < end - EPS) cuts.add(round(c));
    const sorted = [...cuts].sort((x, y) => x - y);
    sorted.forEach((s, k) => {
      windows.push({
        index: windows.length,
        startMin: s,
        endMin: k + 1 < sorted.length ? sorted[k + 1] : end,
        periodIndex,
        periodStart: k === 0,
      });
    });
  });
  return windows;
}

/** Ventanas restantes desde `nowMin`; la que contiene `nowMin` se recorta y conserva su índice. */
export function windowsFrom(windows: TimeWindow[], nowMin: number): TimeWindow[] {
  return windows
    .filter((w) => w.endMin > nowMin + EPS)
    .map((w) =>
      w.startMin >= nowMin - EPS ? w : { ...w, startMin: nowMin, periodStart: false },
    );
}

function round(x: number): number {
  return Math.round(x * 1e6) / 1e6;
}
