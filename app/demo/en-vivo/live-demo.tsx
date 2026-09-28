"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { deriveMatch, minutesByPlayer } from "@/lib/match/derive";
import type { MatchEvent, MatchEventPayload } from "@/lib/match/events";
import {
  alternativesIn,
  alternativesOut,
  dueSubs,
  withIn,
  withOut,
  type Candidate,
  type SwapContext,
} from "@/lib/match/suggestions";
import {
  planRotation,
  type FieldPosition,
  type RotationConfig,
  type RotationPlayer,
  type Substitution,
} from "@/lib/rotation";
import { FORMATIONS, makeSquad, POS_STYLE, Stepper } from "../shared";

const MIN = 60_000;
const GK = "p00";
const PERIODS = 2;

type Side = "in" | "out";

export function LiveDemo() {
  const [onFieldN, setOnFieldN] = useState(7);
  const [squadN, setSquadN] = useState(14);
  const [periodMinutes, setPeriodMinutes] = useState(25);
  const [windowMinutes, setWindowMinutes] = useState(5);

  const [events, setEvents] = useState<MatchEvent[]>([]);
  const [nowMin, setNowMin] = useState(0);
  /** Sugerencias editadas por el DT, por índice en la lista de cambios pendientes. */
  const [edits, setEdits] = useState<Map<number, Substitution>>(new Map());
  const [dismissed, setDismissed] = useState<Set<string>>(new Set());
  const [picker, setPicker] = useState<{ index: number; side: Side } | null>(null);

  const squad = useMemo(() => makeSquad(squadN), [squadN]);
  const names = new Map(squad.map((p) => [p.id, p.name]));
  const posOf = new Map(squad.map((p) => [p.id, p.position]));
  const players: RotationPlayer[] = useMemo(
    () =>
      squad.map((p) => ({
        id: p.id,
        primary: p.position,
        secondary: [],
        availableFromMin: 0,
        availableUntilMin: 999,
        tournamentRatio: null,
      })),
    [squad],
  );
  const config: RotationConfig = useMemo(
    () => ({
      playersOnField: onFieldN,
      periods: Array.from({ length: PERIODS }, () => ({ minutes: periodMinutes })),
      windowMinutes,
      minStintMinutes: windowMinutes,
      guaranteedMinutes: windowMinutes,
      formation: FORMATIONS[onFieldN],
      equityWeight: 0.3,
      goalkeeperRotates: false,
    }),
    [onFieldN, periodMinutes, windowMinutes],
  );

  const state = useMemo(() => deriveMatch(events), [events]);
  const started = events.length > 0;
  const nowMs = nowMin * MIN;
  const played = useMemo(() => {
    const byPlayer = minutesByPlayer(state.stints, nowMs);
    return new Map(players.map((p) => [p.id, (byPlayer.get(p.id)?.fieldMs ?? 0) / MIN]));
  }, [state, nowMs, players]);

  const plan = useMemo(() => {
    const base = { config, players, goalkeeperSchedule: [{ playerId: GK, fromMin: 0 }] };
    if (!started) return planRotation(base);
    const onFieldNow = [...state.onField].map(([playerId, position]) => {
      // El stint sigue si está abierto o si lo cerró el fin del período recién terminado.
      const last = state.stints.filter((s) => s.playerId === playerId && s.role === "field").at(-1);
      const continuing = last && (last.endMs === null || last.endMs === nowMs);
      return { playerId, position, sinceMin: continuing ? last.startMs / MIN : nowMin };
    });
    return planRotation({
      ...base,
      nowMin,
      playedSoFar: players.map((p) => ({
        playerId: p.id,
        fieldMinutes: played.get(p.id) ?? 0,
        goalkeeperMinutes: p.id === GK ? nowMin : 0,
      })),
      onFieldNow,
    });
  }, [config, players, started, state, nowMin, nowMs, played]);

  const periodIndex = state.periodIndex ?? 0;
  const periodEnd = (periodIndex + 1) * periodMinutes;
  const due = started && !state.ended ? dueSubs(plan) : [];
  const keyOf = (s: Substitution) => `${nowMin}:${s.outId}>${s.inId}`;
  const pairs = due
    .map((s, i) => ({ index: i, sub: edits.get(i) ?? s, original: s }))
    .filter((p) => !dismissed.has(keyOf(p.original)));
  const nextChange = plan.windows.find((w) => w.startMin > nowMin + 1e-6 && w.subs.length > 0);

  const ctx: SwapContext = {
    players,
    onField: state.onField,
    goalkeeperId: state.goalkeeperId,
    unavailable: state.injured,
    played,
    targetMinutes: plan.targetMinutes,
  };

  const log = (at: number, payloads: MatchEventPayload[]) => {
    setEvents((ev) => [
      ...ev,
      ...payloads.map(
        (p, i) =>
          ({
            id: `e${ev.length + i}`,
            matchId: "demo",
            seq: ev.length + i,
            matchTimeMs: at * MIN,
            wallTime: ev.length + i,
            deviceId: "demo",
            ...p,
          }) as MatchEvent,
      ),
    ]);
    setEdits(new Map());
    setPicker(null);
  };

  const start = () =>
    log(0, [
      { type: "lineup_set", goalkeeperId: GK, field: plan.windows[0].field },
      { type: "period_start", periodIndex: 0 },
    ]);

  const advanceTo = (target: number) => {
    if (!state.inPeriod) return;
    const t = Math.min(target, periodEnd);
    setNowMin(t);
    if (t >= periodEnd) {
      log(t, [
        periodIndex + 1 >= PERIODS ? { type: "match_end" } : { type: "period_end", periodIndex },
      ]);
    } else {
      setEdits(new Map());
      setPicker(null);
    }
  };

  const confirm = (subs: Substitution[]) =>
    log(
      nowMin,
      subs.map((s) => ({ type: "sub", outId: s.outId, inId: s.inId, position: s.position })),
    );

  const reset = () => {
    setEvents([]);
    setNowMin(0);
    setEdits(new Map());
    setDismissed(new Set());
    setPicker(null);
  };

  const choose = (index: number, side: Side, sub: Substitution, playerId: string) => {
    setEdits((m) => new Map(m).set(index, side === "in" ? withIn(sub, playerId) : withOut(sub, playerId, state.onField)));
    setPicker(null);
  };

  const phase = !started
    ? "Previa"
    : state.ended
      ? "Final"
      : state.inPeriod
        ? `${periodIndex + 1}º tiempo`
        : "Entretiempo";

  return (
    <main className="mx-auto w-full max-w-md px-4 pb-16 pt-5">
      <header className="mb-5 flex items-center justify-between">
        <Link href="/demo" className="text-sm text-muted">
          ← Planificador
        </Link>
        <h1 className="text-2xl">En vivo</h1>
        <button onClick={reset} className="text-sm text-muted">
          Reiniciar
        </button>
      </header>

      {!started && (
        <section className="mb-4 rounded-2xl border border-border bg-surface p-4">
          <div className="mb-4 grid grid-cols-2 gap-3">
            <Stepper label="En cancha" value={onFieldN} options={[5, 6, 7, 8, 9, 10, 11]} onChange={setOnFieldN} />
            <Stepper
              label="Jugadores"
              value={squadN}
              options={[6, 8, 10, 12, 14, 16, 18, 20, 22, 24]}
              onChange={setSquadN}
            />
            <Stepper
              label="Min/tiempo"
              value={periodMinutes}
              options={[10, 12, 15, 20, 25, 30, 35, 40, 45]}
              onChange={setPeriodMinutes}
            />
            <Stepper label="Ventana (min)" value={windowMinutes} options={[2, 3, 4, 5, 6, 8, 10]} onChange={setWindowMinutes} />
          </div>
          <button
            onClick={start}
            className="w-full rounded-xl bg-accent py-3 font-semibold text-accent-contrast transition active:scale-[0.98]"
          >
            Arrancar partido
          </button>
        </section>
      )}

      {started && (
        <section className="mb-4 rounded-2xl border border-border bg-surface p-4">
          <div className="mb-3 flex items-baseline justify-between">
            <p className="tabular text-4xl font-bold">{nowMin}&apos;</p>
            <p className="text-sm text-muted">{phase}</p>
          </div>
          <div className="flex flex-wrap gap-2">
            {state.inPeriod && (
              <>
                <ClockButton onClick={() => advanceTo(nowMin + 1)}>+1&apos;</ClockButton>
                <ClockButton onClick={() => advanceTo(nowMin + 5)}>+5&apos;</ClockButton>
                <ClockButton onClick={() => advanceTo(nextChange ? nextChange.startMin : periodEnd)}>
                  {nextChange && nextChange.startMin < periodEnd
                    ? `Ir al cambio (${nextChange.startMin}')`
                    : "Ir al final del tiempo"}
                </ClockButton>
              </>
            )}
            {!state.inPeriod && !state.ended && (
              <ClockButton primary onClick={() => log(nowMin, [{ type: "period_start", periodIndex: periodIndex + 1 }])}>
                Empezar {periodIndex + 2}º tiempo
              </ClockButton>
            )}
          </div>
        </section>
      )}

      {started && !state.ended && (
        <section className="mb-4">
          {pairs.length > 0 ? (
            <div className="rounded-2xl border-2 border-accent bg-surface p-3">
              <div className="mb-2 flex items-center justify-between">
                <h2 className="font-semibold">Cambios sugeridos · {nowMin}&apos;</h2>
                {pairs.length > 1 && (
                  <button
                    onClick={() => confirm(pairs.map((p) => p.sub))}
                    className="rounded-lg bg-accent px-3 py-1.5 text-sm font-semibold text-accent-contrast"
                  >
                    Confirmar todos
                  </button>
                )}
              </div>
              <ul className="space-y-2">
                {pairs.map(({ index, sub, original }) => {
                  const edited = sub.inId !== original.inId || sub.outId !== original.outId;
                  const others = pairs.map((p) => p.sub);
                  const open = picker?.index === index ? picker.side : null;
                  const candidates =
                    open === "in"
                      ? alternativesIn(sub, others, ctx)
                      : open === "out"
                        ? alternativesOut(sub, others, ctx)
                        : [];
                  return (
                    <li key={index} className="rounded-xl bg-background p-3">
                      <div className="mb-2 flex items-center justify-between">
                        <span className={`rounded px-1.5 text-[10px] font-bold text-white ${POS_STYLE[sub.position]}`}>
                          {sub.position}
                        </span>
                        {edited && <span className="text-[11px] text-muted">Modificado por el DT</span>}
                      </div>
                      <PlayerSlot
                        arrow="↓"
                        tone="text-pos-del"
                        label={sub.outId ? names.get(sub.outId)! : "Lugar libre"}
                        detail={sub.outId ? minutesLabel(sub.outId, played, plan.targetMinutes) : ""}
                        active={open === "out"}
                        onChange={sub.outId ? () => setPicker(open === "out" ? null : { index, side: "out" }) : undefined}
                      />
                      <PlayerSlot
                        arrow="↑"
                        tone="text-pos-med"
                        label={names.get(sub.inId)!}
                        detail={minutesLabel(sub.inId, played, plan.targetMinutes)}
                        active={open === "in"}
                        onChange={() => setPicker(open === "in" ? null : { index, side: "in" })}
                      />
                      {open && (
                        <CandidateList
                          candidates={candidates}
                          current={open === "in" ? sub.inId : sub.outId}
                          names={names}
                          posOf={posOf}
                          played={played}
                          title={open === "in" ? "¿Quién entra?" : "¿Quién sale?"}
                          onPick={(id) => choose(index, open, sub, id)}
                        />
                      )}
                      <div className="mt-3 flex gap-2">
                        <button
                          onClick={() => confirm([sub])}
                          className="flex-1 rounded-lg bg-accent py-2 text-sm font-semibold text-accent-contrast"
                        >
                          Confirmar
                        </button>
                        <button
                          onClick={() => setDismissed((d) => new Set(d).add(keyOf(original)))}
                          className="rounded-lg bg-border/60 px-3 py-2 text-sm text-muted"
                        >
                          Descartar
                        </button>
                      </div>
                    </li>
                  );
                })}
              </ul>
            </div>
          ) : (
            <p className="rounded-2xl border border-border bg-surface px-4 py-3 text-sm text-muted">
              Sin cambios pendientes.
              {nextChange && ` Próximo cambio a los ${nextChange.startMin}'.`}
            </p>
          )}
        </section>
      )}

      {started && (
        <section className="grid grid-cols-2 gap-3">
          <div>
            <h2 className="mb-2 text-sm font-semibold">En cancha</h2>
            <ul className="space-y-1">
              {[
                ...(state.goalkeeperId ? [[state.goalkeeperId, "ARQ"] as const] : []),
                ...[...state.onField].sort(([, a], [, b]) => ORDER[a] - ORDER[b]),
              ].map(([id, pos]) => (
                <PlayerRow key={id} name={names.get(id)!} pos={pos} minutes={id === GK ? nowMin : played.get(id) ?? 0} />
              ))}
            </ul>
          </div>
          <div>
            <h2 className="mb-2 text-sm font-semibold">Banco</h2>
            <ul className="space-y-1">
              {players
                .filter((p) => !state.onField.has(p.id) && p.id !== state.goalkeeperId)
                .sort(
                  (a, b) =>
                    (plan.targetMinutes[b.id] ?? 0) -
                    (played.get(b.id) ?? 0) -
                    ((plan.targetMinutes[a.id] ?? 0) - (played.get(a.id) ?? 0)),
                )
                .map((p) => (
                  <PlayerRow key={p.id} name={names.get(p.id)!} pos={p.primary} minutes={played.get(p.id) ?? 0} />
                ))}
            </ul>
          </div>
        </section>
      )}
    </main>
  );
}

const ORDER: Record<FieldPosition, number> = { DEF: 0, MED: 1, DEL: 2 };

function minutesLabel(id: string, played: Map<string, number>, target: Record<string, number>) {
  const m = played.get(id) ?? 0;
  const pending = Math.round((target[id] ?? 0) - m);
  return `${Math.round(m)}' jugados · ${pending > 0 ? `le faltan ${pending}'` : pending < 0 ? `+${-pending}' de su cuota` : "en su cuota"}`;
}

function ClockButton({
  children,
  onClick,
  primary,
}: {
  children: React.ReactNode;
  onClick: () => void;
  primary?: boolean;
}) {
  return (
    <button
      onClick={onClick}
      className={`rounded-lg px-3 py-2 text-sm font-semibold transition active:scale-95 ${primary ? "bg-accent text-accent-contrast" : "bg-background"}`}
    >
      {children}
    </button>
  );
}

function PlayerSlot({
  arrow,
  tone,
  label,
  detail,
  active,
  onChange,
}: {
  arrow: string;
  tone: string;
  label: string;
  detail: string;
  active: boolean;
  onChange?: () => void;
}) {
  return (
    <div className="flex items-center gap-2 py-1">
      <span className={`w-4 font-bold ${tone}`}>{arrow}</span>
      <div className="min-w-0 flex-1">
        <p className="truncate font-medium">{label}</p>
        {detail && <p className="text-[11px] text-muted">{detail}</p>}
      </div>
      {onChange && (
        <button
          onClick={onChange}
          className={`rounded-md px-2 py-1 text-xs font-semibold ${active ? "bg-foreground text-background" : "bg-border/60"}`}
        >
          {active ? "Cerrar" : "Cambiar"}
        </button>
      )}
    </div>
  );
}

function CandidateList({
  candidates,
  current,
  names,
  posOf,
  played,
  title,
  onPick,
}: {
  candidates: Candidate[];
  current: string | null;
  names: Map<string, string>;
  posOf: Map<string, keyof typeof POS_STYLE>;
  played: Map<string, number>;
  title: string;
  onPick: (id: string) => void;
}) {
  return (
    <div className="mt-2 rounded-lg border border-border p-2">
      <p className="mb-1 text-xs font-semibold text-muted">{title}</p>
      <ul className="max-h-56 space-y-0.5 overflow-y-auto">
        {candidates.map((c) => (
          <li key={c.playerId}>
            <button
              onClick={() => onPick(c.playerId)}
              className={`flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm ${c.playerId === current ? "bg-accent/15 font-semibold" : ""}`}
            >
              <span className={`size-2.5 shrink-0 rounded-full ${POS_STYLE[posOf.get(c.playerId)!]}`} />
              <span className="flex-1 truncate">{names.get(c.playerId)}</span>
              {c.positionCost >= 3 && <span className="text-[10px] text-muted">otra posición</span>}
              <span className="tabular text-xs text-muted">
                {Math.round(played.get(c.playerId) ?? 0)}&apos;
                {c.pendingMinutes > 0.5 && ` · faltan ${Math.round(c.pendingMinutes)}'`}
              </span>
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}

function PlayerRow({ name, pos, minutes }: { name: string; pos: keyof typeof POS_STYLE; minutes: number }) {
  return (
    <li className="flex items-center gap-2 text-sm">
      <span className={`size-2.5 shrink-0 rounded-full ${POS_STYLE[pos]}`} />
      <span className="flex-1 truncate">{name}</span>
      <span className="tabular text-xs text-muted">{Math.round(minutes)}&apos;</span>
    </li>
  );
}
