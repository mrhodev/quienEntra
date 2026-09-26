"use client";

import { useRef, useState, type ReactNode } from "react";
import { Bars, Gantt, Heatmap, type GanttRow } from "./charts";
import { Button, contrastOn, Segmented, Sheet } from "./ui";

/** Infografías para compartir (RF-36, RF-37). Tamaño fijo en px; se exportan a PNG en el cliente. */

export type Format = "4:5" | "9:16";
const SIZE: Record<Format, { w: number; h: number }> = { "4:5": { w: 1080, h: 1350 }, "9:16": { w: 1080, h: 1920 } };
const INK = "#10151b";
const MUTED = "#5d6673";
const TRACK = "#e3e6e2";

function Frame({ format, color, children, footer }: { format: Format; color: string; children: ReactNode; footer?: string }) {
  const { w, h } = SIZE[format];
  return (
    <div
      style={{
        width: w,
        height: h,
        background: "#ffffff",
        color: INK,
        fontFamily: 'system-ui, -apple-system, "Segoe UI", Roboto, sans-serif',
        display: "flex",
        flexDirection: "column",
        overflow: "hidden",
      }}
    >
      <div style={{ height: 24, background: color }} />
      <div style={{ flex: 1, display: "flex", flexDirection: "column", padding: "48px 64px 32px", gap: 28, minHeight: 0 }}>{children}</div>
      <div style={{ padding: "0 64px 36px", display: "flex", justifyContent: "space-between", fontSize: 26, color: MUTED }}>
        <span>{footer}</span>
        <span style={{ fontWeight: 700 }}>quienEntra</span>
      </div>
    </div>
  );
}

function Big({ value, label }: { value: string; label: string }) {
  return (
    <div style={{ display: "flex", flexDirection: "column" }}>
      <span style={{ fontSize: 76, fontWeight: 800, lineHeight: 1, fontVariantNumeric: "tabular-nums" }}>{value}</span>
      <span style={{ fontSize: 26, color: MUTED, marginTop: 6 }}>{label}</span>
    </div>
  );
}

/** Alto de fila que entra en el espacio disponible, para no cortar planteles grandes (RF-37). */
const fit = (rows: number, available: number, max: number) => Math.max(18, Math.min(max, Math.floor(available / Math.max(1, rows))));

export interface MatchInfo {
  teamName: string;
  color: string;
  opponent: string;
  date: string;
  goalsFor: number;
  goalsAgainst: number;
  scorers: string[];
  rows: GanttRow[];
  durationMs: number;
  cutsMs: number[];
  equity: string;
}

export function MatchInfographic({ info, format }: { info: MatchInfo; format: Format }) {
  const { h } = SIZE[format];
  const available = h - 24 - 48 - 32 - 62 - 360;
  const rowHeight = fit(info.rows.length, available, 56);
  return (
    <Frame format={format} color={info.color} footer={info.date}>
      <div>
        <div style={{ fontSize: 30, color: MUTED }}>{info.teamName}</div>
        <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", gap: 24 }}>
          <div style={{ fontSize: 56, fontWeight: 800, lineHeight: 1.1 }}>vs {info.opponent}</div>
          <div style={{ fontSize: 96, fontWeight: 800, fontVariantNumeric: "tabular-nums", color: info.color }}>
            {info.goalsFor}–{info.goalsAgainst}
          </div>
        </div>
        {info.scorers.length > 0 && <div style={{ fontSize: 28, color: MUTED, marginTop: 8 }}>⚽ {info.scorers.join(", ")}</div>}
      </div>
      <div style={{ background: info.color, color: contrastOn(info.color), borderRadius: 20, padding: "18px 28px", fontSize: 34, fontWeight: 700 }}>
        {info.equity}
      </div>
      <div style={{ flex: 1, minHeight: 0 }}>
        <Gantt
          rows={info.rows}
          durationMs={info.durationMs}
          periodCutsMs={info.cutsMs}
          color={info.color}
          gkColor="#d97706"
          textColor={INK}
          mutedColor={TRACK}
          rowHeight={rowHeight}
          labelWidth={260}
          width={952}
          fontSize={Math.min(30, rowHeight * 0.62)}
        />
      </div>
    </Frame>
  );
}

export interface TournamentInfo {
  teamName: string;
  color: string;
  tournamentName: string;
  played: number;
  won: number;
  drawn: number;
  lost: number;
  heat: { rows: string[]; cols: string[]; values: (number | null)[][] };
  ranking: { label: string; value: number }[];
  topScorer: string | null;
  equity: string;
}

export function TournamentInfographic({ info, format }: { info: TournamentInfo; format: Format }) {
  const { h } = SIZE[format];
  const n = info.heat.rows.length;
  const tall = format === "9:16";
  const available = h - 24 - 48 - 32 - 62 - 330;
  // En 9:16 entran el mapa de calor y el ranking; en 4:5, el mapa y un ranking en dos columnas.
  const heatRow = fit(n, tall ? available * 0.55 : available * 0.62, 44);
  const cell = Math.min(heatRow - 2, Math.floor((952 - 240) / Math.max(1, info.heat.cols.length)) - 2);
  const rankRows = tall ? info.ranking : info.ranking.slice(0, 10);
  const rankRow = fit(rankRows.length, tall ? available * 0.42 : available * 0.36, 40);
  return (
    <Frame format={format} color={info.color} footer={info.teamName}>
      <div>
        <div style={{ fontSize: 30, color: MUTED }}>{info.teamName}</div>
        <div style={{ fontSize: 58, fontWeight: 800, lineHeight: 1.1 }}>{info.tournamentName}</div>
      </div>
      <div style={{ display: "flex", justifyContent: "space-between" }}>
        <Big value={String(info.played)} label="partidos" />
        <Big value={`${info.won}-${info.drawn}-${info.lost}`} label="G-E-P" />
        <Big value={info.equity} label="equidad" />
      </div>
      {info.topScorer && <div style={{ fontSize: 30 }}>⚽ Goleador: <b>{info.topScorer}</b></div>}
      <Heatmap
        rows={info.heat.rows}
        cols={info.heat.cols}
        values={info.heat.values}
        color={info.color}
        textColor={INK}
        emptyColor={TRACK}
        cell={Math.max(14, cell)}
        labelWidth={240}
        fontSize={Math.min(28, heatRow * 0.6)}
      />
      <div style={{ flex: 1, minHeight: 0 }}>
        <div style={{ fontSize: 28, fontWeight: 700, marginBottom: 8 }}>Minutos en el torneo</div>
        <Bars items={rankRows} color={info.color} textColor={INK} trackColor={TRACK} rowHeight={rankRow} labelWidth={240} width={952} fontSize={Math.min(26, rankRow * 0.62)} />
      </div>
    </Frame>
  );
}

export interface PlayerInfo {
  teamName: string;
  color: string;
  name: string;
  number: number | null;
  positions: string;
  totalMinutes: number;
  share: string;
  matches: number;
  goals: number;
  perMatch: { label: string; value: number }[];
}

export function PlayerInfographic({ info, format }: { info: PlayerInfo; format: Format }) {
  const { h } = SIZE[format];
  const available = h - 24 - 48 - 32 - 62 - 420;
  const rowHeight = fit(info.perMatch.length, available, 60);
  return (
    <Frame format={format} color={info.color} footer={info.teamName}>
      <div style={{ display: "flex", alignItems: "center", gap: 32 }}>
        <div
          style={{
            width: 150,
            height: 150,
            borderRadius: 999,
            background: info.color,
            color: contrastOn(info.color),
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            fontSize: 72,
            fontWeight: 800,
          }}
        >
          {info.number ?? info.name[0]}
        </div>
        <div>
          <div style={{ fontSize: 64, fontWeight: 800, lineHeight: 1.05 }}>{info.name}</div>
          <div style={{ fontSize: 30, color: MUTED }}>{info.positions}</div>
        </div>
      </div>
      <div style={{ display: "flex", justifyContent: "space-between" }}>
        <Big value={`${Math.round(info.totalMinutes)}'`} label="minutos" />
        <Big value={info.share} label="jugado" />
        <Big value={String(info.matches)} label="partidos" />
        <Big value={String(info.goals)} label="goles" />
      </div>
      <div style={{ flex: 1, minHeight: 0 }}>
        <div style={{ fontSize: 28, fontWeight: 700, marginBottom: 8 }}>Minutos por partido</div>
        <Bars items={info.perMatch} color={info.color} textColor={INK} trackColor={TRACK} rowHeight={rowHeight} labelWidth={260} width={952} fontSize={Math.min(28, rowHeight * 0.6)} />
      </div>
    </Frame>
  );
}

/**
 * Vista previa, elección de formato y envío (RF-37): Web Share API con el PNG; si no se puede,
 * se descarga. La librería de captura se carga solo al exportar.
 */
export function ShareSheet({
  open,
  onClose,
  title,
  fileName,
  render,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  fileName: string;
  render: (format: Format) => ReactNode;
}) {
  const [format, setFormat] = useState<Format>("4:5");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const node = useRef<HTMLDivElement>(null);
  const { w, h } = SIZE[format];
  const scale = 300 / w;

  const share = async () => {
    if (!node.current) return;
    setBusy(true);
    setError("");
    try {
      const { domToBlob } = await import("modern-screenshot");
      const blob = await domToBlob(node.current, { width: w, height: h, scale: 1, type: "image/png" });
      const file = new File([blob], `${fileName}.png`, { type: "image/png" });
      if (navigator.canShare?.({ files: [file] })) {
        await navigator.share({ files: [file], title });
      } else {
        const url = URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = url;
        a.download = file.name;
        a.click();
        setTimeout(() => URL.revokeObjectURL(url), 1000);
      }
    } catch (e) {
      if ((e as Error).name !== "AbortError") setError("No se pudo generar la imagen.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Sheet open={open} onClose={onClose} title={title}>
      <div className="space-y-3">
        <Segmented
          label="Formato"
          value={format}
          onChange={setFormat}
          options={[
            { value: "4:5", label: "4:5 · chats y feed" },
            { value: "9:16", label: "9:16 · historias" },
          ]}
        />
        <div className="mx-auto overflow-hidden rounded-xl border border-border shadow" style={{ width: w * scale, height: h * scale }}>
          <div style={{ transform: `scale(${scale})`, transformOrigin: "top left", width: w, height: h }}>
            <div ref={node}>{render(format)}</div>
          </div>
        </div>
        {error && (
          <p role="alert" className="text-sm text-pos-del">
            {error}
          </p>
        )}
        <Button className="w-full" onClick={share} disabled={busy}>
          {busy ? "Generando…" : "Compartir"}
        </Button>
      </div>
    </Sheet>
  );
}
