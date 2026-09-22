import type { Position, RotationConfig, RotationInput, RotationPlan, RotationPlayer } from "./types";

export const F7: RotationConfig = {
  playersOnField: 7,
  periods: [{ minutes: 25 }, { minutes: 25 }],
  windowMinutes: 5,
  minStintMinutes: 5,
  guaranteedMinutes: 5,
  formation: { DEF: 2, MED: 3, DEL: 1 },
  equityWeight: 0.3,
  goalkeeperRotates: false,
};

const CYCLE: Position[] = ["DEF", "MED", "DEL", "MED", "DEF", "MED"];

export function makePlayers(n: number, overrides: Partial<RotationPlayer> = {}): RotationPlayer[] {
  return Array.from({ length: n }, (_, i) => ({
    id: `p${String(i + 1).padStart(2, "0")}`,
    primary: CYCLE[i % CYCLE.length],
    secondary: [],
    availableFromMin: 0,
    availableUntilMin: 999,
    tournamentRatio: null,
    ...overrides,
  }));
}

/** Arquero fijo "gk" + `n` jugadores de campo. */
export function baseInput(n: number, config: RotationConfig = F7): RotationInput {
  const gk: RotationPlayer = {
    id: "gk",
    primary: "ARQ",
    secondary: [],
    availableFromMin: 0,
    availableUntilMin: 999,
    tournamentRatio: null,
  };
  return {
    config,
    players: [gk, ...makePlayers(n)],
    goalkeeperSchedule: [{ playerId: "gk", fromMin: 0 }],
  };
}

export interface Stint {
  playerId: string;
  start: number;
  end: number;
}

/** Stints de campo contiguos derivados del plan (respeta los cortes de período). */
export function planStints(plan: RotationPlan): Stint[] {
  const open = new Map<string, Stint>();
  const done: Stint[] = [];
  let prevPeriod = -1;
  for (const w of plan.windows) {
    if (w.periodIndex !== prevPeriod) {
      done.push(...open.values());
      open.clear();
      prevPeriod = w.periodIndex;
    }
    const ids = new Set(w.field.map((f) => f.playerId));
    for (const [id, s] of open) {
      if (!ids.has(id)) {
        done.push(s);
        open.delete(id);
      }
    }
    for (const id of ids) {
      const s = open.get(id);
      if (s && Math.abs(s.end - w.startMin) < 1e-6) s.end = w.endMin;
      else open.set(id, { playerId: id, start: w.startMin, end: w.endMin });
    }
  }
  done.push(...open.values());
  return done;
}
