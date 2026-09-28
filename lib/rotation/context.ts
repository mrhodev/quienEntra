import { allocateWithFloors, EPS } from "./allocate";
import { assignPositions, formationSlots } from "./positions";
import type { FieldPosition, PlanWindow, RotationInput, RotationIssue, RotationPlan, RotationPlayer, Substitution } from "./types";
import { buildWindows, matchDuration, windowsFrom, type TimeWindow } from "./windows";

/**
 * Datos comunes de un cálculo de plan (spec §6.2): ventanas, disponibilidad, lo ya jugado,
 * cuotas justas y mínimos garantizados. Lo usan los dos planificadores.
 */
export function prepare(input: RotationInput) {
  const { config, players } = input;
  const nowMin = input.nowMin ?? 0;
  const b = config.windowMinutes;
  const fieldSlots = config.playersOnField - 1;
  const rotates = config.goalkeeperRotates;

  const formationSum = config.formation
    ? config.formation.DEF + config.formation.MED + config.formation.DEL
    : 0;
  const slots =
    config.formation && formationSum === fieldSlots ? formationSlots(config.formation) : null;

  const gkSchedule = [...input.goalkeeperSchedule].sort((a, b) => a.fromMin - b.fromMin);
  const goalkeeperAt = (t: number): string | null => {
    let id: string | null = null;
    for (const g of gkSchedule) if (g.fromMin <= t + EPS) id = g.playerId;
    return id;
  };

  const allWindows = buildWindows(
    config,
    gkSchedule.map((g) => g.fromMin),
  );
  const windows = windowsFrom(allWindows, nowMin);
  const gkOf = new Map(windows.map((w) => [w.index, goalkeeperAt(w.startMin)]));
  const len = (w: TimeWindow) => w.endMin - w.startMin;

  const byId = new Map(players.map((p) => [p.id, p]));
  const ids = players.map((p) => p.id);
  const available = (p: RotationPlayer, w: TimeWindow) =>
    p.availableFromMin <= w.startMin + EPS && p.availableUntilMin >= w.endMin - EPS;
  const fieldEligible = (p: RotationPlayer, w: TimeWindow) =>
    available(p, w) && gkOf.get(w.index) !== p.id;

  // --- Minutos ya jugados y minutos de arco futuros (pre-asignados) ---
  const playedField = new Map<string, number>();
  const playedGk = new Map<string, number>();
  for (const p of input.playedSoFar ?? []) {
    playedField.set(p.playerId, p.fieldMinutes);
    playedGk.set(p.playerId, p.goalkeeperMinutes);
  }
  const futureGk = new Map<string, number>();
  for (const w of windows) {
    const gk = gkOf.get(w.index);
    if (gk) futureGk.set(gk, (futureGk.get(gk) ?? 0) + len(w));
  }

  // --- Cuotas justas (§6.2) ---
  const basePlayed = (id: string) =>
    (playedField.get(id) ?? 0) + (rotates ? (playedGk.get(id) ?? 0) : 0);
  const futureFieldCap = new Map<string, number>();
  // suffixEligible[id][k]: minutos elegibles de campo desde la ventana k+1 en adelante.
  const suffixEligible = new Map<string, number[]>();
  for (const p of players) {
    const suffix = new Array<number>(windows.length).fill(0);
    let acc = 0;
    for (let k = windows.length - 1; k >= 0; k--) {
      suffix[k] = acc;
      if (fieldEligible(p, windows[k])) acc += len(windows[k]);
    }
    futureFieldCap.set(p.id, acc);
    suffixEligible.set(p.id, suffix);
  }

  const remainingFieldMinutes = windows.reduce((a, w) => a + len(w) * fieldSlots, 0);
  const remainingGkMinutes = rotates
    ? windows.reduce((a, w) => a + (gkOf.get(w.index) ? len(w) : 0), 0)
    : 0;
  const total =
    ids.reduce((a, id) => a + basePlayed(id), 0) + remainingFieldMinutes + remainingGkMinutes;

  const caps = ids.map(
    (id) => basePlayed(id) + futureFieldCap.get(id)! + (rotates ? (futureGk.get(id) ?? 0) : 0),
  );
  const weights = players.map((p) =>
    Math.max(0.05, 1 + config.equityWeight * (1 - (p.tournamentRatio ?? 1))),
  );
  // El piso es sobre minutos jugados totales: el arco cuenta como jugar (RF-21, RF-38).
  const gkCredit = (id: string) =>
    rotates ? 0 : (playedGk.get(id) ?? 0) + (futureGk.get(id) ?? 0);
  const floors = ids.map((id, i) =>
    Math.min(caps[i], Math.max(0, config.guaranteedMinutes - gkCredit(id))),
  );
  const targets = allocateWithFloors(weights, caps, floors, total);
  const target = new Map(ids.map((id, i) => [id, targets[i]]));
  const floor = new Map(ids.map((id, i) => [id, floors[i]]));

  const initialOnField = new Map<string, { position: FieldPosition; sinceMin: number }>();
  for (const f of input.onFieldNow ?? []) {
    if (byId.has(f.playerId)) initialOnField.set(f.playerId, { position: f.position, sinceMin: f.sinceMin });
  }

  const locksByWindow = new Map<number, Map<string, "field" | "bench">>();
  for (const l of input.locks ?? []) {
    if (!locksByWindow.has(l.windowIndex)) locksByWindow.set(l.windowIndex, new Map());
    locksByWindow.get(l.windowIndex)!.set(l.playerId, l.state);
  }

  const duration = matchDuration(config);
  const pool = ids.filter((id) => (playedField.get(id) ?? 0) + futureFieldCap.get(id)! > EPS).length;

  return { input, config, players, nowMin, b, fieldSlots, rotates, slots, allWindows, windows, gkOf, len, byId, ids, available, fieldEligible, playedField, playedGk, futureGk, basePlayed, futureFieldCap, suffixEligible, target, floor, initialOnField, locksByWindow, duration, pool };
}

export type RotationContext = ReturnType<typeof prepare>;

/**
 * Plan final a partir de quién está en cancha en cada ventana: posiciones (asignación óptima a la
 * formación, manteniendo la de cada uno cuando se puede), cambios, minutos y avisos.
 */
export function buildPlan(ctx: RotationContext, lineups: string[][], issues: RotationIssue[]): RotationPlan {
  const { windows, byId, ids, slots, len, gkOf, rotates, playedField, playedGk, futureGk, basePlayed, target, floor, players, duration } = ctx;
  const gotField = new Map(ids.map((id) => [id, playedField.get(id) ?? 0]));
  const got = new Map(ids.map((id) => [id, basePlayed(id)]));
  const planWindows: PlanWindow[] = [];
  let prevOn = ctx.initialOnField;
  windows.forEach((w, k) => {
    const previousPos = new Map([...prevOn].map(([id, v]) => [id, v.position]));
    const { assignment } = assignPositions(lineups[k].map((id) => byId.get(id)!), slots, previousPos);
    const field = lineups[k]
      .map((id) => ({ playerId: id, position: assignment.get(id)! }))
      .sort((a, b) => (a.playerId < b.playerId ? -1 : 1));
    const gk = gkOf.get(w.index) ?? null;
    planWindows.push({
      index: w.index,
      startMin: w.startMin,
      endMin: w.endMin,
      periodIndex: w.periodIndex,
      goalkeeperId: gk,
      field,
      subs: prevOn.size === 0 ? [] : pairSubs(prevOn, field),
    });
    if (rotates && gk && got.has(gk)) got.set(gk, got.get(gk)! + len(w));
    const next = new Map<string, { position: FieldPosition; sinceMin: number }>();
    for (const f of field) {
      gotField.set(f.playerId, gotField.get(f.playerId)! + len(w));
      got.set(f.playerId, got.get(f.playerId)! + len(w));
      next.set(f.playerId, { position: f.position, sinceMin: prevOn.get(f.playerId)?.sinceMin ?? w.startMin });
    }
    prevOn = next;
  });

  const all = [...issues];
  lineups.forEach((l, k) => {
    if (l.length < ctx.fieldSlots && !all.some((i) => i.type === "NOT_ENOUGH_PLAYERS" && i.windowIndex === windows[k].index)) {
      all.push({ type: "NOT_ENOUGH_PLAYERS", windowIndex: windows[k].index });
    }
  });
  for (const id of ids) {
    if (got.get(id)! < floor.get(id)! - EPS) all.push({ type: "FLOOR_UNREACHABLE", playerId: id });
  }

  // Spread entre jugadores "completos": disponibles todo el partido y sin minutos de arco.
  const full = players.filter(
    (p) =>
      p.availableFromMin <= EPS &&
      p.availableUntilMin >= duration - EPS &&
      !(playedGk.get(p.id) ?? 0) &&
      !futureGk.has(p.id),
  );
  const fullMinutes = full.map((p) => gotField.get(p.id)!);
  const maxSpread = fullMinutes.length ? Math.max(...fullMinutes) - Math.min(...fullMinutes) : 0;

  const record = (f: (id: string) => number) => Object.fromEntries(ids.map((id) => [id, f(id)]));
  return {
    windows: planWindows,
    targetMinutes: record((id) => target.get(id)!),
    expectedMinutes: record((id) => got.get(id)!),
    expectedFieldMinutes: record((id) => gotField.get(id)!),
    expectedGoalkeeperMinutes: record((id) => (playedGk.get(id) ?? 0) + (futureGk.get(id) ?? 0)),
    maxSpread,
    issues: all,
  };
}

/** Empareja salidas con entradas, priorizando la misma posición. */
export function pairSubs(
  before: Map<string, { position: FieldPosition }>,
  after: { playerId: string; position: FieldPosition }[],
): Substitution[] {
  const afterIds = new Set(after.map((f) => f.playerId));
  const outs = [...before]
    .filter(([id]) => !afterIds.has(id))
    .map(([id, v]) => ({ id, position: v.position }))
    .sort((a, b) => (a.id < b.id ? -1 : 1));
  const ins = after.filter((f) => !before.has(f.playerId));
  const subs: Substitution[] = [];
  for (const i of ins) {
    let k = outs.findIndex((o) => o.position === i.position);
    if (k < 0) k = 0;
    const out = outs.splice(k, 1)[0];
    // Si el campo estaba incompleto (lesión sin reemplazo) la entrada no tiene salida asociada.
    subs.push({ outId: out?.id ?? null, inId: i.playerId, position: i.position });
  }
  return subs;
}
