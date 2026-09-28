import { describe, expect, it } from "vitest";
import type { MatchEvent, MatchEventPayload } from "@/lib/match/events";
import { liveRotationInput, windowSuggestions, type SquadEntry } from "@/lib/match/live";
import { planRotation, type RotationPlayer } from "@/lib/rotation";
import { F7 } from "@/lib/rotation/test-utils";
import { availableMs, matchPlayerStats } from "./match";
import { equity, heatmap, tournamentRatios, tournamentTable, type StatsRow } from "./tournament";

const MIN = 60_000;

function log() {
  const events: MatchEvent[] = [];
  const add = (min: number, p: MatchEventPayload) => {
    events.push({
      id: `e${events.length}`,
      matchId: "m",
      seq: events.length,
      matchTimeMs: min * MIN,
      wallTime: events.length,
      deviceId: "d",
      ...p,
    } as MatchEvent);
  };
  return { events, add };
}

const rp = (id: string, primary: RotationPlayer["primary"] = "MED"): RotationPlayer => ({
  id,
  primary,
  secondary: [],
  availableFromMin: 0,
  availableUntilMin: 999,
  tournamentRatio: null,
});

describe("estadísticas de un partido", () => {
  it("minutos, arco, goles, disponibilidad y cuota justa por jugador", () => {
    const { events, add } = log();
    add(0, { type: "lineup_set", goalkeeperId: "gk", field: [{ playerId: "a", position: "DEF" }, { playerId: "b", position: "MED" }] });
    add(0, { type: "period_start", periodIndex: 0 });
    add(10, { type: "sub", outId: "a", inId: "c", position: "DEF" });
    add(12, { type: "goal_for", scorerId: "b" });
    add(15, { type: "player_available", playerId: "late" });
    add(20, { type: "match_end" });
    const attendance = new Map([
      ["gk", "present"],
      ["a", "present"],
      ["b", "present"],
      ["c", "present"],
      ["late", "late"],
    ] as const);
    const s = matchPlayerStats(events, new Map(attendance), false);
    expect(s.get("a")!.field_seconds).toBe(600);
    expect(s.get("c")!.field_seconds).toBe(600);
    expect(s.get("b")!.field_seconds).toBe(1200);
    expect(s.get("gk")!.goalkeeper_seconds).toBe(1200);
    expect(s.get("b")!.goals).toBe(1);
    expect(s.get("late")!.available_seconds).toBe(300);
    // 40' de campo entre a, b, c (20' disponibles cada uno) y el que llegó tarde (5'):
    // el tope de "late" es 5', el resto se reparte parejo (35/3 ≈ 11,7').
    expect(s.get("late")!.target_seconds).toBe(300);
    expect(s.get("a")!.target_seconds).toBe(700);
    // El arquero fijo tiene como cuota lo que atajó.
    expect(s.get("gk")!.target_seconds).toBe(1200);
    expect(s.get("c")!.stints).toEqual([{ role: "field", position: "DEF", periodIndex: 0, startMs: 10 * MIN, endMs: 20 * MIN }]);
  });

  it("un lesionado deja de estar disponible y vuelve si se lo marca disponible", () => {
    const { events, add } = log();
    add(0, { type: "period_start", periodIndex: 0 });
    add(5, { type: "injury", playerId: "a" });
    add(10, { type: "player_available", playerId: "a" });
    add(20, { type: "match_end" });
    const av = availableMs(events, new Map([["a", "present"]]), 20 * MIN);
    expect(av.get("a")).toBe(15 * MIN);
  });
});

describe("estadísticas del torneo (RF-26, RF-27, RF-30)", () => {
  const rows: StatsRow[] = [
    { match_id: "m1", player_id: "a", field_seconds: 1500, goalkeeper_seconds: 0, target_seconds: 1500, available_seconds: 3000, goals: 1 },
    { match_id: "m1", player_id: "b", field_seconds: 900, goalkeeper_seconds: 0, target_seconds: 1500, available_seconds: 3000, goals: 0 },
    { match_id: "m2", player_id: "a", field_seconds: 1800, goalkeeper_seconds: 0, target_seconds: 1500, available_seconds: 3000, goals: 2 },
  ];

  it("tabla por jugador", () => {
    const [a, b, c] = tournamentTable(rows, ["a", "b", "c"]);
    expect(a).toMatchObject({ matchesPresent: 2, matchesPlayed: 2, playedSeconds: 3300, goals: 3, avgMinutes: 27.5 });
    expect(a.playedShare).toBeCloseTo(0.55);
    expect(b).toMatchObject({ matchesPresent: 1, playedShare: 0.3 });
    expect(c).toMatchObject({ matchesPresent: 0, playedShare: null, avgMinutes: null });
  });

  it("mapa de calor: vacío si estuvo ausente", () => {
    expect(heatmap(rows, ["a", "b"], ["m1", "m2"])).toEqual([
      [0.5, 0.6],
      [0.3, null],
    ]);
  });

  it("equidad: desvío y quiénes están por debajo del promedio", () => {
    const e = equity(tournamentTable(rows, ["a", "b", "c"]));
    expect(e.mean).toBeCloseTo(0.425);
    expect(e.stdDev).toBeCloseTo(0.125);
    expect(e.below).toEqual(["b"]);
  });

  it("CA-02: el acumulado r_i baja para quien jugó menos que su cuota", () => {
    const r = tournamentRatios(rows);
    expect(r.get("a")).toBeCloseTo(1.1);
    expect(r.get("b")).toBeCloseTo(0.6);
  });
});

describe("entrada del motor en vivo", () => {
  const squad: SquadEntry[] = [
    { player: rp("gk", "ARQ"), attendance: "present", expectedFromMin: 0 },
    ...["a", "b", "c", "d", "e", "f", "g", "h"].map((id) => ({ player: rp(id), attendance: "present" as const, expectedFromMin: 0 })),
    { player: rp("late"), attendance: "late", expectedFromMin: 10 },
    { player: rp("gone"), attendance: "absent", expectedFromMin: 0 },
  ];

  it("antes del partido: los ausentes no juegan y el que llega tarde, desde su hora estimada", () => {
    const { input } = liveRotationInput({ config: F7, squad, goalkeeperId: "gk", locks: [], events: [], nowMs: 0 });
    expect(input.players.map((p) => p.id)).not.toContain("gone");
    expect(input.players.find((p) => p.id === "late")!.availableFromMin).toBe(10);
  });

  it("CA-06: si todavía no llegó, no se lo sugiere antes de la próxima ventana; al marcarlo, cuenta desde ese minuto", () => {
    const pre = planRotation(liveRotationInput({ config: F7, squad, goalkeeperId: "gk", locks: [], events: [], nowMs: 0 }).input);
    const { events, add } = log();
    add(0, { type: "lineup_set", goalkeeperId: "gk", field: pre.windows[0].field });
    add(0, { type: "period_start", periodIndex: 0 });
    let { input } = liveRotationInput({ config: F7, squad, goalkeeperId: "gk", locks: [], events, nowMs: 12 * MIN });
    expect(input.players.find((p) => p.id === "late")!.availableFromMin).toBe(17);
    add(15, { type: "player_available", playerId: "late" });
    ({ input } = liveRotationInput({ config: F7, squad, goalkeeperId: "gk", locks: [], events, nowMs: 15 * MIN }));
    expect(input.players.find((p) => p.id === "late")!.availableFromMin).toBe(15);
    const plan = planRotation(input);
    expect(plan.windows.some((w) => w.field.some((f) => f.playerId === "late"))).toBe(true);
  });

  it("CA-05: un lesionado en cancha sale y el plan sugiere su reemplazo de inmediato", () => {
    const pre = planRotation(liveRotationInput({ config: F7, squad, goalkeeperId: "gk", locks: [], events: [], nowMs: 0 }).input);
    const { events, add } = log();
    add(0, { type: "lineup_set", goalkeeperId: "gk", field: pre.windows[0].field });
    add(0, { type: "period_start", periodIndex: 0 });
    const hurt = pre.windows[0].field[0];
    add(3, { type: "injury", playerId: hurt.playerId });
    const { input, state } = liveRotationInput({ config: F7, squad, goalkeeperId: "gk", locks: [], events, nowMs: 3 * MIN });
    expect(state.onField.has(hurt.playerId)).toBe(false);
    const plan = planRotation(input);
    const sub = plan.windows[0].subs.find((s) => s.outId === null);
    expect(sub).toBeDefined();
    expect(plan.windows.every((w) => !w.field.some((f) => f.playerId === hurt.playerId))).toBe(true);
  });
});

describe("sugerencias en vivo durante una ventana", () => {
  const squad: SquadEntry[] = [
    { player: rp("gk", "ARQ"), attendance: "present", expectedFromMin: 0 },
    ...["a", "b", "c", "d", "e", "f", "g", "h", "i", "j", "k"].map((id) => ({
      player: rp(id),
      attendance: "present" as const,
      expectedFromMin: 0,
    })),
  ];

  it("durante la ventana siguen las mismas sugerencias y, una vez hechas, desaparecen", async () => {
    const { currentBoundaryMin } = await import("@/lib/match/boundary");
    const args = { config: F7, squad, goalkeeperId: "gk", locks: [] };
    const pre = planRotation(liveRotationInput({ ...args, events: [], nowMs: 0 }).input);
    const { events, add } = log();
    add(0, { type: "lineup_set", goalkeeperId: "gk", field: pre.windows[0].field });
    add(0, { type: "period_start", periodIndex: 0 });

    const at = (min: number) => windowSuggestions({ ...args, events }, currentBoundaryMin(F7, min)).subs;
    // Primera ventana con cambios del plan (los titulares juegan hasta ahí).
    const t = pre.windows.find((w) => w.subs.length > 0)!.startMin;
    const atT = at(t);
    expect(atT.length).toBeGreaterThan(0);
    expect(at(t + 1.5)).toEqual(atT);

    // Confirmar de a uno: los que quedan siguen siendo los mismos; al final, no queda ninguno.
    const [first, ...rest] = atT;
    add(t + 1.5, { type: "sub", outId: first.outId, inId: first.inId, position: first.position });
    expect(at(t + 1.6)).toEqual(rest);
    for (const s of rest) add(t + 2, { type: "sub", outId: s.outId, inId: s.inId, position: s.position });
    expect(at(t + 2.5)).toEqual([]);
  });
});
