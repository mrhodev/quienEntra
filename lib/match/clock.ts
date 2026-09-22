import { effectiveEvents, type MatchEvent } from "./events";

export interface ClockState {
  running: boolean;
  /** Tiempo efectivo total del partido (sin pausas ni entretiempos), en ms. */
  elapsedMs: number;
  /** Tiempo efectivo del período en curso (o del último), en ms. */
  periodElapsedMs: number;
  periodIndex: number | null;
}

/**
 * Cronómetro derivado de marcas de tiempo reales (RNF-05): no depende de setInterval,
 * así que sobrevive al bloqueo de pantalla, a pasar a segundo plano y a recargar la página.
 */
export function clockAt(events: MatchEvent[], nowWall: number): ClockState {
  let running = false;
  let base = 0; // ms efectivos acumulados hasta el último arranque
  let runningSince = 0; // wallTime del último arranque
  let periodStartElapsed = 0;
  let periodIndex: number | null = null;

  for (const e of effectiveEvents(events)) {
    switch (e.type) {
      case "period_start":
        periodIndex = e.periodIndex;
        periodStartElapsed = base;
        running = true;
        runningSince = e.wallTime;
        break;
      case "resume":
        if (!running && periodIndex !== null) {
          running = true;
          runningSince = e.wallTime;
        }
        break;
      case "pause":
      case "period_end":
      case "match_end":
        if (running) {
          base += Math.max(0, e.wallTime - runningSince);
          running = false;
        }
        break;
    }
  }

  const elapsedMs = base + (running ? Math.max(0, nowWall - runningSince) : 0);
  return { running, elapsedMs, periodElapsedMs: elapsedMs - periodStartElapsed, periodIndex };
}

export function formatClock(ms: number): string {
  const total = Math.floor(ms / 1000);
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
}
