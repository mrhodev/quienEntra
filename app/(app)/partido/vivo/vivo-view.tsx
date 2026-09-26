"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useEffect, useMemo, useRef, useState } from "react";
import { SyncBadge } from "@/components/app-shell";
import { Button, PosChip, POS_BG, Sheet } from "@/components/ui";
import { notifySuggestion, useNow, useWakeLock } from "@/lib/app/device";
import { displayName, useMatchData } from "@/lib/app/match-data";
import { setPref, usePref } from "@/lib/app/prefs";
import { finalizeMatch } from "@/lib/app/finalize";
import { logEvents, updateMatch } from "@/lib/db/repo";
import type { PlayerRow } from "@/lib/db/types";
import { currentBoundaryMin } from "@/lib/match/boundary";
import { clockAt, formatClock } from "@/lib/match/clock";
import { minutesByPlayer } from "@/lib/match/derive";
import { effectiveEvents, type MatchEvent, type MatchEventPayload } from "@/lib/match/events";
import { alternativesIn, alternativesOut, dueSubs, withIn, withOut, type Candidate, type SwapContext } from "@/lib/match/suggestions";
import { toMatchEvent } from "@/lib/match/rows";
import { planRotation, type FieldPosition, type Position, type Substitution } from "@/lib/rotation";

const MIN = 60_000;
const ORDER: Record<FieldPosition, number> = { DEF: 0, MED: 1, DEL: 2 };
const MAX_UNDO = 5;

type Action = "gol" | "arquero" | "lesion" | "fin" | null;

/**
 * Anima el cambio de lugar de los jugadores con la View Transitions API (RNF-03), sin librerías.
 * Donde no está disponible, o con movimiento reducido, el cambio es inmediato.
 */
async function withViewTransition(update: () => Promise<unknown>) {
  if (typeof document.startViewTransition !== "function" || matchMedia("(prefers-reduced-motion: reduce)").matches) {
    await update();
    return;
  }
  const t = document.startViewTransition(async () => {
    await update();
    // La base local avisa del cambio y React vuelve a pintar: se espera ese pintado.
    await new Promise((r) => setTimeout(r, 80));
  });
  await t.updateCallbackDone;
}

/** Tiempo efectivo del partido en este instante (para registrar eventos). */
function elapsedNow(events: MatchEvent[]): number {
  return clockAt(events, Date.now()).elapsedMs;
}

/** Partido en vivo (§8.6, RF-15..25). */
export function LiveMatch() {
  const id = useSearchParams().get("id");
  const router = useRouter();
  const data = useMatchData(id);
  const events = data.loading ? [] : data.events;
  const now = useNow(!data.loading && data.match?.status === "live");
  const clock = clockAt(events, now);
  const wakeLockOk = useWakeLock(!data.loading && data.match?.status === "live");
  const sound = usePref("sound") !== "off";

  const [action, setAction] = useState<Action>(null);
  const [manual, setManual] = useState(false);
  const [manualOut, setManualOut] = useState<string | null>(null);
  const [edits, setEdits] = useState<Map<string, Substitution>>(new Map());
  const [hidden, setHidden] = useState<Map<string, number>>(new Map());
  const [picker, setPicker] = useState<{ key: string; side: "in" | "out" } | null>(null);

  const match = data.match;
  const status = match?.status;
  useEffect(() => {
    if (!match) return;
    if (status === "finished") router.replace(`/partido/resumen?id=${match.id}`);
    if (status === "draft" || status === "planned") router.replace(`/partido/previa?id=${match.id}`);
  }, [match, status, router]);

  const elapsedMin = clock.elapsedMs / MIN;
  const config = match?.config;
  const boundary = config ? currentBoundaryMin(config, elapsedMin) : 0;

  // Plan recalculado al inicio de la ventana en curso (ver lib/match/boundary.ts).
  const live = useMemo(() => {
    if (data.loading) return null;
    const { input, state } = data.inputAt(boundary * MIN);
    return { plan: planRotation(input), state };
  }, [data, boundary]);

  // Marcador en el partido (lo que muestra la lista de partidos).
  const goalsFor = live?.state.goalsFor ?? 0;
  const goalsAgainst = live?.state.goalsAgainst ?? 0;
  useEffect(() => {
    if (match && match.status === "live" && (match.goals_for !== goalsFor || match.goals_against !== goalsAgainst)) {
      void updateMatch(match, { goals_for: goalsFor, goals_against: goalsAgainst });
    }
  }, [match, goalsFor, goalsAgainst]);

  // Sugerencias de la ventana: las editadas por el DT reemplazan a las del motor.
  const due = live && !live.state.ended ? dueSubs(live.plan) : [];
  const keyOf = (s: Substitution) => `${boundary}:${s.outId}>${s.inId}`;
  const pairs = due
    .map((s) => ({ key: keyOf(s), sub: edits.get(keyOf(s)) ?? s, original: s }))
    .filter((p) => (hidden.get(p.key) ?? -1) < clock.elapsedMs);

  // Aviso cuando aparece una sugerencia nueva (RF-19, CA-08).
  const shownKeys = pairs.map((p) => p.key).join("|");
  const lastNotified = useRef("");
  useEffect(() => {
    if (shownKeys && shownKeys !== lastNotified.current && clock.running) notifySuggestion(sound);
    lastNotified.current = shownKeys;
  }, [shownKeys, clock.running, sound]);

  if (match === null) return <p className="text-muted">No encontramos este partido.</p>;
  if (data.loading || !live || !match || !config) return null;
  const { plan, state } = live;
  const byId = data.byId;
  const played = minutesByPlayer(state.stints, clock.elapsedMs);
  const minutesOf = (pid: string) => ((played.get(pid)?.fieldMs ?? 0) + (played.get(pid)?.goalkeeperMs ?? 0)) / MIN;
  const periodIndex = state.periodIndex ?? -1;
  const periodCount = config.periods.length;
  const periodMinutes = config.periods[Math.max(0, periodIndex)]?.minutes ?? 0;
  const duration = config.periods.reduce((a, p) => a + p.minutes, 0);
  const timeUp = state.inPeriod && clock.periodElapsedMs >= periodMinutes * MIN;

  const log = (payloads: MatchEventPayload[], atMs = elapsedNow(events)) => logEvents(match, atMs, payloads);
  const reset = () => {
    setEdits(new Map());
    setPicker(null);
  };

  const confirm = async (subs: Substitution[]) => {
    await withViewTransition(() => log(subs.map((s) => ({ type: "sub", outId: s.outId, inId: s.inId, position: s.position }))));
    reset();
  };

  const ctx: SwapContext = {
    players: data.squad.map((s) => s.player),
    onField: state.onField,
    goalkeeperId: state.goalkeeperId,
    unavailable: new Set([
      ...state.injured,
      ...data.squad.filter((s) => s.attendance === "absent" || s.attendance === "injured").map((s) => s.player.id),
    ]),
    played: new Map(data.squad.map((s) => [s.player.id, minutesOf(s.player.id)])),
    targetMinutes: plan.targetMinutes,
  };
  // Los que llegan tarde y todavía no llegaron no se pueden elegir.
  const arrivedLate = new Set(effectiveEvents(events).flatMap((e) => (e.type === "player_available" ? [e.playerId] : [])));
  for (const s of data.squad) if (s.attendance === "late" && !arrivedLate.has(s.player.id)) ctx.unavailable.add(s.player.id);

  const bench = data.squad
    .filter((s) => !state.onField.has(s.player.id) && s.player.id !== state.goalkeeperId && !ctx.unavailable.has(s.player.id))
    .sort((a, b) => (plan.targetMinutes[b.player.id] ?? 0) - minutesOf(b.player.id) - ((plan.targetMinutes[a.player.id] ?? 0) - minutesOf(a.player.id)));
  const out = data.squad.filter((s) => ctx.unavailable.has(s.player.id) && s.attendance !== "absent" && s.attendance !== "injured");

  // Indicador de cuota (RF-16): lo jugado contra lo que le correspondería a esta altura.
  const quota = (pid: string): "ok" | "over" | "under" => {
    const expected = (plan.targetMinutes[pid] ?? 0) * (elapsedMin / Math.max(1, duration));
    const m = minutesOf(pid);
    if (elapsedMin < 1) return "ok";
    if (m > expected + config.windowMinutes / 2) return "over";
    if (m < expected - config.windowMinutes / 2) return "under";
    return "ok";
  };

  const undoable = effectiveEvents(events).filter((e) => e.type !== "lineup_set");
  const trailingUndos = (() => {
    const sorted = [...events].sort((a, b) => a.seq - b.seq || a.wallTime - b.wallTime);
    let n = 0;
    for (let i = sorted.length - 1; i >= 0 && sorted[i].type === "undo"; i--) n++;
    return n;
  })();

  const finish = async () => {
    const rows = await log([{ type: "match_end" }]);
    const all: MatchEvent[] = [...events, ...rows.map(toMatchEvent)];
    await finalizeMatch(match, all, data.squad.map((s) => [s.player.id, s.attendance]), config.goalkeeperRotates);
    router.replace(`/partido/resumen?id=${match.id}`);
  };

  const onField = [...state.onField].sort(([, a], [, b]) => ORDER[a] - ORDER[b]);
  const nextSubs = plan.windows.find((w, i) => i > 0 && w.subs.length > 0);

  return (
    <div className="space-y-3">
        {/* Cronómetro, período, marcador y sincronización */}
        <header className="rounded-2xl border border-border bg-surface p-3">
          <div className="flex items-center justify-between text-sm">
            <Link href="/partidos" className="min-h-11 content-center text-muted">
              ← Salir
            </Link>
            <span className="text-muted">
              {state.ended
                ? "Final"
                : state.inPeriod
                  ? `${periodIndex + 1}º tiempo${clock.running ? "" : " · pausa"}`
                  : periodIndex < 0
                    ? "Por empezar"
                    : "Entretiempo"}
            </span>
            <SyncBadge />
          </div>
          <div className="flex items-end justify-between">
            <p className="tabular text-6xl font-bold leading-none" aria-live="off">
              {formatClock(clock.periodElapsedMs)}
            </p>
            <p className="tabular text-4xl font-bold">
              {goalsFor}
              <span className="text-muted"> – </span>
              {goalsAgainst}
            </p>
          </div>
          <p className="tabular text-xs text-muted">
            Total {formatClock(clock.elapsedMs)} · {match.opponent ? `vs ${match.opponent}` : ""}
          </p>
          {timeUp && (
            <p className="mt-2 rounded-lg bg-pos-arq/15 px-2 py-1 text-sm font-semibold text-pos-arq" role="status">
              ⏱ Se cumplieron los {periodMinutes}&apos; del tiempo
            </p>
          )}
          {!wakeLockOk && (
            <p className="mt-2 text-xs text-muted">Tu navegador no puede mantener la pantalla encendida: desactivá el bloqueo automático.</p>
          )}
          <div className="mt-3 flex gap-2">
            {!state.inPeriod && !state.ended && periodIndex + 1 < periodCount && (
              <Button className="flex-1" onClick={() => log([{ type: "period_start", periodIndex: periodIndex + 1 }])}>
                ▶ Empezar {periodIndex + 2}º tiempo
              </Button>
            )}
            {state.inPeriod && (
              <>
                <Button variant="secondary" className="flex-1" onClick={() => log([{ type: clock.running ? "pause" : "resume" }])}>
                  {clock.running ? "⏸ Pausar" : "▶ Reanudar"}
                </Button>
                {periodIndex + 1 < periodCount ? (
                  <Button variant={timeUp ? "primary" : "secondary"} className="flex-1" onClick={() => log([{ type: "period_end", periodIndex }])}>
                    Terminar tiempo
                  </Button>
                ) : (
                  <Button variant={timeUp ? "primary" : "secondary"} className="flex-1" onClick={() => setAction("fin")}>
                    Terminar partido
                  </Button>
                )}
              </>
            )}
            {!state.inPeriod && periodIndex + 1 >= periodCount && !state.ended && (
              <Button className="flex-1" onClick={() => setAction("fin")}>
                Terminar partido
              </Button>
            )}
          </div>
        </header>

        {/* Sugerencias de cambio (RF-17) */}
          {pairs.length > 0 && (
            <section className="slide-up rounded-2xl border-2 border-accent bg-surface p-3 shadow-lg" aria-live="polite">
              <div className="mb-2 flex items-center justify-between gap-2">
                <h2 className="font-semibold">Cambios sugeridos · {boundary}&apos;</h2>
                {pairs.length > 1 && (
                  <Button className="min-h-9 px-3 text-sm" onClick={() => confirm(pairs.map((p) => p.sub))}>
                    Confirmar todos
                  </Button>
                )}
              </div>
              <ul className="space-y-2">
                {pairs.map(({ key, sub, original }) => {
                  const edited = sub.inId !== original.inId || sub.outId !== original.outId;
                  const others = pairs.map((p) => p.sub);
                  const open = picker?.key === key ? picker.side : null;
                  const candidates = open === "in" ? alternativesIn(sub, others, ctx) : open === "out" ? alternativesOut(sub, others, ctx) : [];
                  return (
                    <li key={key} className="rounded-xl bg-background p-3">
                      <div className="mb-1 flex items-center justify-between">
                        <PosChip pos={sub.position} />
                        {edited && <span className="text-[11px] text-muted">Modificado por el DT</span>}
                      </div>
                      <SubSlot
                        arrow="↓"
                        tone="text-pos-del"
                        name={sub.outId ? displayName(byId.get(sub.outId)) : "Lugar libre"}
                        detail={sub.outId ? `${Math.round(minutesOf(sub.outId))}' jugados` : "falta un jugador en cancha"}
                        active={open === "out"}
                        onChange={sub.outId ? () => setPicker(open === "out" ? null : { key, side: "out" }) : undefined}
                      />
                      <SubSlot
                        arrow="↑"
                        tone="text-pos-med"
                        name={displayName(byId.get(sub.inId))}
                        detail={`${Math.round(minutesOf(sub.inId))}' jugados`}
                        active={open === "in"}
                        onChange={() => setPicker(open === "in" ? null : { key, side: "in" })}
                      />
                      {open && (
                        <CandidateList
                          title={open === "in" ? "¿Quién entra?" : "¿Quién sale?"}
                          candidates={candidates}
                          current={open === "in" ? sub.inId : sub.outId}
                          byId={byId}
                          minutesOf={minutesOf}
                          onPick={(pid) => {
                            setEdits((e) => new Map(e).set(key, open === "in" ? withIn(sub, pid) : withOut(sub, pid, state.onField)));
                            setPicker(null);
                          }}
                        />
                      )}
                      <div className="mt-2 grid grid-cols-[1fr_auto_auto_auto] gap-1.5">
                        <Button className="min-h-11" onClick={() => confirm([sub])}>
                          Confirmar
                        </Button>
                        {[1, 2].map((mins) => (
                          <Button
                            key={mins}
                            variant="secondary"
                            className="min-h-11 px-2.5 text-sm"
                            aria-label={`Posponer ${mins} minuto${mins > 1 ? "s" : ""}`}
                            onClick={() => setHidden((h) => new Map(h).set(key, clock.elapsedMs + mins * MIN))}
                          >
                            +{mins}&apos;
                          </Button>
                        ))}
                        <Button
                          variant="secondary"
                          className="min-h-11 px-2.5 text-sm"
                          aria-label="Descartar"
                          onClick={() => setHidden((h) => new Map(h).set(key, Number.POSITIVE_INFINITY))}
                        >
                          ✕
                        </Button>
                      </div>
                    </li>
                  );
                })}
              </ul>
            </section>
          )}
        {pairs.length === 0 && !state.ended && nextSubs && (
          <p className="rounded-xl border border-border bg-surface px-3 py-2 text-sm text-muted">
            Próximos cambios a los {nextSubs.startMin}&apos; ({nextSubs.subs.length}).
          </p>
        )}

        {/* Cancha (RF-16) */}
        <section aria-label="En cancha" className="rounded-2xl bg-accent/10 p-3">
          {(manual || manualOut) && (
            <p className="mb-2 text-sm font-semibold" role="status">
              {manualOut
                ? `Cambio manual: sale ${displayName(byId.get(manualOut))}. Tocá quién entra en el banco.`
                : "Cambio manual: tocá quién sale."}{" "}
              <button
                className="min-h-11 text-muted underline"
                onClick={() => {
                  setManual(false);
                  setManualOut(null);
                }}
              >
                Cancelar
              </button>
            </p>
          )}
          {(["DEL", "MED", "DEF"] as const).map((pos) => {
            const row = onField.filter(([, p]) => p === pos);
            if (!row.length) return null;
            return (
              <div key={pos} className="mb-2 flex flex-wrap justify-center gap-2">
                {row.map(([pid]) => (
                  <PlayerDot
                    key={pid}
                    player={byId.get(pid)}
                    pos={pos}
                    minutes={minutesOf(pid)}
                    quota={quota(pid)}
                    selected={manualOut === pid}
                    onClick={() => setManualOut(manualOut === pid ? null : pid)}
                  />
                ))}
              </div>
            );
          })}
          {state.goalkeeperId && (
            <div className="flex justify-center">
              <PlayerDot player={byId.get(state.goalkeeperId)} pos="ARQ" minutes={minutesOf(state.goalkeeperId)} quota="ok" />
            </div>
          )}
        </section>

        {/* Banco, ordenado por prioridad de entrada */}
        <section aria-label="Banco">
          <h2 className="mb-1 text-sm font-semibold text-muted">Banco</h2>
          <div className="flex flex-wrap gap-2">
            {bench.map((s) => (
              <PlayerDot
                key={s.player.id}
                player={byId.get(s.player.id)}
                pos={s.player.primary}
                minutes={minutesOf(s.player.id)}
                quota={quota(s.player.id)}
                small
                onClick={
                  manualOut
                    ? async () => {
                        await confirm([{ outId: manualOut, inId: s.player.id, position: state.onField.get(manualOut) ?? "MED" }]);
                        setManualOut(null);
                        setManual(false);
                      }
                    : undefined
                }
              />
            ))}
            {bench.length === 0 && <p className="text-sm text-muted">Nadie en el banco.</p>}
          </div>
          {out.length > 0 && (
            <p className="mt-2 text-xs text-muted">
              No disponibles: {out.map((s) => displayName(byId.get(s.player.id))).join(", ")}
            </p>
          )}
        </section>

        {/* Acciones rápidas */}
        <nav aria-label="Acciones" className="sticky bottom-3 z-10 grid grid-cols-5 gap-1.5 rounded-2xl border border-border bg-surface/95 p-1.5 shadow-lg backdrop-blur">
          <QuickAction icon="⚽" label="Gol" onClick={() => setAction("gol")} />
          <QuickAction
            icon="🔁"
            label="Cambio"
            active={manual || !!manualOut}
            onClick={() => {
              setManual(!(manual || manualOut));
              setManualOut(null);
            }}
          />
          <QuickAction icon="🧤" label="Arquero" onClick={() => setAction("arquero")} />
          <QuickAction icon="🩹" label="Lesión" onClick={() => setAction("lesion")} />
          <QuickAction
            icon="↩︎"
            label="Deshacer"
            disabled={!undoable.length || trailingUndos >= MAX_UNDO}
            onClick={() => {
              const last = undoable[undoable.length - 1];
              if (last) void log([{ type: "undo", eventId: last.id }]);
            }}
          />
        </nav>
        <label className="flex min-h-11 items-center justify-between text-sm text-muted">
          Aviso sonoro si el teléfono no vibra
          <input type="checkbox" className="size-5" checked={sound} onChange={(e) => setPref("sound", e.target.checked ? null : "off")} />
        </label>

        <Sheet open={action === "gol"} onClose={() => setAction(null)} title="Gol">
          <div className="space-y-3">
            <Button variant="secondary" className="w-full" onClick={() => log([{ type: "goal_against" }]).then(() => setAction(null))}>
              En contra
            </Button>
            <p className="text-sm font-medium">A favor: ¿quién lo hizo?</p>
            <ul className="grid grid-cols-2 gap-2">
              {[...(state.goalkeeperId ? [state.goalkeeperId] : []), ...onField.map(([pid]) => pid)].map((pid) => (
                <li key={pid}>
                  <Button variant="secondary" className="w-full truncate" onClick={() => log([{ type: "goal_for", scorerId: pid }]).then(() => setAction(null))}>
                    {displayName(byId.get(pid))}
                  </Button>
                </li>
              ))}
            </ul>
            <Button className="w-full" onClick={() => log([{ type: "goal_for" }]).then(() => setAction(null))}>
              A favor, sin autor
            </Button>
          </div>
        </Sheet>

        <Sheet open={action === "arquero"} onClose={() => setAction(null)} title="Cambiar arquero">
          <p className="mb-2 text-sm text-muted">El arquero actual ocupa el lugar del nuevo. Los minutos atajados cuentan como jugados.</p>
          <PlayerPicker
            ids={data.squad.map((s) => s.player.id).filter((pid) => pid !== state.goalkeeperId && !ctx.unavailable.has(pid))}
            byId={byId}
            onPick={(pid) => log([{ type: "gk_change", toId: pid }]).then(() => setAction(null))}
          />
        </Sheet>

        <Sheet open={action === "lesion"} onClose={() => setAction(null)} title="Lesión y llegadas">
          <p className="mb-2 text-sm font-medium">¿Quién se lesionó? (sale al instante)</p>
          <PlayerPicker
            ids={[...onField.map(([pid]) => pid), ...bench.map((s) => s.player.id)]}
            byId={byId}
            onPick={(pid) => log([{ type: "injury", playerId: pid }]).then(() => setAction(null))}
          />
          {out.length > 0 && (
            <>
              <p className="mb-2 mt-4 text-sm font-medium">Ya puede jugar (llegó o se recuperó)</p>
              <PlayerPicker
                ids={out.map((s) => s.player.id)}
                byId={byId}
                onPick={(pid) => log([{ type: "player_available", playerId: pid }]).then(() => setAction(null))}
              />
            </>
          )}
        </Sheet>

        <Sheet open={action === "fin"} onClose={() => setAction(null)} title="Terminar partido">
          <p className="mb-3 text-sm text-muted">
            Se guardan los minutos de cada jugador y el resultado ({goalsFor} – {goalsAgainst}).
          </p>
          <Button className="w-full" onClick={finish}>
            Terminar y ver el resumen
          </Button>
        </Sheet>
    </div>
  );
}

function PlayerDot({
  player,
  pos,
  minutes,
  quota,
  selected,
  small,
  onClick,
}: {
  player: PlayerRow | undefined;
  pos: Position;
  minutes: number;
  quota: "ok" | "over" | "under";
  selected?: boolean;
  small?: boolean;
  onClick?: () => void;
}) {
  // Estado respecto de la cuota con color e ícono (RNF-09): ✓ en cuota, ▲ se pasa, ▼ le faltan.
  const q = { ok: { ring: "ring-accent", icon: "✓", label: "en cuota" }, over: { ring: "ring-pos-arq", icon: "▲", label: "se está pasando" }, under: { ring: "ring-pos-def", icon: "▼", label: "le faltan minutos" } }[quota];
  return (
    <button
      // Al confirmar un cambio, el jugador "viaja" entre la cancha y el banco (View Transitions).
      style={player ? { viewTransitionName: `p-${player.id}` } : undefined}
      onClick={onClick}
      disabled={!onClick}
      aria-label={`${displayName(player)}, ${Math.round(minutes)} minutos, ${q.label}`}
      className={`flex w-[4.5rem] flex-col items-center gap-0.5 rounded-xl p-1 ${selected ? "bg-foreground/10" : ""}`}
    >
      <span
        className={`relative grid ${small ? "size-10" : "size-12"} place-items-center rounded-full font-bold text-white ring-2 ring-offset-2 ring-offset-background ${POS_BG[pos]} ${q.ring}`}
      >
        {player?.shirt_number ?? pos[0]}
        <span className="absolute -right-1 -top-1 grid size-4 place-items-center rounded-full bg-surface text-[9px] text-foreground shadow" aria-hidden>
          {q.icon}
        </span>
      </span>
      <span className="w-full truncate text-center text-[11px] leading-tight">{displayName(player)}</span>
      <span className="tabular text-[11px] text-muted">{Math.round(minutes)}&apos;</span>
    </button>
  );
}

function SubSlot({
  arrow,
  tone,
  name,
  detail,
  active,
  onChange,
}: {
  arrow: string;
  tone: string;
  name: string;
  detail: string;
  active: boolean;
  onChange?: () => void;
}) {
  return (
    <div className="flex items-center gap-2 py-0.5">
      <span className={`w-4 font-bold ${tone}`} aria-hidden>
        {arrow}
      </span>
      <div className="min-w-0 flex-1">
        <p className="truncate font-medium">{name}</p>
        <p className="text-[11px] text-muted">{detail}</p>
      </div>
      {onChange && (
        <button onClick={onChange} className={`min-h-9 rounded-md px-2 text-xs font-semibold ${active ? "bg-foreground text-background" : "bg-border/60"}`}>
          {active ? "Cerrar" : "Cambiar"}
        </button>
      )}
    </div>
  );
}

function CandidateList({
  title,
  candidates,
  current,
  byId,
  minutesOf,
  onPick,
}: {
  title: string;
  candidates: Candidate[];
  current: string | null;
  byId: Map<string, PlayerRow>;
  minutesOf: (id: string) => number;
  onPick: (id: string) => void;
}) {
  return (
    <div className="mt-2 rounded-lg border border-border p-2">
      <p className="mb-1 text-xs font-semibold text-muted">{title}</p>
      <ul className="max-h-56 space-y-0.5 overflow-y-auto">
        {candidates.map((c) => {
          const p = byId.get(c.playerId);
          return (
            <li key={c.playerId}>
              <button
                onClick={() => onPick(c.playerId)}
                aria-current={c.playerId === current ? "true" : undefined}
                className={`flex min-h-11 w-full items-center gap-2 rounded-md px-2 text-left text-sm ${c.playerId === current ? "bg-accent/15 font-semibold" : ""}`}
              >
                {p && <PosChip pos={p.primary_position} />}
                <span className="flex-1 truncate">{displayName(p)}</span>
                {c.positionCost >= 3 && <span className="text-[10px] text-muted">otra posición</span>}
                <span className="tabular text-xs text-muted">
                  {Math.round(minutesOf(c.playerId))}&apos;
                  {c.pendingMinutes > 0.5 && ` · faltan ${Math.round(c.pendingMinutes)}'`}
                </span>
              </button>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

function PlayerPicker({ ids, byId, onPick }: { ids: string[]; byId: Map<string, PlayerRow>; onPick: (id: string) => void }) {
  return (
    <ul className="grid grid-cols-2 gap-2">
      {ids.map((pid) => {
        const p = byId.get(pid);
        return (
          <li key={pid}>
            <button onClick={() => onPick(pid)} className="flex min-h-12 w-full items-center gap-2 rounded-xl border border-border px-2 text-left text-sm">
              {p && <PosChip pos={p.primary_position} />}
              <span className="truncate">{displayName(p)}</span>
            </button>
          </li>
        );
      })}
    </ul>
  );
}

function QuickAction({
  icon,
  label,
  onClick,
  disabled,
  active,
}: {
  icon: string;
  label: string;
  onClick: () => void;
  disabled?: boolean;
  active?: boolean;
}) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      aria-pressed={active}
      className={`flex min-h-14 flex-col items-center justify-center rounded-xl text-[11px] font-medium transition active:scale-95 disabled:opacity-30 ${active ? "bg-accent text-accent-contrast" : ""}`}
    >
      <span className="text-xl leading-none" aria-hidden>
        {icon}
      </span>
      {label}
    </button>
  );
}
