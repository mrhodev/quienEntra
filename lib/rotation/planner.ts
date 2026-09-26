import { allocateWithFloors, EPS } from "./allocate";
import { assignPositions, COST_OFF_POSITION, formationSlots, positionCost } from "./positions";
import { refineLineups } from "./refine";
import type {
  FieldPosition,
  PlanWindow,
  RotationInput,
  RotationIssue,
  RotationPlan,
  RotationPlayer,
  Substitution,
} from "./types";
import { buildWindows, matchDuration, windowsFrom, type TimeWindow } from "./windows";

/** Prioridades por encima de los minutos pendientes. */
const CLASS_FLOOR = 1;
const CLASS_LOCK = 2;

/**
 * Genera el plan de rotación (spec §6). Función pura y determinista.
 * Antes del partido usar nowMin = 0; en vivo pasar nowMin, playedSoFar y onFieldNow reales.
 */
export function planRotation(input: RotationInput): RotationPlan {
  const { config, players } = input;
  const nowMin = input.nowMin ?? 0;
  const b = config.windowMinutes;
  const fieldSlots = config.playersOnField - 1;
  const rotates = config.goalkeeperRotates;
  // Jugar fuera de posición (costo 3) pesa menos de media ventana: la posición desempata,
  // pero nunca le quita una ventana entera a quien tiene más minutos pendientes.
  const positionWeight = 0.15 * b;

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

  // --- Estado del greedy ---
  const got = new Map(ids.map((id) => [id, basePlayed(id)]));
  const gotField = new Map(ids.map((id) => [id, playedField.get(id) ?? 0]));
  let onField = new Map<string, { position: FieldPosition; sinceMin: number }>();
  for (const f of input.onFieldNow ?? []) {
    if (byId.has(f.playerId)) onField.set(f.playerId, { position: f.position, sinceMin: f.sinceMin });
  }

  const initialOnField = new Map(onField);

  const locksByWindow = new Map<number, Map<string, "field" | "bench">>();
  for (const l of input.locks ?? []) {
    if (!locksByWindow.has(l.windowIndex)) locksByWindow.set(l.windowIndex, new Map());
    locksByWindow.get(l.windowIndex)!.set(l.playerId, l.state);
  }

  // Ritmo de entradas (§6.3): el plantel entero rota una vez a lo largo del partido,
  // así que entran en promedio `pool / D` jugadores por minuto, repartidos entre las ventanas.
  // Las entradas que no se pudieron hacer (por el stint mínimo) se arrastran, con un tope por ventana.
  const duration = matchDuration(config);
  const pool = ids.filter((id) => (playedField.get(id) ?? 0) + futureFieldCap.get(id)! > EPS).length;
  const pacedAt = (t: number) => Math.floor((pool * t) / duration + 0.5);
  // En vivo, justo al inicio de una ventana, sus entradas todavía están pendientes salvo las que
  // ya se hicieron en este minuto (quienes están en cancha desde `nowMin`).
  let pacedDone = 0;
  if (windows.length && onField.size > 0) {
    const w0 = windows[0];
    const atBoundary = w0.startMin === allWindows[w0.index].startMin && w0.index > 0;
    const doneNow = [...onField.values()].filter((v) => v.sinceMin >= w0.startMin - EPS).length;
    pacedDone = atBoundary ? pacedAt(allWindows[w0.index - 1].startMin) + doneNow : pacedAt(w0.startMin);
  }
  const pacedCap = (w: TimeWindow) => Math.ceil((pool * len(w)) / duration - EPS);

  const issues: RotationIssue[] = [];
  const planWindows: PlanWindow[] = [];

  windows.forEach((w, k) => {
    const wLen = len(w);
    const gk = gkOf.get(w.index) ?? null;
    if (rotates && gk && got.has(gk)) got.set(gk, got.get(gk)! + wLen);

    const locks = locksByWindow.get(w.index) ?? new Map<string, "field" | "bench">();
    const eligible = players.filter((p) => fieldEligible(p, w) && locks.get(p.id) !== "bench");

    const deficit = (id: string) => floor.get(id)! - got.get(id)!;
    const unmet = eligible
      .filter((p) => locks.get(p.id) !== "field" && deficit(p.id) > EPS)
      .sort(
        (a, b) =>
          suffixEligible.get(a.id)![k] - suffixEligible.get(b.id)![k] ||
          deficit(b.id) - deficit(a.id) ||
          (a.id < b.id ? -1 : 1),
      );
    // Mínimo garantizado (RF-38): si las entradas posibles en las ventanas que quedan
    // no alcanzan para todos los que no llegaron al mínimo, los que sobran entran ya.
    const laterCapacity =
      (windows.length - k - 1) * Math.min(fieldSlots, config.maxSubsPerWindow ?? fieldSlots);
    const urgent = new Set(unmet.slice(0, Math.max(0, unmet.length - laterCapacity)).map((p) => p.id));

    const cls = new Map<string, number>();
    for (const p of eligible) {
      let c = 0;
      if (locks.get(p.id) === "field") c = CLASS_LOCK;
      else if (
        urgent.has(p.id) ||
        (deficit(p.id) > EPS && suffixEligible.get(p.id)![k] < deficit(p.id) - EPS)
      ) {
        c = CLASS_FLOOR;
      }
      cls.set(p.id, c);
    }
    const need = (p: RotationPlayer) => target.get(p.id)! - got.get(p.id)!;
    const idOrder = (a: RotationPlayer, b: RotationPlayer) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
    const byPriority = (a: RotationPlayer, b: RotationPlayer) =>
      cls.get(b.id)! - cls.get(a.id)! || need(b) - need(a) || idOrder(a, b);

    for (const p of eligible.filter((p) => cls.get(p.id) === CLASS_LOCK).sort(byPriority).slice(fieldSlots)) {
      issues.push({ type: "LOCK_CONFLICT", playerId: p.id, windowIndex: w.index });
    }
    if (eligible.length < fieldSlots) issues.push({ type: "NOT_ENOUGH_PLAYERS", windowIndex: w.index });

    const canLeave = (p: RotationPlayer) =>
      cls.get(p.id) === 0 && w.startMin - onField.get(p.id)!.sinceMin >= config.minStintMinutes - EPS;
    // Rotación escalonada (§6.3): quien está en cancha sigue salvo que le toque salir.
    // Sale primero quien ya puede salir, con menos minutos pendientes y más tiempo en cancha.
    const kept = eligible
      .filter((p) => onField.has(p.id))
      .sort(
        (a, b) =>
          Number(canLeave(b)) - Number(canLeave(a)) ||
          cls.get(a.id)! - cls.get(b.id)! ||
          need(a) - need(b) ||
          onField.get(a.id)!.sinceMin - onField.get(b.id)!.sinceMin ||
          idOrder(a, b),
      );
    // Margen: minutos disponibles desde esta ventana menos los pendientes. Entra primero quien
    // tiene menos margen; así quien ya jugó vuelve lo más tarde posible y juega de corrido.
    const slack = (p: RotationPlayer) => suffixEligible.get(p.id)![k] + wLen - need(p);
    const bench = eligible
      .filter((p) => !onField.has(p.id))
      .sort(
        (a, b) =>
          cls.get(b.id)! - cls.get(a.id)! || slack(a) - slack(b) || need(b) - need(a) || idOrder(a, b),
      );
    const incoming: RotationPlayer[] = [];
    const leaving: RotationPlayer[] = [];
    const enter = () => {
      incoming.push(bench.shift()!);
      if (kept.length + incoming.length > fieldSlots) leaving.push(kept.shift()!);
    };
    const gap = () => (bench.length && kept.length ? need(bench[0]) - need(kept[0]) : -Infinity);

    // 1. Lugares vacíos (inicio, lesión) y entradas obligatorias (bloqueos, mínimo garantizado).
    while (
      bench.length &&
      (kept.length + incoming.length < fieldSlots ||
        (kept.length > 0 && cls.get(bench[0].id)! > cls.get(kept[0].id)!))
    ) {
      enter();
    }
    // 2. Entradas al ritmo parejo del partido, solo si mejoran la equidad.
    const maxSubs = config.maxSubsPerWindow ?? Infinity;
    const owed = Math.max(0, Math.min(pacedAt(w.startMin) - pacedDone, pacedCap(w)));
    const paced = Math.min(owed, maxSubs);
    while (incoming.length < paced && kept.length && canLeave(kept[0]) && gap() > EPS) enter();
    // 3. Una entrada extra si alguien del banco quedaría más de una ventana por debajo de su cuota
    //    esperando a la próxima, o si alguien en cancha ya la superó por más de media ventana.
    const extraCap = Math.min(owed + 1, pacedCap(w) + 1, maxSubs);
    const drifting = () =>
      need(bench[0]) - suffixEligible.get(bench[0].id)![k] > b + EPS ||
      need(kept[0]) < -b / 2;
    while (incoming.length < extraCap && kept.length && canLeave(kept[0]) && gap() > EPS && drifting()) enter();

    if (onField.size > 0) pacedDone += incoming.length;
    let selected = [...kept, ...incoming];

    // Posiciones: asignación óptima + canje por alguien en su posición sin sumar cambios (no excluyente).
    const previousPos = new Map([...onField].map(([id, v]) => [id, v.position]));
    let { assignment } = assignPositions(selected, slots, previousPos);
    if (slots) {
      for (const p of [...selected]) {
        const pos = assignment.get(p.id)!;
        const currentCost = positionCost(p, pos);
        if (currentCost < COST_OFF_POSITION || cls.get(p.id)! > 0) continue;
        // Quien entra se canjea con otro del banco; quien sigue, con otro que iba a salir.
        const staying = onField.has(p.id);
        if (staying && !canLeave(p)) continue;
        const candidates = staying ? leaving : bench;
        let best: { cand: RotationPlayer; delta: number } | null = null;
        for (const cand of candidates) {
          const delta = need(cand) - need(p) + positionWeight * (currentCost - positionCost(cand, pos));
          if (delta > EPS && (!best || delta > best.delta)) best = { cand, delta };
        }
        if (best) {
          selected = selected.map((s) => (s === p ? best.cand : s));
          candidates.splice(candidates.indexOf(best.cand), 1, p);
        }
      }
      ({ assignment } = assignPositions(selected, slots, previousPos));
    }
    const field = selected
      .map((p) => ({ playerId: p.id, position: assignment.get(p.id)! }))
      .sort((a, b) => (a.playerId < b.playerId ? -1 : 1));

    const subs = onField.size === 0 ? [] : pairSubs(onField, field);
    planWindows.push({
      index: w.index,
      startMin: w.startMin,
      endMin: w.endMin,
      periodIndex: w.periodIndex,
      goalkeeperId: gk,
      field,
      subs,
    });

    const next = new Map<string, { position: FieldPosition; sinceMin: number }>();
    for (const f of field) {
      got.set(f.playerId, got.get(f.playerId)! + wLen);
      gotField.set(f.playerId, gotField.get(f.playerId)! + wLen);
      const prev = onField.get(f.playerId);
      next.set(f.playerId, { position: f.position, sinceMin: prev ? prev.sinceMin : w.startMin });
    }
    onField = next;
  });

  // Refinamiento (§6.3, paso 5): canjes puntuales que mejoran equidad, continuidad y reparto de cambios.
  const lineups = planWindows.map((pw) => pw.field.map((f) => f.playerId));
  refineLineups({
    lens: windows.map(len),
    periodEnd: windows.map((w, k) => k + 1 === windows.length || windows[k + 1].periodIndex !== w.periodIndex),
    frozen: windows.map((w) => w.startMin !== allWindows[w.index].startMin),
    lineups,
    minutes: got,
    target,
    floor,
    initial: new Map([...initialOnField].map(([id, v]) => [id, (windows[0]?.startMin ?? 0) - v.sinceMin])),
    candidates: [...ids].sort(),
    canPlay: (id, k) =>
      fieldEligible(byId.get(id)!, windows[k]) && locksByWindow.get(windows[k].index)?.get(id) !== "bench",
    lockedOn: (id, k) => locksByWindow.get(windows[k].index)?.get(id) === "field",
    lineupCost: (lineup) => (slots ? assignPositions(lineup.map((id) => byId.get(id)!), slots).cost : 0),
    minStint: config.minStintMinutes,
    b,
    entryCap: config.maxSubsPerWindow ?? Math.ceil((pool * b) / duration - EPS) + 1,
  });

  // Posiciones, cambios y minutos de campo del plan final.
  for (const id of ids) gotField.set(id, playedField.get(id) ?? 0);
  let prevOn = initialOnField;
  planWindows.forEach((pw, k) => {
    const previousPos = new Map([...prevOn].map(([id, v]) => [id, v.position]));
    const { assignment } = assignPositions(lineups[k].map((id) => byId.get(id)!), slots, previousPos);
    pw.field = lineups[k]
      .map((id) => ({ playerId: id, position: assignment.get(id)! }))
      .sort((a, b) => (a.playerId < b.playerId ? -1 : 1));
    pw.subs = prevOn.size === 0 ? [] : pairSubs(prevOn, pw.field);
    const next = new Map<string, { position: FieldPosition; sinceMin: number }>();
    for (const f of pw.field) {
      gotField.set(f.playerId, gotField.get(f.playerId)! + len(windows[k]));
      next.set(f.playerId, { position: f.position, sinceMin: prevOn.get(f.playerId)?.sinceMin ?? pw.startMin });
    }
    prevOn = next;
  });

  for (const id of ids) {
    if (got.get(id)! < floor.get(id)! - EPS) issues.push({ type: "FLOOR_UNREACHABLE", playerId: id });
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
    expectedGoalkeeperMinutes: record(
      (id) => (playedGk.get(id) ?? 0) + (futureGk.get(id) ?? 0),
    ),
    maxSpread,
    issues,
  };
}

/** Empareja salidas con entradas, priorizando la misma posición. */
function pairSubs(
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
