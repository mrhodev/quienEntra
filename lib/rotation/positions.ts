import { FIELD_POSITIONS, type FieldPosition, type Position } from "./types";

export const COST_PRIMARY = 0;
export const COST_SECONDARY = 1;
export const COST_OFF_POSITION = 3;

interface PositionedPlayer {
  id: string;
  primary: Position;
  secondary: Position[];
}

export function positionCost(p: PositionedPlayer, pos: FieldPosition): number {
  if (p.primary === pos) return COST_PRIMARY;
  if (p.secondary.includes(pos)) return COST_SECONDARY;
  return COST_OFF_POSITION;
}

/** Posición de campo preferida: la principal, o la primera secundaria de campo, o MED. */
export function preferredFieldPosition(p: PositionedPlayer): FieldPosition {
  if (p.primary !== "ARQ") return p.primary;
  return (p.secondary.find((s) => s !== "ARQ") as FieldPosition | undefined) ?? "MED";
}

export function formationSlots(formation: Record<FieldPosition, number>): FieldPosition[] {
  return FIELD_POSITIONS.flatMap((pos) => Array<FieldPosition>(formation[pos]).fill(pos));
}

/**
 * Asigna jugadores a los puestos de la formación minimizando el costo total
 * (DP sobre subconjuntos de puestos; alcanza para ≤ 12 jugadores de campo).
 * `previous` da un pequeño bonus a mantener la posición que ya tenía cada uno.
 */
export function assignPositions(
  players: PositionedPlayer[],
  slots: FieldPosition[] | null,
  previous: Map<string, FieldPosition> = new Map(),
): { assignment: Map<string, FieldPosition>; cost: number } {
  const assignment = new Map<string, FieldPosition>();
  if (!slots || slots.length !== players.length) {
    for (const p of players) assignment.set(p.id, previous.get(p.id) ?? preferredFieldPosition(p));
    return { assignment, cost: 0 };
  }

  const n = players.length;
  const sortedPlayers = [...players].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  const full = 1 << n;
  const dp = new Float64Array(full).fill(Infinity);
  const choice = new Int8Array(full).fill(-1);
  dp[0] = 0;
  for (let mask = 0; mask < full; mask++) {
    if (dp[mask] === Infinity) continue;
    const i = popcount(mask);
    if (i >= n) continue;
    const p = sortedPlayers[i];
    const tried = new Set<FieldPosition>();
    for (let s = 0; s < n; s++) {
      if (mask & (1 << s)) continue;
      // Puestos iguales son intercambiables: basta con probar el primero libre de cada tipo.
      if (tried.has(slots[s])) continue;
      tried.add(slots[s]);
      const c = positionCost(p, slots[s]) - (previous.get(p.id) === slots[s] ? 0.1 : 0);
      const next = mask | (1 << s);
      if (dp[mask] + c < dp[next] - 1e-9) {
        dp[next] = dp[mask] + c;
        choice[next] = s;
      }
    }
  }

  let mask = full - 1;
  let cost = 0;
  for (let i = n - 1; i >= 0; i--) {
    const s = choice[mask];
    const p = sortedPlayers[i];
    assignment.set(p.id, slots[s]);
    cost += positionCost(p, slots[s]);
    mask &= ~(1 << s);
  }
  return { assignment, cost };
}

function popcount(x: number): number {
  let c = 0;
  while (x) {
    x &= x - 1;
    c++;
  }
  return c;
}
