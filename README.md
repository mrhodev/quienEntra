# quienEntra

Web app mobile-first para repartir equitativamente los minutos de juego de un equipo de fútbol, con sugerencias de cambio en vivo y estadísticas por torneo.

La especificación completa está en [docs/SPEC.md](docs/SPEC.md).

## Stack

Next.js (App Router) · Tailwind CSS · Supabase (Postgres + Auth) · Vitest + fast-check · Vercel

## Correr en local

Requisitos: Node 20+ y Docker Desktop (para Supabase local).

```bash
npm install
npx supabase start        # levanta Postgres, Auth y Studio en Docker (la 1ª vez descarga imágenes)
cp .env.example .env.local  # ya apunta al Supabase local
npm run dev               # http://localhost:3000
```

- App: http://localhost:3000. El planificador de demo está en `/demo`.
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
| `npm run build` | Build de producción |
| `npx supabase db reset` | Recrea la base local aplicando las migraciones |

## Estructura

```
app/                  rutas (Next.js App Router)
lib/rotation/         motor de rotación (puro, sin dependencias) — spec §6
lib/match/            log de eventos → stints/minutos, cronómetro
lib/supabase/         clientes de Supabase (browser / server)
supabase/migrations/  esquema SQL + RLS
docs/SPEC.md          especificación
```

## Estado

- [x] F0: setup (Next.js, Tailwind, Supabase local, migración inicial con RLS)
- [x] F1: motor de rotación y derivación de eventos, con tests
- [ ] F2: login, equipos, plantel, torneos y sync offline
- [ ] F3: previa del partido
- [ ] F4: partido en vivo
- [ ] F5: estadísticas, vista pública e infografías
- [ ] F6: PWA y pulido
