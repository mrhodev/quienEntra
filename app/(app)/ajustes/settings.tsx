"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { useState } from "react";
import { ConfigEditor } from "@/components/config-editor";
import { Button, Card, Field, Input, Segmented, Sheet, TEAM_COLORS } from "@/components/ui";
import { useCurrent } from "@/lib/app/data";
import { getSupabase } from "@/lib/app/session";
import { push, supabaseRemote } from "@/lib/db/sync";
import { usePref } from "@/lib/app/prefs";
import { signOut, useSession } from "@/lib/app/session";
import { applyTheme, type Theme } from "@/lib/app/theme";
import { archiveTeam, createTournament, DEFAULT_CONFIG, setPublicLink, updateTeam, updateTournament } from "@/lib/db/repo";
import type { TeamRow, TournamentRow } from "@/lib/db/types";
import type { RotationConfig } from "@/lib/rotation";

/** Ajustes (§8.9): equipo, torneo y su configuración (RF-08), link público (RF-03), tema y sesión. */
export function Settings() {
  const { team, tournament, selectTournament } = useCurrent();
  const params = useSearchParams();
  const router = useRouter();
  const [newTournament, setNewTournament] = useState(false);
  // "?torneo=nuevo" (desde el selector de torneo) abre la hoja de torneo nuevo.
  const wantsNew = params.get("torneo") === "nuevo";
  const closeNew = () => {
    setNewTournament(false);
    if (wantsNew) router.replace("/ajustes");
  };

  if (!team) return null;
  return (
    <div className="space-y-5">
      <h1 className="text-xl font-bold">Ajustes</h1>
      <TeamSection key={team.id} team={team} />
      <PublicLink team={team} />
      {tournament ? (
        <TournamentSection key={tournament.id} tournament={tournament} onNew={() => setNewTournament(true)} />
      ) : (
        <Button className="w-full" onClick={() => setNewTournament(true)}>
          + Crear torneo
        </Button>
      )}
      <ThemeSection />
      <AccountSection />

      <Sheet open={newTournament || wantsNew} onClose={closeNew} title="Nuevo torneo">
        <NewTournament
          teamId={team.id}
          base={tournament?.default_config ?? DEFAULT_CONFIG}
          onDone={(t) => {
            selectTournament(t.id);
            closeNew();
          }}
        />
      </Sheet>
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section>
      <h2 className="mb-2 text-sm font-semibold text-muted">{title}</h2>
      <Card className="space-y-4">{children}</Card>
    </section>
  );
}

function TeamSection({ team }: { team: TeamRow }) {
  const [name, setName] = useState(team.name);
  const [archive, setArchive] = useState(false);
  return (
    <Section title="Equipo">
      <Field label="Nombre">
        <Input value={name} onChange={(e) => setName(e.target.value)} onBlur={() => name.trim() && name !== team.name && updateTeam(team, { name: name.trim() })} maxLength={80} />
      </Field>
      <div>
        <p className="mb-2 text-sm font-medium">Color (acento de la app e infografías)</p>
        <div className="flex flex-wrap gap-2" role="radiogroup" aria-label="Color del equipo">
          {TEAM_COLORS.map((c) => (
            <button
              key={c}
              role="radio"
              aria-checked={c === team.color}
              aria-label={c}
              onClick={() => updateTeam(team, { color: c })}
              className={`size-11 rounded-full border-4 ${c === team.color ? "border-foreground" : "border-transparent"}`}
              style={{ background: c }}
            />
          ))}
        </div>
      </div>
      <button className="min-h-11 text-sm text-pos-del" onClick={() => setArchive(true)}>
        Archivar equipo
      </button>
      <Sheet open={archive} onClose={() => setArchive(false)} title="¿Archivar el equipo?">
        <p className="mb-3 text-sm text-muted">Deja de aparecer en la app. Sus datos no se borran.</p>
        <Button variant="danger" className="w-full" onClick={() => archiveTeam(team).then(() => setArchive(false))}>
          Archivar
        </Button>
      </Sheet>
    </Section>
  );
}

/** Cambia el link público y lo envía enseguida, para que el cambio rija cuanto antes (CA-07). */
async function changePublicLink(team: TeamRow, enabled: boolean, regenerate = false) {
  await setPublicLink(team, enabled, regenerate);
  // Sin conexión, se envía con la próxima sincronización.
  await push(supabaseRemote(await getSupabase())).catch(() => {});
}

function PublicLink({ team }: { team: TeamRow }) {
  const [copied, setCopied] = useState(false);
  const [confirm, setConfirm] = useState(false);
  const url = team.public_slug && typeof window !== "undefined" ? `${window.location.origin}/p/${team.public_slug}` : "";
  return (
    <Section title="Link público">
      <label className="flex min-h-11 items-center justify-between gap-3">
        <span>
          <span className="block font-medium">Estadísticas públicas</span>
          <span className="block text-xs text-muted">Para jugadores y familias: solo partidos finalizados, sin planes ni convocatorias.</span>
        </span>
        <input type="checkbox" className="size-6 shrink-0" checked={team.is_public} onChange={(e) => changePublicLink(team, e.target.checked)} />
      </label>
      {team.is_public && url && (
        <>
          <p className="break-all rounded-lg bg-background px-3 py-2 font-mono text-xs">{url}</p>
          <div className="flex gap-2">
            <Button
              variant="secondary"
              className="flex-1"
              onClick={async () => {
                if (navigator.share) await navigator.share({ url, title: team.name }).catch(() => {});
                else {
                  await navigator.clipboard.writeText(url);
                  setCopied(true);
                  setTimeout(() => setCopied(false), 1500);
                }
              }}
            >
              {copied ? "¡Copiado!" : "Compartir link"}
            </Button>
            <Button variant="secondary" onClick={() => setConfirm(true)}>
              Regenerar
            </Button>
          </div>
          <p className="text-xs text-muted">El link se activa cuando se sincroniza con el servidor.</p>
        </>
      )}
      <Sheet open={confirm} onClose={() => setConfirm(false)} title="¿Regenerar el link?">
        <p className="mb-3 text-sm text-muted">El link anterior deja de funcionar para todos.</p>
        <Button className="w-full" onClick={() => changePublicLink(team, true, true).then(() => setConfirm(false))}>
          Regenerar
        </Button>
      </Sheet>
    </Section>
  );
}

function TournamentSection({ tournament, onNew }: { tournament: TournamentRow; onNew: () => void }) {
  const [name, setName] = useState(tournament.name);
  const [config, setConfig] = useState<RotationConfig>(tournament.default_config);
  const dirty = JSON.stringify(config) !== JSON.stringify(tournament.default_config);
  return (
    <Section title="Torneo">
      <Field label="Nombre">
        <Input
          value={name}
          onChange={(e) => setName(e.target.value)}
          onBlur={() => name.trim() && name !== tournament.name && updateTournament(tournament, { name: name.trim() })}
          maxLength={80}
        />
      </Field>
      <div className="grid grid-cols-2 gap-3">
        <Field label="Desde">
          <Input type="date" value={tournament.starts_on ?? ""} onChange={(e) => updateTournament(tournament, { starts_on: e.target.value || null })} />
        </Field>
        <Field label="Hasta">
          <Input type="date" value={tournament.ends_on ?? ""} onChange={(e) => updateTournament(tournament, { ends_on: e.target.value || null })} />
        </Field>
      </div>
      <p className="text-sm font-medium">Configuración por defecto de los partidos</p>
      <ConfigEditor value={config} onChange={setConfig} />
      {dirty && (
        <Button className="w-full" onClick={() => updateTournament(tournament, { default_config: config })}>
          Guardar configuración
        </Button>
      )}
      <p className="text-xs text-muted">Los partidos ya creados conservan su configuración.</p>
      <button className="min-h-11 text-sm text-accent" onClick={onNew}>
        + Nuevo torneo
      </button>
    </Section>
  );
}

function NewTournament({ teamId, base, onDone }: { teamId: string; base: RotationConfig; onDone: (t: TournamentRow) => void }) {
  const [name, setName] = useState("");
  const [config, setConfig] = useState(base);
  return (
    <div className="space-y-4">
      <Field label="Nombre">
        <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Apertura 2026" autoFocus maxLength={80} />
      </Field>
      <ConfigEditor value={config} onChange={setConfig} />
      <Button className="w-full" disabled={!name.trim()} onClick={async () => onDone(await createTournament(teamId, name, config))}>
        Crear torneo
      </Button>
    </div>
  );
}

function ThemeSection() {
  const saved = usePref("theme");
  const theme = (saved === "light" || saved === "dark" ? saved : "system") as Theme;
  return (
    <Section title="Tema">
      <Segmented
        label="Tema"
        value={theme}
        onChange={applyTheme}
        options={[
          { value: "system", label: "Automático" },
          { value: "light", label: "Claro" },
          { value: "dark", label: "Oscuro" },
        ]}
      />
      <p className="text-xs text-muted">Al sol, el tema claro se lee mejor.</p>
    </Section>
  );
}

function AccountSection() {
  const { session } = useSession();
  const router = useRouter();
  return (
    <Section title="Cuenta">
      <p className="text-sm">{session?.user.email}</p>
      <Button
        variant="secondary"
        className="w-full"
        onClick={async () => {
          await signOut();
          router.replace("/login");
        }}
      >
        Cerrar sesión
      </Button>
      <p className="text-xs text-muted">Al cerrar sesión se borran los datos guardados en este dispositivo (los que ya se sincronizaron quedan en el servidor).</p>
    </Section>
  );
}
