import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { allocate, allocateWithFloors } from "./allocate";
import { planRotation } from "./planner";
import { baseInput, F7, makePlayers, planStints } from "./test-utils";
import type { RotationConfig, RotationInput } from "./types";
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
  it("CA-01: F7 2×25, 12 presentes con arquero fijo → entre 25 y 30 minutos", () => {
    const plan = planRotation(baseInput(11));
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

  it("maxSubsPerWindow limita las entradas (salvo en el entretiempo)", () => {
    const plan = planRotation(baseInput(14, { ...F7, maxSubsPerWindow: 2 }));
    for (const w of plan.windows.slice(1)) {
      if (w.startMin === 25) continue;
      expect(w.subs.length).toBeLessThanOrEqual(2);
    }
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
    // Quienes no jugaron todavía tienen que entrar primero.
    const benchIds = input.players.filter((p) => p.id !== "gk" && !first.some((f) => f.playerId === p.id));
    for (const p of benchIds) expect(plan.windows[0].field.map((f) => f.playerId)).toContain(p.id);
    expect(sum(Object.values(plan.expectedFieldMinutes))).toBeCloseTo(6 * 50);
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

  it("CA-R1: pool homogéneo, períodos múltiplos de b, sin límites → spread ≤ b", () => {
    const arb = fc.record({
      n: fc.constantFrom(5, 7, 9, 11),
      extra: fc.integer({ min: 0, max: 14 }),
      b: fc.integer({ min: 2, max: 8 }),
      windowsPerPeriod: fc.integer({ min: 2, max: 8 }),
      periods: fc.integer({ min: 1, max: 4 }),
    });
    fc.assert(
      fc.property(arb, ({ n, extra, b, windowsPerPeriod, periods }) => {
        const config: RotationConfig = {
          playersOnField: n,
          periods: Array.from({ length: periods }, () => ({ minutes: b * windowsPerPeriod })),
          windowMinutes: b,
          minStintMinutes: b,
          guaranteedMinutes: b,
          equityWeight: 0.3,
          goalkeeperRotates: false,
        };
        const input = baseInput(n - 1 + extra, config);
        input.players = [input.players[0], ...makePlayers(n - 1 + extra, { primary: "MED" })];
        const plan = planRotation(input);
        expect(plan.maxSpread).toBeLessThanOrEqual(b + 1e-6);
      }),
    );
  });
});
