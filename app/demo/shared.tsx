import type { FieldPosition, Position } from "@/lib/rotation";

const NAMES = [
  "Tomás", "Benja", "Santi", "Mateo", "Juanchi", "Lucho", "Nacho", "Fran", "Joaco", "Thiago",
  "Bauti", "Valen", "Lauti", "Agus", "Facu", "Nico", "Pipe", "Rama", "Gonza", "Mati",
  "Leo", "Emi", "Dani", "Seba",
];
const POS_CYCLE: Position[] = ["DEF", "MED", "DEL", "MED", "DEF", "MED", "DEF", "DEL"];

export const FORMATIONS: Record<number, Record<FieldPosition, number>> = {
  5: { DEF: 2, MED: 1, DEL: 1 },
  7: { DEF: 2, MED: 3, DEL: 1 },
  8: { DEF: 3, MED: 3, DEL: 1 },
  9: { DEF: 3, MED: 3, DEL: 2 },
  11: { DEF: 4, MED: 4, DEL: 2 },
};

export const POS_STYLE: Record<Position, string> = {
  DEF: "bg-pos-def",
  MED: "bg-pos-med",
  DEL: "bg-pos-del",
  ARQ: "bg-pos-arq",
};

export interface DemoPlayer {
  id: string;
  name: string;
  position: Position;
  present: boolean;
  ratio: number | null;
}

export function makeSquad(n: number): DemoPlayer[] {
  return [
    { id: "p00", name: "Arquero", position: "ARQ", present: true, ratio: null },
    ...Array.from({ length: n }, (_, i) => ({
      id: `p${String(i + 1).padStart(2, "0")}`,
      name: NAMES[i % NAMES.length],
      position: POS_CYCLE[i % POS_CYCLE.length],
      present: true,
      ratio: null,
    })),
  ];
}

export function Stepper<T extends number>({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: T;
  options: T[];
  onChange: (v: T) => void;
}) {
  const i = Math.max(0, options.indexOf(value));
  const btn =
    "grid size-9 place-items-center rounded-full bg-background text-lg font-semibold transition active:scale-90 disabled:opacity-30";
  return (
    <div>
      <p className="mb-1 text-xs text-muted">{label}</p>
      <div className="flex items-center justify-between gap-1">
        <button className={btn} disabled={i === 0} onClick={() => onChange(options[i - 1])} aria-label={`Menos ${label}`}>
          −
        </button>
        <span className="tabular text-lg font-bold">{value}</span>
        <button
          className={btn}
          disabled={i === options.length - 1}
          onClick={() => onChange(options[i + 1])}
          aria-label={`Más ${label}`}
        >
          +
        </button>
      </div>
    </div>
  );
}

export function Stat({ label, value, tone }: { label: string; value: string; tone?: "good" | "warn" }) {
  return (
    <div className="rounded-2xl border border-border bg-surface px-2 py-3">
      <p
        className={`tabular text-2xl font-bold ${tone === "good" ? "text-accent" : tone === "warn" ? "text-pos-del" : ""}`}
      >
        {value}
      </p>
      <p className="text-xs text-muted">{label}</p>
    </div>
  );
}

export function Legend() {
  return (
    <div className="flex gap-2 text-[10px] text-muted">
      {(["ARQ", "DEF", "MED", "DEL"] as const).map((p) => (
        <span key={p} className="flex items-center gap-1">
          <span className={`size-2 rounded-full ${POS_STYLE[p]}`} />
          {p}
        </span>
      ))}
    </div>
  );
}
