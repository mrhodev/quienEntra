"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import { ConfigEditor } from "@/components/config-editor";
import { cycleLock, PlanGrid } from "@/components/plan-grid";
import { Button, Card, PosChip, Segmented, Sheet, Stepper } from "@/components/ui";
import { formatKickoff } from "@/lib/app/format";
import { displayName, useMatchData } from "@/lib/app/match-data";
import { deleteMatch, ensureMatchPlayers, logEvents, savePlan, setAttendance, snapshotPlan, updateMatch } from "@/lib/db/repo";
import type { Attendance, MatchPlayerRow } from "@/lib/db/types";
import { planRotation, type RotationConfig } from "@/lib/rotation";

const ATTENDANCE: Record<Attendance, { label: string; icon: string; tone: string }> = {
  present: { label: "Presente", icon: "✓", tone: "bg-accent/15 text-accent" },
  absent: { label: "Ausente", icon: "✕", tone: "bg-border/60 text-muted" },
  injured: { label: "Lesionado", icon: "✚", tone: "bg-pos-del/15 text-pos-del" },
  late: { label: "Llega tarde", icon: "⏱", tone: "bg-pos-arq/15 text-pos-arq" },
};
const NEXT: Record<Attendance, Attendance> = { present: "absent", absent: "injured", injured: "late", late: "present" };

type Step = "asistencia" | "arquero" | "plan";

/** Previa del partido (§8.5, RF-09..14, RF-38). */
export function Pregame() {
  const id = useSearchParams().get("id");
  const router = useRouter();
  const data = useMatchData(id);
  const [step, setStep] = useState<Step>("asistencia");
  const [config, setConfig] = useState(false);
  const [late, setLate] = useState<MatchPlayerRow | null>(null);
  const [starting, setStarting] = useState(false);

  // Jugadores dados de alta después de crear el partido entran a la convocatoria.
  const match = data.match;
  const players = data.loading ? undefined : data.players;
  useEffect(() => {
    if (match && players && (match.status === "draft" || match.status === "planned")) void ensureMatchPlayers(match, players);
  }, [match, players]);

  const plan = useMemo(() => (data.loading ? null : planRotation(data.inputAt(0).input)), [data]);

  // Si el partido ya empezó o terminó, esta no es su pantalla.
  const status = match?.status;
  useEffect(() => {
    if (!match) return;
    if (status === "live") router.replace(`/partido/vivo?id=${match.id}`);
    if (status === "finished") router.replace(`/partido/resumen?id=${match.id}`);
  }, [match, status, router]);

  if (match === null) return <p className="text-muted">No encontramos este partido.</p>;
  if (data.loading || !plan) return null;
  const m = data.match!;

  const present = data.squad.filter((s) => s.attendance === "present" || s.attendance === "late");
  const floorIssues = plan.issues.filter((i) => i.type === "FLOOR_UNREACHABLE");
  const notEnough = plan.issues.some((i) => i.type === "NOT_ENOUGH_PLAYERS");
  const gk = data.goalkeeperId;

  const save = async (patch: Parameters<typeof savePlan>[2]) => {
    await savePlan(m, data.planRow ?? undefined, { goalkeeperId: gk, ...patch });
    if (m.status === "draft") await updateMatch(m, { status: "planned" });
  };

  const start = async () => {
    setStarting(true);
    await save({});
    const row = data.planRow;
    if (row) await snapshotPlan(row);
    await logEvents(m, 0, [{ type: "lineup_set", goalkeeperId: gk ?? "", field: plan.windows[0].field }]);
    await updateMatch(m, { status: "live" });
    router.push(`/partido/vivo?id=${m.id}`);
  };

  return (
    <div className="space-y-4">
      <header className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <Link href="/partidos" className="text-sm text-muted">
            ← Partidos
          </Link>
          <h1 className="truncate text-xl font-bold">
            {m.is_home === false ? "@ " : "vs "}
            {m.opponent || "Rival sin nombre"}
          </h1>
          <p className="text-sm text-muted">{formatKickoff(m.kickoff_at)}</p>
        </div>
        <Button variant="secondary" className="shrink-0 text-sm" onClick={() => setConfig(true)}>
          Configuración
        </Button>
      </header>

      <Segmented
        label="Pasos de la previa"
        value={step}
        onChange={setStep}
        options={[
          { value: "asistencia", label: `1. Asistencia (${present.length})` },
          { value: "arquero", label: "2. Arquero" },
          { value: "plan", label: "3. Plan" },
        ]}
      />

      {step === "asistencia" && (
        <section className="space-y-2">
          <p className="text-sm text-muted">Tocá para cambiar: presente → ausente → lesionado → llega tarde.</p>
          <ul className="divide-y divide-border overflow-hidden rounded-2xl border border-border bg-surface">
            {data.squad.map((s) => {
              const mp = data.matchPlayers.find((r) => r.player_id === s.player.id)!;
              const a = ATTENDANCE[mp.attendance];
              return (
                <li key={s.player.id} className="flex min-h-14 items-center gap-3 px-3">
                  <PosChip pos={s.player.primary} />
                  <span className="min-w-0 flex-1 truncate">{displayName(data.byId.get(s.player.id))}</span>
                  {mp.attendance === "late" && (
                    <button onClick={() => setLate(mp)} className="tabular min-h-11 px-1 text-sm text-pos-arq underline">
                      desde el {Number(mp.available_from_min)}&apos;
                    </button>
                  )}
                  <button
                    onClick={async () => {
                      const next = NEXT[mp.attendance];
                      await setAttendance(mp, next, next === "late" ? 10 : 0);
                      if (next === "late") setLate({ ...mp, attendance: "late", available_from_min: 10 });
                    }}
                    className={`min-h-11 min-w-28 rounded-xl px-2 text-sm font-semibold ${a.tone}`}
                  >
                    <span aria-hidden>{a.icon} </span>
                    {a.label}
                  </button>
                </li>
              );
            })}
          </ul>
          <Button className="w-full" onClick={() => setStep("arquero")}>
            Siguiente
          </Button>
        </section>
      )}

      {step === "arquero" && (
        <section className="space-y-3">
          <Card>
            <p className="mb-2 text-sm font-medium">Arquero titular</p>
            <ul className="space-y-1">
              {present
                .slice()
                .sort((a, b) => Number(b.player.primary === "ARQ") - Number(a.player.primary === "ARQ"))
                .map((s) => (
                  <li key={s.player.id}>
                    <button
                      onClick={() => save({ goalkeeperId: s.player.id })}
                      aria-pressed={s.player.id === gk}
                      className={`flex min-h-12 w-full items-center gap-3 rounded-xl px-3 text-left ${s.player.id === gk ? "bg-pos-arq/15 font-semibold" : ""}`}
                    >
                      <PosChip pos={s.player.primary} />
                      <span className="flex-1">{displayName(data.byId.get(s.player.id))}</span>
                      {s.player.id === gk && <span className="text-sm text-pos-arq">🧤 Arquero</span>}
                    </button>
                  </li>
                ))}
            </ul>
          </Card>
          <Card>
            <p className="mb-2 text-sm font-medium">Titulares propuestos</p>
            <ul className="grid grid-cols-2 gap-2 text-sm">
              {plan.windows[0]?.field
                .slice()
                .sort((a, b) => "DEFMEDDEL".indexOf(a.position) - "DEFMEDDEL".indexOf(b.position))
                .map((f) => (
                  <li key={f.playerId} className="flex items-center gap-2">
                    <PosChip pos={f.position} />
                    <span className="truncate">{displayName(data.byId.get(f.playerId))}</span>
                  </li>
                ))}
            </ul>
            <p className="mt-2 text-xs text-muted">Los elige el motor; para cambiarlos, fijá celdas en el plan.</p>
          </Card>
          <Button className="w-full" onClick={() => setStep("plan")}>
            Ver el plan
          </Button>
        </section>
      )}

      {step === "plan" && (
        <section className="space-y-3">
          <p className="text-sm text-muted">Tocá una celda para fijar al jugador en cancha (●) o en el banco (✕); el resto se recalcula.</p>
          <PlanGrid
            plan={plan}
            locks={data.locks}
            goalkeeperId={gk}
            rows={data.squad.map((s) => ({
              id: s.player.id,
              name: displayName(data.byId.get(s.player.id)),
              position: s.player.primary,
              dim: s.attendance === "absent" || s.attendance === "injured",
            }))}
            onCell={(pid, w) => save({ locks: cycleLock(data.locks, pid, w) })}
          />
          <EquityBar plan={plan} names={(pid) => displayName(data.byId.get(pid))} goalkeeperId={gk} />
        </section>
      )}

      {(floorIssues.length > 0 || notEnough || !gk) && (
        <div role="alert" className="space-y-1 rounded-xl bg-pos-del/10 px-3 py-2 text-sm text-pos-del">
          {!gk && <p>Elegí un arquero titular.</p>}
          {notEnough && <p>No hay suficientes presentes para completar la cancha.</p>}
          {floorIssues.map((i) => (
            <p key={i.type === "FLOOR_UNREACHABLE" ? i.playerId : ""}>
              {displayName(data.byId.get(i.type === "FLOOR_UNREACHABLE" ? i.playerId : ""))} no llega al mínimo garantizado:
              sacá algún bloqueo en el banco (RF-38).
            </p>
          ))}
        </div>
      )}

      <div className="sticky bottom-20 z-10 flex gap-2">
        <Button className="flex-1 shadow-lg" disabled={!gk || floorIssues.length > 0 || notEnough || starting} onClick={start}>
          {starting ? "Arrancando…" : "Empezar partido"}
        </Button>
      </div>

      <Sheet open={config} onClose={() => setConfig(false)} title="Configuración del partido">
        <MatchConfig
          value={m.config}
          onSave={async (c) => {
            await updateMatch(m, { config: c });
            // Los bloqueos dependen de las ventanas: si cambia la configuración, se descartan.
            if (data.locks.length) await save({ locks: [] });
            setConfig(false);
          }}
          onDelete={async () => {
            await deleteMatch(m);
            router.replace("/partidos");
          }}
        />
      </Sheet>

      <Sheet open={!!late} onClose={() => setLate(null)} title="¿Desde qué minuto llega?">
        {late && (
          <LateArrival
            row={late}
            maxMin={m.config.periods.reduce((a, p) => a + p.minutes, 0)}
            onDone={async (min) => {
              await setAttendance(late, "late", min);
              setLate(null);
            }}
          />
        )}
      </Sheet>
    </div>
  );
}

function EquityBar({
  plan,
  names,
  goalkeeperId,
}: {
  plan: ReturnType<typeof planRotation>;
  names: (id: string) => string;
  goalkeeperId: string | null;
}) {
  const rows = Object.entries(plan.expectedFieldMinutes)
    .filter(([id, m]) => id !== goalkeeperId && (m > 0 || (plan.targetMinutes[id] ?? 0) > 0))
    .sort((a, b) => b[1] - a[1]);
  const max = Math.max(1, ...rows.map(([, m]) => m), ...rows.map(([id]) => plan.targetMinutes[id] ?? 0));
  const mins = rows.map(([, m]) => m);
  return (
    <Card>
      <div className="mb-2 flex items-baseline justify-between">
        <p className="text-sm font-medium">Minutos previstos (RF-14)</p>
        <p className="text-xs text-muted">
          {mins.length ? `entre ${Math.round(Math.min(...mins))}' y ${Math.round(Math.max(...mins))}'` : ""}
        </p>
      </div>
      <ul className="space-y-1.5">
        {rows.map(([id, m]) => (
          <li key={id} className="flex items-center gap-2 text-sm">
            <span className="w-20 truncate">{names(id)}</span>
            <div className="relative h-3 flex-1 overflow-hidden rounded-full bg-border/60">
              <div className="h-full rounded-full bg-accent transition-all duration-500" style={{ width: `${(m / max) * 100}%` }} />
              <div
                className="absolute top-0 h-full w-0.5 bg-foreground/50"
                style={{ left: `${((plan.targetMinutes[id] ?? 0) / max) * 100}%` }}
                title="Cuota justa"
              />
            </div>
            <span className="tabular w-8 text-right">{Math.round(m)}&apos;</span>
          </li>
        ))}
      </ul>
      <p className="mt-2 text-xs text-muted">La línea marca la cuota justa de cada uno.</p>
    </Card>
  );
}

function MatchConfig({
  value,
  onSave,
  onDelete,
}: {
  value: RotationConfig;
  onSave: (c: RotationConfig) => void;
  onDelete: () => void;
}) {
  const [c, setC] = useState(value);
  return (
    <div className="space-y-4">
      <ConfigEditor value={c} onChange={setC} />
      <Button className="w-full" onClick={() => onSave(c)}>
        Guardar
      </Button>
      <Button variant="ghost" className="w-full text-pos-del" onClick={onDelete}>
        Borrar partido
      </Button>
    </div>
  );
}

function LateArrival({ row, maxMin, onDone }: { row: MatchPlayerRow; maxMin: number; onDone: (min: number) => void }) {
  const [min, setMin] = useState(Number(row.available_from_min) || 10);
  const options = Array.from({ length: Math.floor(maxMin / 5) }, (_, i) => (i + 1) * 5).filter((v) => v < maxMin);
  return (
    <div className="space-y-4">
      <Stepper label="Minuto estimado de llegada" value={min} options={options.length ? options : [5]} onChange={setMin} format={(v) => `${v}'`} />
      <p className="text-xs text-muted">En el partido lo marcás como disponible cuando llegue, y su cuota se recalcula (CA-06).</p>
      <Button className="w-full" onClick={() => onDone(min)}>
        Listo
      </Button>
    </div>
  );
}
