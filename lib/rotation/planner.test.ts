import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { allocate, allocateWithFloors } from "./allocate";
import { planRotation } from "./planner";
import { baseInput, F7, makePlayers, planStints, stintCounts } from "./test-utils";
import type { FieldPosition, RotationConfig, RotationInput } from "./types";
import { buildWindows } from "./windows";

const sum = (xs: number[]) => xs.reduce((a, x) => a + x, 0);

describe("allocate", () => {
  it("reparte parejo sin topes", () => {
    expect(allocate([1, 1, 1], [100, 100, 100], 30)).toEqual([10, 10, 10]);
  });

  it("redistribuye lo que un tope no deja usar", () => {
    const r = allocate([1, 1, 1], [4, 100, 100], 30);
    expect(r[0]).toBe(4);
    expect(r[1]).toBeCloseTo(13);
    expect(r[2]).toBeCloseTo(13);
  });

  it("respeta el piso", () => {
    const r = allocateWithFloors([10, 1, 1], [100, 100, 100], [0, 8, 8], 30);
    expect(r[1]).toBeCloseTo(8);
    expect(r[2]).toBeCloseTo(8);
    expect(sum(r)).toBeCloseTo(30);
  });
});

describe("buildWindows", () => {
  it("corta cada b minutos y al inicio de cada período", () => {
    const w = buildWindows({ ...F7, periods: [{ minutes: 12 }, { minutes: 12 }] });
    expect(w.map((x) => [x.startMin, x.endMin])).toEqual([
      [0, 5], [5, 10], [10, 12], [12, 17], [17, 22], [22, 24],
    ]);
    expect(w.filter((x) => x.periodStart).map((x) => x.startMin)).toEqual([0, 12]);
  });
});

describe("planRotation", () => {
  it("greedy: con ventanas de distinta duración (10-10-5) compensa para que casi todos jueguen lo mismo", () => {
    const config: RotationConfig = {
      ...F7,
      continuous: false,
      playersOnField: 9,
      windowMinutes: 10,
      minStintMinutes: 10,
      guaranteedMinutes: 10,
      formation: { DEF: 3, MED: 3, DEL: 2 },
    };
    const plan = planRotation(baseInput(20, config));
    const minutes = Object.entries(plan.expectedFieldMinutes).filter(([id]) => id !== "gk").map(([, m]) => m);
    // M = 8 · 50 = 400 entre 20 → 20' cada uno. Con las ventanas de 5' no se puede sin cambiar
    // 6 de 8 de golpe; con hasta 5 cambios por ventana, 16 de 20 quedan justo en 20'.
    expect(minutes.filter((m) => m === 20).length).toBeGreaterThanOrEqual(16);
    expect(plan.maxSpread).toBeLessThanOrEqual(10);
    for (const w of plan.windows.slice(1)) expect(w.subs.length).toBeLessThanOrEqual(5);
    for (const [, n] of stintCounts(plan)) expect(n).toBeLessThanOrEqual(2);
  });

  it("CA-01: F7 2×25, 13 presentes con arquero fijo → un solo tramo cada uno, entre 20' y 30'", () => {
    const plan = planRotation(baseInput(12));
    const field = Object.entries(plan.expectedFieldMinutes).filter(([id]) => id !== "gk");
    for (const [, m] of field) {
      expect(m).toBeGreaterThanOrEqual(20);
      expect(m).toBeLessThanOrEqual(30);
    }
    for (const [id, n] of stintCounts(plan)) if (id !== "gk") expect(n).toBe(1);
    // Nunca cambia el equipo entero: como máximo la mitad de la cancha (3 de 6) por ventana.
    for (const w of plan.windows.slice(1)) expect(w.subs.length).toBeLessThanOrEqual(3);
    expect(plan.issues).toEqual([]);
    for (const w of plan.windows) {
      expect(w.field).toHaveLength(6);
      const count = (pos: string) => w.field.filter((f) => f.position === pos).length;
      expect([count("DEF"), count("MED"), count("DEL")]).toEqual([2, 3, 1]);
    }
  });

  it("RF-40: con menos suplentes que titulares, alguien juega todo el partido (límite de un solo tramo)", () => {
    // F7 con 11 de campo: 6 arrancan, 6 terminan y nadie vuelve → al menos 2·6 − 11 = 1 juega los 50'.
    const plan = planRotation(baseInput(11));
    const minutes = Object.entries(plan.expectedFieldMinutes).filter(([id]) => id !== "gk").map(([, m]) => m);
    expect(minutes.filter((m) => m === 50)).toHaveLength(1);
    for (const [id, n] of stintCounts(plan)) if (id !== "gk") expect(n).toBe(1);
  });

  it("greedy: F7 2×25, 12 presentes con arquero fijo → entre 25 y 30 minutos", () => {
    const plan = planRotation(baseInput(11, { ...F7, continuous: false }));
    const field = Object.entries(plan.expectedFieldMinutes).filter(([id]) => id !== "gk");
    for (const [, m] of field) {
      expect(m).toBeGreaterThanOrEqual(25);
      expect(m).toBeLessThanOrEqual(30);
    }
    expect(plan.maxSpread).toBeLessThanOrEqual(5);
    expect(plan.issues).toEqual([]);
    for (const w of plan.windows) {
      expect(w.field).toHaveLength(6);
      expect(w.goalkeeperId).toBe("gk");
      const count = (pos: string) => w.field.filter((f) => f.position === pos).length;
      expect([count("DEF"), count("MED"), count("DEL")]).toEqual([2, 3, 1]);
    }
  });

  it("la primera ventana no tiene cambios y las demás emparejan salida/entrada", () => {
    const plan = planRotation(baseInput(11));
    expect(plan.windows[0].subs).toEqual([]);
    const withSubs = plan.windows.filter((w) => w.subs.length > 0);
    expect(withSubs.length).toBeGreaterThan(0);
    for (const w of withSubs) for (const s of w.subs) expect(s.outId).not.toBeNull();
  });

  it("respeta la posición cuando hay jugadores de esa posición en el banco", () => {
    const plan = planRotation(baseInput(11));
    // El plantel de prueba tiene DEL suficientes: nadie debería jugar fuera de posición todo el partido.
    const offPosition = plan.windows.flatMap((w) =>
      w.field.filter((f) => {
        const p = baseInput(11).players.find((x) => x.id === f.playerId)!;
        return p.primary !== f.position;
      }),
    );
    expect(offPosition.length).toBeLessThan(plan.windows.length * 2);
  });

  it("CA-02: con α = 0.5, quien jugó menos en el torneo recibe más cuota", () => {
    const input = baseInput(11, { ...F7, equityWeight: 0.5 });
    input.players[1].tournamentRatio = 0.6;
    input.players[2].tournamentRatio = 1;
    input.players[2].primary = input.players[1].primary;
    const plan = planRotation(input);
    const low = input.players[1].id;
    const high = input.players[2].id;
    expect(plan.targetMinutes[low]).toBeGreaterThan(plan.targetMinutes[high]);
    expect(plan.expectedFieldMinutes[low]).toBeGreaterThanOrEqual(plan.expectedFieldMinutes[high]);
  });

  it("CA-09: todos juegan aunque el acumulado diga lo contrario", () => {
    const input = baseInput(21, { ...F7, equityWeight: 1 });
    input.players[5].tournamentRatio = 5; // jugó muchísimo más que su cuota
    const plan = planRotation(input);
    for (const p of input.players) {
      if (p.id === "gk") continue;
      expect(plan.expectedFieldMinutes[p.id]).toBeGreaterThanOrEqual(F7.guaranteedMinutes);
    }
    expect(plan.issues.filter((i) => i.type === "FLOOR_UNREACHABLE")).toEqual([]);
  });

  it("RF-38: un bloqueo en el banco que impide el mínimo se informa como issue", () => {
    const input = baseInput(11);
    const id = input.players[3].id;
    input.locks = buildWindows(F7).map((w) => ({ playerId: id, windowIndex: w.index, state: "bench" as const }));
    const plan = planRotation(input);
    expect(plan.issues).toContainEqual({ type: "FLOOR_UNREACHABLE", playerId: id });
  });

  it("respeta bloqueos en cancha", () => {
    const input = baseInput(11);
    const id = input.players[4].id;
    input.locks = [0, 1, 2, 3, 4, 5, 6].map((i) => ({ playerId: id, windowIndex: i, state: "field" as const }));
    const plan = planRotation(input);
    for (const w of plan.windows.slice(0, 7)) expect(w.field.map((f) => f.playerId)).toContain(id);
  });

  it("CA-06: un jugador que llega tarde entra después y su cuota se ajusta", () => {
    const input = baseInput(11);
    const late = input.players[1];
    late.availableFromMin = 15;
    const plan = planRotation(input);
    for (const w of plan.windows.filter((w) => w.startMin < 15)) {
      expect(w.field.map((f) => f.playerId)).not.toContain(late.id);
    }
    expect(plan.expectedFieldMinutes[late.id]).toBeGreaterThan(0);
    expect(plan.targetMinutes[late.id]).toBeLessThanOrEqual(35);
  });

  it("maxSubsPerWindow limita las entradas, también en el entretiempo", () => {
    const plan = planRotation(baseInput(14, { ...F7, maxSubsPerWindow: 1 }));
    for (const w of plan.windows.slice(1)) expect(w.subs.length).toBeLessThanOrEqual(1);
  });

  it("greedy: F7 con 11 de campo, a lo sumo dos tramos y cambios de a uno o dos", () => {
    const plan = planRotation(baseInput(11, { ...F7, continuous: false }));
    for (const w of plan.windows.slice(1)) expect(w.subs.length).toBeLessThanOrEqual(2);
    for (const [, n] of stintCounts(plan)) expect(n).toBeLessThanOrEqual(2);
    // El entretiempo es una ventana más: no se cambia el equipo entero.
    expect(plan.windows.find((w) => w.startMin === 25)!.subs.length).toBeLessThanOrEqual(2);
    expect(plan.maxSpread).toBeLessThanOrEqual(5);
  });

  it("cambio de arquero planificado: los minutos de arco cuentan como jugados", () => {
    const input = baseInput(11);
    const second = input.players[1];
    input.goalkeeperSchedule.push({ playerId: second.id, fromMin: 25 });
    const plan = planRotation(input);
    expect(plan.expectedGoalkeeperMinutes[second.id]).toBe(25);
    expect(plan.expectedGoalkeeperMinutes.gk).toBe(25);
    for (const w of plan.windows.filter((w) => w.startMin >= 25)) {
      expect(w.goalkeeperId).toBe(second.id);
      expect(w.field.map((f) => f.playerId)).not.toContain(second.id);
    }
    // El arquero titular pasa a disponible para jugar de campo en el 2º tiempo.
    expect(plan.expectedFieldMinutes.gk).toBeGreaterThanOrEqual(0);
  });

  it("en vivo: recalcula desde el minuto actual con lo ya jugado", () => {
    const input = baseInput(11);
    const pre = planRotation(input);
    const first = pre.windows[0].field;
    const live: RotationInput = {
      ...input,
      nowMin: 12,
      playedSoFar: input.players.map((p) => ({
        playerId: p.id,
        fieldMinutes: first.some((f) => f.playerId === p.id) ? 12 : 0,
        goalkeeperMinutes: p.id === "gk" ? 12 : 0,
      })),
      onFieldNow: first.map((f) => ({ ...f, sinceMin: 0 })),
    };
    const plan = planRotation(live);
    expect(plan.windows[0].startMin).toBe(12);
    expect(plan.windows[0].index).toBe(2);
    // Todos los que no jugaron entran en algún momento, cada uno en un solo tramo (RF-40),
    // y nunca cambia medio equipo de golpe.
    const benchIds = input.players.filter((p) => p.id !== "gk" && !first.some((f) => f.playerId === p.id));
    const entries = plan.windows.flatMap((w) => w.subs.map((s) => s.inId));
    for (const p of benchIds) expect(entries).toContain(p.id);
    expect(new Set(entries).size).toBe(entries.length);
    for (const w of plan.windows) expect(w.subs.length).toBeLessThanOrEqual(3);
    expect(sum(Object.values(plan.expectedFieldMinutes))).toBeCloseTo(6 * 50);
  });

  it("en vivo: al inicio de una ventana sugiere sus cambios y, una vez hechos, nadie vuelve a entrar", () => {
    const input = baseInput(11);
    const pre = planRotation(input);
    const at = (nowMin: number, field: { playerId: string; position: FieldPosition }[], since: Map<string, number>, played: Map<string, number>) =>
      planRotation({
        ...input,
        nowMin,
        playedSoFar: input.players.map((p) => ({
          playerId: p.id,
          fieldMinutes: played.get(p.id) ?? 0,
          goalkeeperMinutes: p.id === "gk" ? nowMin : 0,
        })),
        onFieldNow: field.map((f) => ({ ...f, sinceMin: since.get(f.playerId) ?? 0 })),
      });
    // Primera ventana con cambios del plan: hasta ahí juegan los titulares.
    const t = pre.windows.find((w) => w.subs.length > 0)!.startMin;
    const lineup = pre.windows[0].field;
    const played = new Map(lineup.map((f) => [f.playerId, t]));
    const live = at(t, lineup, new Map(), played);
    expect(live.windows[0].startMin).toBe(t);
    expect(live.windows[0].subs.length).toBeGreaterThan(0);

    // Hechos los cambios, los que salieron no vuelven a entrar (RF-40).
    const since = new Map(live.windows[0].subs.map((s) => [s.inId, t]));
    const out = new Set(live.windows[0].subs.map((s) => s.outId));
    const after = at(t, live.windows[0].field, since, played);
    for (const w of after.windows) for (const f of w.field) expect(out.has(f.playerId)).toBe(false);
  });

  it("en vivo: un lesionado sale y su lugar lo ocupa alguien de la misma posición", () => {
    const input = baseInput(11);
    const pre = planRotation(input);
    const first = pre.windows[0].field;
    const injured = first.find((f) => f.position === "DEF")!;
    const players = input.players.map((p) =>
      p.id === injured.playerId ? { ...p, availableUntilMin: 3 } : p,
    );
    const plan = planRotation({
      ...input,
      players,
      nowMin: 3,
      playedSoFar: input.players.map((p) => ({
        playerId: p.id,
        fieldMinutes: first.some((f) => f.playerId === p.id) ? 3 : 0,
        goalkeeperMinutes: p.id === "gk" ? 3 : 0,
      })),
      onFieldNow: first.map((f) => ({ ...f, sinceMin: 0 })),
    });
    const sub = plan.windows[0].subs.find((s) => s.outId === injured.playerId);
    expect(sub).toBeDefined();
    expect(sub!.position).toBe("DEF");
    expect(players.find((p) => p.id === sub!.inId)!.primary).toBe("DEF");
  });

  it("CA-R7: rinde con 25 jugadores, 80 minutos y ventanas de 2", () => {
    const config: RotationConfig = {
      ...F7,
      playersOnField: 11,
      periods: [{ minutes: 40 }, { minutes: 40 }],
      windowMinutes: 2,
      minStintMinutes: 2,
      formation: { DEF: 4, MED: 4, DEL: 2 },
    };
    const input = baseInput(24, config);
    planRotation(input); // warm-up
    const t = performance.now();
    planRotation(input);
    expect(performance.now() - t).toBeLessThan(100);
  });
});

// ---------- Property-based (CA-R1..R6, R8) ----------

const configArb = fc
  .record({
    n: fc.constantFrom(5, 7, 9, 11),
    periods: fc.integer({ min: 1, max: 4 }),
    periodMinutes: fc.integer({ min: 8, max: 45 }),
    b: fc.integer({ min: 2, max: 10 }),
    alpha: fc.double({ min: 0, max: 1, noNaN: true }),
    useFormation: fc.boolean(),
    maxSubs: fc.option(fc.integer({ min: 1, max: 4 }), { nil: undefined }),
  })
  .map(({ n, periods, periodMinutes, b, alpha, useFormation, maxSubs }): RotationConfig => {
    const f = n - 1;
    const DEF = Math.floor(f / 3);
    const DEL = Math.max(1, Math.floor(f / 4));
    return {
      playersOnField: n,
      periods: Array.from({ length: periods }, () => ({ minutes: periodMinutes })),
      windowMinutes: b,
      minStintMinutes: b,
      guaranteedMinutes: b,
      equityWeight: alpha,
      goalkeeperRotates: false,
      maxSubsPerWindow: maxSubs,
      formation: useFormation ? { DEF, MED: f - DEF - DEL, DEL } : undefined,
    };
  });

const scenarioArb = configArb.chain((config) =>
  fc
    .record({
      extra: fc.integer({ min: 0, max: 14 }),
      ratios: fc.array(fc.option(fc.double({ min: 0, max: 2, noNaN: true }), { nil: null }), {
        minLength: 25,
        maxLength: 25,
      }),
      lateIdx: fc.option(fc.nat(), { nil: undefined }),
      lateMin: fc.nat(),
    })
    .map(({ extra, ratios, lateIdx, lateMin }) => {
      const input = baseInput(config.playersOnField - 1 + extra, config);
      input.players.forEach((p, i) => {
        if (p.id !== "gk") p.tournamentRatio = ratios[i];
      });
      const D = config.periods.reduce((a, p) => a + p.minutes, 0);
      if (lateIdx !== undefined) {
        const p = input.players[1 + (lateIdx % (input.players.length - 1))];
        p.availableFromMin = lateMin % D;
      }
      return input;
    }),
);

const D = (c: RotationConfig) => c.periods.reduce((a, p) => a + p.minutes, 0);

describe("propiedades del motor", () => {
  it("CA-R2: minutos de campo previstos = (N − 1) · D", () => {
    fc.assert(
      fc.property(scenarioArb, (input) => {
        const plan = planRotation(input);
        const total = sum(Object.values(plan.expectedFieldMinutes));
        const expected = (input.config.playersOnField - 1) * D(input.config);
        if (plan.issues.some((i) => i.type === "NOT_ENOUGH_PLAYERS")) {
          expect(total).toBeLessThan(expected);
        } else {
          expect(total).toBeCloseTo(expected, 6);
        }
      }),
    );
  });

  it("CA-R3: nadie juega fuera de su disponibilidad ni el arquero en el campo", () => {
    fc.assert(
      fc.property(scenarioArb, (input) => {
        const plan = planRotation(input);
        for (const w of plan.windows) {
          for (const f of w.field) {
            const p = input.players.find((x) => x.id === f.playerId)!;
            expect(p.availableFromMin).toBeLessThanOrEqual(w.startMin + 1e-6);
            expect(f.playerId).not.toBe(w.goalkeeperId);
          }
        }
      }),
    );
  });

  it("CA-R4: los stints respetan el mínimo salvo al cierre de un período", () => {
    fc.assert(
      fc.property(scenarioArb, (input) => {
        const plan = planRotation(input);
        const periodEnds = new Set<number>();
        let t = 0;
        for (const p of input.config.periods) periodEnds.add((t += p.minutes));
        for (const s of planStints(plan)) {
          if (periodEnds.has(s.end)) continue;
          expect(s.end - s.start).toBeGreaterThanOrEqual(input.config.minStintMinutes - 1e-6);
        }
      }),
    );
  });

  it("CA-R5: con α = 0 el acumulado no influye", () => {
    fc.assert(
      fc.property(scenarioArb, (input) => {
        const config = { ...input.config, equityWeight: 0 };
        const a = planRotation({ ...input, config });
        const b = planRotation({
          ...input,
          config,
          players: input.players.map((p) => ({ ...p, tournamentRatio: null })),
        });
        expect(a.windows).toEqual(b.windows);
      }),
    );
  });

  it("CA-R6: determinista", () => {
    fc.assert(
      fc.property(scenarioArb, (input) => {
        expect(planRotation(input)).toEqual(planRotation(structuredClone(input)));
      }),
    );
  });

  it("CA-R8: si no hay issue FLOOR_UNREACHABLE, todos llegan al mínimo garantizado", () => {
    fc.assert(
      fc.property(scenarioArb, (input) => {
        const plan = planRotation(input);
        const unreachable = new Set(
          plan.issues.flatMap((i) => (i.type === "FLOOR_UNREACHABLE" ? [i.playerId] : [])),
        );
        for (const p of input.players) {
          if (p.id === "gk" || unreachable.has(p.id)) continue;
          const eligibleMinutes = sum(
            plan.windows
              .filter((w) => w.startMin >= p.availableFromMin - 1e-6)
              .map((w) => w.endMin - w.startMin),
          );
          const floor = Math.min(input.config.guaranteedMinutes, eligibleMinutes);
          expect(plan.expectedFieldMinutes[p.id]).toBeGreaterThanOrEqual(floor - 1e-6);
        }
      }),
    );
  });

  it("CA-R8: con capacidad suficiente, nadie queda sin su mínimo", () => {
    fc.assert(
      fc.property(scenarioArb, (input) => {
        const { config } = input;
        const windows = buildWindows(config);
        const fieldPlayers = input.players.length - 1;
        const feasible =
          input.players.every((p) => p.availableFromMin === 0) &&
          windows.every((w) => w.endMin - w.startMin >= config.guaranteedMinutes) &&
          fieldPlayers <= (config.playersOnField - 1) * windows.length;
        fc.pre(feasible);
        const plan = planRotation(input);
        expect(plan.issues.filter((i) => i.type === "FLOOR_UNREACHABLE")).toEqual([]);
      }),
    );
  });

  const homogeneousArb = fc.record({
    n: fc.constantFrom(5, 7, 9, 11),
    extra: fc.integer({ min: 0, max: 14 }),
    b: fc.integer({ min: 2, max: 8 }),
    windowsPerPeriod: fc.integer({ min: 2, max: 8 }),
    periods: fc.integer({ min: 1, max: 4 }),
  });
  type HomogeneousScenario = { n: number; extra: number; b: number; windowsPerPeriod: number; periods: number };
  const homogeneousPlan = ({ n, extra, b, windowsPerPeriod, periods }: HomogeneousScenario, continuous = false) => {
    const config: RotationConfig = {
      playersOnField: n,
      periods: Array.from({ length: periods }, () => ({ minutes: b * windowsPerPeriod })),
      windowMinutes: b,
      minStintMinutes: b,
      guaranteedMinutes: b,
      equityWeight: 0.3,
      goalkeeperRotates: false,
      continuous,
    };
    const input = baseInput(n - 1 + extra, config);
    input.players = [input.players[0], ...makePlayers(n - 1 + extra, { primary: "MED" })];
    return planRotation(input);
  };

  it("CA-R1 (greedy): pool homogéneo, períodos múltiplos de b, sin límites → spread ≤ b", () => {
    fc.assert(
      fc.property(homogeneousArb, (s) => {
        expect(homogeneousPlan(s).maxSpread).toBeLessThanOrEqual(s.b + 1e-6);
      }),
    );
  });

  it("CA-R9 (greedy): pool homogéneo → cada jugador juega a lo sumo dos stints", () => {
    fc.assert(
      fc.property(homogeneousArb, (s) => {
        for (const [, n] of stintCounts(homogeneousPlan(s))) expect(n).toBeLessThanOrEqual(2);
      }),
    );
  });

  it("CA-R10 (greedy): pool homogéneo → las entradas por ventana siguen el ritmo parejo del partido", () => {
    fc.assert(
      fc.property(homogeneousArb, (s) => {
        const plan = homogeneousPlan(s);
        const pool = s.n - 1 + s.extra;
        const duration = s.b * s.windowsPerPeriod * s.periods;
        const cap = Math.ceil((pool * s.b) / duration);
        for (const w of plan.windows.slice(1)) expect(w.subs.length).toBeLessThanOrEqual(cap);
      }),
    );
  });

  it("CA-R11: un solo tramo por jugador y nunca más de la mitad de la cancha cambia junta", () => {
    fc.assert(
      fc.property(homogeneousArb, (s) => {
        const plan = homogeneousPlan(s, true);
        for (const [id, n] of stintCounts(plan)) if (id !== "gk") expect(n).toBeLessThanOrEqual(1);
        // La mitad de la cancha, salvo que no alcancen las ventanas para que entren todos.
        const entries = s.extra;
        const boundaries = s.windowsPerPeriod * s.periods - 1;
        const cap = Math.max(Math.ceil((s.n - 1) / 2), Math.ceil(entries / Math.max(1, boundaries)));
        for (const w of plan.windows.slice(1)) expect(w.subs.length).toBeLessThanOrEqual(cap);
      }),
    );
  });

  it("CA-R12: con un solo tramo, los minutos son los más parejos posibles (±1 ventana del reparto por cadenas)", () => {
    fc.assert(
      fc.property(homogeneousArb, (s) => {
        const plan = homogeneousPlan(s, true);
        const S = s.n - 1;
        const P = S + s.extra;
        const D = s.b * s.windowsPerPeriod * s.periods;
        const minutes = Object.entries(plan.expectedFieldMinutes).filter(([id]) => id !== "gk").map(([, m]) => m);
        // Cada puesto es una cadena que dura D: con P jugadores en S cadenas, las cadenas tienen
        // ⌊P/S⌋ o ⌈P/S⌉ jugadores. El reparto ideal va de D/⌈P/S⌉ a D/⌊P/S⌋; se admite una
        // ventana de redondeo y otra para escalonar los cambios.
        const lo = Math.floor(P / S);
        const hi = Math.ceil(P / S);
        expect(Math.min(...minutes)).toBeGreaterThanOrEqual(D / hi - 2 * s.b - 1e-6);
        expect(Math.max(...minutes)).toBeLessThanOrEqual(D / lo + 2 * s.b + 1e-6);
      }),
    );
  });
});
