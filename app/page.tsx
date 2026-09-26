import Link from "next/link";
import { HomeActions } from "./home-actions";

export default function Home() {
  return (
    <main className="mx-auto flex w-full max-w-md flex-1 flex-col justify-center gap-8 px-5 py-12">
      <div className="space-y-3">
        <p className="text-sm font-semibold uppercase tracking-widest text-accent">quienEntra</p>
        <h1 className="text-4xl font-bold leading-tight">Que jueguen todos. Parejo.</h1>
        <p className="text-muted">
          Planificá las rotaciones, recibí sugerencias de cambio en vivo y seguí los minutos de cada
          jugador a lo largo del torneo. Funciona sin conexión en la cancha.
        </p>
      </div>

      <HomeActions />

      <Link href="/demo" className="text-center text-sm text-muted underline">
        Probar el planificador sin cuenta
      </Link>
      <p className="text-center text-xs text-muted">Beta</p>
    </main>
  );
}
