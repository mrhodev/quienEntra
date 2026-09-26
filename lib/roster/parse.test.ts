import { describe, expect, it } from "vitest";
import { parseQuickRoster } from "./parse";

describe("alta rápida del plantel", () => {
  it("lee número, nombre y posiciones, una línea por jugador", () => {
    expect(parseQuickRoster("10 Juan MED\nJuan Pérez def med\n7 Nacho\n\n1 Tomi arquero")).toEqual([
      { name: "Juan", shirtNumber: 10, primary: "MED", secondary: [] },
      { name: "Juan Pérez", shirtNumber: null, primary: "DEF", secondary: ["MED"] },
      { name: "Nacho", shirtNumber: 7, primary: "MED", secondary: [] },
      { name: "Tomi", shirtNumber: 1, primary: "ARQ", secondary: [] },
    ]);
  });

  it("ignora líneas sin nombre y posiciones repetidas", () => {
    expect(parseQuickRoster("  \n12\nLeo DEL/DEL, MED")).toEqual([
      { name: "Leo", shirtNumber: null, primary: "DEL", secondary: ["MED"] },
    ]);
  });
});
