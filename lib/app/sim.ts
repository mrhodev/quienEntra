"use client";

import { useSyncExternalStore } from "react";
import type { SimClock } from "@/lib/match/sim";

/**
 * Modo simulación (RF-41): solo en la versión beta. Se activa en el build de la rama `beta`
 * y en desarrollo (ver next.config.ts); en producción (`main`) no existe.
 */
export const SIMULATION_ENABLED = process.env.NEXT_PUBLIC_SIMULATION === "1";

const key = (matchId: string) => `quienentra:sim:${matchId}`;
const listeners = new Set<() => void>();
const cache = new Map<string, { raw: string | null; value: SimClock | null }>();

function read(matchId: string): SimClock | null {
  let raw: string | null = null;
  try {
    raw = localStorage.getItem(key(matchId));
  } catch {
    return null;
  }
  const hit = cache.get(matchId);
  if (hit && hit.raw === raw) return hit.value;
  let value: SimClock | null = null;
  try {
    value = raw ? (JSON.parse(raw) as SimClock) : null;
  } catch {
    value = null;
  }
  cache.set(matchId, { raw, value });
  return value;
}

/** Guarda el reloj virtual del partido en este dispositivo. */
export function saveSim(matchId: string, sim: SimClock) {
  try {
    localStorage.setItem(key(matchId), JSON.stringify(sim));
  } catch {
    // Sin almacenamiento: la simulación dura hasta recargar.
  }
  for (const l of listeners) l();
}

export function useSim(matchId: string | null): SimClock | null {
  return useSyncExternalStore(
    (cb) => {
      listeners.add(cb);
      return () => listeners.delete(cb);
    },
    () => (matchId ? read(matchId) : null),
    () => null,
  );
}
