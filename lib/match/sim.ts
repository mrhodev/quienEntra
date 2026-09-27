/**
 * Reloj virtual del modo simulación (RF-41, solo beta). El partido se registra con horas
 * virtuales que avanzan `speed` veces más rápido que las reales; como el cronómetro sale de
 * las marcas de tiempo de los eventos (RNF-05), todo lo demás funciona igual.
 */
export interface SimClock {
  /** Hora virtual (epoch ms) en el instante real `real`. */
  virtual: number;
  real: number;
  speed: number;
}

export const SIM_SPEEDS = [1, 10, 30, 60] as const;

/** Hora virtual en el instante real `real` (sin simulación, la real). */
export function simNow(sim: SimClock | null, real: number): number {
  return sim ? sim.virtual + (real - sim.real) * sim.speed : real;
}

/** Cambia la velocidad sin saltos: la hora virtual sigue desde donde estaba. */
export function withSpeed(sim: SimClock | null, speed: number, real: number): SimClock {
  return { virtual: simNow(sim, real), real, speed };
}

/** Adelanta la hora virtual `ms` (nunca hacia atrás). */
export function jump(sim: SimClock | null, ms: number, real: number): SimClock {
  return { virtual: simNow(sim, real) + Math.max(0, ms), real, speed: sim?.speed ?? 1 };
}
