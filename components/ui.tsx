"use client";

import { useEffect, useRef, type ButtonHTMLAttributes, type InputHTMLAttributes, type ReactNode } from "react";
import type { Position } from "@/lib/rotation";

type Variant = "primary" | "secondary" | "ghost" | "danger";

const VARIANT: Record<Variant, string> = {
  primary: "bg-accent text-accent-contrast font-display text-lg font-extrabold uppercase tracking-wide",
  secondary: "bg-raised border border-border",
  ghost: "text-muted",
  danger: "bg-pos-del text-background font-display text-lg font-extrabold uppercase tracking-wide",
};

/** Botón con objetivo táctil de al menos 44 px (RNF-01). */
export function Button({
  variant = "primary",
  className = "",
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: Variant }) {
  return (
    <button
      {...props}
      className={`min-h-11 rounded-xl px-4 font-semibold transition active:scale-[0.98] disabled:opacity-40 ${VARIANT[variant]} ${className}`}
    />
  );
}

export function Field({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children: ReactNode;
}) {
  return (
    <label className="block">
      <span className="mb-1 block text-sm font-medium">{label}</span>
      {children}
      {hint && <span className="mt-1 block text-xs text-muted">{hint}</span>}
    </label>
  );
}

export function Input(props: InputHTMLAttributes<HTMLInputElement>) {
  return (
    <input
      {...props}
      className={`min-h-11 w-full rounded-xl border border-border bg-surface px-3 text-base outline-none focus:border-accent ${props.className ?? ""}`}
    />
  );
}

export function Card({ children, className = "" }: { children: ReactNode; className?: string }) {
  return <div className={`rounded-2xl border border-border bg-surface p-4 ${className}`}>{children}</div>;
}

/**
 * Hoja modal que sube desde abajo. Usa `<dialog>`: foco, Escape y fondo inerte los da el navegador.
 */
export function Sheet({
  open,
  onClose,
  title,
  children,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  children: ReactNode;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const d = ref.current;
    if (!d) return;
    if (open && !d.open) d.showModal();
    if (!open && d.open) d.close();
  }, [open]);
  return (
    <dialog
      ref={ref}
      onClose={onClose}
      onClick={(e) => e.target === ref.current && onClose()}
      className="sheet m-0 mx-auto mt-auto w-full max-w-md rounded-t-3xl bg-surface p-0 text-foreground backdrop:bg-black/40"
    >
      <div className="max-h-[85dvh] overflow-y-auto px-4 pb-[max(1rem,env(safe-area-inset-bottom))] pt-3">
        <div className="mx-auto mb-3 h-1.5 w-10 rounded-full bg-border" aria-hidden />
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-lg font-bold">{title}</h2>
          <button onClick={onClose} className="min-h-11 px-2 text-sm text-muted">
            Cerrar
          </button>
        </div>
        {open && children}
      </div>
    </dialog>
  );
}

export const POS_BG: Record<Position, string> = {
  DEF: "bg-pos-def",
  MED: "bg-pos-med",
  DEL: "bg-pos-del",
  ARQ: "bg-pos-arq",
};

export const POS_LABEL: Record<Position, string> = {
  ARQ: "Arquero",
  DEF: "Defensor",
  MED: "Mediocampista",
  DEL: "Delantero",
};

/** Chip de posición: color y texto, para no depender solo del color (RNF-09). */
export function PosChip({ pos, dim }: { pos: Position; dim?: boolean }) {
  return (
    <span
      className={`inline-flex h-5 min-w-9 items-center justify-center rounded-md px-1 font-display text-[11px] font-extrabold text-background ${POS_BG[pos]} ${dim ? "opacity-50" : ""}`}
    >
      {pos}
    </span>
  );
}

export function Segmented<T extends string>({
  value,
  options,
  onChange,
  label,
}: {
  value: T;
  options: { value: T; label: string }[];
  onChange: (v: T) => void;
  label: string;
}) {
  return (
    <div role="tablist" aria-label={label} className="flex rounded-xl bg-surface p-1">
      {options.map((o) => (
        <button
          key={o.value}
          role="tab"
          aria-selected={o.value === value}
          onClick={() => onChange(o.value)}
          className={`min-h-9 flex-1 rounded-lg px-2 font-display text-sm font-bold uppercase tracking-wide transition ${o.value === value ? "bg-accent text-accent-contrast" : "text-muted"}`}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

export function Empty({ title, children }: { title: string; children?: ReactNode }) {
  return (
    <div className="rounded-2xl border border-dashed border-border px-4 py-8 text-center">
      <p className="font-semibold">{title}</p>
      {children && <div className="mt-2 text-sm text-muted">{children}</div>}
    </div>
  );
}

export function Stepper({
  label,
  value,
  options,
  onChange,
  format = (v) => String(v),
}: {
  label: string;
  value: number;
  options: number[];
  onChange: (v: number) => void;
  format?: (v: number) => string;
}) {
  const i = Math.max(0, options.indexOf(value));
  const btn =
    "grid size-11 place-items-center rounded-full bg-background text-lg font-semibold transition active:scale-90 disabled:opacity-30";
  return (
    <div>
      <p className="mb-1 text-xs text-muted">{label}</p>
      <div className="flex items-center justify-between gap-1">
        <button type="button" className={btn} disabled={i === 0} onClick={() => onChange(options[i - 1])} aria-label={`Menos: ${label}`}>
          −
        </button>
        <span className="tabular text-lg font-bold">{format(value)}</span>
        <button
          type="button"
          className={btn}
          disabled={i === options.length - 1}
          onClick={() => onChange(options[i + 1])}
          aria-label={`Más: ${label}`}
        >
          +
        </button>
      </div>
    </div>
  );
}

/** Texto oscuro o blanco según el color de fondo (contraste WCAG, RNF-09). */
export function contrastOn(hex: string): string {
  const L = luminance(hex);
  if (L === null) return "#ffffff";
  return L > 0.4 ? "#0f0a26" : "#ffffff";
}

/** Colores de equipo: vivos, para que se lean sobre el fondo índigo. */
export const TEAM_COLORS = ["#00e0c6", "#b6ff3b", "#ff4fd8", "#ffc247", "#59a8ff", "#ff7a7a", "#a78bfa", "#3ddc84", "#ff9f43"];

function luminance(hex: string): number | null {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex);
  if (!m) return null;
  const n = parseInt(m[1], 16);
  const lin = (c: number) => {
    const s = c / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * lin((n >> 16) & 255) + 0.7152 * lin((n >> 8) & 255) + 0.0722 * lin(n & 255);
}

/**
 * Color de acento legible sobre el fondo oscuro: un color de equipo muy oscuro (de antes del
 * estilo Fantasy) se aclara hasta tener contraste suficiente.
 */
export function readableAccent(hex: string): string {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex);
  if (!m) return "#00e0c6";
  let [r, g, b] = [0, 2, 4].map((i) => parseInt(m[1].slice(i, i + 2), 16));
  const toHex = () => `#${[r, g, b].map((c) => Math.round(c).toString(16).padStart(2, "0")).join("")}`;
  for (let i = 0; i < 10 && (luminance(toHex()) ?? 1) < 0.2; i++) {
    [r, g, b] = [r, g, b].map((c) => c + (255 - c) * 0.18);
  }
  return toHex();
}
