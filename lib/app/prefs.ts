"use client";

import { useSyncExternalStore } from "react";

/** Preferencias del dispositivo (equipo y torneo seleccionados, tema), en localStorage. */

const listeners = new Set<() => void>();

function read(key: string): string | null {
  try {
    return localStorage.getItem(`quienentra:${key}`);
  } catch {
    return null;
  }
}

export function setPref(key: string, value: string | null) {
  try {
    if (value === null) localStorage.removeItem(`quienentra:${key}`);
    else localStorage.setItem(`quienentra:${key}`, value);
  } catch {
    // Sin almacenamiento (modo privado): la preferencia dura hasta recargar.
  }
  for (const l of listeners) l();
}

function subscribe(cb: () => void) {
  listeners.add(cb);
  window.addEventListener("storage", cb);
  return () => {
    listeners.delete(cb);
    window.removeEventListener("storage", cb);
  };
}

export function usePref(key: string): string | null {
  return useSyncExternalStore(
    subscribe,
    () => read(key),
    () => null,
  );
}
