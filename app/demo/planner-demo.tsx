"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { planRotation, type RotationConfig, type RotationPlayer } from "@/lib/rotation";
import { FORMATIONS, Legend, makeSquad, POS_STYLE, Stat, Stepper, type DemoPlayer } from "./shared";

/** Minutos de cada módulo visual de la grilla (RF-12). */
const MODULE_MINUTES = 5;

export function PlannerDemo() {
  const [onField, setOnField] = useState(7);
  const [periods, setPeriods] = useState(2);
  const [periodMinutes, setPeriodMinutes] = useState(25);
  const [windowMinutes, setWindowMinutes] = useState(5);
  const [alpha, setAlpha] = useState(0.3);
  const [squad, setSquad] = useState(() => makeSquad(14));

  const config: RotationConfig = useMemo(
    () => ({
      playersOnField: onField,
      periods: Array.from({ length: periods }, () => ({ minutes: periodMinutes })),
      windowMinutes,
      minStintMinutes: windowMinutes,
      guaranteedMinutes: windowMinutes,
      formation: FORMATIONS[onField],
      equityWeight: alpha,
      goalkeeperRotates: false,
    }),
    [onField, periods, periodMinutes, windowMinutes, alpha],
  );

  const present = squad.filter((p) => p.present);
  const plan = useMemo(() => {
    const players: RotationPlayer[] = squad
      .filter((p) => p.present)
      .map((p) => ({
        id: p.id,
        primary: p.position,
        secondary: [],
        availableFromMin: 0,
        availableUntilMin: 999,
        tournamentRatio: p.ratio,
      }));
    return planRotation({ config, players, goalkeeperSchedule: [{ playerId: "p00", fromMin: 0 }] });
  }, [config, squad]);

  const byId = new Map(squad.map((p) => [p.id, p]));
  const fieldPlayers = present.filter((p) => p.position !== "ARQ");
  const maxMinutes = Math.max(1, ...Object.values(plan.expectedFieldMinutes));
  const fieldMinutes = fieldPlayers.map((p) => plan.expectedFieldMinutes[p.id]);

  const periodBreak = (i: number) =>
    i > 0 && plan.windows[i - 1].periodIndex !== plan.windows[i].periodIndex;
  const moduleOf = (min: number) => Math.floor(min / MODULE_MINUTES + 1e-6);
  const moduleBreak = (i: number) =>
    i > 0 && moduleOf(plan.windows[i].startMin) > moduleOf(plan.windows[i - 1].startMin);
  const colSeparator = (i: number) =>
    periodBreak(i) ? "border-l-2 border-border" : moduleBreak(i) ? "border-l border-border/70" : "";

  const toggle = (id: string, patch: (p: DemoPlayer) => Partial<DemoPlayer>) =>
    setSquad((s) => s.map((p) => (p.id === id ? { ...p, ...patch(p) } : p)));

  return (
    <main className="mx-auto w-full max-w-md px-4 pb-16 pt-5">
      <header className="mb-5 flex items-center justify-between">
        <Link href="/" className="text-sm text-muted">
          ← Inicio
        </Link>
        <h1 className="text-lg font-bold">Planificador</h1>
        <Link href="/demo/en-vivo" className="text-sm text-muted">
          En vivo →
        </Link>
      </header>

      <section className="mb-4 grid grid-cols-2 gap-3 rounded-2xl border border-border bg-surface p-4">
        <Stepper label="En cancha" value={onField} options={[5, 7, 8, 9, 11]} onChange={setOnField} />
        <Stepper
          label="Jugadores"
          value={squad.length - 1}
          options={[6, 8, 10, 12, 14, 16, 18, 20, 22, 24]}
          onChange={(n) => setSquad(makeSquad(n))}
        />
        <Stepper label="Períodos" value={periods} options={[1, 2, 3, 4]} onChange={setPeriods} />
        <Stepper
          label="Min/período"
          value={periodMinutes}
          options={[10, 12, 15, 20, 25, 30, 35, 40, 45]}
          onChange={setPeriodMinutes}
        />
        <Stepper label="Ventana (min)" value={windowMinutes} options={[2, 3, 4, 5, 6, 8, 10]} onChange={setWindowMinutes} />
        <Stepper
          label="Peso torneo α"
          value={alpha}
          options={[0, 0.1, 0.2, 0.3, 0.5, 0.75, 1]}
          onChange={setAlpha}
        />
      </section>

      <section className="mb-4 grid grid-cols-3 gap-3 text-center">
        <Stat label="Mín" value={`${Math.min(...fieldMinutes)}'`} />
        <Stat label="Máx" value={`${Math.max(...fieldMinutes)}'`} />
        <Stat
          label="Diferencia"
          value={`${plan.maxSpread}'`}
          tone={plan.maxSpread <= windowMinutes ? "good" : "warn"}
        />
      </section>

      {plan.issues.length > 0 && (
        <p className="mb-4 rounded-xl bg-pos-del/10 px-3 py-2 text-sm text-pos-del">
          {plan.issues.some((i) => i.type === "NOT_ENOUGH_PLAYERS")
            ? "No hay suficientes jugadores presentes para completar la cancha."
            : "Hay jugadores que no llegan al mínimo garantizado."}
        </p>
      )}

      <section className="mb-2 flex items-center justify-between">
        <h2 className="font-semibold">Plan</h2>
        <Legend />
      </section>
      <div className="overflow-x-auto rounded-2xl border border-border bg-surface">
        <table className="w-full border-collapse text-sm">
          <thead>
            <tr className="text-xs text-muted">
              <th className="sticky left-0 z-10 bg-surface px-2 py-2 text-left font-medium">Jugador</th>
              {plan.windows.map((w) => (
                <th
                  key={w.index}
                  className={`tabular px-px py-2 text-[10px] font-medium ${colSeparator(w.index)}`}
                >
                  {w.startMin}&apos;
                </th>
              ))}
              <th className="px-2 py-2 text-right font-medium">Min</th>
            </tr>
          </thead>
          <tbody>
            {squad.map((p) => {
              const minutes = p.position === "ARQ" ? null : plan.expectedFieldMinutes[p.id];
              return (
                <tr key={p.id} className={`border-t border-border ${p.present ? "" : "opacity-40"}`}>
                  <td className="sticky left-0 z-10 bg-surface px-2 py-1.5">
                    <button
                      onClick={() => toggle(p.id, (x) => ({ present: !x.present }))}
                      className="flex items-center gap-2 text-left"
                      disabled={p.position === "ARQ"}
                      title={p.position === "ARQ" ? "Arquero fijo" : "Tocá para marcar ausente/presente"}
                    >
                      <span className={`size-2.5 shrink-0 rounded-full ${POS_STYLE[p.position]}`} />
                      <span className="max-w-18 truncate">{p.name}</span>
                    </button>
                  </td>
                  {plan.windows.map((w) => {
                    const cell =
                      w.goalkeeperId === p.id
                        ? ("ARQ" as const)
                        : w.field.find((f) => f.playerId === p.id)?.position;
                    const entering = w.subs.some((s) => s.inId === p.id);
                    return (
                      <td
                        key={w.index}
                        className={`px-px py-1.5 ${colSeparator(w.index)}`}
                      >
                        <div
                          className={`h-6 min-w-3.5 rounded-[5px] transition-all duration-300 ${cell ? POS_STYLE[cell] : "bg-border/60"} ${entering ? "ring-2 ring-foreground/60 ring-offset-1 ring-offset-surface" : ""}`}
                          title={cell ? `${w.startMin}'–${w.endMin}' ${cell}` : undefined}
                        />
                      </td>
                    );
                  })}
                  <td className="tabular px-1.5 py-1.5 text-right font-semibold">
                    {minutes === null ? "—" : p.present ? `${minutes}'` : ""}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <section className="mt-6">
        <h2 className="mb-2 font-semibold">Minutos previstos</h2>
        <ul className="space-y-1.5">
          {fieldPlayers
            .map((p) => ({ p, m: plan.expectedFieldMinutes[p.id], t: plan.targetMinutes[p.id] }))
            .sort((a, b) => b.m - a.m)
            .map(({ p, m, t }) => (
              <li key={p.id} className="flex items-center gap-2 text-sm">
                <span className="w-20 truncate">{p.name}</span>
                <div className="relative h-3 flex-1 overflow-hidden rounded-full bg-border/60">
                  <div
                    className={`h-full rounded-full transition-all duration-500 ${POS_STYLE[p.position]}`}
                    style={{ width: `${(m / maxMinutes) * 100}%` }}
                  />
                  <div
                    className="absolute top-0 h-full w-0.5 bg-foreground/50"
                    style={{ left: `${(t / maxMinutes) * 100}%` }}
                    title={`Cuota justa: ${t.toFixed(1)}'`}
                  />
                </div>
                <span className="tabular w-8 text-right">{m}&apos;</span>
                <button
                  onClick={() => toggle(p.id, (x) => ({ ratio: x.ratio === 0.6 ? null : 0.6 }))}
                  className={`rounded-md px-1.5 py-0.5 text-[10px] font-semibold transition ${p.ratio ? "bg-accent text-accent-contrast" : "bg-border/60 text-muted"}`}
                  title="Simula que en el torneo jugó el 60% de su cuota"
                >
                  −40%
                </button>
              </li>
            ))}
        </ul>
        <p className="mt-2 text-xs text-muted">
          La línea marca la cuota justa. «−40%» simula que ese jugador jugó poco en el torneo: con α &gt; 0
          recibe más minutos hoy.
        </p>
      </section>

      <section className="mt-6">
        <h2 className="mb-2 font-semibold">Cambios</h2>
        <ol className="space-y-2">
          {plan.windows
            .filter((w) => w.subs.length > 0)
            .map((w) => (
              <li key={w.index} className="rounded-xl border border-border bg-surface p-3">
                <p className="tabular mb-1 text-xs font-semibold text-muted">
                  {w.startMin}&apos; · {w.periodIndex + 1}º período
                </p>
                <ul className="space-y-0.5 text-sm">
                  {w.subs.map((s) => (
                    <li key={s.inId} className="flex items-center gap-2">
                      <span className="text-pos-del">↓ {s.outId ? byId.get(s.outId)?.name : "—"}</span>
                      <span className="text-muted">·</span>
                      <span className="text-pos-med">↑ {byId.get(s.inId)?.name}</span>
                      <span className={`ml-auto rounded px-1.5 text-[10px] font-bold text-white ${POS_STYLE[s.position]}`}>
                        {s.position}
                      </span>
                    </li>
                  ))}
                </ul>
              </li>
            ))}
        </ol>
      </section>
    </main>
  );
}
