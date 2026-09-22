import Link from "next/link";

export default function Home() {
  return (
    <main className="mx-auto flex w-full max-w-md flex-1 flex-col justify-center gap-8 px-5 py-12">
      <div className="space-y-3">
        <p className="text-sm font-semibold uppercase tracking-widest text-accent">quienJuega</p>
        <h1 className="text-4xl font-bold leading-tight">Que jueguen todos. Parejo.</h1>
        <p className="text-muted">
          Planificá las rotaciones, recibí sugerencias de cambio en vivo y seguí los minutos de cada
          jugador a lo largo del torneo.
        </p>
      </div>

      <Link
        href="/demo"
        className="rounded-2xl bg-accent px-5 py-4 text-center text-lg font-semibold text-accent-contrast shadow-sm transition active:scale-[0.98]"
      >
        Probar el planificador
      </Link>

      <p className="text-center text-xs text-muted">En desarrollo · fase F1</p>
    </main>
  );
}
