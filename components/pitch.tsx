import type { FieldPosition, Position } from "@/lib/rotation";
import { Jersey } from "./jersey";

export type Quota = "ok" | "over" | "under";

const QUOTA: Record<Quota, { mark: string; label: string }> = {
  ok: { mark: "✓", label: "en cuota" },
  over: { mark: "▲", label: "se está pasando" },
  under: { mark: "▼", label: "le faltan minutos" },
};

/**
 * Carta de jugador (estilo Fantasy): camiseta con número, nombre en una plaqueta y minutos.
 * El estado respecto de la cuota se indica con una marca, no solo con color (RNF-09).
 */
export function PlayerCard({
  id,
  name,
  number,
  pos,
  minutes,
  quota,
  selected,
  small,
  onClick,
}: {
  id?: string;
  name: string;
  number?: number | null;
  pos: Position;
  minutes?: number;
  quota?: Quota;
  selected?: boolean;
  small?: boolean;
  onClick?: () => void;
}) {
  const label = [name, minutes !== undefined ? `${Math.round(minutes)} minutos` : "", quota ? QUOTA[quota].label : ""]
    .filter(Boolean)
    .join(", ");
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={!onClick}
      aria-label={label}
      aria-pressed={selected}
      // Al confirmar un cambio, el jugador "viaja" entre la cancha y el banco (View Transitions).
      style={id ? { viewTransitionName: `p-${id}` } : undefined}
      className={`flex ${small ? "w-16" : "w-[4.5rem]"} flex-col items-center gap-0.5 rounded-xl p-0.5 transition ${selected ? "bg-accent/30 ring-2 ring-accent" : ""}`}
    >
      <span className="relative">
        <Jersey pos={pos} number={number ?? pos} size={small ? 32 : 44} />
        {quota && (
          <span
            aria-hidden
            className="absolute -right-2 -top-1 grid size-[18px] place-items-center rounded-full bg-foreground text-[10px] font-extrabold text-background"
          >
            {QUOTA[quota].mark}
          </span>
        )}
      </span>
      <span className="max-w-full truncate rounded-md bg-background px-1.5 font-display text-[13px] font-bold leading-5 text-foreground">
        {name}
      </span>
      {minutes !== undefined && (
        <span className="tabular rounded-md bg-foreground px-1.5 font-display text-xs font-extrabold leading-4 text-background">
          {Math.round(minutes)}&apos;
        </span>
      )}
    </button>
  );
}

export interface PitchPlayer {
  id: string;
  name: string;
  number?: number | null;
  pos: FieldPosition;
  minutes?: number;
  quota?: Quota;
}

/** Cancha rayada con los jugadores formados por línea: delanteros arriba, arquero abajo. */
export function Pitch({
  players,
  goalkeeper,
  selectedId,
  onPick,
  compact,
  label = "En cancha",
  children,
}: {
  players: PitchPlayer[];
  goalkeeper?: { id: string; name: string; number?: number | null; minutes?: number } | null;
  selectedId?: string | null;
  onPick?: (id: string) => void;
  compact?: boolean;
  label?: string;
  children?: React.ReactNode;
}) {
  const row = (pos: FieldPosition) => players.filter((p) => p.pos === pos);
  return (
    <section aria-label={label} className={`pitch relative overflow-hidden rounded-2xl px-1 ${compact ? "py-2" : "py-3"}`}>
      {/* Áreas: decoración */}
      <span aria-hidden className="absolute left-1/2 top-0 h-9 w-32 -translate-x-1/2 border-2 border-t-0 border-[var(--pitch-line)]" />
      <span aria-hidden className="absolute bottom-0 left-1/2 h-12 w-40 -translate-x-1/2 border-2 border-b-0 border-[var(--pitch-line)]" />
      <span aria-hidden className="absolute inset-x-0 top-1/2 border-t-2 border-[var(--pitch-line)]" />
      {children}
      <div className={`relative flex flex-col ${compact ? "gap-1" : "gap-2"}`}>
        {(["DEL", "MED", "DEF"] as const).map((pos) =>
          row(pos).length ? (
            <div key={pos} className="flex flex-wrap justify-center gap-x-2 gap-y-1">
              {row(pos).map((p) => (
                <PlayerCard
                  key={p.id}
                  id={p.id}
                  name={p.name}
                  number={p.number}
                  pos={p.pos}
                  minutes={p.minutes}
                  quota={p.quota}
                  small={compact}
                  selected={selectedId === p.id}
                  onClick={onPick ? () => onPick(p.id) : undefined}
                />
              ))}
            </div>
          ) : null,
        )}
        {goalkeeper && (
          <div className="flex justify-center">
            <PlayerCard
              id={goalkeeper.id}
              name={goalkeeper.name}
              number={goalkeeper.number}
              pos="ARQ"
              minutes={goalkeeper.minutes}
              small={compact}
            />
          </div>
        )}
      </div>
    </section>
  );
}
