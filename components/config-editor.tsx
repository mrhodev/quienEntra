"use client";

import type { FieldPosition, RotationConfig } from "@/lib/rotation";
import { Stepper } from "./ui";

/** Formaciones de referencia por modalidad (sin el arquero). */
export const FORMATIONS: Record<number, Record<FieldPosition, number>> = {
  5: { DEF: 2, MED: 1, DEL: 1 },
  6: { DEF: 2, MED: 2, DEL: 1 },
  7: { DEF: 2, MED: 3, DEL: 1 },
  8: { DEF: 3, MED: 3, DEL: 1 },
  9: { DEF: 3, MED: 3, DEL: 2 },
  10: { DEF: 3, MED: 4, DEL: 2 },
  11: { DEF: 4, MED: 4, DEL: 2 },
};

const range = (a: number, b: number, step = 1) => Array.from({ length: Math.floor((b - a) / step) + 1 }, (_, i) => a + i * step);

/** Configuración del torneo o del partido (RF-08). */
export function ConfigEditor({
  value,
  onChange,
  compact = false,
}: {
  value: RotationConfig;
  onChange: (c: RotationConfig) => void;
  compact?: boolean;
}) {
  const set = (patch: Partial<RotationConfig>) => onChange({ ...value, ...patch });
  const minutes = value.periods[0]?.minutes ?? 25;
  const f = value.formation ?? FORMATIONS[value.playersOnField] ?? { DEF: 0, MED: 0, DEL: 0 };
  const fieldSlots = value.playersOnField - 1;
  const formationOk = f.DEF + f.MED + f.DEL === fieldSlots;

  const setWindow = (b: number) =>
    set({
      windowMinutes: b,
      // Por defecto el stint mínimo y el mínimo garantizado siguen a la ventana (RF-08).
      minStintMinutes: value.minStintMinutes === value.windowMinutes ? b : value.minStintMinutes,
      guaranteedMinutes: Math.max(value.guaranteedMinutes === value.windowMinutes ? b : value.guaranteedMinutes, b),
    });

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-3">
        <Stepper
          label="Jugadores por equipo (con arquero)"
          value={value.playersOnField}
          options={[5, 6, 7, 8, 9, 10, 11]}
          onChange={(n) => set({ playersOnField: n, formation: FORMATIONS[n] })}
        />
        <Stepper
          label="Tiempos"
          value={value.periods.length}
          options={[1, 2, 3, 4]}
          onChange={(n) => set({ periods: Array.from({ length: n }, () => ({ minutes })) })}
        />
        <Stepper
          label="Minutos por tiempo"
          value={minutes}
          options={[8, 10, 12, 15, 20, 25, 30, 35, 40, 45]}
          onChange={(m) => set({ periods: value.periods.map(() => ({ minutes: m })) })}
          format={(v) => `${v}'`}
        />
        <Stepper label="Ventana de cambio" value={value.windowMinutes} options={[2, 3, 4, 5, 6, 8, 10]} onChange={setWindow} format={(v) => `${v}'`} />
      </div>

      {!compact && (
        <>
          <div>
            <p className="mb-1 text-sm font-medium">Formación de referencia</p>
            <div className="grid grid-cols-3 gap-3">
              {(["DEF", "MED", "DEL"] as const).map((pos) => (
                <Stepper
                  key={pos}
                  label={pos}
                  value={f[pos]}
                  options={range(0, fieldSlots)}
                  onChange={(n) => set({ formation: { ...f, [pos]: n } })}
                />
              ))}
            </div>
            <p className={`mt-1 text-xs ${formationOk ? "text-muted" : "text-pos-del"}`}>
              {formationOk
                ? `Arquero + ${f.DEF}-${f.MED}-${f.DEL}. Orienta los cambios, pero no es obligatoria.`
                : `Tiene que sumar ${fieldSlots} jugadores de campo (ahora suma ${f.DEF + f.MED + f.DEL}).`}
            </p>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <Stepper
              label="Cambios por ventana"
              value={value.maxSubsPerWindow ?? 0}
              options={range(0, fieldSlots)}
              onChange={(n) => set({ maxSubsPerWindow: n === 0 ? undefined : n })}
              format={(v) => (v === 0 ? "Sin límite" : String(v))}
            />
            <Stepper
              label="Stint mínimo"
              value={value.minStintMinutes}
              options={range(1, 20)}
              onChange={(n) => set({ minStintMinutes: n, guaranteedMinutes: Math.max(value.guaranteedMinutes, n) })}
              format={(v) => `${v}'`}
            />
            <Stepper
              label="Mínimo garantizado"
              value={value.guaranteedMinutes}
              options={range(value.minStintMinutes, 45)}
              onChange={(n) => set({ guaranteedMinutes: n })}
              format={(v) => `${v}'`}
            />
            <Stepper
              label="Peso del torneo (α)"
              value={value.equityWeight}
              options={[0, 0.1, 0.2, 0.3, 0.5, 0.75, 1]}
              onChange={(n) => set({ equityWeight: n })}
            />
          </div>
          <p className="text-xs text-muted">
            El peso del torneo compensa hoy a quien jugó menos en partidos anteriores (0 = no compensa).
          </p>

          <label className="flex min-h-11 items-center justify-between gap-3">
            <span className="text-sm font-medium">El arquero entra en el reparto parejo</span>
            <input
              type="checkbox"
              className="size-5 accent-[var(--accent)]"
              checked={value.goalkeeperRotates}
              onChange={(e) => set({ goalkeeperRotates: e.target.checked })}
            />
          </label>
        </>
      )}
    </div>
  );
}
