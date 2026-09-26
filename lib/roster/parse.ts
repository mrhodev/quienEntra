import type { Position } from "@/lib/rotation";

export interface ParsedPlayer {
  name: string;
  shirtNumber: number | null;
  primary: Position;
  secondary: Position[];
}

const ALIASES: Record<string, Position> = {
  arq: "ARQ",
  arquero: "ARQ",
  gk: "ARQ",
  def: "DEF",
  defensor: "DEF",
  med: "MED",
  medio: "MED",
  mediocampista: "MED",
  vol: "MED",
  volante: "MED",
  del: "DEL",
  delantero: "DEL",
};

const toPosition = (token: string): Position | undefined =>
  ALIASES[token.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "")];

/**
 * Alta rápida del plantel (§8, onboarding): un jugador por línea, por ejemplo "10 Juan MED",
 * "Juan Pérez DEF MED" o "7 Nacho". La primera posición es la principal; sin posición, MED.
 */
export function parseQuickRoster(text: string): ParsedPlayer[] {
  const out: ParsedPlayer[] = [];
  for (const raw of text.split(/\r?\n/)) {
    const tokens = raw.trim().split(/[\s,/]+/).filter(Boolean);
    if (!tokens.length) continue;
    let shirtNumber: number | null = null;
    if (/^\d{1,3}$/.test(tokens[0])) shirtNumber = Number(tokens.shift());
    const positions: Position[] = [];
    while (tokens.length && toPosition(tokens[tokens.length - 1])) {
      positions.unshift(toPosition(tokens.pop()!)!);
    }
    const name = tokens.join(" ");
    if (!name) continue;
    const unique = [...new Set(positions)];
    out.push({ name, shirtNumber, primary: unique[0] ?? "MED", secondary: unique.slice(1) });
  }
  return out;
}
