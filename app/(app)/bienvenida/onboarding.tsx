"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { useState } from "react";
import { ConfigEditor } from "@/components/config-editor";
import { Button, Card, Field, Input, PosChip, TEAM_COLORS } from "@/components/ui";
import { setPref } from "@/lib/app/prefs";
import { currentUserId } from "@/lib/app/session";
import { addPlayers, createTeam, createTournament, DEFAULT_CONFIG } from "@/lib/db/repo";
import { parseQuickRoster } from "@/lib/roster/parse";
import type { RotationConfig } from "@/lib/rotation";

/** Onboarding (§8.2): equipo → plantel (alta rápida) → torneo y configuración. */
export function Onboarding() {
  const router = useRouter();
  const isNew = useSearchParams().get("nuevo") === "1";
  const [step, setStep] = useState(0);
  const [name, setName] = useState("");
  const [color, setColor] = useState(TEAM_COLORS[0]);
  const [roster, setRoster] = useState("");
  const [tournament, setTournament] = useState(`Torneo ${new Date().getFullYear()}`);
  const [config, setConfig] = useState<RotationConfig>(DEFAULT_CONFIG);
  const [saving, setSaving] = useState(false);
  const parsed = parseQuickRoster(roster);

  const finish = async () => {
    setSaving(true);
    const team = await createTeam(await currentUserId(), name, color);
    if (parsed.length) await addPlayers(team.id, parsed);
    const t = await createTournament(team.id, tournament, config);
    setPref("team", team.id);
    setPref(`tournament:${team.id}`, t.id);
    router.replace("/partidos");
  };

  return (
    <div className="space-y-5">
      <div>
        <p className="text-sm font-semibold uppercase tracking-widest text-accent-ink">
          {isNew ? "Nuevo equipo" : "Bienvenida"} · paso {step + 1} de 3
        </p>
        <h1 className="mt-1 text-3xl">
          {["¿Cómo se llama tu equipo?", "Cargá tu plantel", "Armá el torneo"][step]}
        </h1>
      </div>

      {step === 0 && (
        <Card className="space-y-4">
          <Field label="Nombre del equipo">
            <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Los Pibes 2015" autoFocus maxLength={80} />
          </Field>
          <div>
            <p className="mb-2 text-sm font-medium">Color</p>
            <div className="flex flex-wrap gap-2" role="radiogroup" aria-label="Color del equipo">
              {TEAM_COLORS.map((c) => (
                <button
                  key={c}
                  role="radio"
                  aria-checked={c === color}
                  aria-label={c}
                  onClick={() => setColor(c)}
                  className={`size-11 rounded-full border-4 ${c === color ? "border-foreground" : "border-transparent"}`}
                  style={{ background: c }}
                />
              ))}
            </div>
          </div>
          <Button className="w-full" disabled={!name.trim()} onClick={() => setStep(1)}>
            Siguiente
          </Button>
        </Card>
      )}

      {step === 1 && (
        <Card className="space-y-4">
          <Field label="Un jugador por línea" hint='Número (opcional), nombre y posiciones: "10 Juan MED" o "Nacho DEF MED". Sin posición, queda MED.'>
            <textarea
              value={roster}
              onChange={(e) => setRoster(e.target.value)}
              rows={8}
              className="w-full rounded-xl border border-border bg-surface p-3 text-base outline-none focus:border-accent"
              placeholder={"1 Tomi ARQ\n4 Benja DEF\n10 Juan MED\n9 Lucho DEL"}
            />
          </Field>
          {parsed.length > 0 && (
            <ul className="max-h-48 space-y-1 overflow-y-auto text-sm">
              {parsed.map((p, i) => (
                <li key={i} className="flex items-center gap-2">
                  <span className="tabular w-6 text-right text-muted">{p.shirtNumber ?? ""}</span>
                  <span className="flex-1 truncate">{p.name}</span>
                  <PosChip pos={p.primary} />
                  {p.secondary.map((s) => (
                    <PosChip key={s} pos={s} dim />
                  ))}
                </li>
              ))}
            </ul>
          )}
          <div className="flex gap-2">
            <Button variant="secondary" onClick={() => setStep(0)}>
              Atrás
            </Button>
            <Button className="flex-1" onClick={() => setStep(2)}>
              {parsed.length ? `Siguiente (${parsed.length} jugadores)` : "Lo cargo después"}
            </Button>
          </div>
        </Card>
      )}

      {step === 2 && (
        <Card className="space-y-4">
          <Field label="Nombre del torneo">
            <Input value={tournament} onChange={(e) => setTournament(e.target.value)} maxLength={80} />
          </Field>
          <ConfigEditor value={config} onChange={setConfig} />
          <div className="flex gap-2">
            <Button variant="secondary" onClick={() => setStep(1)}>
              Atrás
            </Button>
            <Button className="flex-1" disabled={!tournament.trim() || saving} onClick={finish}>
              {saving ? "Guardando…" : "Listo"}
            </Button>
          </div>
        </Card>
      )}
    </div>
  );
}
