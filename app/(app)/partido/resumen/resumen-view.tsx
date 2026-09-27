"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useMemo, useState } from "react";
import { Gantt } from "@/components/charts";
import { Icon } from "@/components/icons";
import { MatchInfographic, ShareSheet } from "@/components/infographic";
import { Button, Card, PosChip, readableAccent, Sheet } from "@/components/ui";
import { useCurrent } from "@/lib/app/data";
import { formatDate, formatKickoff } from "@/lib/app/format";
import { displayName, useMatchData } from "@/lib/app/match-data";
import { ganttRows, matchEquityText, periodCuts } from "@/lib/app/summaries";
import { logEvents, updateMatch } from "@/lib/db/repo";
import { effectiveEvents } from "@/lib/match/events";
import { matchEndMs, matchPlayerStats } from "@/lib/stats/match";

/** Resumen del partido (§8.7, RF-25, RF-28, RF-36). */
export function MatchSummary() {
  const id = useSearchParams().get("id");
  const router = useRouter();
  const data = useMatchData(id);
  const { team } = useCurrent();
  const [sharing, setSharing] = useState(false);
  const [reopen, setReopen] = useState(false);

  const summary = useMemo(() => {
    if (data.loading) return null;
    const stats = matchPlayerStats(
      data.events,
      new Map(data.squad.map((s) => [s.player.id, s.attendance])),
      data.match!.config.goalkeeperRotates,
    );
    const rows = [...stats.values()].map((s) => ({
      playerId: s.player_id,
      fieldSeconds: s.field_seconds,
      goalkeeperSeconds: s.goalkeeper_seconds,
      stints: s.stints,
      availableSeconds: s.available_seconds,
      goals: s.goals,
    }));
    return { rows, durationMs: matchEndMs(data.events), cuts: periodCuts(rows.flatMap((r) => r.stints)) };
  }, [data]);

  if (data.match === null) return <p className="text-muted">No encontramos este partido.</p>;
  if (data.loading || !summary) return null;
  const m = data.match!;
  const nameOf = (pid: string) => displayName(data.byId.get(pid));
  const gantt = ganttRows(summary.rows, data.byId, displayName);
  const scorers = summary.rows.filter((r) => r.goals > 0).map((r) => `${nameOf(r.playerId)}${r.goals > 1 ? ` (${r.goals})` : ""}`);
  const equity = matchEquityText(summary.rows);
  const table = summary.rows
    .filter((r) => r.availableSeconds > 0 || r.fieldSeconds + r.goalkeeperSeconds > 0)
    .sort((a, b) => b.fieldSeconds + b.goalkeeperSeconds - (a.fieldSeconds + a.goalkeeperSeconds));
  const matchEnd = effectiveEvents(data.events).find((e) => e.type === "match_end");

  return (
    <div className="space-y-4">
      <header>
        <Link href="/partidos" className="text-sm text-muted">
          ← Partidos
        </Link>
        <div className="mt-1 flex items-end justify-between gap-3">
          <div className="min-w-0">
            <h1 className="truncate text-3xl">
              {m.is_home === false ? "@ " : "vs "}
              {m.opponent || "Rival sin nombre"}
            </h1>
            <p className="text-sm text-muted">{formatKickoff(m.kickoff_at)}</p>
          </div>
          <p className="tabular font-display text-5xl font-extrabold leading-none">
            {m.goals_for}–{m.goals_against}
          </p>
        </div>
        {scorers.length > 0 && (
          <p className="mt-1 flex items-center gap-1.5 text-sm">
            <Icon name="ball" size={16} />
            <span className="sr-only">Goles:</span> {scorers.join(", ")}
          </p>
        )}
      </header>

      <Card>
        <p className="mb-2 font-semibold">{equity}</p>
        {gantt.length ? (
          <Gantt rows={gantt} durationMs={summary.durationMs} periodCutsMs={summary.cuts} />
        ) : (
          <p className="text-sm text-muted">No hay minutos registrados.</p>
        )}
        <p className="mt-2 text-xs text-muted">
          <span className="mr-1 inline-block size-2.5 rounded-full bg-accent align-middle" /> campo
          <span className="ml-3 mr-1 inline-block size-2.5 rounded-full bg-pos-arq align-middle" /> arco
        </p>
      </Card>

      <Card className="p-0">
        <table className="w-full text-sm">
          <caption className="sr-only">Minutos por jugador</caption>
          <thead>
            <tr className="text-xs text-muted">
              <th className="px-3 py-2 text-left font-medium">Jugador</th>
              <th className="px-2 py-2 text-right font-medium">Min</th>
              <th className="px-2 py-2 text-right font-medium">% disp.</th>
              <th className="px-3 py-2 text-right font-medium">Goles</th>
            </tr>
          </thead>
          <tbody>
            {table.map((r) => {
              const p = data.byId.get(r.playerId);
              const playedS = r.fieldSeconds + r.goalkeeperSeconds;
              const avail = Math.max(r.availableSeconds, playedS);
              return (
                <tr key={r.playerId} className="border-t border-border">
                  <td className="px-3 py-2">
                    <span className="flex items-center gap-2">
                      {p && <PosChip pos={r.goalkeeperSeconds > 0 ? "ARQ" : p.primary_position} />}
                      <span className="truncate">{nameOf(r.playerId)}</span>
                    </span>
                  </td>
                  <td className="tabular px-2 py-2 text-right font-semibold">{Math.round(playedS / 60)}&apos;</td>
                  <td className="tabular px-2 py-2 text-right text-muted">{avail ? `${Math.round((playedS / avail) * 100)}%` : "—"}</td>
                  <td className="tabular px-3 py-2 text-right">{r.goals || ""}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </Card>

      <div className="flex gap-2">
        <Button className="flex-1" onClick={() => setSharing(true)}>
          Compartir
        </Button>
        <Button variant="secondary" onClick={() => setReopen(true)}>
          Editar
        </Button>
      </div>

      <ShareSheet
        open={sharing}
        onClose={() => setSharing(false)}
        title="Compartir el partido"
        fileName={`partido-${(m.opponent || "rival").toLowerCase().replace(/\s+/g, "-")}`}
        render={(format) => (
          <MatchInfographic
            format={format}
            info={{
              teamName: team?.name ?? "",
              color: readableAccent(team?.color ?? "#00e0c6"),
              opponent: m.opponent || "Rival",
              date: formatDate(m.kickoff_at ?? m.created_at),
              goalsFor: m.goals_for,
              goalsAgainst: m.goals_against,
              scorers,
              rows: gantt,
              durationMs: summary.durationMs,
              cutsMs: summary.cuts,
              equity,
            }}
          />
        )}
      />

      <Sheet open={reopen} onClose={() => setReopen(false)} title="¿Editar el partido?">
        <p className="mb-3 text-sm text-muted">
          El partido ya terminó. Si lo reabrís, podés deshacer o corregir eventos y volver a terminarlo; las estadísticas se
          recalculan.
        </p>
        <Button
          className="w-full"
          onClick={async () => {
            if (matchEnd) await logEvents(m, matchEnd.matchTimeMs, [{ type: "undo", eventId: matchEnd.id }]);
            await updateMatch(m, { status: "live" });
            router.replace(`/partido/vivo?id=${m.id}`);
          }}
        >
          Sí, reabrir
        </Button>
      </Sheet>
    </div>
  );
}
