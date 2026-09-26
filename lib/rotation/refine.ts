import { EPS } from "./allocate";

/** Pesos del objetivo del refinamiento (§6.3, paso 5). Unidad: (desvío de la cuota / b)². */
export const REFINE_WEIGHTS = {
  /** Cada stint (entrada a la cancha) de un jugador. */
  stint: 0.1,
  /** Cuadrado de las entradas de cada ventana: favorece repartir los cambios. */
  entries: 0.01,
  /** Por unidad de costo de posición (0 principal, 1 secundaria, 3 fuera de posición). */
  position: 0.1,
};
const MAX_PASSES = 30;
/** Nadie pasa a tener más de dos stints por el refinamiento (RF-40). */
const MAX_STINTS = 2;

export interface RefineProblem {
  /** Duración de cada ventana. */
  lens: number[];
  /** true si la ventana cierra un período. */
  periodEnd: boolean[];
  /** Ventanas que el refinamiento no toca (la ventana en curso, recortada en vivo). */
  frozen: boolean[];
  /** Jugadores en cancha por ventana; se modifica en el lugar. */
  lineups: string[][];
  /** Base de equidad al final del plan (jugados + previstos); se modifica en el lugar. */
  minutes: Map<string, number>;
  target: Map<string, number>;
  floor: Map<string, number>;
  /** En cancha antes de la primera ventana → minutos que ya lleva su stint. Vacío antes del partido. */
  initial: Map<string, number>;
  candidates: string[];
  canPlay(id: string, k: number): boolean;
  lockedOn(id: string, k: number): boolean;
  /** Costo de posiciones de una alineación (asignación óptima a la formación). */
  lineupCost(ids: string[]): number;
  minStint: number;
  b: number;
  /** Tope de entradas por ventana; una ventana que ya lo supera no puede sumar más. */
  entryCap: number;
}

/**
 * Búsqueda local sobre el plan del greedy: canjea a un jugador en cancha por uno del banco en una
 * ventana si baja el objetivo (equidad + stints + concentración de cambios + posiciones), sin
 * romper bloqueos, disponibilidad, mínimos garantizados ni el stint mínimo. Determinista.
 */
export function refineLineups(pb: RefineProblem): void {
  const { lens, lineups, minutes, target, b } = pb;
  const W = lineups.length;
  if (W === 0) return;
  const on = lineups.map((l) => new Set(l));
  const wasOn = (id: string, k: number) => (k < 0 ? pb.initial.has(id) : on[k].has(id));
  const countsEntries = (k: number) => k > 0 || pb.initial.size > 0;
  const entries = on.map((s, k) => (countsEntries(k) ? [...s].filter((id) => !wasOn(id, k - 1)).length : 0));
  const cap = entries.map((e) => Math.max(e, pb.entryCap));
  const posCost = lineups.map((l) => pb.lineupCost(l));

  const eq = (id: string, m: number) => ((m - target.get(id)!) / b) ** 2;

  const stints = new Map<string, number>();
  on.forEach((s, k) => {
    for (const id of s) if (!wasOn(id, k - 1)) stints.set(id, (stints.get(id) ?? 0) + 1);
  });
  const stintsOf = (id: string) => stints.get(id) ?? 0;

  /** Stints cortos que no cierran un período (CA-R4); el refinamiento no puede sumar ninguno. */
  const shortStints = (id: string) => {
    let bad = 0;
    let len = pb.initial.has(id) ? pb.initial.get(id)! : -1;
    for (let k = 0; k < W; k++) {
      if (on[k].has(id)) {
        len = Math.max(len, 0) + lens[k];
        if (pb.periodEnd[k]) len = -1;
      } else {
        if (len >= 0 && len < pb.minStint - EPS) bad++;
        len = -1;
      }
    }
    return bad;
  };

  for (let pass = 0; pass < MAX_PASSES; pass++) {
    let improved = false;
    for (let k = 0; k < W; k++) {
      if (pb.frozen[k]) continue;
      const L = lens[k];
      const bench = pb.candidates.filter((id) => !on[k].has(id) && pb.canPlay(id, k));
      for (const p of [...lineups[k]].sort()) {
        if (!on[k].has(p) || pb.lockedOn(p, k)) continue;
        const mp = minutes.get(p)!;
        if (mp - L < pb.floor.get(p)! - EPS && mp >= pb.floor.get(p)! - EPS) continue;
        const pPrev = wasOn(p, k - 1);
        const pNext = k + 1 < W && on[k + 1].has(p);
        for (const c of bench) {
          if (on[k].has(c)) continue;
          const mc = minutes.get(c)!;
          const cPrev = wasOn(c, k - 1);
          const cNext = k + 1 < W && on[k + 1].has(c);

          let delta = eq(p, mp - L) - eq(p, mp) + eq(c, mc + L) - eq(c, mc);
          const dp = pPrev && pNext ? 1 : !pPrev && !pNext ? -1 : 0;
          const dc = cPrev && cNext ? -1 : !cPrev && !cNext ? 1 : 0;
          if ((dp > 0 && stintsOf(p) + dp > MAX_STINTS) || (dc > 0 && stintsOf(c) + dc > MAX_STINTS)) continue;
          delta += REFINE_WEIGHTS.stint * (dp + dc);

          let ek = entries[k];
          if (countsEntries(k)) ek += (cPrev ? 0 : 1) - (pPrev ? 0 : 1);
          let ek1 = k + 1 < W ? entries[k + 1] : 0;
          if (k + 1 < W) ek1 += (pNext ? 1 : 0) - (cNext ? 1 : 0);
          if (ek > cap[k] || (k + 1 < W && ek1 > cap[k + 1])) continue;
          delta += REFINE_WEIGHTS.entries * (ek ** 2 - entries[k] ** 2);
          if (k + 1 < W) delta += REFINE_WEIGHTS.entries * (ek1 ** 2 - entries[k + 1] ** 2);
          if (delta > -EPS) continue;

          const next = lineups[k].map((id) => (id === p ? c : id));
          const cost = pb.lineupCost(next);
          delta += REFINE_WEIGHTS.position * (cost - posCost[k]);
          if (delta > -EPS) continue;

          const before = shortStints(p) + shortStints(c);
          on[k].delete(p);
          on[k].add(c);
          if (shortStints(p) + shortStints(c) > before) {
            on[k].delete(c);
            on[k].add(p);
            continue;
          }
          lineups[k] = next;
          posCost[k] = cost;
          minutes.set(p, mp - L);
          minutes.set(c, mc + L);
          stints.set(p, stintsOf(p) + dp);
          stints.set(c, stintsOf(c) + dc);
          entries[k] = ek;
          if (k + 1 < W) entries[k + 1] = ek1;
          bench.splice(bench.indexOf(c), 1, p);
          improved = true;
          break;
        }
      }
    }
    if (!improved) break;
  }
}
