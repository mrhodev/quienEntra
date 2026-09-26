import { describe, expect, it } from "vitest";
import type { FieldPosition, RotationPlayer, Substitution } from "@/lib/rotation";
import { alternativesIn, alternativesOut, withIn, withOut, type SwapContext } from "./suggestions";

const player = (id: string, primary: RotationPlayer["primary"], secondary: RotationPlayer["secondary"] = []) => ({
  id,
  primary,
  secondary,
  availableFromMin: 0,
  availableUntilMin: 999,
  tournamentRatio: null,
});

const players: RotationPlayer[] = [
  player("gk", "ARQ"),
  player("a", "DEF"),
  player("b", "MED"),
  player("c", "DEL"),
  player("d", "DEF"),
  player("e", "MED", ["DEF"]),
  player("f", "DEF"),
  player("g", "DEL"),
  player("h", "DEF"),
];

const onField = new Map<string, FieldPosition>([
  ["a", "DEF"],
  ["b", "MED"],
  ["c", "DEL"],
]);

const ctx: SwapContext = {
  players,
  onField,
  goalkeeperId: "gk",
  unavailable: new Set(["h"]),
  played: new Map([
    ["a", 20],
    ["b", 10],
    ["c", 15],
    ["d", 0],
    ["e", 5],
    ["f", 10],
    ["g", 0],
  ]),
  targetMinutes: { a: 20, b: 20, c: 20, d: 20, e: 20, f: 20, g: 20, h: 20 },
};

describe("alternativas a una sugerencia de cambio (RF-17)", () => {
  const sub: Substitution = { outId: "a", inId: "d", position: "DEF" };

  it("para entrar: del banco, primero la posición del cambio y luego a quien más le falta", () => {
    const alts = alternativesIn(sub, [sub], ctx).map((c) => c.playerId);
    // d y f son DEF (a d le faltan más), e es DEF de secundaria, g juega fuera de posición.
    expect(alts).toEqual(["d", "f", "e", "g"]);
  });

  it("para entrar: no ofrece al arquero, a los de cancha, a los no disponibles ni a quien ya entra en otro cambio", () => {
    const other: Substitution = { outId: "b", inId: "f", position: "MED" };
    const alts = alternativesIn(sub, [sub, other], ctx).map((c) => c.playerId);
    expect(alts).not.toContain("gk");
    expect(alts).not.toContain("a");
    expect(alts).not.toContain("h");
    expect(alts).not.toContain("f");
  });

  it("para salir: en cancha, primero quien más se pasó de su cuota, sin repetir salidas", () => {
    const other: Substitution = { outId: "c", inId: "g", position: "DEL" };
    const alts = alternativesOut(sub, [sub, other], ctx).map((c) => c.playerId);
    expect(alts).toEqual(["a", "b"]);
  });

  it("cambiar quién sale mueve el cambio a la posición del nuevo saliente", () => {
    expect(withOut(sub, "b", onField)).toEqual({ outId: "b", inId: "d", position: "MED" });
    expect(withIn(sub, "f")).toEqual({ outId: "a", inId: "f", position: "DEF" });
  });
});
