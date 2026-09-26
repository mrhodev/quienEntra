import {
  positionCost,
  type FieldPosition,
  type RotationPlan,
  type RotationPlayer,
  type Substitution,
} from "@/lib/rotation";

/** Cambios que el plan recalculado pide hacer ahora (RF-17): los de la ventana en curso. */
export function dueSubs(plan: RotationPlan): Substitution[] {
  return plan.windows[0]?.subs ?? [];
}

export interface SwapContext {
  players: RotationPlayer[];
  onField: Map<string, FieldPosition>;
  goalkeeperId: string | null;
  /** Lesionados o que todavía no llegaron. */
  unavailable: Set<string>;
  /** Minutos jugados hasta ahora, en la base de equidad del plan. */
  played: Map<string, number>;
  targetMinutes: Record<string, number>;
}

export interface Candidate {
  playerId: string;
  /** 0 posición principal, 1 secundaria, 3 fuera de posición. */
  positionCost: number;
  /** Cuota justa menos lo jugado: positivo = le faltan minutos. */
  pendingMinutes: number;
}

const pending = (ctx: SwapContext, id: string) => (ctx.targetMinutes[id] ?? 0) - (ctx.played.get(id) ?? 0);
const byId = (a: Candidate, b: Candidate) => (a.playerId < b.playerId ? -1 : a.playerId > b.playerId ? 1 : 0);

/**
 * Quiénes pueden entrar en lugar del sugerido (RF-17): del banco, disponibles y que no entren ya
 * en otro cambio. Primero los de la posición del cambio y, entre ellos, a quienes más minutos les faltan.
 */
export function alternativesIn(sub: Substitution, pairs: Substitution[], ctx: SwapContext): Candidate[] {
  const taken = new Set(pairs.filter((p) => p !== sub).map((p) => p.inId));
  return ctx.players
    .filter(
      (p) =>
        !ctx.onField.has(p.id) &&
        p.id !== ctx.goalkeeperId &&
        !ctx.unavailable.has(p.id) &&
        !taken.has(p.id),
    )
    .map((p) => ({ playerId: p.id, positionCost: positionCost(p, sub.position), pendingMinutes: pending(ctx, p.id) }))
    .sort((a, b) => a.positionCost - b.positionCost || b.pendingMinutes - a.pendingMinutes || byId(a, b));
}

/**
 * Quiénes pueden salir en lugar del sugerido: en cancha y que no salgan ya en otro cambio.
 * Primero quienes más se pasaron de su cuota.
 */
export function alternativesOut(sub: Substitution, pairs: Substitution[], ctx: SwapContext): Candidate[] {
  const taken = new Set(pairs.filter((p) => p !== sub).flatMap((p) => (p.outId ? [p.outId] : [])));
  const incoming = ctx.players.find((p) => p.id === sub.inId);
  return [...ctx.onField]
    .filter(([id]) => !taken.has(id))
    .map(([id, pos]) => ({
      playerId: id,
      positionCost: incoming ? positionCost(incoming, pos) : 0,
      pendingMinutes: pending(ctx, id),
    }))
    .sort((a, b) => a.pendingMinutes - b.pendingMinutes || a.positionCost - b.positionCost || byId(a, b));
}

/** Cambia quién entra; la posición del cambio no cambia. */
export function withIn(sub: Substitution, inId: string): Substitution {
  return { ...sub, inId };
}

/** Cambia quién sale; quien entra ocupa la posición del que sale. */
export function withOut(sub: Substitution, outId: string, onField: Map<string, FieldPosition>): Substitution {
  return { ...sub, outId, position: onField.get(outId) ?? sub.position };
}
