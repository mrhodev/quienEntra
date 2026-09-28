import { EPS } from "./allocate";
import { planContinuous } from "./continuous";
import { buildPlan, pairSubs, prepare } from "./context";
import { assignPositions, COST_OFF_POSITION, positionCost } from "./positions";
import { refineLineups } from "./refine";
import type { FieldPosition, PlanWindow, RotationInput, RotationIssue, RotationPlan, RotationPlayer } from "./types";
import type { TimeWindow } from "./windows";

/** Prioridades por encima de los minutos pendientes. */
const CLASS_FLOOR = 1;
const CLASS_LOCK = 2;

/**
 * Genera el plan de rotación (spec §6). Función pura y determinista.
 * Antes del partido usar nowMin = 0; en vivo pasar nowMin, playedSoFar y onFieldNow reales.
 * Por defecto cada jugador juega un solo tramo (RF-40); `continuous: false` usa el greedy
 * por ventanas, que prioriza minutos parejos.
 */
export function planRotation(input: RotationInput): RotationPlan {
  return input.config.continuous === false ? planGreedy(input) : planContinuous(prepare(input));
}

function planGreedy(input: RotationInput): RotationPlan {
  const ctx = prepare(input);
  const {
    config, players, b, fieldSlots, rotates, slots, allWindows, windows, gkOf, len, byId, ids,
    fieldEligible, playedField, basePlayed, suffixEligible, target, floor, initialOnField, locksByWindow,
    duration, pool,
  } = ctx;
  // Jugar fuera de posición (costo 3) pesa menos de media ventana: la posición desempata,
  // pero nunca le quita una ventana entera a quien tiene más minutos pendientes.
  const positionWeight = 0.15 * b;

  // --- Estado del greedy ---
  const got = new Map(ids.map((id) => [id, basePlayed(id)]));
  const gotField = new Map(ids.map((id) => [id, playedField.get(id) ?? 0]));
  let onField = new Map(initialOnField);

  // Ritmo de entradas (§6.3): el plantel entero rota una vez a lo largo del partido,
  // así que entran en promedio `pool / D` jugadores por minuto, repartidos entre las ventanas.
  // Las entradas que no se pudieron hacer (por el stint mínimo) se arrastran, con un tope por ventana.
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

  return buildPlan(ctx, lineups, issues);
}
