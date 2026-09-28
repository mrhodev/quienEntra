import { planRotation, type PlanLock, type RotationConfig, type RotationInput, type RotationPlayer } from "@/lib/rotation";
import { deriveMatch, minutesByPlayer, type MatchState } from "./derive";
import { effectiveEvents, type MatchEvent } from "./events";

const MIN = 60_000;

export type AttendanceState = "present" | "absent" | "injured" | "late";

export interface SquadEntry {
  player: RotationPlayer;
  attendance: AttendanceState;
  /** Minuto estimado de llegada (solo para "llega tarde"). */
  expectedFromMin: number;
}

export interface LiveInputArgs {
  config: RotationConfig;
  squad: SquadEntry[];
  /** Arquero titular elegido en la previa (se usa antes de que haya eventos). */
  goalkeeperId: string | null;
  locks: PlanLock[];
  events: MatchEvent[];
  nowMs: number;
}

/** Quién llegó (evento `player_available` de alguien que llegaba tarde) y cuándo, en ms. */
function arrivals(events: MatchEvent[]): Map<string, number> {
  const out = new Map<string, number>();
  for (const e of effectiveEvents(events)) {
    if (e.type === "player_available" && !out.has(e.playerId)) out.set(e.playerId, e.matchTimeMs);
  }
  return out;
}

/**
 * Entrada del motor para un momento del partido (§6.4): lo jugado sale del log de eventos,
 * los que llegan tarde se consideran disponibles desde que el DT los marca, y los lesionados
 * dejan de estar disponibles.
 */
export function liveRotationInput({ config, squad, goalkeeperId, locks, events, nowMs }: LiveInputArgs): {
  input: RotationInput;
  state: MatchState;
} {
  const state = deriveMatch(events);
  const started = events.length > 0;
  const nowMin = nowMs / MIN;
  const arrived = arrivals(events);
  const minutes = minutesByPlayer(state.stints, nowMs);

  const players: RotationPlayer[] = [];
  for (const s of squad) {
    if (s.attendance === "absent" || s.attendance === "injured") {
      // Si igual llegó a jugar (por ejemplo, se marcó disponible), cuenta desde entonces.
      if (!arrived.has(s.player.id)) continue;
    }
    let from = 0;
    if (s.attendance !== "present") {
      const at = arrived.get(s.player.id);
      if (at !== undefined) from = at / MIN;
      // Todavía no llegó: se lo espera para la hora estimada, nunca antes de la próxima ventana.
      else from = started ? Math.max(s.expectedFromMin, nowMin + config.windowMinutes) : s.expectedFromMin;
    }
    const injured = state.injured.has(s.player.id);
    players.push({
      ...s.player,
      availableFromMin: from,
      availableUntilMin: injured ? nowMin : s.player.availableUntilMin,
    });
  }

  const gk = state.goalkeeperId ?? goalkeeperId;
  const base: RotationInput = {
    config,
    players,
    goalkeeperSchedule: gk ? [{ playerId: gk, fromMin: 0 }] : [],
    locks,
  };
  if (!started) return { input: base, state };

  const onFieldNow = [...state.onField].map(([playerId, position]) => {
    // El stint sigue si está abierto o si lo cerró el fin del período que acaba de terminar.
    const last = state.stints.filter((st) => st.playerId === playerId && st.role === "field").at(-1);
    const continuing = last && (last.endMs === null || last.endMs === nowMs);
    return { playerId, position, sinceMin: continuing ? last.startMs / MIN : nowMin };
  });
  return {
    input: {
      ...base,
      nowMin,
      playedSoFar: players.map((p) => ({
        playerId: p.id,
        fieldMinutes: (minutes.get(p.id)?.fieldMs ?? 0) / MIN,
        goalkeeperMinutes: (minutes.get(p.id)?.goalkeeperMs ?? 0) / MIN,
      })),
      onFieldNow,
    },
    state,
  };
}

/**
 * Cambios que corresponden a la ventana que empezó en `boundaryMin` (RF-17, §6.4).
 * Se calculan con el estado del inicio de la ventana —sin los cambios que el DT hizo
 * después—, así la sugerencia queda fija durante toda la ventana aunque se confirmen de a uno,
 * y se descartan los que ya se hicieron (o que ya no se pueden hacer).
 * Devuelve también el plan recalculado con el estado actual, para lo que viene después.
 */
export function windowSuggestions(args: Omit<LiveInputArgs, "nowMs">, boundaryMin: number) {
  const atMs = boundaryMin * MIN;
  const before = args.events.filter((e) => !(e.type === "sub" && e.matchTimeMs >= atMs - 1));
  const pinned = planRotation(liveRotationInput({ ...args, events: before, nowMs: atMs }).input);
  const { input, state } = liveRotationInput({ ...args, nowMs: atMs });
  const plan = planRotation(input);
  const subs = (pinned.windows[0]?.subs ?? []).filter(
    (s) =>
      !state.onField.has(s.inId) &&
      s.inId !== state.goalkeeperId &&
      !state.injured.has(s.inId) &&
      (s.outId === null ? state.onField.size < args.config.playersOnField - 1 : state.onField.has(s.outId)),
  );
  return { subs, plan, state };
}
