"use client";

import { useState } from "react";
import { Jersey } from "@/components/jersey";
import { Button, Empty, Field, Input, PosChip, POS_LABEL, Sheet } from "@/components/ui";
import { useCurrent, usePlayers } from "@/lib/app/data";
import { addPlayers, updatePlayer } from "@/lib/db/repo";
import type { PlayerRow } from "@/lib/db/types";
import { parseQuickRoster } from "@/lib/roster/parse";
import type { Position } from "@/lib/rotation";

const POSITIONS: Position[] = ["ARQ", "DEF", "MED", "DEL"];

/** Plantel (RF-04..06): lista con chips de posición, alta rápida y edición. */
export function Roster() {
  const { team } = useCurrent();
  const players = usePlayers(team?.id);
  const [adding, setAdding] = useState(false);
  const [editing, setEditing] = useState<PlayerRow | null>(null);
  if (!team || !players) return null;

  const active = players.filter((p) => p.active);
  const inactive = players.filter((p) => !p.active);

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-3xl">Plantel</h1>
        <Button onClick={() => setAdding(true)}>+ Agregar</Button>
      </div>

      {active.length === 0 ? (
        <Empty title="Todavía no hay jugadores">Tocá «Agregar» para cargar el plantel de una.</Empty>
      ) : (
        <PlayerList players={active} onEdit={setEditing} />
      )}

      {inactive.length > 0 && (
        <section>
          <h2 className="mb-2 font-display text-sm font-bold uppercase tracking-widest text-muted">Dados de baja</h2>
          <PlayerList players={inactive} onEdit={setEditing} />
        </section>
      )}

      <Sheet open={adding} onClose={() => setAdding(false)} title="Agregar jugadores">
        <QuickAdd teamId={team.id} onDone={() => setAdding(false)} />
      </Sheet>
      <Sheet open={!!editing} onClose={() => setEditing(null)} title="Editar jugador">
        {editing && <EditPlayer player={editing} onDone={() => setEditing(null)} />}
      </Sheet>
    </div>
  );
}

function PlayerList({ players, onEdit }: { players: PlayerRow[]; onEdit: (p: PlayerRow) => void }) {
  return (
    <ul className="divide-y divide-border overflow-hidden rounded-2xl border border-border bg-surface">
      {players.map((p) => (
        <li key={p.id}>
          <button onClick={() => onEdit(p)} className="flex min-h-14 w-full items-center gap-3 px-3 text-left">
            <Jersey pos={p.primary_position} number={p.shirt_number ?? p.primary_position} size={36} />
            <span className="min-w-0 flex-1">
              <span className="block truncate font-display text-lg font-bold leading-tight">{p.nickname || p.name}</span>
              {p.nickname && <span className="block truncate text-xs text-muted">{p.name}</span>}
            </span>
            <PosChip pos={p.primary_position} />
            {p.secondary_positions.map((s) => (
              <PosChip key={s} pos={s} dim />
            ))}
          </button>
        </li>
      ))}
    </ul>
  );
}

function QuickAdd({ teamId, onDone }: { teamId: string; onDone: () => void }) {
  const [text, setText] = useState("");
  const parsed = parseQuickRoster(text);
  return (
    <div className="space-y-3">
      <Field label="Un jugador por línea" hint='"10 Juan MED", "Nacho DEF MED" o solo el nombre.'>
        <textarea
          value={text}
          onChange={(e) => setText(e.target.value)}
          rows={6}
          autoFocus
          className="w-full rounded-xl border border-border bg-surface p-3 text-base outline-none focus:border-accent"
        />
      </Field>
      <Button
        className="w-full"
        disabled={!parsed.length}
        onClick={async () => {
          await addPlayers(teamId, parsed);
          onDone();
        }}
      >
        Agregar {parsed.length || ""}
      </Button>
    </div>
  );
}

function EditPlayer({ player, onDone }: { player: PlayerRow; onDone: () => void }) {
  const [name, setName] = useState(player.name);
  const [nickname, setNickname] = useState(player.nickname ?? "");
  const [number, setNumber] = useState(player.shirt_number?.toString() ?? "");
  const [primary, setPrimary] = useState<Position>(player.primary_position);
  const [secondary, setSecondary] = useState<Position[]>(player.secondary_positions);

  const save = async (patch: Partial<PlayerRow> = {}) => {
    const n = number.trim() === "" ? null : Math.max(0, Math.min(999, Number(number)));
    await updatePlayer(player, {
      name: name.trim() || player.name,
      nickname: nickname.trim() || null,
      shirt_number: Number.isFinite(n) ? n : null,
      primary_position: primary,
      secondary_positions: secondary.filter((s) => s !== primary),
      ...patch,
    });
    onDone();
  };

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-[1fr_5rem] gap-3">
        <Field label="Nombre">
          <Input value={name} onChange={(e) => setName(e.target.value)} maxLength={80} />
        </Field>
        <Field label="Número">
          <Input value={number} onChange={(e) => setNumber(e.target.value.replace(/\D/g, ""))} inputMode="numeric" maxLength={3} />
        </Field>
      </div>
      <Field label="Apodo (opcional)" hint="Si tiene apodo, es lo que se muestra, también en la vista pública.">
        <Input value={nickname} onChange={(e) => setNickname(e.target.value)} maxLength={40} />
      </Field>

      <div>
        <p className="mb-2 text-sm font-medium">Posición principal</p>
        <div className="grid grid-cols-4 gap-2" role="radiogroup" aria-label="Posición principal">
          {POSITIONS.map((p) => (
            <button
              key={p}
              role="radio"
              aria-checked={p === primary}
              onClick={() => setPrimary(p)}
              className={`min-h-11 rounded-xl border text-sm font-semibold ${p === primary ? "border-foreground bg-foreground text-background" : "border-border"}`}
            >
              {p}
            </button>
          ))}
        </div>
      </div>
      <div>
        <p className="mb-2 text-sm font-medium">También puede jugar de</p>
        <div className="grid grid-cols-4 gap-2">
          {POSITIONS.filter((p) => p !== primary).map((p) => {
            const on = secondary.includes(p);
            return (
              <button
                key={p}
                aria-pressed={on}
                onClick={() => setSecondary(on ? secondary.filter((s) => s !== p) : [...secondary, p])}
                className={`min-h-11 rounded-xl border text-xs font-semibold ${on ? "border-accent bg-accent/15" : "border-border text-muted"}`}
              >
                {on ? "✓ " : ""}
                {POS_LABEL[p]}
              </button>
            );
          })}
        </div>
      </div>

      <Button className="w-full" onClick={() => save()}>
        Guardar
      </Button>
      <Button variant="secondary" className="w-full" onClick={() => save({ active: !player.active })}>
        {player.active ? "Dar de baja (conserva su historial)" : "Volver a dar de alta"}
      </Button>
    </div>
  );
}
