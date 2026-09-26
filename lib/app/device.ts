"use client";

import { useEffect, useState } from "react";

/** Pantalla encendida durante el partido (RF-24). Devuelve false si el navegador no lo soporta. */
export function useWakeLock(active: boolean): boolean {
  const [supported] = useState(() => typeof navigator === "undefined" || "wakeLock" in navigator);
  useEffect(() => {
    if (!active || !supported) return;
    let lock: WakeLockSentinel | null = null;
    const acquire = async () => {
      try {
        lock = await navigator.wakeLock.request("screen");
      } catch {
        // Por ejemplo, con la batería baja: se reintenta al volver a la pestaña.
      }
    };
    const onVisible = () => document.visibilityState === "visible" && void acquire();
    void acquire();
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      document.removeEventListener("visibilitychange", onVisible);
      void lock?.release().catch(() => {});
    };
  }, [active, supported]);
  return supported;
}

/** Aviso de sugerencia (RF-19): vibración si hay; si no, un pitido corto (si está habilitado). */
export function notifySuggestion(sound: boolean) {
  if (typeof navigator !== "undefined" && "vibrate" in navigator && navigator.vibrate([180, 90, 180])) return;
  if (!sound) return;
  try {
    const Ctx = window.AudioContext ?? (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    const ctx = new Ctx();
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.frequency.value = 880;
    gain.gain.setValueAtTime(0.2, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.35);
    osc.connect(gain).connect(ctx.destination);
    osc.start();
    osc.stop(ctx.currentTime + 0.35);
    osc.onended = () => void ctx.close();
  } catch {
    // Sin audio disponible: queda el aviso visual.
  }
}

/** Re-render periódico para el cronómetro (el tiempo se calcula con marcas de tiempo, RNF-05). */
export function useNow(active: boolean, everyMs = 500): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!active) return;
    const t = setInterval(() => setNow(Date.now()), everyMs);
    const onVisible = () => setNow(Date.now());
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      clearInterval(t);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [active, everyMs]);
  return now;
}
