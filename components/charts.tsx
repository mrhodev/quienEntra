/** Gráficos en SVG propio (§7.1): livianos y reutilizables en la app, la vista pública y las infografías. */

export interface GanttRow {
  id: string;
  name: string;
  minutes: number;
  stints: { startMs: number; endMs: number; role: "field" | "goalkeeper" }[];
}

/** Línea de tiempo del partido (RF-28): una barra por jugador con sus stints y los cortes de período. */
export function Gantt({
  rows,
  durationMs,
  periodCutsMs,
  color = "var(--accent)",
  gkColor = "var(--pos-arq)",
  textColor = "currentColor",
  mutedColor = "var(--border)",
  rowHeight = 22,
  labelWidth = 96,
  width = 360,
  fontSize = 11,
}: {
  rows: GanttRow[];
  durationMs: number;
  periodCutsMs: number[];
  color?: string;
  gkColor?: string;
  textColor?: string;
  mutedColor?: string;
  rowHeight?: number;
  labelWidth?: number;
  width?: number;
  fontSize?: number;
}) {
  const minutesWidth = fontSize * 3;
  const plotW = width - labelWidth - minutesWidth;
  const x = (ms: number) => labelWidth + (Math.min(ms, durationMs) / Math.max(1, durationMs)) * plotW;
  const height = rows.length * rowHeight + fontSize + 6;
  const bar = rowHeight * 0.62;
  return (
    <svg viewBox={`0 0 ${width} ${height}`} width="100%" role="img" aria-label="Línea de tiempo de minutos por jugador" style={{ display: "block" }}>
      {rows.map((r, i) => {
        const y = i * rowHeight;
        return (
          <g key={r.id}>
            <text x={0} y={y + rowHeight / 2} dominantBaseline="central" fontSize={fontSize} fill={textColor}>
              {r.name.length > 14 ? `${r.name.slice(0, 13)}…` : r.name}
            </text>
            <rect x={labelWidth} y={y + (rowHeight - bar) / 2} width={plotW} height={bar} rx={bar / 3} fill={mutedColor} opacity={0.5} />
            {r.stints.map((s, k) => (
              <rect
                key={k}
                x={x(s.startMs)}
                y={y + (rowHeight - bar) / 2}
                width={Math.max(1, x(s.endMs) - x(s.startMs))}
                height={bar}
                rx={bar / 3}
                fill={s.role === "goalkeeper" ? gkColor : color}
              />
            ))}
            <text x={width} y={y + rowHeight / 2} dominantBaseline="central" textAnchor="end" fontSize={fontSize} fontWeight={700} fill={textColor}>
              {Math.round(r.minutes)}&apos;
            </text>
          </g>
        );
      })}
      {periodCutsMs.map((c) => (
        <line key={c} x1={x(c)} x2={x(c)} y1={0} y2={rows.length * rowHeight} stroke={textColor} strokeOpacity={0.35} strokeDasharray="3 3" />
      ))}
      <text x={labelWidth} y={height - 2} fontSize={fontSize * 0.85} fill={textColor} opacity={0.6}>
        0&apos;
      </text>
      <text x={labelWidth + plotW} y={height - 2} fontSize={fontSize * 0.85} fill={textColor} opacity={0.6} textAnchor="end">
        {Math.round(durationMs / 60_000)}&apos;
      </text>
    </svg>
  );
}

/** Mapa de calor jugadores × partidos (RF-27): % jugado sobre lo disponible; vacío = ausente. */
export function Heatmap({
  rows,
  cols,
  values,
  color = "var(--accent)",
  textColor = "currentColor",
  emptyColor = "var(--border)",
  cell = 26,
  labelWidth = 96,
  fontSize = 11,
}: {
  rows: string[];
  cols: string[];
  values: (number | null)[][];
  color?: string;
  textColor?: string;
  emptyColor?: string;
  cell?: number;
  labelWidth?: number;
  fontSize?: number;
}) {
  const gap = 2;
  const head = fontSize + 8;
  const width = labelWidth + cols.length * (cell + gap);
  const height = head + rows.length * (cell + gap);
  return (
    <svg viewBox={`0 0 ${width} ${height}`} width={Math.max(width, 1)} role="img" aria-label="Mapa de calor de minutos por partido" style={{ display: "block", maxWidth: "100%" }}>
      {cols.map((c, j) => (
        <text key={j} x={labelWidth + j * (cell + gap) + cell / 2} y={fontSize} textAnchor="middle" fontSize={fontSize * 0.85} fill={textColor} opacity={0.7}>
          {c}
        </text>
      ))}
      {rows.map((r, i) => (
        <g key={i}>
          <text x={0} y={head + i * (cell + gap) + cell / 2} dominantBaseline="central" fontSize={fontSize} fill={textColor}>
            {r.length > 14 ? `${r.slice(0, 13)}…` : r}
          </text>
          {values[i].map((v, j) => (
            <g key={j}>
              <rect
                x={labelWidth + j * (cell + gap)}
                y={head + i * (cell + gap)}
                width={cell}
                height={cell}
                rx={4}
                fill={v === null ? "none" : color}
                fillOpacity={v === null ? 0 : 0.15 + 0.85 * Math.min(1, v)}
                stroke={v === null ? emptyColor : "none"}
                strokeDasharray={v === null ? "3 2" : undefined}
              >
                <title>{v === null ? "Ausente" : `${Math.round(v * 100)}% jugado`}</title>
              </rect>
              {v !== null && cell >= 22 && (
                <text
                  x={labelWidth + j * (cell + gap) + cell / 2}
                  y={head + i * (cell + gap) + cell / 2}
                  dominantBaseline="central"
                  textAnchor="middle"
                  fontSize={fontSize * 0.75}
                  fill={v > 0.55 ? "#fff" : textColor}
                >
                  {Math.round(v * 100)}
                </text>
              )}
            </g>
          ))}
        </g>
      ))}
    </svg>
  );
}

/** Barras horizontales simples (ranking de minutos, minutos por partido). */
export function Bars({
  items,
  color = "var(--accent)",
  textColor = "currentColor",
  trackColor = "var(--border)",
  rowHeight = 22,
  labelWidth = 96,
  width = 360,
  fontSize = 11,
  format = (v: number) => `${Math.round(v)}'`,
}: {
  items: { label: string; value: number }[];
  color?: string;
  textColor?: string;
  trackColor?: string;
  rowHeight?: number;
  labelWidth?: number;
  width?: number;
  fontSize?: number;
  format?: (v: number) => string;
}) {
  const max = Math.max(1, ...items.map((i) => i.value));
  const valueW = fontSize * 3.2;
  const plotW = width - labelWidth - valueW;
  const bar = rowHeight * 0.6;
  return (
    <svg viewBox={`0 0 ${width} ${items.length * rowHeight}`} width="100%" role="img" aria-label="Gráfico de barras" style={{ display: "block" }}>
      {items.map((it, i) => (
        <g key={i}>
          <text x={0} y={i * rowHeight + rowHeight / 2} dominantBaseline="central" fontSize={fontSize} fill={textColor}>
            {it.label.length > 14 ? `${it.label.slice(0, 13)}…` : it.label}
          </text>
          <rect x={labelWidth} y={i * rowHeight + (rowHeight - bar) / 2} width={plotW} height={bar} rx={bar / 2} fill={trackColor} opacity={0.5} />
          <rect x={labelWidth} y={i * rowHeight + (rowHeight - bar) / 2} width={(it.value / max) * plotW} height={bar} rx={bar / 2} fill={color} />
          <text x={width} y={i * rowHeight + rowHeight / 2} dominantBaseline="central" textAnchor="end" fontSize={fontSize} fontWeight={700} fill={textColor}>
            {format(it.value)}
          </text>
        </g>
      ))}
    </svg>
  );
}
