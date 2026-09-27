"use client";

import { useMemo, useState } from "react";
import { formatDate, pct } from "@/lib/app/format";
import { positionsPlayed, record, type StatsDataset } from "@/lib/stats/dataset";
import type { Position } from "@/lib/rotation";
import { equity, heatmap, tournamentTable } from "@/lib/stats/tournament";
import { Bars, Heatmap } from "./charts";
import { PlayerInfographic, ShareSheet, TournamentInfographic } from "./infographic";
import { Jersey } from "./jersey";
import { Button, Card, Empty, Segmented } from "./ui";

type Tab = "tabla" | "mapa" | "jugador";

/**
 * Estadísticas de un torneo (RF-26..30) con infografías para compartir (RF-36).
 * La usa la app del DT y la vista pública (solo partidos finalizados).
 */
export function TournamentStats({ data, tournamentId }: { data: StatsDataset; tournamentId: string | null }) {
  const [tab, setTab] = useState<Tab>("tabla");
  const [playerId, setPlayerId] = useState<string | null>(null);
  const [share, setShare] = useState<"torneo" | "jugador" | null>(null);

  const view = useMemo(() => {
    const matches = data.matches.filter((m) => m.tournamentId === tournamentId);
    const ids = new Set(matches.map((m) => m.id));
    const rows = data.rows.filter((r) => ids.has(r.match_id));
    const playerIds = data.players.filter((p) => rows.some((r) => r.player_id === p.id)).map((p) => p.id);
    const totals = tournamentTable(rows, playerIds).sort((a, b) => b.playedSeconds - a.playedSeconds);
    return { matches, rows, totals, eq: equity(totals) };
  }, [data, tournamentId]);

  const name = new Map(data.players.map((p) => [p.id, p.name]));
  const tournamentName = data.tournaments.find((t) => t.id === tournamentId)?.name ?? "Torneo";

  if (!view.matches.length) return <Empty title="Todavía no hay partidos finalizados">Las estadísticas aparecen cuando termina el primer partido.</Empty>;

  const heatPlayers = view.totals.map((t) => t.playerId);
  const heatCols = view.matches.map((m, i) => (m.kickoffAt ? formatDate(m.kickoffAt).replace(/\.$/, "") : String(i + 1)));
  const heatValues = heatmap(view.rows, heatPlayers, view.matches.map((m) => m.id));
  const rec = record(view.matches);
  const topScorer = [...view.totals].sort((a, b) => b.goals - a.goals)[0];
  const equityText = `±${Math.round(view.eq.stdDev * 100)} pp`;
  const selected = playerId ?? view.totals[0]?.playerId ?? null;

  return (
    <div className="space-y-4">
      <Segmented
        label="Vista"
        value={tab}
        onChange={setTab}
        options={[
          { value: "tabla", label: "Ranking" },
          { value: "mapa", label: "Mapa de calor" },
          { value: "jugador", label: "Jugador" },
        ]}
      />

      {tab === "tabla" && (
        <>
          <div className="grid grid-cols-3 gap-2">
            <Tile value={String(view.matches.length)} label="partidos" />
            <Tile value={`${rec.won}-${rec.drawn}-${rec.lost}`} label="G-E-P" />
            <Tile value={`±${Math.round(view.eq.stdDev * 100)}`} label="equidad (pp)" accent />
          </div>
          {topScorer && topScorer.goals > 0 && (
            <div className="flex items-center gap-3 rounded-2xl border-2 border-pos-arq bg-raised p-3">
              <Jersey pos={mainPosition(view.rows, topScorer.playerId)} number={data.players.find((p) => p.id === topScorer.playerId)?.number ?? ""} size={52} />
              <div className="min-w-0 flex-1">
                <p className="font-display text-xs font-bold uppercase tracking-widest text-pos-arq">Goleador</p>
                <p className="truncate font-display text-2xl font-extrabold leading-tight">{name.get(topScorer.playerId)}</p>
                <p className="text-xs text-muted">
                  {Math.round(topScorer.playedSeconds / 60)}&apos; · {pct(topScorer.playedShare)} jugado
                </p>
              </div>
              <p className="font-display text-5xl font-extrabold text-pos-arq">{topScorer.goals}</p>
            </div>
          )}
          <Card className="space-y-1.5">
            <div className="flex items-baseline justify-between">
              <p className="font-display text-lg font-extrabold uppercase tracking-wide">Minutos en el torneo</p>
              <p className="text-xs text-muted">% jugado</p>
            </div>
            <ol className="space-y-1.5">
              {view.totals.map((t, i) => {
                const max = Math.max(1, view.totals[0]?.playedSeconds ?? 1);
                const below = view.eq.below.includes(t.playerId);
                return (
                  <li key={t.playerId} className="flex min-h-9 items-center gap-2">
                    <span className="tabular w-5 text-center font-display font-extrabold text-muted">{i + 1}</span>
                    <div className="min-w-0 flex-1">
                      <div className="flex justify-between text-sm">
                        <span className="truncate font-semibold">{name.get(t.playerId)}</span>
                        <span className="tabular font-display font-extrabold">{Math.round(t.playedSeconds / 60)}&apos;</span>
                      </div>
                      <div className="h-1.5 overflow-hidden rounded-full bg-background">
                        <div className="h-full rounded-full bg-accent" style={{ width: `${(t.playedSeconds / max) * 100}%` }} />
                      </div>
                    </div>
                    <span className={`tabular w-16 shrink-0 whitespace-nowrap text-right text-sm font-semibold ${below ? "text-pos-def" : ""}`}>
                      {below && <span aria-hidden>▼ </span>}
                      {pct(t.playedShare)}
                      {below && <span className="sr-only"> (por debajo del promedio)</span>}
                    </span>
                  </li>
                );
              })}
            </ol>
          </Card>
          <Card>
            <p className="font-display text-lg font-extrabold uppercase tracking-wide">Equidad del plantel</p>
            <p className="mt-1 text-sm text-muted">
              Promedio jugado: <strong className="text-foreground">{pct(view.eq.mean)}</strong> de los minutos disponibles, con un desvío de{" "}
              <strong className="text-foreground">{Math.round(view.eq.stdDev * 100)} puntos</strong>.
            </p>
            {view.eq.below.length > 0 && (
              <p className="mt-1 text-sm text-muted">
                Por debajo del promedio: {view.eq.below.map((id) => name.get(id)).join(", ")}.
              </p>
            )}
          </Card>
          <div className="overflow-x-auto rounded-2xl border border-border bg-surface">
            <table className="w-full text-sm">
              <caption className="sr-only">Minutos por jugador en el torneo</caption>
              <thead>
                <tr className="text-xs text-muted">
                  <th className="px-3 py-2 text-left font-medium">Jugador</th>
                  <th className="px-1.5 py-2 text-right font-medium" title="Partidos presentes">
                    PP
                  </th>
                  <th className="px-1.5 py-2 text-right font-medium" title="Partidos jugados">
                    PJ
                  </th>
                  <th className="px-1.5 py-2 text-right font-medium">Min</th>
                  <th className="px-1.5 py-2 text-right font-medium" title="Minutos jugados sobre los disponibles">
                    %
                  </th>
                  <th className="px-1.5 py-2 text-right font-medium" title="Promedio por partido presente">
                    Prom
                  </th>
                  <th className="px-3 py-2 text-right font-medium">G</th>
                </tr>
              </thead>
              <tbody>
                {view.totals.map((t) => (
                  <tr key={t.playerId} className="border-t border-border">
                    <td className="max-w-32 truncate px-3 py-2">{name.get(t.playerId)}</td>
                    <td className="tabular px-1.5 py-2 text-right">{t.matchesPresent}</td>
                    <td className="tabular px-1.5 py-2 text-right">{t.matchesPlayed}</td>
                    <td className="tabular px-1.5 py-2 text-right font-semibold">{Math.round(t.playedSeconds / 60)}&apos;</td>
                    <td className={`tabular px-1.5 py-2 text-right ${view.eq.below.includes(t.playerId) ? "text-pos-def" : ""}`}>
                      {pct(t.playedShare)}
                      {view.eq.below.includes(t.playerId) && <span className="sr-only"> (por debajo del promedio)</span>}
                    </td>
                    <td className="tabular px-1.5 py-2 text-right">{t.avgMinutes === null ? "—" : `${Math.round(t.avgMinutes)}'`}</td>
                    <td className="tabular px-3 py-2 text-right">{t.goals || ""}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}

      {tab === "mapa" && (
        <Card className="overflow-x-auto">
          <p className="mb-2 text-sm text-muted">% jugado de los minutos disponibles en cada partido. Vacío = ausente.</p>
          <Heatmap rows={heatPlayers.map((id) => name.get(id) ?? "")} cols={heatCols} values={heatValues} />
        </Card>
      )}

      {tab === "jugador" && selected && (
        <PlayerSheet data={data} matches={view.matches} rows={view.rows} totals={view.totals} playerId={selected} onPick={setPlayerId} />
      )}

      <div className="flex gap-2">
        <Button className="flex-1" onClick={() => setShare("torneo")}>
          Compartir torneo
        </Button>
        {tab === "jugador" && selected && (
          <Button variant="secondary" className="flex-1" onClick={() => setShare("jugador")}>
            Compartir jugador
          </Button>
        )}
      </div>

      <ShareSheet
        open={share === "torneo"}
        onClose={() => setShare(null)}
        title="Compartir el torneo"
        fileName={`torneo-${tournamentName.toLowerCase().replace(/\s+/g, "-")}`}
        render={(format) => (
          <TournamentInfographic
            format={format}
            info={{
              teamName: data.teamName,
              color: data.color,
              tournamentName,
              played: view.matches.length,
              ...rec,
              heat: { rows: heatPlayers.map((id) => name.get(id) ?? ""), cols: heatCols, values: heatValues },
              ranking: view.totals.map((t) => ({ label: name.get(t.playerId) ?? "", value: t.playedSeconds / 60 })),
              topScorer: topScorer && topScorer.goals > 0 ? `${name.get(topScorer.playerId)} (${topScorer.goals})` : null,
              equity: equityText,
            }}
          />
        )}
      />
      {selected && (
        <ShareSheet
          open={share === "jugador"}
          onClose={() => setShare(null)}
          title="Compartir la ficha"
          fileName={`jugador-${(name.get(selected) ?? "").toLowerCase().replace(/\s+/g, "-")}`}
          render={(format) => {
            const t = view.totals.find((x) => x.playerId === selected)!;
            const p = data.players.find((x) => x.id === selected);
            const stints = view.rows.filter((r) => r.player_id === selected).flatMap((r) => r.stints);
            return (
              <PlayerInfographic
                format={format}
                info={{
                  teamName: `${data.teamName} · ${tournamentName}`,
                  color: data.color,
                  name: p?.name ?? "",
                  number: p?.number ?? null,
                  positions: positionsPlayed(stints).map((x) => x.position).join(" · "),
                  totalMinutes: t.playedSeconds / 60,
                  share: pct(t.playedShare),
                  matches: t.matchesPlayed,
                  goals: t.goals,
                  perMatch: perMatch(view.matches, view.rows, selected),
                }}
              />
            );
          }}
        />
      )}
    </div>
  );
}

/** Posición en la que más minutos jugó (para colorear su camiseta). */
function mainPosition(rows: StatsDataset["rows"], playerId: string): Position {
  const top = positionsPlayed(rows.filter((r) => r.player_id === playerId).flatMap((r) => r.stints))[0]?.position;
  return top === "ARQ" || top === "DEF" || top === "MED" || top === "DEL" ? top : "MED";
}

function perMatch(matches: StatsDataset["matches"], rows: StatsDataset["rows"], playerId: string) {
  return matches.map((m, i) => {
    const r = rows.find((x) => x.match_id === m.id && x.player_id === playerId);
    return {
      label: m.opponent ? `vs ${m.opponent}` : `Partido ${i + 1}`,
      value: r ? (r.field_seconds + r.goalkeeper_seconds) / 60 : 0,
    };
  });
}

/** Ficha de jugador (RF-29): minutos por partido, posiciones jugadas y goles. */
function PlayerSheet({
  data,
  matches,
  rows,
  totals,
  playerId,
  onPick,
}: {
  data: StatsDataset;
  matches: StatsDataset["matches"];
  rows: StatsDataset["rows"];
  totals: ReturnType<typeof tournamentTable>;
  playerId: string;
  onPick: (id: string) => void;
}) {
  const t = totals.find((x) => x.playerId === playerId);
  const p = data.players.find((x) => x.id === playerId);
  const positions = positionsPlayed(rows.filter((r) => r.player_id === playerId).flatMap((r) => r.stints));
  return (
    <div className="space-y-3">
      <label className="block">
        <span className="sr-only">Jugador</span>
        <select
          value={playerId}
          onChange={(e) => onPick(e.target.value)}
          className="min-h-11 w-full rounded-xl border border-border bg-surface px-3"
        >
          {totals.map((x) => (
            <option key={x.playerId} value={x.playerId}>
              {data.players.find((pl) => pl.id === x.playerId)?.name}
            </option>
          ))}
        </select>
      </label>
      {t && (
        <Card>
          <p className="text-lg font-bold">
            {p?.number != null && <span className="text-muted">{p.number} · </span>}
            {p?.name}
          </p>
          <div className="mt-2 grid grid-cols-4 gap-2 text-center">
            <Metric value={`${Math.round(t.playedSeconds / 60)}'`} label="minutos" />
            <Metric value={pct(t.playedShare)} label="jugado" />
            <Metric value={String(t.matchesPlayed)} label="partidos" />
            <Metric value={String(t.goals)} label="goles" />
          </div>
          {positions.length > 0 && (
            <p className="mt-3 text-sm text-muted">
              Posiciones: {positions.map((x) => `${x.position} ${Math.round(x.minutes)}'`).join(" · ")}
            </p>
          )}
          <p className="mb-1 mt-3 text-sm font-medium">Minutos por partido</p>
          <Bars items={perMatch(matches, rows, playerId)} />
        </Card>
      )}
    </div>
  );
}

function Tile({ value, label, accent }: { value: string; label: string; accent?: boolean }) {
  return (
    <div className={`rounded-2xl p-3 ${accent ? "bg-accent text-accent-contrast" : "bg-surface"}`}>
      <p className="tabular font-display text-3xl font-extrabold leading-none">{value}</p>
      <p className={`mt-1 text-xs ${accent ? "font-semibold" : "text-muted"}`}>{label}</p>
    </div>
  );
}

function Metric({ value, label }: { value: string; label: string }) {
  return (
    <div>
      <p className="tabular font-display text-2xl font-extrabold">{value}</p>
      <p className="text-xs text-muted">{label}</p>
    </div>
  );
}
