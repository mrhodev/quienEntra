import { describe, expect, it } from "vitest";
import { clockAt, formatClock } from "./clock";
import { deriveMatch, minutesByPlayer } from "./derive";
import type { MatchEvent, MatchEventPayload } from "./events";

const MIN = 60_000;

/** Construye eventos con matchTime en minutos efectivos y wallTime explícito. */
function log() {
  const events: MatchEvent[] = [];
  let seq = 0;
  const add = (min: number, wall: number, p: MatchEventPayload): MatchEvent => {
    const e = {
      id: `e${seq}`,
      matchId: "m1",
      seq: seq++,
      matchTimeMs: min * MIN,
      wallTime: wall,
      deviceId: "d1",
      ...p,
    } as MatchEvent;
    events.push(e);
    return e;
  };
  return { events, add };
}

const lineup: MatchEventPayload = {
  type: "lineup_set",
  goalkeeperId: "gk",
  field: [
    { playerId: "a", position: "DEF" },
    { playerId: "b", position: "MED" },
  ],
};

describe("clockAt", () => {
  it("descuenta pausas y entretiempo (CA-10)", () => {
    const { events, add } = log();
    add(0, 0, lineup);
    add(0, 1_000, { type: "period_start", periodIndex: 0 });
    add(5, 1_000 + 5 * MIN, { type: "pause" });
    add(5, 1_000 + 7 * MIN, { type: "resume" }); // 2 min de pausa
    add(10, 1_000 + 12 * MIN, { type: "period_end", periodIndex: 0 });
    add(10, 1_000 + 20 * MIN, { type: "period_start", periodIndex: 1 });

    const c = clockAt(events, 1_000 + 23 * MIN);
    expect(c.running).toBe(true);
    expect(c.elapsedMs).toBe(13 * MIN);
    expect(c.periodElapsedMs).toBe(3 * MIN);
    expect(c.periodIndex).toBe(1);
  });

  it("CA-04: es consistente sin importar cuándo se consulte (recarga/bloqueo)", () => {
    const { events, add } = log();
    add(0, 0, { type: "period_start", periodIndex: 0 });
    expect(clockAt(events, 3 * MIN + 400).elapsedMs).toBe(3 * MIN + 400);
    expect(formatClock(3 * MIN + 400)).toBe("03:00");
  });
});

describe("deriveMatch", () => {
  it("calcula stints y minutos con cambios, pausas y entretiempo", () => {
    const { events, add } = log();
    add(0, 0, lineup);
    add(0, 1, { type: "period_start", periodIndex: 0 });
    add(10, 2, { type: "sub", outId: "a", inId: "c", position: "DEF" });
    add(20, 3, { type: "period_end", periodIndex: 0 });
    add(20, 4, { type: "sub", outId: "b", inId: "a", position: "MED" }); // cambio en el entretiempo
    add(20, 5, { type: "period_start", periodIndex: 1 });
    add(30, 6, { type: "goal_for", scorerId: "c" });
    add(40, 7, { type: "match_end" });

    const s = deriveMatch(events);
    const m = minutesByPlayer(s.stints, 0);
    expect(m.get("a")!.fieldMs).toBe(30 * MIN);
    expect(m.get("b")!.fieldMs).toBe(20 * MIN);
    expect(m.get("c")!.fieldMs).toBe(30 * MIN);
    expect(m.get("gk")!.goalkeeperMs).toBe(40 * MIN);
    expect(s.goalsFor).toBe(1);
    expect(s.scorers.get("c")).toBe(1);
    expect(s.ended).toBe(true);
    // Stints cortados por período (para el Gantt, RF-28).
    expect(s.stints.filter((x) => x.playerId === "c").map((x) => x.periodIndex)).toEqual([0, 1]);
  });

  it("undo elimina el evento deshecho", () => {
    const { events, add } = log();
    add(0, 0, lineup);
    add(0, 1, { type: "period_start", periodIndex: 0 });
    const g = add(5, 2, { type: "goal_for" });
    add(6, 3, { type: "undo", eventId: g.id });
    expect(deriveMatch(events).goalsFor).toBe(0);
  });

  it("lesión: sale al instante y el reemplazo entra sin salida asociada", () => {
    const { events, add } = log();
    add(0, 0, lineup);
    add(0, 1, { type: "period_start", periodIndex: 0 });
    add(7, 2, { type: "injury", playerId: "a" });
    add(8, 3, { type: "sub", outId: null, inId: "c", position: "DEF" });
    const s = deriveMatch(events);
    const m = minutesByPlayer(s.stints, 10 * MIN);
    expect(m.get("a")!.fieldMs).toBe(7 * MIN);
    expect(m.get("c")!.fieldMs).toBe(2 * MIN);
    expect(s.injured.has("a")).toBe(true);
    expect([...s.onField.keys()].sort()).toEqual(["b", "c"]);
  });

  it("cambio de arquero: el anterior toma el lugar del nuevo en el campo", () => {
    const { events, add } = log();
    add(0, 0, lineup);
    add(0, 1, { type: "period_start", periodIndex: 0 });
    add(15, 2, { type: "gk_change", toId: "b" });
    const s = deriveMatch(events);
    const m = minutesByPlayer(s.stints, 20 * MIN);
    expect(s.goalkeeperId).toBe("b");
    expect(s.onField.get("gk")).toBe("MED");
    expect(m.get("b")).toEqual({ fieldMs: 15 * MIN, goalkeeperMs: 5 * MIN });
    expect(m.get("gk")).toEqual({ fieldMs: 5 * MIN, goalkeeperMs: 15 * MIN });
  });

  it("une logs de dos dispositivos sin duplicar (RF-35)", () => {
    const { events, add } = log();
    add(0, 0, lineup);
    add(0, 1, { type: "period_start", periodIndex: 0 });
    add(4, 2, { type: "goal_for" });
    const other = { ...events[2], id: "x1", deviceId: "d2", seq: 0, matchTimeMs: 6 * MIN, wallTime: 3 };
    expect(deriveMatch([other, ...events]).goalsFor).toBe(2);
  });
});

describe("reloj de simulación (RF-41)", () => {
  it("acelera, cambia de velocidad sin saltos y adelanta; el cronómetro lo sigue", async () => {
    const { simNow, withSpeed, jump } = await import("./sim");
    const t0 = 1_000_000;
    let sim = withSpeed(null, 30, t0);
    expect(simNow(sim, t0 + 1000)).toBe(t0 + 30_000);
    sim = withSpeed(sim, 60, t0 + 1000);
    expect(simNow(sim, t0 + 1000)).toBe(t0 + 30_000);
    expect(simNow(sim, t0 + 2000)).toBe(t0 + 90_000);
    sim = jump(sim, 5 * MIN, t0 + 2000);
    expect(simNow(sim, t0 + 2000)).toBe(t0 + 90_000 + 5 * MIN);
    expect(simNow(jump(sim, -MIN, t0 + 2000), t0 + 2000)).toBe(simNow(sim, t0 + 2000));

    // Con eventos registrados en hora virtual, el cronómetro avanza acelerado.
    const { events, add } = log();
    add(0, t0, { type: "period_start", periodIndex: 0 });
    const running = withSpeed(null, 60, t0);
    expect(clockAt(events, simNow(running, t0 + 5_000)).elapsedMs).toBe(5 * MIN);
  });
});
