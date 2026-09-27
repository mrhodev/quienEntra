"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useState, type CSSProperties, type ReactNode } from "react";
import { useCurrent } from "@/lib/app/data";
import { useSession } from "@/lib/app/session";
import { SyncProvider, useSync, type SyncStatus } from "@/lib/app/sync-runner";
import { Icon } from "./icons";
import { contrastOn, readableAccent, Sheet } from "./ui";

const TABS = [
  { href: "/partidos", label: "Partido", icon: "ball", match: ["/partidos", "/partido"] },
  { href: "/plantel", label: "Plantel", icon: "people", match: ["/plantel"] },
  { href: "/estadisticas", label: "Estadísticas", icon: "chart", match: ["/estadisticas"] },
  { href: "/ajustes", label: "Ajustes", icon: "settings", match: ["/ajustes"] },
] as const;

/** Estructura de la app del DT (§8): exige sesión, sincroniza y muestra la navegación. */
export function AppShell({ children }: { children: ReactNode }) {
  const { session, loading } = useSession();
  const router = useRouter();

  useEffect(() => {
    if (!loading && !session) router.replace("/login");
  }, [loading, session, router]);

  if (loading || !session) return <Splash />;
  return (
    <SyncProvider enabled>
      <Frame>{children}</Frame>
    </SyncProvider>
  );
}

function Splash() {
  return (
    <div className="flex flex-1 items-center justify-center text-sm text-muted" role="status">
      Cargando…
    </div>
  );
}

function Frame({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const { ready } = useSync();
  const current = useCurrent();
  const onboarding = pathname.startsWith("/bienvenida");
  const live = pathname.startsWith("/partido/vivo");

  // Sin equipos (después de bajar los datos): al onboarding.
  useEffect(() => {
    if (ready && !current.loading && current.teams.length === 0 && !onboarding) router.replace("/bienvenida");
  }, [ready, current.loading, current.teams.length, onboarding, router]);

  if (!ready || current.loading) return <Splash />;

  const color = readableAccent(current.team?.color ?? "#00e0c6");
  const style = { "--accent": color, "--accent-contrast": contrastOn(color) } as CSSProperties;

  return (
    <div style={style} className="flex flex-1 flex-col">
      {!onboarding && !live && <TopBar />}
      <div className={`mx-auto w-full max-w-md flex-1 px-4 ${live || onboarding ? "pt-4" : "pt-2"} pb-28`}>{children}</div>
      {!onboarding && !live && (
        <nav
          aria-label="Principal"
          className="fixed inset-x-0 bottom-0 z-20 border-t border-border bg-surface/95 pb-[env(safe-area-inset-bottom)] backdrop-blur"
        >
          <ul className="mx-auto flex max-w-md">
            {TABS.map((t) => {
              const active = t.match.some((m) => pathname === m || pathname.startsWith(`${m}/`));
              return (
                <li key={t.href} className="flex-1">
                  <Link
                    href={t.href}
                    aria-current={active ? "page" : undefined}
                    className={`flex min-h-14 flex-col items-center justify-center gap-0.5 font-display text-xs font-bold uppercase tracking-wide ${active ? "text-accent-ink" : "text-muted"}`}
                  >
                    <Icon name={t.icon} />
                    {t.label}
                  </Link>
                </li>
              );
            })}
          </ul>
        </nav>
      )}
    </div>
  );
}

function TopBar() {
  const current = useCurrent();
  const [open, setOpen] = useState<"team" | "tournament" | null>(null);
  return (
    <header className="sticky top-0 z-10 border-b border-border bg-background/95 pt-[env(safe-area-inset-top)] backdrop-blur">
      <div className="mx-auto flex max-w-md items-center gap-2 px-4 py-2">
        <button onClick={() => setOpen("team")} className="flex min-h-11 min-w-0 items-center gap-2 text-left">
          <span className="size-3 shrink-0 rounded-full bg-accent" aria-hidden />
          <span className="truncate font-display text-lg font-extrabold uppercase">{current.team?.name ?? "Equipo"}</span>
          <span className="text-muted" aria-hidden>
            ▾
          </span>
        </button>
        <span className="text-border" aria-hidden>
          /
        </span>
        <button onClick={() => setOpen("tournament")} className="flex min-h-11 min-w-0 flex-1 items-center gap-1 text-left">
          <span className="truncate text-sm text-muted">{current.tournament?.name ?? "Sin torneo"}</span>
          <span className="text-muted" aria-hidden>
            ▾
          </span>
        </button>
        <SyncBadge />
      </div>

      <Sheet open={open === "team"} onClose={() => setOpen(null)} title="Equipo">
        <ul className="space-y-1">
          {current.teams.map((t) => (
            <li key={t.id}>
              <button
                onClick={() => {
                  current.selectTeam(t.id);
                  setOpen(null);
                }}
                className={`flex min-h-12 w-full items-center gap-3 rounded-xl px-3 text-left ${t.id === current.team?.id ? "bg-border/60 font-semibold" : ""}`}
              >
                <span className="size-3 rounded-full" style={{ background: t.color }} aria-hidden />
                {t.name}
              </button>
            </li>
          ))}
        </ul>
        <Link href="/bienvenida?nuevo=1" onClick={() => setOpen(null)} className="mt-3 flex min-h-12 items-center px-3 text-accent-ink">
          + Nuevo equipo
        </Link>
      </Sheet>

      <Sheet open={open === "tournament"} onClose={() => setOpen(null)} title="Torneo">
        <ul className="space-y-1">
          {current.tournaments.map((t) => (
            <li key={t.id}>
              <button
                onClick={() => {
                  current.selectTournament(t.id);
                  setOpen(null);
                }}
                className={`flex min-h-12 w-full items-center rounded-xl px-3 text-left ${t.id === current.tournament?.id ? "bg-border/60 font-semibold" : ""}`}
              >
                {t.name}
              </button>
            </li>
          ))}
        </ul>
        <Link href="/ajustes?torneo=nuevo" onClick={() => setOpen(null)} className="mt-3 flex min-h-12 items-center px-3 text-accent-ink">
          + Nuevo torneo
        </Link>
      </Sheet>
    </header>
  );
}

const SYNC_TEXT: Record<SyncStatus["kind"], string> = {
  synced: "Sincronizado",
  pending: "Pendiente",
  syncing: "Sincronizando",
  offline: "Sin conexión",
};

/** Estado de sincronización (RF-34): con texto e ícono, no solo color (RNF-09). */
export function SyncBadge() {
  const { status, syncNow } = useSync();
  const count = "count" in status && status.count > 0 ? ` (${status.count})` : "";
  const icon = status.kind === "synced" ? "check" : status.kind === "offline" ? "offline" : "sync";
  const tone = status.kind === "synced" ? "text-pos-med" : status.kind === "offline" ? "text-pos-arq" : "text-accent-ink";
  return (
    <button
      onClick={syncNow}
      className={`flex min-h-11 shrink-0 items-center gap-1 text-xs ${tone}`}
      aria-label={`${SYNC_TEXT[status.kind]}${count}. Tocá para sincronizar.`}
    >
      <Icon name={icon} size={14} />
      <span>
        {SYNC_TEXT[status.kind]}
        {count}
      </span>
    </button>
  );
}
