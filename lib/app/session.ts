"use client";

import type { Session } from "@supabase/supabase-js";
import { useEffect, useState } from "react";
import { getMeta, setMeta } from "@/lib/db/local";
import { resetLocal } from "@/lib/db/sync";

type Client = ReturnType<typeof import("@/lib/supabase/client").createClient>;
let client: Promise<Client> | null = null;

/**
 * Cliente de Supabase, cargado a demanda: no forma parte del JS inicial de las pantallas
 * (RNF-02). La app funciona con la base local mientras se carga.
 */
export function getSupabase(): Promise<Client> {
  client ??= import("@/lib/supabase/client").then((m) => m.createClient());
  return client;
}

/**
 * Sesión actual. `getSession` lee la sesión guardada, así que funciona sin conexión.
 * Si entra otro usuario, se borran los datos locales del anterior.
 */
export function useSession(): { session: Session | null; loading: boolean } {
  const [session, setSession] = useState<Session | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let alive = true;
    let unsubscribe: (() => void) | undefined;
    const apply = async (s: Session | null) => {
      if (s) {
        const prev = await getMeta<string>("userId");
        if (prev && prev !== s.user.id) await resetLocal();
        await setMeta("userId", s.user.id);
      }
      if (alive) {
        setSession(s);
        setLoading(false);
      }
    };
    void getSupabase().then(async (sb) => {
      const { data } = await sb.auth.getSession();
      await apply(data.session);
      const { data: sub } = sb.auth.onAuthStateChange((_event, s) => {
        void apply(s);
      });
      unsubscribe = () => sub.subscription.unsubscribe();
      if (!alive) unsubscribe();
    });
    return () => {
      alive = false;
      unsubscribe?.();
    };
  }, []);

  return { session, loading };
}

export async function signOut() {
  await (await getSupabase()).auth.signOut();
  await resetLocal();
}

/** Id del usuario con sesión (lee la sesión guardada; funciona sin conexión). */
export async function currentUserId(): Promise<string> {
  const { data } = await (await getSupabase()).auth.getSession();
  if (!data.session) throw new Error("Sin sesión");
  return data.session.user.id;
}
