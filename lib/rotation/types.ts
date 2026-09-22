export type Position = "ARQ" | "DEF" | "MED" | "DEL";
export type FieldPosition = Exclude<Position, "ARQ">;
export const FIELD_POSITIONS: readonly FieldPosition[] = ["DEF", "MED", "DEL"];

export interface RotationConfig {
  /** N: jugadores en cancha, incluido el arquero. */
  playersOnField: number;
  periods: { minutes: number }[];
  /** b: longitud de la ventana de cambio, en minutos. */
  windowMinutes: number;
  /** Máximo de jugadores que entran por ventana (no aplica al inicio de un período). */
  maxSubsPerWindow?: number;
  minStintMinutes: number;
  /** Mínimo garantizado por presente (RF-38). */
  guaranteedMinutes: number;
  /** Cantidad de jugadores de campo por posición; debe sumar N − 1. */
  formation?: Record<FieldPosition, number>;
  /** α ∈ [0, 1]: peso del acumulado del torneo. */
  equityWeight: number;
  /** Si los minutos de arquero entran en el reparto equitativo. */
  goalkeeperRotates: boolean;
}

export interface RotationPlayer {
  id: string;
  primary: Position;
  secondary: Position[];
  availableFromMin: number;
  availableUntilMin: number;
  /** r_i: minutos jugados / cuota justa acumulada en el torneo. null = sin historial. */
  tournamentRatio: number | null;
}

export interface GoalkeeperSlot {
  playerId: string;
  fromMin: number;
}

export interface PlayedSoFar {
  playerId: string;
  fieldMinutes: number;
  goalkeeperMinutes: number;
}

export interface OnFieldNow {
  playerId: string;
  position: FieldPosition;
  /** Minuto en que empezó el stint actual. */
  sinceMin: number;
}

export interface PlanLock {
  playerId: string;
  windowIndex: number;
  state: "field" | "bench";
}

export interface RotationInput {
  config: RotationConfig;
  players: RotationPlayer[];
  goalkeeperSchedule: GoalkeeperSlot[];
  playedSoFar?: PlayedSoFar[];
  onFieldNow?: OnFieldNow[];
  locks?: PlanLock[];
  /** 0 antes del partido; tiempo efectivo transcurrido en vivo. */
  nowMin?: number;
}

export interface FieldAssignment {
  playerId: string;
  position: FieldPosition;
}

export interface Substitution {
  /** null si entra a completar un campo incompleto (por ejemplo, tras una lesión). */
  outId: string | null;
  inId: string;
  position: FieldPosition;
}

export interface PlanWindow {
  index: number;
  startMin: number;
  endMin: number;
  periodIndex: number;
  goalkeeperId: string | null;
  field: FieldAssignment[];
  /** Cambios al inicio de la ventana. Vacío en la primera ventana del partido (es la formación inicial). */
  subs: Substitution[];
}

export type RotationIssue =
  | { type: "FLOOR_UNREACHABLE"; playerId: string }
  | { type: "LOCK_CONFLICT"; playerId: string; windowIndex: number }
  | { type: "NOT_ENOUGH_PLAYERS"; windowIndex: number };

export interface RotationPlan {
  windows: PlanWindow[];
  /** Cuota justa, en la base de equidad (campo, o campo + arco si el arquero rota). */
  targetMinutes: Record<string, number>;
  /** Minutos previstos en la base de equidad, incluidos los ya jugados. */
  expectedMinutes: Record<string, number>;
  expectedFieldMinutes: Record<string, number>;
  expectedGoalkeeperMinutes: Record<string, number>;
  /** max − min de minutos de campo previstos entre jugadores disponibles todo el partido y sin minutos de arco. */
  maxSpread: number;
  issues: RotationIssue[];
}
