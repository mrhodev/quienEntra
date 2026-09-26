# quienEntra

Web app mobile-first para repartir equitativamente los minutos de juego de un equipo de fútbol, con sugerencias de cambio en vivo y estadísticas por torneo.

La especificación completa está en [docs/SPEC.md](docs/SPEC.md).

## Stack

Next.js (App Router) · Tailwind CSS · Supabase (Postgres + Auth) · Dexie (offline) · Vitest + fast-check · Playwright · Vercel

## Correr en local

Requisitos: Node 20+ y Docker Desktop (para Supabase local).

```bash
npm install
npx supabase start        # levanta Postgres, Auth y Studio en Docker (la 1ª vez descarga imágenes)
cp .env.example .env.local  # ya apunta al Supabase local
npm run dev               # http://localhost:3000
```

- App: http://localhost:3000. Ingresás con tu email: el link llega a Mailpit (abajo). La demo sin cuenta está en `/demo`.
- Supabase Studio (para ver las tablas): http://127.0.0.1:54323
- Mailpit (emails de login en local): http://127.0.0.1:54324

Para probar desde el celular en la misma red Wi-Fi: `npm run dev -- -H 0.0.0.0` y abrí `http://<IP-de-tu-compu>:3000`.

Para detener Supabase: `npx supabase stop`.

## Scripts

| Comando | Qué hace |
|---|---|
| `npm run dev` | Servidor de desarrollo |
| `npm test` | Tests unitarios y de propiedades |
| `FC_RUNS=2000 npm test` | Tests de propiedades más exhaustivos |
| `npm run typecheck` | Chequeo de tipos |
| `npm run lint` | ESLint |
| `npm run test:e2e` | E2E con Playwright (viewport móvil) contra el build y Supabase local |
| `npm run build` | Build de producción |
| `npx supabase db reset` | Recrea la base local aplicando las migraciones |

## Estructura

```
app/                  rutas (Next.js App Router); la app del DT está en app/(app)
components/           UI compartida (gráficos, infografías, grilla del plan…)
lib/rotation/         motor de rotación (puro) — spec §6
lib/match/            log de eventos → stints/minutos, cronómetro, sugerencias en vivo (puro)
lib/stats/            estadísticas del partido y del torneo (puro)
lib/db/               base local (Dexie), cola de salida y sincronización
lib/app/              hooks de React: sesión, datos, sincronizador
public/sw.js          service worker (offline)
e2e/                  tests de Playwright
supabase/migrations/  esquema SQL + RLS
docs/SPEC.md          especificación
```

## Deploy (beta)

1. **Supabase**: creá un proyecto en supabase.com y aplicá las migraciones:
   ```bash
   npx supabase login
   npx supabase link --project-ref <ref-del-proyecto>
   npx supabase db push
   ```
   En *Authentication → URL Configuration*: `Site URL` = la URL de Vercel y agregá `https://<tu-app>.vercel.app/**` a *Redirect URLs*.
   Para entrar con Google, activá el proveedor en *Authentication → Providers* (necesita un cliente OAuth de Google Cloud). El link por email funciona sin configurar nada.
2. **Vercel**: importá el repo de GitHub y cargá las variables `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` (de *Project Settings → API*) y `CRON_SECRET` (cualquier texto largo al azar). El cron diario de `vercel.json` evita que Supabase Free pause el proyecto.

## Estado

- [x] F0: setup (Next.js, Tailwind, Supabase local, migración inicial con RLS)
- [x] F1: motor de rotación y derivación de eventos, con tests
- [x] F2: login, equipos, plantel, torneos y sync offline
- [x] F3: previa del partido
- [x] F4: partido en vivo
- [x] F5: estadísticas, vista pública e infografías
- [x] F6: PWA y pulido (pendiente: centralizar los textos, RNF-08)
