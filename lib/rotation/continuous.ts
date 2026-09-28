import { EPS } from "./allocate";
import { buildPlan, type RotationContext } from "./context";
import { positionCost } from "./positions";
import type { FieldPosition, RotationIssue, RotationPlan, RotationPlayer } from "./types";

/**
 * Planificador de un solo tramo por jugador (RF-40, spec §6.3).
 *
 * Con un tramo por jugador, cada lugar de la cancha es una CADENA de jugadores que se pasan el
 * puesto (A → B → C) y cada cadena dura exactamente lo que queda del partido. Se planifica en
 * dos fases:
 *  1. Armar las cadenas: quién va en cada una, para que los minutos queden lo más parejos
 *     posible y cada cadena conserve su posición (búsqueda local: mover o canjear jugadores).
 *  2. Ubicar los cambios en el tiempo, globalmente: cada cambio en la ventana más cercana a su
 *     minuto ideal que tenga lugar, sin que cambie más de la mitad de la cancha a la vez; y un
 *     ajuste fino corriendo cambios de a una o dos ventanas.
 *
 * En vivo, cada jugador en cancha encabeza su cadena. Quien ya jugó y salió no vuelve a entrar,
 * salvo que no haya llegado al mínimo garantizado (RF-38, que está por encima de todo).
 */

const W_POSITION = 0.15; // por unidad de costo de posición (0 principal, 1 secundaria, 3 fuera)
const W_STAGGER = 0.02; // por (cambios en una misma ventana)²
const P_FLOOR = 100; // por ventana (b) de mínimo garantizado sin cubrir
const P_LOCK = 50; // por bloqueo "en cancha" incumplido
const P_EMPTY = 30; // por ventana con un lugar vacío
const P_MAXCHANGES = 50; // por cada cambio por encima del tope de la ventana
const MAX_PASSES = 30;

interface Cand {
  p: RotationPlayer;
  id: string;
  /** Rango de ventanas en que puede jugar de campo (el tramo continuo más largo). */
  lo: number;
  hi: number;
  target: number;
  got: number;
  floor: number;
  occupant: boolean;
  sinceMin: number;
}

interface Chain {
  slot: FieldPosition | null;
  members: Cand[];
}

export function planContinuous(ctx: RotationContext): RotationPlan {
  const { windows, config, players, len, fieldEligible, locksByWindow, target, floor, basePlayed, futureGk, rotates, playedField, initialOnField } = ctx;
  const W = windows.length;
  if (W === 0) return buildPlan(ctx, [], []);
  const b = config.windowMinutes;
  const S = ctx.fieldSlots;
  const lens = windows.map(len);
  const offset: number[] = [0];
  for (let k = 0; k < W; k++) offset.push(offset[k] + lens[k]);
  const total = offset[W];
  const now = windows[0].startMin;
  const live = initialOnField.size > 0;
  const minStint = config.minStintMinutes;

  const lockAt = (id: string, k: number) => locksByWindow.get(windows[k].index)?.get(id);
  const canPlay = (p: RotationPlayer, k: number) => fieldEligible(p, windows[k]) && lockAt(p.id, k) !== "bench";
  const gkLater = (id: string) => (rotates ? (futureGk.get(id) ?? 0) : 0);

  // --- Candidatos ---
  const cands: Cand[] = [];
  // Sumas prefijas de minutos y de ventanas en que cada uno puede jugar.
  const playable = new Map<string, { minutes: number[]; windows: number[] }>();
  for (const p of players) {
    let best: [number, number] | null = null;
    let run: number | null = null;
    const minutes = [0];
    const count = [0];
    for (let k = 0; k <= W; k++) {
      const ok = k < W && canPlay(p, k);
      if (k < W) {
        minutes.push(minutes[k] + (ok ? lens[k] : 0));
        count.push(count[k] + (ok ? 1 : 0));
      }
      if (ok && run === null) run = k;
      if (!ok && run !== null) {
        if (!best || k - 1 - run > best[1] - best[0]) best = [run, k - 1];
        run = null;
      }
    }
    if (!best) continue;
    const occ = initialOnField.get(p.id);
    const occupant = !!occ && best[0] === 0;
    const got = basePlayed(p.id) + gkLater(p.id);
    const fl = floor.get(p.id)!;
    // Quien ya jugó y salió no vuelve, salvo para llegar al mínimo garantizado (RF-38).
    const exited = !occ && (playedField.get(p.id) ?? 0) > EPS;
    if (exited && got >= fl - EPS) continue;
    playable.set(p.id, { minutes, windows: count });
    cands.push({ p, id: p.id, lo: best[0], hi: best[1], target: target.get(p.id)!, got, floor: fl, occupant, sinceMin: occ?.sinceMin ?? now });
  }
  const minutesIn = (c: Cand, s: number, e: number) => playable.get(c.id)!.minutes[e] - playable.get(c.id)!.minutes[s];
  const windowsIn = (c: Cand, s: number, e: number) => playable.get(c.id)!.windows[e] - playable.get(c.id)!.windows[s];

  // --- Cadenas iniciales ---
  const formation = ctx.slots ? [...ctx.slots] : null;
  const chains: Chain[] = [];
  for (const c of cands.filter((c) => c.occupant).sort((a, z) => (a.id < z.id ? -1 : 1))) {
    if (chains.length >= S) break;
    const pos = initialOnField.get(c.id)!.position;
    if (formation) {
      const i = formation.indexOf(pos);
      if (i >= 0) formation.splice(i, 1);
    }
    chains.push({ slot: pos, members: [c] });
  }
  while (chains.length < S) chains.push({ slot: formation ? (formation.shift() ?? null) : null, members: [] });

  const byArrival = (a: Cand, z: Cand) => a.lo - z.lo || z.target - a.target || (a.id < z.id ? -1 : 1);
  const fresh = cands.filter((c) => !chains.some((ch) => ch.members.includes(c))).sort(byArrival);
  const posCost = (c: Cand, slot: FieldPosition | null) => (slot ? positionCost(c.p, slot) : 0);

  // Titulares (antes del partido) o reemplazos de lugares vacíos: por posición y cuota.
  for (const ch of chains) {
    if (ch.members.length) continue;
    const pick = fresh
      .filter((c) => c.lo === 0)
      .sort((a, z) => posCost(a, ch.slot) - posCost(z, ch.slot) || z.target - a.target || (a.id < z.id ? -1 : 1))[0];
    if (pick) {
      ch.members.push(pick);
      fresh.splice(fresh.indexOf(pick), 1);
    }
  }
  // El resto, a la cadena con más lugar relativo a lo que sus jugadores deberían jugar.
  const load = (ch: Chain, extra: Cand) => {
    const cap = total + ch.members.reduce((a, m) => a + m.got, 0) + extra.got;
    return (ch.members.reduce((a, m) => a + m.target, 0) + extra.target) / Math.max(EPS, cap);
  };
  for (const c of fresh) {
    let best: Chain | null = null;
    let bestScore = Infinity;
    for (const ch of chains) {
      const score = load(ch, c) + 0.1 * posCost(c, ch.slot);
      if (score < bestScore - EPS) {
        best = ch;
        bestScore = score;
      }
    }
    best?.members.push(c);
  }

  // Bloqueos "en cancha" de la previa (RF-13): quien está fijado en una ventana tiene que jugarla.
  const fieldLocks = new Map<string, number[]>();
  windows.forEach((w, k) => {
    for (const [id, state] of locksByWindow.get(w.index) ?? []) {
      if (state === "field") fieldLocks.set(id, [...(fieldLocks.get(id) ?? []), k]);
    }
  });

  // --- Reparto ideal de una cadena: minuto (continuo) en que entra cada jugador ---
  const idealTimes = (m: Cand[]): number[] => {
    const minAdd = m.map((c, j) => {
      const floorDef = Math.max(0, c.floor - c.got);
      if (j === 0 && c.occupant) return Math.max(floorDef, minStint - (now - c.sinceMin), 0);
      return Math.max(floorDef, minStint);
    });
    // Reparto parejo: final_i = λ·T_i (sin bajar de su mínimo), sumando lo que queda de partido.
    const sumAdd = (lambda: number) => m.reduce((a, c, j) => a + Math.max(minAdd[j], lambda * c.target - c.got), 0);
    let adds = minAdd;
    if (minAdd.reduce((a, x) => a + x, 0) < total) {
      let lo = 0;
      let hi = 1;
      while (sumAdd(hi) < total && hi < 1e6) hi *= 2;
      for (let it = 0; it < 40; it++) {
        const mid = (lo + hi) / 2;
        if (sumAdd(mid) < total) lo = mid;
        else hi = mid;
      }
      adds = m.map((c, j) => Math.max(minAdd[j], hi * c.target - c.got));
    }
    const times = [0];
    for (let j = 1; j < m.length; j++) times.push(times[j - 1] + adds[j - 1]);
    return times;
  };

  // Ventanas posibles para la entrada del jugador j de la cadena: orden, disponibilidad y stint mínimo.
  const bounds = (m: Cand[], starts: number[], j: number): [number, number] => {
    const prev = starts[j - 1];
    const before = j === 1 && m[0].occupant ? now - m[0].sinceMin : 0;
    let lo = Math.max(j === 1 && m[0].occupant ? 0 : prev + 1, m[j].lo);
    while (lo < W && offset[lo] - offset[prev] + before < minStint - EPS) lo++;
    let hi = Math.min(W - (m.length - j), m[j - 1].hi + 1);
    // El siguiente también necesita su stint mínimo (si ya está ubicado).
    if (j + 1 < m.length && starts[j + 1] !== undefined) {
      while (hi > lo && offset[starts[j + 1]] - offset[hi] < minStint - EPS) hi--;
    }
    lo = Math.min(lo, W);
    return [lo, Math.max(lo, hi)];
  };

  const nearestStarts = (m: Cand[], times: number[]) => {
    const starts = [0];
    for (let j = 1; j < m.length; j++) {
      const [lo, hi] = bounds(m, starts, j);
      let best = lo;
      for (let k = lo; k <= hi; k++) if (Math.abs(offset[k] - times[j]) < Math.abs(offset[best] - times[j]) - EPS) best = k;
      starts.push(best);
    }
    return starts;
  };

  /** Costo de una cadena con los inicios dados: equidad, posición, mínimos, bloqueos y huecos. */
  const chainCost = (ch: Chain, starts: number[]) => {
    const m = ch.members;
    if (!m.length) return P_EMPTY * W;
    let cost = 0;
    let covered = 0;
    m.forEach((c, j) => {
      const s = starts[j];
      const e = j + 1 < m.length ? starts[j + 1] : W;
      const final = c.got + minutesIn(c, s, e);
      covered += windowsIn(c, s, e);
      cost += ((final - c.target) / b) ** 2 + W_POSITION * posCost(c, ch.slot);
      if (final < c.floor - EPS) cost += (P_FLOOR * (c.floor - final)) / b;
      for (const k of fieldLocks.get(c.id) ?? []) if (k < s || k >= e) cost += P_LOCK;
    });
    return cost + P_EMPTY * (W - covered);
  };

  // --- Fase 1: armar las cadenas ---
  const memo = new Map<string, { cost: number; times: number[] }>();
  const phase1 = (slot: FieldPosition | null, members: Cand[]) => {
    const key = `${slot}|${members.map((c) => c.id).join(",")}`;
    let hit = memo.get(key);
    if (!hit) {
      const times = members.length ? idealTimes(members) : [];
      hit = { cost: chainCost({ slot, members }, members.length ? nearestStarts(members, times) : []), times };
      memo.set(key, hit);
    }
    return hit;
  };
  const costs = chains.map((ch) => phase1(ch.slot, ch.members).cost);
  const headOk = (m: Cand[]) => m.length === 0 || m[0].occupant || m[0].lo === 0 || live;
  const movable = (ch: Chain, i: number) => !(i === 0 && ch.members[i].occupant);
  const insertAt = (m: Cand[], x: Cand) => {
    let q = m.length;
    while (q > 0 && !m[q - 1].occupant && byArrival(x, m[q - 1]) < 0) q--;
    return [...m.slice(0, q), x, ...m.slice(q)];
  };
  const tryChains = (a: number, bIdx: number, nextA: Cand[], nextB: Cand[]) => {
    if (!headOk(nextA) || !headOk(nextB)) return false;
    const ca = phase1(chains[a].slot, nextA).cost;
    const cb = phase1(chains[bIdx].slot, nextB).cost;
    if (ca + cb < costs[a] + costs[bIdx] - 1e-9) {
      chains[a].members = nextA;
      chains[bIdx].members = nextB;
      costs[a] = ca;
      costs[bIdx] = cb;
      return true;
    }
    return false;
  };
  for (let pass = 0; pass < MAX_PASSES; pass++) {
    let improved = false;
    for (let a = 0; a < chains.length; a++) {
      scan: for (let i = 0; i < chains[a].members.length; i++) {
        if (!movable(chains[a], i)) continue;
        const x = chains[a].members[i];
        const from = chains[a].members.filter((_, j) => j !== i);
        for (let bIdx = 0; bIdx < chains.length; bIdx++) {
          if (bIdx === a) continue;
          const base = chains[bIdx].members;
          // Mover x a otra cadena: en su lugar por hora de llegada, o al final.
          for (const into of [insertAt(base, x), [...base, x]]) {
            if (tryChains(a, bIdx, from, into)) {
              improved = true;
              i = -1;
              continue scan;
            }
          }
          // Canjear x con alguien de otra cadena.
          for (let j = 0; j < base.length; j++) {
            if (!movable(chains[bIdx], j)) continue;
            const y = base[j];
            const nextA = chains[a].members.map((c) => (c === x ? y : c));
            const nextB = base.map((c) => (c === y ? x : c));
            if (tryChains(a, bIdx, nextA, nextB)) {
              improved = true;
              i = -1;
              continue scan;
            }
          }
        }
      }
    }
    if (!improved) break;
  }

  // --- Fase 2: ubicar los cambios en el tiempo ---
  // Nunca cambia el equipo entero de golpe (RF-40): como máximo la mitad de la cancha por ventana
  // (o el límite del torneo), salvo que no alcancen las ventanas para que entren todos (RF-38).
  const isChange = (k: number) => k > 0 || live;
  const switchCount = chains.reduce((a, ch) => a + Math.max(0, ch.members.length - 1), 0);
  const changeWindows = W - (live ? 0 : 1);
  const cap = Math.max(
    Math.min(config.maxSubsPerWindow ?? S, Math.max(1, Math.ceil(S / 2))),
    Math.ceil(switchCount / Math.max(1, changeWindows)),
  );

  const starts: number[][] = chains.map(() => [0]);
  const count = new Array<number>(W).fill(0);
  // Los cambios se ubican en orden de su minuto ideal (dentro de una cadena, en orden).
  const queue = chains
    .flatMap((ch, c) => {
      const times = phase1(ch.slot, ch.members).times;
      return ch.members.slice(1).map((_, i) => ({ c, j: i + 1, t: times[i + 1] }));
    })
    .sort((x, y) => x.t - y.t || x.c - y.c || x.j - y.j);
  while (queue.length) {
    const idx = queue.findIndex((s) => starts[s.c].length === s.j);
    const { c, j, t } = queue.splice(idx, 1)[0];
    const [lo, hi] = bounds(chains[c].members, starts[c], j);
    let best = lo;
    let bestScore = Infinity;
    for (let k = lo; k <= hi; k++) {
      const score = (isChange(k) && count[k] >= cap ? 1e6 : 0) + Math.abs(offset[k] - t);
      if (score < bestScore - EPS) {
        best = k;
        bestScore = score;
      }
    }
    starts[c].push(best);
    if (isChange(best)) count[best]++;
  }

  // Reparación: si una ventana quedó por encima del tope, llevar alguno de sus cambios a una
  // ventana con lugar; si no hay lugar directo, correr dos cambios encadenados.
  type Switch = { c: number; j: number };
  const switchesAt = (k: number): Switch[] =>
    chains.flatMap((ch, c) => ch.members.map((_, j) => ({ c, j })).filter((x) => x.j > 0 && starts[x.c][x.j] === k));
  const moveTo = (sw: Switch, k: number) => {
    const from = starts[sw.c][sw.j];
    if (isChange(from)) count[from]--;
    starts[sw.c][sw.j] = k;
    if (isChange(k)) count[k]++;
  };
  const targetsFor = (sw: Switch) => {
    const [lo, hi] = bounds(chains[sw.c].members, starts[sw.c], sw.j);
    const cur = starts[sw.c][sw.j];
    return Array.from({ length: hi - lo + 1 }, (_, i) => lo + i)
      .filter((k) => k !== cur)
      .sort((x, y) => Math.abs(x - cur) - Math.abs(y - cur) || x - y);
  };
  for (let guard = 0; guard < 4 * W; guard++) {
    const k = count.findIndex((n, i) => isChange(i) && n > cap);
    if (k < 0) break;
    let fixed = false;
    for (const sw of switchesAt(k)) {
      const free = targetsFor(sw).find((t) => !isChange(t) || count[t] < cap);
      if (free !== undefined) {
        moveTo(sw, free);
        fixed = true;
        break;
      }
    }
    for (const sw of fixed ? [] : switchesAt(k)) {
      for (const t of targetsFor(sw)) {
        moveTo(sw, t);
        const second = switchesAt(t).filter((o) => o.c !== sw.c || o.j !== sw.j);
        for (const o of second) {
          const free = targetsFor(o).find((u) => u !== t && (!isChange(u) || count[u] < cap));
          if (free !== undefined) {
            moveTo(o, free);
            fixed = true;
            break;
          }
        }
        if (fixed) break;
        moveTo(sw, k);
      }
      if (fixed) break;
    }
    if (!fixed) break;
  }

  const staggerAt = (n: number) => W_STAGGER * n * n + (n > cap ? P_MAXCHANGES * (n - cap) : 0);
  const chainCosts = chains.map((ch, c) => chainCost(ch, starts[c]));
  // Ajuste fino: correr cada cambio hasta dos ventanas si mejora equidad + escalonado.
  for (let pass = 0; pass < MAX_PASSES; pass++) {
    let improved = false;
    chains.forEach((ch, c) => {
      for (let j = 1; j < ch.members.length; j++) {
        const cur = starts[c][j];
        const [lo, hi] = bounds(ch.members, starts[c], j);
        for (const k of [cur - 1, cur + 1, cur - 2, cur + 2]) {
          if (k < lo || k > hi) continue;
          const trial = starts[c].slice();
          trial[j] = k;
          const newCost = chainCost(ch, trial);
          let delta = newCost - chainCosts[c];
          if (isChange(cur)) delta += staggerAt(count[cur] - 1) - staggerAt(count[cur]);
          if (isChange(k)) delta += staggerAt(count[k] + 1) - staggerAt(count[k]);
          if (delta < -1e-9) {
            if (isChange(cur)) count[cur]--;
            if (isChange(k)) count[k]++;
            starts[c] = trial;
            chainCosts[c] = newCost;
            improved = true;
            break;
          }
        }
      }
    });
    if (!improved) break;
  }

  // --- Plan: quién está en cancha en cada ventana ---
  const lineups: string[][] = windows.map(() => []);
  chains.forEach((ch, c) => {
    ch.members.forEach((m, j) => {
      const s = starts[c][j];
      const e = j + 1 < ch.members.length ? starts[c][j + 1] : W;
      for (let k = s; k < e; k++) if (canPlay(m.p, k)) lineups[k].push(m.id);
    });
  });
  const issues: RotationIssue[] = [];
  for (const [id, ks] of fieldLocks) {
    for (const k of ks) {
      if (!lineups[k].includes(id)) issues.push({ type: "LOCK_CONFLICT", playerId: id, windowIndex: windows[k].index });
    }
  }
  return buildPlan(ctx, lineups, issues);
}
