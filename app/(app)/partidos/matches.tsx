"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { Button, Empty, Field, Input, Segmented, Sheet } from "@/components/ui";
import { useCurrent, useMatches, usePlayers } from "@/lib/app/data";
import { formatKickoff, fromLocalInput, toLocalInput } from "@/lib/app/format";
import { createMatch } from "@/lib/db/repo";
import type { MatchRow, MatchStatus, TournamentRow } from "@/lib/db/types";

const STATUS: Record<MatchStatus, { label: string; tone: string }> = {
  draft: { label: "Borrador", tone: "bg-border/60 text-muted" },
  planned: { label: "Planificado", tone: "bg-pos-def/15 text-pos-def" },
  live: { label: "● En juego", tone: "bg-pos-del/15 text-pos-del" },
  finished: { label: "Final", tone: "bg-accent/15 text-accent" },
};

export function matchHref(m: MatchRow): string {
  const page = m.status === "live" ? "vivo" : m.status === "finished" ? "resumen" : "previa";
  return `/partido/${page}?id=${m.id}`;
}

/** Partidos del torneo (§8.4): tarjetas con estado y botón "Nuevo partido". */
export function Matches() {
  const { team, tournament } = useCurrent();
  const matches = useMatches(tournament?.id);
  const [creating, setCreating] = useState(false);

  if (!team) return null;
  if (!tournament)
    return (
      <Empty title="No hay torneos">
        <Link href="/ajustes?torneo=nuevo" className="text-accent">
          Crear un torneo
        </Link>
      </Empty>
    );

  const upcoming = (matches ?? []).filter((m) => m.status !== "finished");
  const played = (matches ?? []).filter((m) => m.status === "finished").reverse();

  return (
    <div className="space-y-4">
      <h1 className="text-xl font-bold">Partidos</h1>

      {matches && matches.length === 0 && <Empty title="Todavía no hay partidos">Creá el primero con el botón de abajo.</Empty>}

      {upcoming.length > 0 && <MatchList matches={upcoming} />}
      {played.length > 0 && (
        <section>
          <h2 className="mb-2 text-sm font-semibold text-muted">Jugados</h2>
          <MatchList matches={played} />
        </section>
      )}

      <button
        onClick={() => setCreating(true)}
        className="fixed bottom-20 right-4 z-10 min-h-14 rounded-full bg-accent px-5 font-semibold text-accent-contrast shadow-lg transition active:scale-95 sm:right-[calc(50%-14rem)]"
      >
        + Nuevo partido
      </button>

      <Sheet open={creating} onClose={() => setCreating(false)} title="Nuevo partido">
        <NewMatch tournament={tournament} onDone={() => setCreating(false)} />
      </Sheet>
    </div>
  );
}

function MatchList({ matches }: { matches: MatchRow[] }) {
  return (
    <ul className="space-y-2">
      {matches.map((m) => (
        <li key={m.id}>
          <Link href={matchHref(m)} className="block rounded-2xl border border-border bg-surface p-4 transition active:scale-[0.99]">
            <div className="flex items-center justify-between gap-2">
              <p className="truncate font-semibold">
                {m.is_home === false ? "@ " : "vs "}
                {m.opponent || "Rival sin nombre"}
              </p>
              <span className={`shrink-0 rounded-full px-2 py-0.5 text-xs font-semibold ${STATUS[m.status].tone}`}>
                {STATUS[m.status].label}
              </span>
            </div>
            <div className="mt-1 flex items-center justify-between text-sm text-muted">
              <span>{formatKickoff(m.kickoff_at)}</span>
              {(m.status === "live" || m.status === "finished") && (
                <span className="tabular text-base font-bold text-foreground">
                  {m.goals_for} – {m.goals_against}
                </span>
              )}
            </div>
          </Link>
        </li>
      ))}
    </ul>
  );
}

function NewMatch({ tournament, onDone }: { tournament: TournamentRow; onDone: () => void }) {
  const router = useRouter();
  const players = usePlayers(tournament.team_id);
  const [opponent, setOpponent] = useState("");
  const [kickoff, setKickoff] = useState(toLocalInput(null));
  const [side, setSide] = useState<"home" | "away">("home");
  return (
    <form
      className="space-y-4"
      onSubmit={async (e) => {
        e.preventDefault();
        const m = await createMatch(tournament, players ?? [], {
          opponent: opponent.trim() || null,
          kickoff_at: fromLocalInput(kickoff),
          is_home: side === "home",
        });
        onDone();
        router.push(`/partido/previa?id=${m.id}`);
      }}
    >
      <Field label="Rival">
        <Input value={opponent} onChange={(e) => setOpponent(e.target.value)} placeholder="Club Atlético…" maxLength={80} />
      </Field>
      <Field label="Fecha y hora">
        <Input type="datetime-local" value={kickoff} onChange={(e) => setKickoff(e.target.value)} />
      </Field>
      <Segmented
        label="Condición"
        value={side}
        onChange={setSide}
        options={[
          { value: "home", label: "Local" },
          { value: "away", label: "Visitante" },
        ]}
      />
      <p className="text-xs text-muted">Usa la configuración del torneo; la podés cambiar en la previa.</p>
      <Button type="submit" className="w-full">
        Crear y armar la previa
      </Button>
    </form>
  );
}
