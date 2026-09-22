@AGENTS.md

# quienJuega

- La especificación es la fuente de verdad: `docs/SPEC.md`. Cada cambio de comportamiento referencia su ID (RF-xx, CA-xx); si la implementación se desvía, actualizar la spec en el mismo cambio.
- `lib/rotation` y `lib/match` son TypeScript puro (sin React, sin Supabase): toda regla de negocio va ahí, con tests en Vitest y fast-check.
- UI y textos en español rioplatense (es-AR).
- Base de datos: cambios solo mediante nuevas migraciones en `supabase/migrations/`, siempre con RLS.
- Antes de dar algo por terminado: `npm test && npm run typecheck && npm run lint`.
