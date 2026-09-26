/** Estadísticas del torneo (RF-26..30), agregadas desde `match_player_stats`. */

export interface StatsRow {
  match_id: string;
  player_id: string;
  field_seconds: number;
  goalkeeper_seconds: number;
  target_seconds: number;
  available_seconds: number;
  goals: number;
}

export interface PlayerTotals {
  playerId: string;
  /** Partidos en los que estuvo disponible. */
  matchesPresent: number;
  /** Partidos en los que jugó algún minuto. */
  matchesPlayed: number;
  playedSeconds: number;
  availableSeconds: number;
  targetSeconds: number;
  goals: number;
  /** Jugado / disponible, entre 0 y 1; null si nunca estuvo disponible. */
  playedShare: number | null;
  /** Minutos por partido presente; null si no estuvo en ninguno. */
  avgMinutes: number | null;
}

const played = (r: StatsRow) => r.field_seconds + r.goalkeeper_seconds;

export function tournamentTable(rows: StatsRow[], playerIds: string[]): PlayerTotals[] {
  return playerIds.map((playerId) => {
    const mine = rows.filter((r) => r.player_id === playerId);
    const present = mine.filter((r) => r.available_seconds > 0 || played(r) > 0);
    const playedSeconds = mine.reduce((a, r) => a + played(r), 0);
    const availableSeconds = mine.reduce((a, r) => a + Math.max(r.available_seconds, played(r)), 0);
    return {
      playerId,
      matchesPresent: present.length,
      matchesPlayed: mine.filter((r) => played(r) > 0).length,
      playedSeconds,
      availableSeconds,
      targetSeconds: mine.reduce((a, r) => a + r.target_seconds, 0),
      goals: mine.reduce((a, r) => a + r.goals, 0),
      playedShare: availableSeconds > 0 ? playedSeconds / availableSeconds : null,
      avgMinutes: present.length ? playedSeconds / 60 / present.length : null,
    };
  });
}

/** Celda del mapa de calor (RF-27): % jugado sobre lo disponible; null = ausente. */
export function heatmap(rows: StatsRow[], playerIds: string[], matchIds: string[]): (number | null)[][] {
  const byKey = new Map(rows.map((r) => [`${r.player_id}|${r.match_id}`, r]));
  return playerIds.map((p) =>
    matchIds.map((m) => {
      const r = byKey.get(`${p}|${m}`);
      if (!r) return null;
      const avail = Math.max(r.available_seconds, played(r));
      return avail > 0 ? played(r) / avail : null;
    }),
  );
}

/**
 * Indicador de equidad (RF-30): desvío estándar del % jugado entre quienes estuvieron
 * disponibles y la lista de los que están por debajo del promedio.
 */
export function equity(totals: PlayerTotals[]): { mean: number; stdDev: number; below: string[] } {
  const shares = totals.filter((t) => t.playedShare !== null) as (PlayerTotals & { playedShare: number })[];
  if (!shares.length) return { mean: 0, stdDev: 0, below: [] };
  const mean = shares.reduce((a, t) => a + t.playedShare, 0) / shares.length;
  const variance = shares.reduce((a, t) => a + (t.playedShare - mean) ** 2, 0) / shares.length;
  return {
    mean,
    stdDev: Math.sqrt(variance),
    below: shares
      .filter((t) => t.playedShare < mean - 1e-9)
      .sort((a, b) => a.playedShare - b.playedShare)
      .map((t) => t.playerId),
  };
}

/**
 * r_i del torneo (§6.2): minutos jugados / cuota justa acumulada, en partidos anteriores.
 * null si todavía no tiene cuota (primer partido).
 */
export function tournamentRatios(rows: StatsRow[]): Map<string, number | null> {
  const acc = new Map<string, { played: number; target: number }>();
  for (const r of rows) {
    const a = acc.get(r.player_id) ?? { played: 0, target: 0 };
    a.played += played(r);
    a.target += r.target_seconds;
    acc.set(r.player_id, a);
  }
  return new Map([...acc].map(([id, a]) => [id, a.target > 0 ? a.played / a.target : null]));
}
