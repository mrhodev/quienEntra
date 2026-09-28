"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useEffect, useMemo, useRef, useState } from "react";
import { SyncBadge } from "@/components/app-shell";
import { Icon, type IconName } from "@/components/icons";
import { Jersey } from "@/components/jersey";
import { Pitch, PlayerCard } from "@/components/pitch";
import { Button, PosChip, Sheet } from "@/components/ui";
import { notifySuggestion, useNow, useWakeLock } from "@/lib/app/device";
import { displayName, useMatchData } from "@/lib/app/match-data";
import { setPref, usePref } from "@/lib/app/prefs";
import { finalizeMatch } from "@/lib/app/finalize";
import { logEvents, updateMatch } from "@/lib/db/repo";
import type { PlayerRow } from "@/lib/db/types";
import { currentBoundaryMin } from "@/lib/match/boundary";
import { saveSim, SIMULATION_ENABLED, useSim } from "@/lib/app/sim";
import { clockAt, formatClock } from "@/lib/match/clock";
import { jump, SIM_SPEEDS, simNow, withSpeed, type SimClock } from "@/lib/match/sim";
import { minutesByPlayer } from "@/lib/match/derive";
import { effectiveEvents, type MatchEvent, type MatchEventPayload } from "@/lib/match/events";
import { windowSuggestions } from "@/lib/match/live";
import { alternativesIn, alternativesOut, withIn, withOut, type Candidate, type SwapContext } from "@/lib/match/suggestions";
import { toMatchEvent } from "@/lib/match/rows";
import type { FieldPosition, Substitution } from "@/lib/rotation";

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
function elapsedNow(events: MatchEvent[], sim: SimClock | null): number {
  return clockAt(events, virtualNow(sim)).elapsedMs;
}

/** Hora actual: la real, o la virtual del partido en el modo simulación (RF-41). */
function virtualNow(sim: SimClock | null): number {
  return simNow(sim, Date.now());
}

/** Partido en vivo (§8.6, RF-15..25). */
export function LiveMatch() {
  const id = useSearchParams().get("id");
  const router = useRouter();
  const data = useMatchData(id);
  const events = data.loading ? [] : data.events;
  const sim = useSim(SIMULATION_ENABLED ? id : null);
  const realNow = useNow(!data.loading && data.match?.status === "live", sim && sim.speed > 1 ? 250 : 500);
  const now = simNow(sim, realNow);
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
  // Las sugerencias de la ventana se fijan con el estado de su inicio (lib/match/live.ts).
  const live = useMemo(() => {
    if (data.loading) return null;
    return windowSuggestions(
      { config: data.match!.config, squad: data.squad, goalkeeperId: data.goalkeeperId, locks: data.locks, events: data.events },
      boundary,
    );
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
  const due = live && !live.state.ended ? live.subs : [];
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

  const log = (payloads: MatchEventPayload[], atMs = elapsedNow(events, sim)) =>
    logEvents(match, atMs, payloads, virtualNow(sim));
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

  const pendingText = (pid: string) => {
    const pending = Math.round((plan.targetMinutes[pid] ?? 0) - minutesOf(pid));
    return pending > 0 ? `le faltan ${pending}'` : `${Math.round(minutesOf(pid))}' jugados`;
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
        <header className="-mx-4 -mt-4 space-y-2 bg-surface px-4 pb-3 pt-3">
          <div className="flex items-center justify-between text-sm">
            <Link href="/partidos" className="min-h-11 content-center text-muted">
              ‹ Salir
            </Link>
            <span className="rounded-full bg-accent px-3 py-0.5 font-display text-sm font-bold uppercase tracking-widest text-accent-contrast">
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
            <div>
              <p className="tabular font-display text-7xl font-extrabold leading-[0.85]" aria-live="off">
                {formatClock(clock.periodElapsedMs)}
              </p>
              <p className="tabular mt-1 text-xs text-muted">
                Total {formatClock(clock.elapsedMs)}
                {match.opponent ? ` · vs ${match.opponent}` : ""}
              </p>
            </div>
            <p className="tabular font-display text-5xl font-extrabold leading-none">
              {goalsFor}
              <span className="text-muted"> – </span>
              {goalsAgainst}
            </p>
          </div>
          {timeUp && (
            <p className="flex items-center gap-1.5 rounded-lg bg-pos-arq/20 px-2 py-1 text-sm font-semibold text-pos-arq" role="status">
              <Icon name="clock" size={16} /> Se cumplieron los {periodMinutes}&apos; del tiempo
            </p>
          )}
          {!wakeLockOk && (
            <p className="text-xs text-muted">Tu navegador no puede mantener la pantalla encendida: desactivá el bloqueo automático.</p>
          )}
          <div className="flex gap-2">
            {!state.inPeriod && !state.ended && periodIndex + 1 < periodCount && (
              <Button className="flex-1" onClick={() => log([{ type: "period_start", periodIndex: periodIndex + 1 }])}>
                <span className="inline-flex items-center gap-1.5">
                  <Icon name="play" size={18} /> Empezar {periodIndex + 2}º tiempo
                </span>
              </Button>
            )}
            {state.inPeriod && (
              <>
                <Button variant="secondary" className="flex-1" onClick={() => log([{ type: clock.running ? "pause" : "resume" }])}>
                  <span className="inline-flex items-center gap-1.5">
                    <Icon name={clock.running ? "pause" : "play"} size={18} />
                    {clock.running ? "Pausar" : "Reanudar"}
                  </span>
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

        {SIMULATION_ENABLED && !state.ended && (
          <SimulationPanel
            sim={sim}
            running={clock.running}
            onSpeed={(speed) => saveSim(match.id, withSpeed(sim, speed, Date.now()))}
            onJump={(ms) => saveSim(match.id, jump(sim, ms, Date.now()))}
            nextChangeMs={nextSubs ? nextSubs.startMin * MIN - clock.elapsedMs + 1000 : null}
            timeLeftMs={state.inPeriod ? periodMinutes * MIN - clock.periodElapsedMs : null}
          />
        )}

        {/* Sugerencias de cambio (RF-17) */}
          {pairs.length > 0 && (
            <section className="slide-up rounded-2xl border-2 border-accent bg-raised p-3 shadow-lg" aria-live="polite">
              <div className="mb-2 flex items-center justify-between gap-2">
                <h2 className="font-display text-lg font-extrabold uppercase tracking-wide">Cambios sugeridos · {boundary}&apos;</h2>
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
                    <li key={key} className="rounded-xl bg-background/60 p-2">
                      <div className="mb-1.5 flex items-center justify-between">
                        <PosChip pos={sub.position} />
                        {edited && <span className="text-[11px] text-muted">Modificado por el DT</span>}
                      </div>
                      <div className="flex items-stretch gap-1.5">
                        <SubCard
                          kind="out"
                          player={sub.outId ? byId.get(sub.outId) : undefined}
                          pos={sub.position}
                          detail={sub.outId ? `${Math.round(minutesOf(sub.outId))}' jugados` : "falta un jugador"}
                          active={open === "out"}
                          onChange={sub.outId ? () => setPicker(open === "out" ? null : { key, side: "out" }) : undefined}
                        />
                        <span className="self-center text-accent-ink">
                          <Icon name="arrowRight" size={20} />
                        </span>
                        <SubCard
                          kind="in"
                          player={byId.get(sub.inId)}
                          pos={sub.position}
                          detail={pendingText(sub.inId)}
                          active={open === "in"}
                          onChange={() => setPicker(open === "in" ? null : { key, side: "in" })}
                        />
                      </div>
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
        {(manual || manualOut) && (
          <p className="rounded-xl bg-raised px-3 py-2 text-sm font-semibold" role="status">
            {manualOut
              ? `Cambio manual: sale ${displayName(byId.get(manualOut))}. Tocá quién entra en el banco.`
              : "Cambio manual: tocá en la cancha quién sale."}{" "}
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
        <Pitch
          players={onField.map(([pid, pos]) => ({
            id: pid,
            name: displayName(byId.get(pid)),
            number: byId.get(pid)?.shirt_number,
            pos,
            minutes: minutesOf(pid),
            quota: quota(pid),
          }))}
          goalkeeper={
            state.goalkeeperId
              ? {
                  id: state.goalkeeperId,
                  name: displayName(byId.get(state.goalkeeperId)),
                  number: byId.get(state.goalkeeperId)?.shirt_number,
                  minutes: minutesOf(state.goalkeeperId),
                }
              : null
          }
          selectedId={manualOut}
          onPick={(pid) => setManualOut(manualOut === pid ? null : pid)}
        />

        {/* Banco, ordenado por prioridad de entrada */}
        <section aria-label="Banco">
          <h2 className="mb-1 font-display text-sm font-bold uppercase tracking-widest text-muted">Banco · por prioridad</h2>
          <div className="flex flex-wrap gap-1.5">
            {bench.map((s) => (
              <div key={s.player.id} className="rounded-xl bg-surface py-1">
                <PlayerCard
                  id={s.player.id}
                  name={displayName(byId.get(s.player.id))}
                  number={byId.get(s.player.id)?.shirt_number}
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
              </div>
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
        <nav aria-label="Acciones" className="sticky bottom-3 z-10 grid grid-cols-5 gap-1 rounded-2xl border border-border bg-surface/95 p-1.5 shadow-lg backdrop-blur">
          <QuickAction icon="ball" label="Gol" onClick={() => setAction("gol")} />
          <QuickAction
            icon="swap"
            label="Cambio"
            active={manual || !!manualOut}
            onClick={() => {
              setManual(!(manual || manualOut));
              setManualOut(null);
            }}
          />
          <QuickAction icon="glove" label="Arquero" onClick={() => setAction("arquero")} />
          <QuickAction icon="injury" label="Lesión" onClick={() => setAction("lesion")} />
          <QuickAction
            icon="undo"
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

/** Carta de un lado del cambio: SALE o ENTRA, con la camiseta y "Cambiar" (RF-17). */
function SubCard({
  kind,
  player,
  pos,
  detail,
  active,
  onChange,
}: {
  kind: "out" | "in";
  player: PlayerRow | undefined;
  pos: FieldPosition;
  detail: string;
  active: boolean;
  onChange?: () => void;
}) {
  return (
    <div className="flex min-w-0 flex-1 flex-col gap-1.5 rounded-xl bg-surface p-2">
      <div className="flex items-center gap-2">
        <Jersey pos={pos} number={player?.shirt_number ?? pos} size={32} />
        <div className="min-w-0">
          <p className={`font-display text-[11px] font-bold uppercase tracking-widest ${kind === "out" ? "text-pos-del" : "text-pos-med"}`}>
            {kind === "out" ? "Sale" : "Entra"}
          </p>
          <p className="truncate font-semibold leading-tight">{player ? displayName(player) : "Lugar libre"}</p>
          <p className="truncate text-[11px] text-muted">{detail}</p>
        </div>
      </div>
      {onChange && (
        <button
          onClick={onChange}
          className={`min-h-9 rounded-lg font-display text-xs font-bold uppercase tracking-wide ${active ? "bg-foreground text-background" : "bg-raised"}`}
        >
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
  icon: IconName;
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
      className={`flex min-h-14 flex-col items-center justify-center gap-0.5 rounded-xl font-display text-xs font-bold uppercase tracking-wide transition active:scale-95 disabled:opacity-30 ${active ? "bg-accent text-accent-contrast" : ""}`}
    >
      <Icon name={icon} />
      {label}
    </button>
  );
}

/**
 * Modo simulación (RF-41, solo beta): acelera el reloj del partido y permite adelantarlo,
 * para probar el flujo completo sin esperar los minutos reales.
 */
function SimulationPanel({
  sim,
  running,
  onSpeed,
  onJump,
  nextChangeMs,
  timeLeftMs,
}: {
  sim: SimClock | null;
  running: boolean;
  onSpeed: (speed: number) => void;
  onJump: (ms: number) => void;
  nextChangeMs: number | null;
  timeLeftMs: number | null;
}) {
  const speed = sim?.speed ?? 1;
  return (
    <section aria-label="Modo simulación" className="space-y-2 rounded-2xl border-2 border-dashed border-pos-arq bg-surface p-3">
      <div className="flex items-center justify-between">
        <p className="font-display text-sm font-extrabold uppercase tracking-widest text-pos-arq">Simulación · beta</p>
        <p className="text-xs text-muted">{speed > 1 ? `El reloj corre ×${speed}` : "Tiempo real"}</p>
      </div>
      <div role="group" aria-label="Velocidad" className="grid grid-cols-4 gap-1.5">
        {SIM_SPEEDS.map((v) => (
          <button
            key={v}
            onClick={() => onSpeed(v)}
            aria-pressed={v === speed}
            className={`min-h-10 rounded-lg font-display text-sm font-bold ${v === speed ? "bg-pos-arq text-background" : "bg-raised"}`}
          >
            ×{v}
          </button>
        ))}
      </div>
      <div className="grid grid-cols-3 gap-1.5">
        <button disabled={!running} onClick={() => onJump(MIN)} className="min-h-10 rounded-lg bg-raised font-display text-sm font-bold disabled:opacity-30">
          +1&apos;
        </button>
        <button disabled={!running} onClick={() => onJump(5 * MIN)} className="min-h-10 rounded-lg bg-raised font-display text-sm font-bold disabled:opacity-30">
          +5&apos;
        </button>
        {nextChangeMs !== null && (timeLeftMs === null || nextChangeMs < timeLeftMs) ? (
          <button
            disabled={!running}
            onClick={() => onJump(nextChangeMs)}
            className="min-h-10 rounded-lg bg-raised font-display text-sm font-bold disabled:opacity-30"
          >
            Próx. cambio
          </button>
        ) : (
          <button
            disabled={!running || timeLeftMs === null}
            onClick={() => timeLeftMs !== null && onJump(timeLeftMs)}
            className="min-h-10 rounded-lg bg-raised font-display text-sm font-bold disabled:opacity-30"
          >
            Fin del tiempo
          </button>
        )}
      </div>
      {!running && <p className="text-xs text-muted">Adelantar funciona con el tiempo en juego.</p>}
    </section>
  );
}
