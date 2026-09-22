# quienEntra — Especificación funcional y técnica

> Documento base para desarrollo guiado por especificación (spec-driven development).
> Cada requisito tiene un ID (`RF-xx`, `RNF-xx`) para referenciarlo desde issues, commits y tests.
> Versión 1.2 · 2026-09-22

---

## 1. Visión

Una web app para celulares que ayuda a un DT a **repartir los minutos de juego de forma equitativa** entre todos los jugadores del plantel, sugiriendo cambios durante el partido, y que guarda un **historial de quién jugó, cuánto y cuándo** a lo largo de cada torneo.

### 1.1 Problema
- Planteles de 15–25 jugadores y cambios ilimitados: hacer que todos jueguen lo mismo "de cabeza" no funciona.
- Hay que tener en cuenta posiciones (DEF / MED / DEL), el arquero, ausencias, llegadas tarde y lesiones.
- No queda registro confiable de los minutos de cada jugador en el torneo.

### 1.2 Objetivos
1. Generar antes del partido un **plan de rotación** equitativo.
2. Durante el partido, con cronómetro, **sugerir cambios** y recalcular el plan ante imprevistos.
3. Funcionar **sin conexión** en la cancha.
4. Mostrar **estadísticas por jugador y por torneo**, con vista pública de solo lectura para jugadores y familias.
5. Costo cero: Vercel (Hobby) + Supabase (Free).

### 1.3 Fuera de alcance (v1)
- Tarjetas, asistencias de gol y estadísticas tácticas.
- Varios editores por equipo (cuerpo técnico). El modelo de datos lo prevé, pero la UI no.
- Notificaciones push y app nativa.
- Pagos / planes premium.

---

## 2. Usuarios y roles

| Rol | Descripción | Permisos |
|---|---|---|
| **DT (owner)** | Usuario registrado. Puede tener varios equipos. | CRUD completo sobre sus equipos, jugadores, torneos y partidos. |
| **Visitante público** | Jugador, padre o madre con el link público del equipo. Sin login. | Solo lectura de estadísticas y resultados del equipo, si el DT activó el link. |
| *(futuro)* Editor | Miembro del cuerpo técnico invitado. | Igual que el owner, salvo borrar el equipo. |

Es un SaaS multiusuario: cualquier DT puede registrarse y crear sus equipos.

---

## 3. Glosario

| Término | Definición |
|---|---|
| **Modalidad** | Cantidad de jugadores en cancha, incluido el arquero (5, 7, 8, 9, 11…). |
| **Período** | Tramo del partido (tiempo o cuarto). Cantidad y duración configurables. |
| **Duración (D)** | Suma de la duración de todos los períodos, en minutos. |
| **Jugador de campo** | Cualquier jugador en cancha que no sea el arquero. |
| **Stint** | Intervalo continuo en que un jugador está en cancha. |
| **Ventana de cambio** | Momento previsto en el plan para hacer cambios (cada *b* minutos y al inicio de cada período). |
| **Cuota justa (T)** | Minutos que le corresponden a un jugador en el partido según el algoritmo de equidad. |
| **Peso del acumulado (α)** | Cuánto influye lo jugado en partidos anteriores del torneo en la cuota de hoy (0 = nada, 1 = mucho). |
| **Minutos disponibles** | Minutos en los que el jugador pudo jugar (presente y no lesionado). |

---

## 4. Requisitos funcionales

### 4.1 Cuenta y equipos
- **RF-01** Registro e inicio de sesión con email (magic link) y Google, usando Supabase Auth.
- **RF-02** El DT puede crear, editar y archivar equipos (nombre, escudo/color opcional).
- **RF-03** Cada equipo tiene un **link público** (`/p/{slug}`) que el DT activa o desactiva. Al regenerarlo, el link anterior deja de funcionar.

### 4.2 Plantel
- **RF-04** CRUD de jugadores: nombre, apodo (opcional), número de camiseta (opcional), foto (opcional, fase posterior).
- **RF-05** Posiciones del jugador: una **principal** y cero o más **secundarias**, entre `ARQ`, `DEF`, `MED` y `DEL`. Las posiciones orientan las sugerencias, pero **no son excluyentes**.
- **RF-06** Se puede marcar a un jugador como inactivo (baja del plantel) sin perder su historial.

### 4.3 Torneos
- **RF-07** CRUD de torneos por equipo: nombre y fechas de inicio y fin (opcionales).
- **RF-08** Configuración por defecto del torneo, heredada por cada partido y editable en él:
  - Modalidad: jugadores en cancha (N).
  - Períodos: cantidad y minutos de cada uno.
  - Formación de referencia: cantidad de DEF/MED/DEL en cancha (ej. F7: 1 ARQ + 2-3-1). Opcional.
  - Longitud de ventana de cambio *b*, en minutos (default: 5).
  - Máximo de cambios por ventana (default: sin límite; recomendado 2–3).
  - Stint mínimo en minutos (default = *b*).
  - Peso del acumulado α (default: 0.3).
  - Minutos mínimos garantizados por presente (default = *b*, nunca menor que el stint mínimo). Ver RF-38.
  - Si el arquero entra en la rotación equitativa (default: no).

### 4.4 Partidos: antes de jugar
- **RF-09** Crear partido dentro de un torneo: fecha y hora, rival, local o visitante, y configuración (heredada, editable).
- **RF-10** **Convocatoria / asistencia**: para cada jugador del plantel se marca `presente`, `ausente`, `lesionado` o `llega tarde` (con minuto estimado de llegada).
- **RF-11** Elegir el **arquero titular**. Por defecto se propone el jugador con `ARQ` como posición principal que más partidos atajó.
- **RF-12** **Generar plan de rotación** (ver §6): una grilla de ventanas × jugadores que muestra quién está en cancha en cada ventana y en qué posición, más los minutos previstos de cada uno.
- **RF-13** El DT puede **editar el plan** a mano: intercambiar jugadores de una ventana, fijar a un jugador en cancha o en el banco durante una ventana. El resto del plan se recalcula respetando lo fijado.
- **RF-14** Vista previa de la equidad del plan: minutos previstos por jugador y diferencia máxima entre jugadores de campo.

### 4.5 Partidos: en vivo
- **RF-15** **Cronómetro de partido** por período, con iniciar, pausar, reanudar y finalizar período. Muestra el tiempo del período y el acumulado. **El tiempo en pausa no cuenta** como minutos jugados para nadie, ni en el partido ni en las estadísticas.
- **RF-16** **Vista de cancha**: los jugadores en cancha agrupados por posición y el banco ordenado por prioridad de entrada. Cada jugador muestra sus minutos jugados en el partido y un indicador de estado respecto de su cuota (verde: en cuota, ámbar: se está pasando, azul: le faltan minutos).
- **RF-17** **Sugerencia de cambio**: al llegar una ventana de cambio, o si el desvío de algún jugador supera el umbral, se muestra una tarjeta "Sale X → Entra Y" (una por par), con la posición.
  - El DT puede **confirmar** todos, confirmar algunos, **posponer** (1 o 2 minutos) o **descartar**.
  - Confirmar registra un evento `sub` (`{out, in, position}`) por cada par, con el tiempo de partido actual.
- **RF-18** **Cambio manual**: tocar un jugador en cancha y luego uno del banco (o arrastrar) registra el cambio en cualquier momento.
- **RF-19** **Avisos**: vibración y aviso visual (flash o pulso en la tarjeta) cuando hay una sugerencia. En dispositivos sin la Vibration API (iOS Safari) se usa un aviso sonoro corto, que se puede desactivar, y el visual.
- **RF-20** **Recalcular en vivo** automáticamente ante:
  - un cambio manual distinto al sugerido,
  - un jugador marcado como lesionado (sale sin volver, o "vuelve disponible"),
  - la llegada de un jugador que llegó tarde,
  - un cambio de arquero.
- **RF-21** **Cambio de arquero**: seleccionar el nuevo arquero entre los de cancha o el banco. Los minutos atajados cuentan como minutos jugados.
- **RF-22** **Registrar gol**: a favor (con autor, opcional) o en contra. Actualiza el marcador.
- **RF-23** **Deshacer** el último evento, hasta 5 niveles.
- **RF-24** La pantalla no se apaga durante el partido (Screen Wake Lock API, si está disponible).
- **RF-25** Finalizar partido: resumen con minutos por jugador, goles y marcador. El partido queda en estado `finished`, y editarlo después requiere confirmación.

### 4.6 Estadísticas
- **RF-26** **Tabla del torneo por jugador**: partidos presentes, partidos jugados, minutos totales, % de minutos jugados sobre los disponibles, promedio de minutos por partido y goles.
- **RF-27** **Mapa de calor torneo × jugador**: filas = jugadores, columnas = partidos, celda = % jugado (vacía = ausente). Responde de un vistazo "cuándo fue jugando cada uno a lo largo del torneo".
- **RF-28** **Línea de tiempo por partido**: una barra horizontal por jugador que muestra sus stints a lo largo del partido (tipo Gantt), con los cortes de período.
- **RF-29** **Ficha de jugador**: evolución de minutos por partido (barras), posiciones jugadas y goles.
- **RF-30** **Indicador de equidad del torneo**: desvío estándar del % jugado y lista de jugadores por debajo del promedio.
- **RF-31** La vista pública (`/p/{slug}`) muestra RF-26 a RF-29 en solo lectura, sin datos personales más allá del nombre o apodo. **Solo estadísticas de partidos finalizados**: no muestra planes, convocatorias ni partidos en curso o futuros.
- **RF-36** **Exportar como infografía**: no se exporta a CSV. Se genera una **imagen tipo infografía**, lista para compartir, con estos modelos:
  - **Resumen del partido**: rival, fecha, marcador y goleadores. Muestra una línea de tiempo tipo Gantt que indica cuándo estuvo en cancha cada jugador, con los minutos de cada uno. Destaca el dato de equidad del partido (por ejemplo, "Todos jugaron entre 24' y 30'").
  - **Torneo**: nombre del torneo, partidos jugados y resultados (ganados, empatados, perdidos), el mapa de calor jugadores × partidos, un ranking de minutos con barras, el goleador y un indicador de equidad del plantel.
  - **Ficha de jugador**: nombre, número y posiciones, minutos totales, porcentaje jugado, partidos, goles y un gráfico de barras con los minutos por partido.
- **RF-37** **Diseño y generación de la infografía**:
  - Formatos: **4:5 (1080×1350)** para chats y feed, y **9:16 (1080×1920)** para historias. Se elige antes de compartir, con una vista previa.
  - Estilo: usa el color del equipo, tipografía grande, cifras destacadas y los gráficos de la app en versión simplificada, con marca discreta "quienEntra" al pie. Tiene que leerse bien en el celular sin hacer zoom.
  - Planteles grandes (hasta 25 jugadores): el diseño se adapta, con filas más compactas o dos columnas, sin cortar jugadores.
  - Se genera **en el cliente** y funciona sin conexión. La infografía se arma como un componente con SVG de tamaño fijo y se convierte a PNG con una librería liviana (`modern-screenshot` o `html-to-image`) que se carga solo al exportar.
  - Se comparte con la Web Share API (WhatsApp, Instagram, etc.). Si el navegador no la soporta, se descarga el PNG.
  - Disponible para el DT. En la vista pública, las mismas infografías de torneo y de jugador se pueden compartir, porque solo contienen estadísticas de partidos finalizados.

### 4.8 Reglas de juego
- **RF-38** **Todos los presentes juegan.** Cada jugador marcado `presente` o `llega tarde` que llegue a estar disponible juega al menos los minutos mínimos garantizados. Esta regla está por encima de la equidad, del peso del acumulado y de los bloqueos manuales: si el DT fija a un jugador en el banco de forma que no llegaría al mínimo, la app avisa y no deja confirmar el plan sin corregirlo.
  - Única excepción: el jugador tiene menos minutos disponibles que el mínimo (llegó muy tarde o se lesionó antes de entrar). En ese caso juega todos los minutos que tenga disponibles.
  - En vivo, si un presente todavía no entró y el tiempo restante se acerca a su mínimo, su entrada se sugiere con prioridad máxima.
- **RF-39** **Reingresos permitidos**: un jugador que sale puede volver a entrar las veces que sea necesario.

### 4.7 Offline y sincronización
- **RF-32** La app se instala como **PWA** y funciona sin conexión para: ver plantel y torneo, crear y jugar un partido, y registrar todos sus eventos.
- **RF-33** Los cambios hechos sin conexión se guardan en una **cola local** y se sincronizan al volver la conexión, sin duplicados (IDs generados en el cliente, `upsert` idempotente).
- **RF-34** Indicador visible del estado de sincronización: `sincronizado`, `pendiente (n)` o `sin conexión`.
- **RF-35** Si el mismo partido se edita desde dos dispositivos, los eventos se **unen** (un log de eventos no genera conflictos de sobrescritura). Las ediciones de entidades como jugadores o configuración usan *last-write-wins* según `updated_at`.

---

## 5. Requisitos no funcionales

- **RNF-01 Mobile-first**: diseñada para 360–430 px de ancho, usable con una mano y con objetivos táctiles de al menos 44 px. En escritorio se ve centrada.
- **RNF-02 Liviana**: JS inicial de la ruta de partido en vivo por debajo de 150 KB gzip. LCP por debajo de 2 s en 4G.
- **RNF-03 Transiciones**: animaciones de 150–300 ms en cambios de vista, al entrar o salir jugadores (layout animations) y en las tarjetas de sugerencia. Se respeta `prefers-reduced-motion`.
- **RNF-04 Legibilidad al sol**: alto contraste, tema claro por defecto y tema oscuro opcional. Números grandes en el cronómetro.
- **RNF-05 Precisión del cronómetro**: el tiempo se calcula a partir de marcas de tiempo (`Date.now()`) y no de contadores de `setInterval`. Sobrevive al bloqueo de pantalla, a pasar la app a segundo plano y a recargar la página, con un error menor a 1 s.
- **RNF-06 Seguridad**: Row Level Security en todas las tablas. La vista pública accede solo mediante funciones o vistas que filtran por equipo público.
- **RNF-07 Costo cero**: debe caber en los límites gratuitos de Vercel Hobby y Supabase Free (500 MB de base de datos, 50k usuarios activos por mes).
- **RNF-08 Idioma**: español (es-AR) en v1, con los textos centralizados para poder traducir más adelante.
- **RNF-09 Accesibilidad**: WCAG AA en contraste. Los estados no se comunican solo con color: también con icono o texto.

---

## 6. Motor de rotación (núcleo del producto)

Es un módulo **TypeScript puro** (`/lib/rotation`), sin dependencias de UI ni de la base de datos, determinista y cubierto por tests. Corre en el cliente, por lo que funciona offline.

### 6.1 Entradas
> Los tipos definitivos están en `lib/rotation/types.ts`. Este bloque es orientativo.

```ts
type RotationInput = {
  config: {
    playersOnField: number;          // N (incluye arquero)
    periods: { minutes: number }[];  // D = suma
    windowMinutes: number;           // b
    maxSubsPerWindow?: number;
    minStintMinutes: number;
    guaranteedMinutes: number;       // mínimo por presente (RF-38)
    formation?: { DEF: number; MED: number; DEL: number }; // suma = N - 1
    equityWeight: number;            // α ∈ [0, 1]
    goalkeeperRotates: boolean;
  };
  players: {
    id: string;
    primary: Position; secondary: Position[];
    availableFromMin: number;        // 0, o minuto de llegada
    availableUntilMin: number;       // D, o minuto de lesión
    tournamentRatio: number | null;  // r_i: minutos jugados / cuota justa acumulada (null = primer partido)
  }[];
  goalkeeperSchedule: { playerId: string; fromMin: number }[];
  playedSoFar: { playerId: string; minutes: number }[]; // en vivo
  onFieldNow: { playerId: string; position: Position }[]; // en vivo
  locks: { playerId: string; windowIndex: number; state: 'field' | 'bench' }[];
  nowMin: number;                    // 0 antes del partido
};
```

### 6.2 Cuota justa (T_i)
1. **Pool de campo**: los jugadores presentes excepto el arquero en cada tramo (salvo que `goalkeeperRotates`).
2. **Minutos de campo totales**: `M = (N − 1) · D`.
3. **Reparto parejo con disponibilidad** (*water-filling*): se reparte `M` entre el pool en partes iguales, pero sin darle a nadie más que sus minutos disponibles. Lo que sobra por ese tope se redistribuye entre los demás. El resultado es `T⁰_i`.
4. **Ajuste por acumulado del torneo**:
   `T_i = T⁰_i · (1 + α · (1 − r_i))`, con `r_i = 1` si es null.
   Después se **renormaliza** para que `Σ T_i = M` y se limita cada `T_i` a `[0, disponibles_i]`.
   *Interpretación*: con α = 0.3, un jugador que en el torneo jugó el 70 % de su cuota justa (r = 0.7) recibe hoy un 9 % más que el reparto parejo, antes de renormalizar.
5. Los minutos atajados cuentan como jugados en las estadísticas, pero el arquero fijo no participa del reparto de campo.
6. **Piso garantizado**: `T_i ≥ min(guaranteedMinutes, disponibles_i)` para todo jugador del pool. Se aplica después del paso 4. El excedente se descuenta proporcionalmente de quienes están por encima del piso.
7. Todos los minutos se miden en **tiempo de juego efectivo**: el cronómetro pausado no suma.

### 6.3 Planificación por ventanas (algoritmo greedy)
Se divide el partido en ventanas `[t_k, t_{k+1})` de longitud *b*. Siempre hay un corte al inicio de cada período, así que la última ventana de un período puede ser más corta.

Para cada ventana *k* (desde `nowMin`):
1. `need_i = T_i − (jugados_i + asignados_i)`: minutos que le faltan a cada jugador.
2. Se descartan los no disponibles en la ventana y se aplican los `locks`.
3. **Restricción dura**: si a un jugador que todavía no alcanzó su piso le quedan tantos minutos disponibles como ventanas necesarias para cubrirlo, se lo pone en cancha obligatoriamente.
4. Con el resto de los lugares, se eligen los `N − 1` jugadores de campo maximizando:
   `score_i = need_i + β·[está en cancha y su stint < minStint] − γ·[cambio]`
   - β (continuidad forzada) respeta el stint mínimo.
   - γ (costo de cambiar) evita cambios innecesarios cuando las diferencias son chicas (default γ = 0.5·b).
   - Si hay `maxSubsPerWindow`, se limitan las entradas por ventana.
5. **Asignación de posiciones**: con los elegidos se cubre la `formation` minimizando el costo (0 = posición principal, 1 = secundaria, 3 = fuera de posición). Como el problema es chico (≤ 10 jugadores de campo), alcanza con una asignación húngara o con fuerza bruta con poda. Si nadie cubre una posición, se usa el costo 3: **no es excluyente**.
6. Se actualizan `asignados_i += duración de la ventana`.

**Salida**:
```ts
type RotationPlan = {
  windows: { startMin: number; endMin: number;
             field: { playerId: string; position: Position }[];
             subs: { outId: string; inId: string; position: Position }[] }[];
  expectedMinutes: Record<string, number>;
  targetMinutes: Record<string, number>;
  maxSpread: number; // max − min de expectedMinutes entre jugadores de campo con disponibilidad completa
};
```

**Parámetros internos (calibrados con tests)**:
- γ, costo de cambiar: `0.5·b`.
- λ, peso de la posición por unidad de costo: `0.15·b`. Jugar fuera de posición (costo 3) pesa menos de media ventana. Así, la posición desempata entre jugadores con minutos parecidos, pero nunca le quita una ventana entera a quien tiene más minutos pendientes. Con un valor más alto (`0.4·b`), el test CA-01 mostró diferencias de 10 minutos entre jugadores.
- **Urgencia del mínimo garantizado**: en cada ventana, si la capacidad de entradas de las ventanas que quedan (limitada por `maxSubsPerWindow`) no alcanza para todos los que todavía no llegaron al mínimo, los que sobran entran ya, aunque se supere el límite de cambios (RF-38 tiene prioridad).

### 6.4 En vivo
- Con cada evento relevante (RF-20) se vuelve a ejecutar el planificador con `nowMin`, `playedSoFar` y `onFieldNow` reales. Las ventanas pasadas quedan fijas.
- **Disparo de sugerencias**: al alcanzar `startMin` de una ventana con `subs` no vacíos, o si algún jugador en cancha supera su `T_i` por más de `b/2` y hay alguien en el banco con `need > b/2`.

### 6.5 Criterios de aceptación del motor
- **CA-R1**: con un pool homogéneo, todos disponibles todo el partido y sin locks, `maxSpread ≤ b`.
- **CA-R2**: `Σ expectedMinutes (campo) = (N − 1) · D` en todo plan.
- **CA-R3**: nunca se asignan minutos a un jugador fuera de su disponibilidad.
- **CA-R4**: ningún stint planificado es menor que `minStintMinutes`, salvo en el último tramo de un período o por lesión.
- **CA-R5**: con α = 0 el resultado no depende de `tournamentRatio`. Con α > 0, entre dos jugadores idénticos, el de menor `r` recibe al menos los mismos minutos.
- **CA-R6**: la función es determinista: la misma entrada produce la misma salida (desempates por `id`).
- **CA-R8**: todo jugador del pool tiene `expectedMinutes ≥ min(guaranteedMinutes, disponibles)`, cualquiera sea α, el valor de `tournamentRatio` y los bloqueos. Si los bloqueos lo hacen imposible, el motor devuelve un error de validación que identifica al jugador.
- **CA-R7**: rendimiento por debajo de 20 ms para 25 jugadores, D = 80 y b = 2 en un móvil de gama media.
- Se exigen tests unitarios y *property-based tests* (fast-check) para CA-R1 a CA-R6 y CA-R8.

---

## 7. Arquitectura técnica

### 7.1 Stack
| Capa | Tecnología | Motivo |
|---|---|---|
| Framework | **Next.js** (App Router, TypeScript, última estable) | Nativo en Vercel. |
| Estilos | **Tailwind CSS** + componentes propios sobre **Radix UI** (o shadcn/ui) | Liviano y accesible. |
| Animaciones | **Motion** (ex Framer Motion), `LazyMotion` + `domAnimation` | Layout animations para entradas y salidas; se carga solo lo necesario. |
| BBDD + Auth | **Supabase** (Postgres, Auth, RLS) | Gratis, SQL cómodo para estadísticas. |
| Local / offline | **Dexie** (IndexedDB) + cola de sincronización propia | Log de eventos local. |
| PWA | **Serwist** (service worker para Next.js) | Precache del shell y rutas offline. |
| Estado cliente | Zustand (UI) + `dexie-react-hooks` (`useLiveQuery`) | Simple y reactivo. |
| Validación | Zod | Esquemas compartidos entre cliente y servidor. |
| Gráficos | SVG propio para mapa de calor y Gantt; librería liviana solo si hace falta | Mantiene bajo el bundle. |
| Tests | Vitest + fast-check (motor), Playwright (flujos E2E en viewport móvil) | |
| Hosting | Vercel Hobby | Gratis. |

### 7.2 Flujo de datos
```
UI ──► Store local (Dexie) ──► Outbox ──(online)──► Supabase (upsert idempotente)
 ▲            ▲                                          │
 └── useLiveQuery ◄──── pull incremental (updated_at > cursor) ◄──┘
```
- **Toda escritura va primero a Dexie**, y la UI nunca espera a la red.
- El outbox envía en orden. Si falla, reintenta con *backoff* exponencial y también con los eventos `online` y `visibilitychange`.
- El pull es incremental por tabla, usando `updated_at` más un cursor guardado localmente.
- Las páginas públicas (`/p/[slug]`) son Server Components que consultan Supabase directamente, con ISR y revalidación de 60 s. No usan offline.

### 7.3 Modelo de datos (Postgres)

```sql
-- Todas las tablas: id uuid PK (generado en cliente), created_at, updated_at, deleted_at (soft delete).
-- Todas las tablas hijas llevan team_id (desnormalizado) para RLS simple y sync incremental por equipo.
-- Esquema real: supabase/migrations/.

profiles        (id = auth.users.id, display_name)
teams           (id, owner_id → profiles, name, color, public_slug unique null, is_public bool)
team_members    (team_id, user_id, role enum('owner','editor'))       -- preparado para el futuro
players         (id, team_id, name, nickname, shirt_number, primary_position, secondary_positions player_position[], active bool)
tournaments     (id, team_id, name, starts_on, ends_on, default_config jsonb)
matches         (id, tournament_id, team_id, kickoff_at, opponent, is_home,
                 status enum('draft','planned','live','finished'),
                 config jsonb, goals_for int, goals_against int)
match_players   (match_id, player_id, attendance enum('present','absent','injured','late'),
                 available_from_min numeric, available_until_min numeric)
match_plans     (id, match_id, version int, plan jsonb, locks jsonb)   -- se guarda la última versión y el histórico
match_events    (id, match_id, seq int, type text, payload jsonb,
                 match_time_ms bigint, wall_time timestamptz, device_id text)
match_player_stats (match_id, player_id, field_seconds, goalkeeper_seconds, target_seconds,
                 available_seconds, goals, stints jsonb)                -- derivado del log
```

**Tipos de `match_events`**: `period_start`, `period_end`, `pause`, `resume`, `lineup_set` (inicial), `sub` (`{outId | null, inId, position}`), `gk_change` (`{toId}`: el arquero anterior toma el lugar del nuevo), `injury` (`{playerId}`: sale al instante), `player_available` (`{playerId}`), `goal_for` (`{scorerId?}`), `goal_against`, `undo` (`{eventId}`), `match_end`.

**Derivados**: el log de eventos es la fuente de verdad. `lib/match/derive.ts` lo convierte en stints y minutos (tiempo efectivo, sin pausas). Esa derivación corre en el cliente, así que funciona offline. Al finalizar o sincronizar un partido, el cliente guarda el resultado en `match_player_stats`, y las estadísticas del torneo se agregan desde esa tabla.
*Decisión (v1.2)*: se descartan las vistas SQL que recalculaban stints en Postgres. Duplicar la lógica en SQL y en TypeScript agregaba un riesgo de divergencia sin ningún beneficio, porque el log completo sigue guardado y `match_player_stats` se puede regenerar en cualquier momento.

### 7.4 Seguridad (RLS)
- Todas las tablas tienen RLS habilitado. Política de acceso: `team_id in (select team_id from team_members where user_id = auth.uid())`.
- Acceso público: función `security definer` `public_team_stats(slug)` (una fila por partido × jugador, incluidos los stints para la línea de tiempo) que devuelve datos solo si `teams.is_public = true`, y únicamente de partidos con `status = 'finished'`. El rol `anon` no tiene acceso directo a las tablas.

### 7.5 Estructura del repositorio
```
/app
  /(auth)/login
  /(app)/equipos/[teamId]/...
        plantel, torneos/[tournamentId], partidos/[matchId]/{previa,vivo,resumen}, estadisticas
  /p/[slug]                      -- público
/lib
  /rotation                      -- motor puro + tests
  /match                         -- eventos, derivación a stints/minutos, cronómetro
  /db (dexie schema, sync)
  /supabase (clients, types generados)
/components
/supabase/migrations
/docs/SPEC.md
```

---

## 8. Pantallas y flujos (UI)

Navegación inferior con 4 tabs: **Partido** · **Plantel** · **Estadísticas** · **Ajustes**. Arriba hay un selector de equipo y de torneo.

1. **Login**: email (magic link) o Google.
2. **Onboarding**: crear el primer equipo, cargar jugadores (alta rápida, uno por línea: "10 Juan MED"), crear torneo y configuración.
3. **Plantel**: lista con chips de posición. Gesto de deslizar para editar o desactivar.
4. **Partidos del torneo**: tarjetas de partido con estado. Botón flotante "Nuevo partido".
5. **Previa del partido** (en pasos):
   1. Asistencia: tocar para alternar entre presente, ausente, lesionado o tarde.
   2. Arquero y titulares (propuestos por el motor).
   3. **Plan**: grilla de ventanas (columnas) × jugadores (filas), con celdas coloreadas por posición. Tocar una celda la fija. Barra de minutos previstos por jugador.
   4. "Empezar partido".
6. **Partido en vivo** (la pantalla clave):
   - Arriba: cronómetro grande, período, marcador y estado de sincronización.
   - Centro: cancha esquemática con jugadores por posición (círculo con número y minutos).
   - Abajo: banco ordenado por prioridad.
   - Sobre la cancha aparece la **tarjeta de sugerencia**, que entra deslizándose desde abajo, con "Sale → Entra" y los botones Confirmar, Posponer y Descartar.
   - Acciones rápidas: ⚽ Gol, 🔁 Cambio manual, 🧤 Cambiar arquero, 🩹 Lesión, ↩︎ Deshacer.
   - Al confirmar un cambio, los jugadores intercambian lugar con una animación de layout.
7. **Resumen del partido**: marcador, Gantt de stints y tabla de minutos.
8. **Estadísticas**: tabs Tabla · Mapa de calor · Jugador.
9. **Ajustes**: configuración del torneo, link público (activar, copiar, regenerar) y tema.

### 8.1 Lineamientos visuales
- Paleta sobria con un color de acento, que es el color del equipo.
- Tipografía del sistema (sin fuentes web) para mantener el bundle chico. Cifras tabulares en el cronómetro y en los minutos.
- Transiciones: *shared layout* para jugador ↔ banco, *slide* entre pasos de la previa y *fade/scale* en modales. Siempre con `prefers-reduced-motion`.

---

## 9. Criterios de aceptación (flujos clave)

**CA-01 Plan equitativo**
- Dado un torneo F7 (N = 7, 2×25 min, b = 5) con 12 presentes y el arquero fijo,
- cuando genero el plan,
- entonces cada jugador de campo tiene entre 25 y 30 minutos previstos (M = 300 entre 11 jugadores ≈ 27,3) y la formación se respeta en cada ventana siempre que haya jugadores de la posición.

**CA-02 Compensación del torneo**
- Dado α = 0.5 y un jugador que en el torneo jugó el 60 % de su cuota justa,
- cuando genero el plan del partido siguiente,
- entonces su cuota es mayor que la de un jugador con el 100 %.

**CA-03 Offline**
- Dado que el dispositivo está en modo avión desde antes del inicio,
- cuando juego el partido completo con cambios y goles, y luego vuelvo a tener conexión,
- entonces todos los eventos quedan en Supabase sin duplicados y las estadísticas coinciden con las locales.

**CA-04 Cronómetro resiliente**
- Dado un período en curso,
- cuando bloqueo la pantalla 3 minutos (o recargo la página),
- entonces al volver el cronómetro muestra el tiempo correcto (±1 s).

**CA-05 Lesión**
- Dado un jugador en cancha,
- cuando lo marco como lesionado,
- entonces se sugiere de inmediato un reemplazo de la misma posición (o la más cercana) y el plan restante se recalcula sin él.

**CA-06 Llegada tarde**
- Dado un jugador marcado "llega tarde",
- cuando lo marco como disponible en el minuto 15,
- entonces su cuota se recalcula con los minutos disponibles restantes y entra en las próximas ventanas.

**CA-07 Vista pública**
- Dado un equipo con link público activo,
- cuando un visitante sin sesión abre `/p/{slug}`,
- entonces ve la tabla y el mapa de calor del torneo actual, solo con partidos finalizados (no ve planes, convocatorias ni partidos en curso). Si el link se desactiva o se regenera, el anterior devuelve 404.

**CA-08 Avisos**
- Dado que llega una ventana con cambios,
- entonces el dispositivo vibra (si lo soporta) o emite un sonido corto (si está habilitado), y la tarjeta de sugerencia aparece con una animación.


**CA-09 Todos juegan**
- Dado un partido con 22 presentes, N = 7 y α = 1, con un jugador cuyo acumulado es del 150 %,
- cuando genero el plan,
- entonces ese jugador igual tiene al menos los minutos garantizados en el plan.
- Y si en vivo el DT descarta sugerencias y quedan justo los minutos garantizados para terminar el partido, la entrada de ese jugador se sugiere con prioridad máxima.

**CA-10 Pausas**
- Dado un período pausado 2 minutos,
- cuando se reanuda,
- entonces ningún jugador suma minutos por ese lapso, y el partido termina cuando se cumplen los minutos efectivos configurados.

**CA-11 Compartir**
- Dado un partido finalizado,
- cuando toco "Compartir",
- entonces veo la vista previa de la infografía del partido en el formato elegido (4:5 o 9:16), y al confirmar se abre la hoja nativa de compartir con el PNG. En escritorio, el PNG se descarga.
- Y desde Estadísticas puedo generar las infografías del torneo y de cada jugador, también sin conexión.
- Y con 25 jugadores la infografía muestra a todos, legibles y sin cortes.
---

## 10. Plan de entregas (hitos)

| Fase | Contenido | Requisitos |
|---|---|---|
| **F0 Setup** | Repo, Next.js, Tailwind, Supabase (proyecto y migraciones), CI con lint y tests, deploy en Vercel. | — |
| **F1 Núcleo** | Motor de rotación y derivación de stints como librería pura, con tests (antes de cualquier UI). | §6, CA-R* |
| **F2 Datos y auth** | Login, equipos, plantel, torneos y configuración. Dexie y sincronización básica. | RF-01..08, RF-32..35 |
| **F3 Previa** | Crear partido, asistencia, arquero, plan y edición del plan. | RF-09..14, CA-01, CA-02 |
| **F4 En vivo** | Cronómetro, cancha, sugerencias, cambios, lesión, arquero, goles, deshacer, avisos, wake lock. | RF-15..25, RF-38, CA-03..06, CA-08..10 |
| **F5 Estadísticas** | Tabla, mapa de calor, Gantt, ficha de jugador, vista pública y infografías para compartir. | RF-26..31, RF-36..37, CA-07, CA-11 |
| **F6 Pulido** | PWA instalable, transiciones, tema oscuro, auditoría de performance y accesibilidad. | RNF-* |

Definición de "hecho" para cada fase: los requisitos implementados, los criterios de aceptación de la fase cubiertos por tests (unitarios o E2E), el deploy funcionando en Vercel y esta spec actualizada si algo cambió.

---

## 11. Riesgos y consideraciones

| Riesgo | Mitigación |
|---|---|
| Supabase Free **pausa el proyecto tras 7 días sin actividad**. | Cron de Vercel (Hobby permite crons diarios) que haga una consulta liviana todos los días. |
| **Vercel Hobby es solo para uso no comercial.** | Si el SaaS empieza a cobrar, migrar a Vercel Pro o a otro hosting. |
| iOS Safari no soporta la Vibration API. | Aviso sonoro opcional más aviso visual (RF-19). |
| Wake Lock no disponible en algunos navegadores. | Mensaje sugiriendo desactivar el autobloqueo. |
| Conflictos entre dos dispositivos en el mismo partido. | El log de eventos se une sin conflictos (RF-35). Edición concurrente del plan: gana la última versión. |
| Complejidad del motor y casos borde. | Módulo puro con *property-based tests* desde F1. |

---

## 12. Preguntas abiertas

### Resueltas
- ~~¿Mínimo garantizado?~~ → Sí, todos los asistentes juegan (RF-38, CA-R8, CA-09).
- ~~¿Las pausas cuentan?~~ → No (RF-15, §6.2, CA-10).
- ~~¿Exportar?~~ → Sí, como **infografía** en imagen (no CSV): partido, torneo y jugador (RF-36, RF-37, CA-11).

- ~~¿La vista pública muestra el plan del próximo partido?~~ → No, solo estadísticas de partidos finalizados (RF-31).
- ~~¿Reingresos?~~ → Sí, permitidos sin límite (RF-39).

### Pendientes
Ninguna por ahora.
