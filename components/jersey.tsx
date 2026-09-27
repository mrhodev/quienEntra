import type { Position } from "@/lib/rotation";

const POS_VAR: Record<Position, string> = {
  DEF: "var(--pos-def)",
  MED: "var(--pos-med)",
  DEL: "var(--pos-del)",
  ARQ: "var(--pos-arq)",
};

/** Camiseta con el número, coloreada por posición (estilo Fantasy). */
export function Jersey({ pos, number, size = 44 }: { pos: Position; number?: number | string | null; size?: number }) {
  return (
    <svg width={size} height={(size * 44) / 48} viewBox="0 0 48 44" aria-hidden="true" className="shrink-0">
      <path
        d="M16 2 L6 7 L1 17 L8 20 L8 42 L40 42 L40 20 L47 17 L42 7 L32 2 C30 6 27 8 24 8 C21 8 18 6 16 2 Z"
        fill={POS_VAR[pos]}
        stroke="var(--background)"
        strokeWidth="1.5"
      />
      {number !== undefined && number !== null && number !== "" && (
        <text
          x="24"
          y="31"
          textAnchor="middle"
          fontFamily="var(--font-display)"
          fontWeight="800"
          fontSize={String(number).length > 2 ? 13 : 17}
          fill="#0f0a26"
        >
          {number}
        </text>
      )}
    </svg>
  );
}
