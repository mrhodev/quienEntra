"use client";

import { useLiveQuery } from "dexie-react-hooks";
import { createContext, useCallback, useContext, useEffect, useRef, useState } from "react";
import { db, getMeta, setMeta } from "@/lib/db/local";
import { pull, push, supabaseRemote } from "@/lib/db/sync";
import { getSupabase } from "./session";

export type SyncStatus =
  | { kind: "synced" }
  | { kind: "pending"; count: number }
  | { kind: "offline"; count: number }
  | { kind: "syncing"; count: number };

const Ctx = createContext<{ status: SyncStatus; syncNow: () => void; ready: boolean }>({
  status: { kind: "synced" },
  syncNow: () => {},
  ready: false,
});

export const useSync = () => useContext(Ctx);

const MAX_BACKOFF_MS = 60_000;

/**
 * Sincroniza en segundo plano (§7.2, RF-33, RF-34): al abrir la app, al volver la conexión,
 * al volver a la pestaña, cada 30 s y poco después de cada cambio local. Si falla, reintenta
 * con backoff exponencial.
 */
export function SyncProvider({ enabled, children }: { enabled: boolean; children: React.ReactNode }) {
  const pending = useLiveQuery(() => db().outbox.count(), []) ?? 0;
  const [online, setOnline] = useState(() => typeof navigator === "undefined" || navigator.onLine);
  const [running, setRunning] = useState(false);
  const busy = useRef(false);
  const again = useRef(false);
  const failures = useRef(0);
  const retryTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const runRef = useRef<() => Promise<void>>(async () => {});
  // Listo cuando ya se bajaron los datos alguna vez en este dispositivo, o si no hay conexión.
  const [ready, setReady] = useState(false);

  useEffect(() => {
    void getMeta<string>("lastPull").then((v) => {
      if (v || !navigator.onLine) setReady(true);
    });
  }, []);

  const run = useCallback(async () => {
    if (!enabled) return;
    if (busy.current) {
      again.current = true;
      return;
    }
    if (typeof navigator !== "undefined" && !navigator.onLine) return;
    busy.current = true;
    setRunning(true);
    try {
      const remote = supabaseRemote(await getSupabase());
      await push(remote);
      await pull(remote);
      await setMeta("lastPull", new Date().toISOString());
      setReady(true);
      failures.current = 0;
      setOnline(true);
    } catch {
      setReady(true);
      failures.current++;
      const delay = Math.min(MAX_BACKOFF_MS, 1000 * 2 ** failures.current);
      if (retryTimer.current) clearTimeout(retryTimer.current);
      retryTimer.current = setTimeout(() => void runRef.current(), delay);
    } finally {
      busy.current = false;
      setRunning(false);
      if (again.current) {
        again.current = false;
        void runRef.current();
      }
    }
  }, [enabled]);

  useEffect(() => {
    runRef.current = run;
  }, [run]);

  useEffect(() => {
    if (!enabled) return;
    const onOnline = () => {
      setOnline(true);
      void run();
    };
    const onOffline = () => {
      setOnline(false);
      setReady(true);
    };
    const onVisible = () => document.visibilityState === "visible" && void run();
    window.addEventListener("online", onOnline);
    window.addEventListener("offline", onOffline);
    document.addEventListener("visibilitychange", onVisible);
    const interval = setInterval(() => void run(), 30_000);
    const first = setTimeout(() => void run(), 0);
    return () => {
      window.removeEventListener("online", onOnline);
      window.removeEventListener("offline", onOffline);
      document.removeEventListener("visibilitychange", onVisible);
      clearInterval(interval);
      clearTimeout(first);
      if (retryTimer.current) clearTimeout(retryTimer.current);
    };
  }, [enabled, run]);

  // Poco después de cada cambio local, se envía.
  useEffect(() => {
    if (!enabled || pending === 0) return;
    const t = setTimeout(() => void run(), 1500);
    return () => clearTimeout(t);
  }, [enabled, pending, run]);

  const status: SyncStatus = !online
    ? { kind: "offline", count: pending }
    : running
      ? { kind: "syncing", count: pending }
      : pending > 0
        ? { kind: "pending", count: pending }
        : { kind: "synced" };

  return <Ctx.Provider value={{ status, syncNow: () => void run(), ready }}>{children}</Ctx.Provider>;
}
