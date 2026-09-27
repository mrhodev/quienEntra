"use client";

import Link from "next/link";
import { useState } from "react";
import { Button, Field, Input } from "@/components/ui";
import { getSupabase } from "@/lib/app/session";

/** Ingreso con link por email o con Google (RF-01). */
export function LoginForm() {
  const [email, setEmail] = useState("");
  const [state, setState] = useState<"idle" | "sending" | "sent" | "error">("idle");
  const [error, setError] = useState("");

  const redirectTo = () => `${window.location.origin}/auth/callback`;

  const sendLink = async (e: React.FormEvent) => {
    e.preventDefault();
    setState("sending");
    const { error } = await (await getSupabase()).auth.signInWithOtp({
      email: email.trim(),
      options: { emailRedirectTo: redirectTo() },
    });
    if (error) {
      setError(error.message);
      setState("error");
    } else setState("sent");
  };

  const google = async () => {
    const { error } = await (await getSupabase()).auth.signInWithOAuth({ provider: "google", options: { redirectTo: redirectTo() } });
    if (error) {
      setError(error.message);
      setState("error");
    }
  };

  return (
    <main className="mx-auto flex w-full max-w-md flex-1 flex-col justify-center gap-6 px-5 py-12">
      <div>
        <Link href="/" className="text-sm font-semibold uppercase tracking-widest text-accent-ink">
          quienEntra
        </Link>
        <h1 className="mt-2 text-4xl">Ingresar</h1>
        <p className="mt-1 text-muted">Te mandamos un link a tu email; no hace falta contraseña.</p>
      </div>

      {state === "sent" ? (
        <div className="rounded-2xl border border-border bg-surface p-4" role="status">
          <p className="font-semibold">Revisá tu email</p>
          <p className="mt-1 text-sm text-muted">
            Te mandamos un link a <strong>{email}</strong>. Abrilo en este mismo dispositivo para entrar.
          </p>
          <button className="mt-3 min-h-11 text-sm text-accent-ink" onClick={() => setState("idle")}>
            Usar otro email
          </button>
        </div>
      ) : (
        <form onSubmit={sendLink} className="space-y-3">
          <Field label="Email">
            <Input
              type="email"
              required
              autoComplete="email"
              inputMode="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="dt@ejemplo.com"
            />
          </Field>
          <Button type="submit" className="w-full" disabled={state === "sending"}>
            {state === "sending" ? "Enviando…" : "Mandame el link"}
          </Button>
        </form>
      )}

      <div className="flex items-center gap-3 text-xs text-muted">
        <span className="h-px flex-1 bg-border" /> o <span className="h-px flex-1 bg-border" />
      </div>
      <Button variant="secondary" onClick={google}>
        Seguir con Google
      </Button>

      {state === "error" && (
        <p role="alert" className="rounded-xl bg-pos-del/10 px-3 py-2 text-sm text-pos-del">
          No pudimos iniciar sesión: {error}
        </p>
      )}
    </main>
  );
}
