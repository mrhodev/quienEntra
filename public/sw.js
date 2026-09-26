/* Service worker de quienEntra (RF-32): la app funciona sin conexión en la cancha.
 *
 * - Al instalarse guarda todas las pantallas de la app (son estáticas: los datos viven en
 *   IndexedDB) y los scripts y estilos que usan.
 * - Pantallas: primero la red (con límite de tiempo) y, sin conexión, la copia guardada.
 * - /_next/static: inmutables, primero la copia guardada.
 * - Datos de Supabase: no pasan por acá (otro dominio); la app usa su propia cola.
 */

const VERSION = new URL(self.location.href).searchParams.get("v") || "dev";
const PAGES = `pages-${VERSION}`;
const STATIC = `static-${VERSION}`;

const APP_ROUTES = [
  "/",
  "/login",
  "/bienvenida",
  "/partidos",
  "/partido/previa",
  "/partido/vivo",
  "/partido/resumen",
  "/plantel",
  "/estadisticas",
  "/ajustes",
  "/demo",
  "/demo/en-vivo",
];
const EXTRA = ["/manifest.webmanifest", "/icon-192.png", "/icon-512.png"];
const NAV_TIMEOUT_MS = 3500;

async function precache() {
  const pages = await caches.open(PAGES);
  const statics = await caches.open(STATIC);
  const assets = new Set();
  await Promise.all(
    APP_ROUTES.map(async (route) => {
      try {
        const res = await fetch(route, { credentials: "same-origin", cache: "no-cache" });
        if (!res.ok) return;
        const html = await res.clone().text();
        await pages.put(route, res);
        for (const m of html.matchAll(/\/_next\/static\/[^"'\s)\\]+/g)) assets.add(m[0]);
      } catch {
        // Sin red al instalar: se completa en la próxima visita.
      }
    }),
  );
  // Los scripts cargados a demanda (por ejemplo, la captura de infografías) no aparecen en el
  // HTML: se siguen las referencias "static/chunks/…" dentro de cada script hasta cubrirlos todos.
  const queue = [...assets, ...EXTRA];
  const seen = new Set(queue);
  while (queue.length) {
    const batch = queue.splice(0, 12);
    await Promise.all(
      batch.map(async (url) => {
        try {
          let res = await statics.match(url);
          if (!res) {
            res = await fetch(url);
            if (!res.ok) return;
            await statics.put(url, res.clone());
          }
          if (!url.endsWith(".js")) return;
          const code = await res.text();
          for (const m of code.matchAll(/static\/chunks\/[\w.-]+\.(?:js|css)/g)) {
            const next = `/_next/${m[0]}`;
            if (!seen.has(next)) {
              seen.add(next);
              queue.push(next);
            }
          }
        } catch {
          /* ignorar */
        }
      }),
    );
  }
}

self.addEventListener("install", (event) => {
  event.waitUntil(precache().then(() => self.skipWaiting()));
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    (async () => {
      for (const key of await caches.keys()) {
        if (key !== PAGES && key !== STATIC) await caches.delete(key);
      }
      await self.clients.claim();
    })(),
  );
});

function withTimeout(promise, ms) {
  return Promise.race([promise, new Promise((_, reject) => setTimeout(() => reject(new Error("timeout")), ms))]);
}

async function navigation(request) {
  const url = new URL(request.url);
  const cache = await caches.open(PAGES);
  try {
    const res = await withTimeout(fetch(request), NAV_TIMEOUT_MS);
    // Solo se guardan las pantallas de la app (no el callback de login ni páginas con error).
    if (res.ok && APP_ROUTES.includes(url.pathname)) await cache.put(url.pathname, res.clone());
    return res;
  } catch {
    const cached = (await cache.match(url.pathname)) || (await cache.match(request, { ignoreSearch: true }));
    if (cached) return cached;
    return (await cache.match("/partidos")) || (await cache.match("/")) || Response.error();
  }
}

async function cacheFirst(request) {
  const cache = await caches.open(STATIC);
  const cached = await cache.match(request, { ignoreSearch: false });
  if (cached) return cached;
  const res = await fetch(request);
  if (res.ok) await cache.put(request, res.clone());
  return res;
}

async function staleWhileRevalidate(request) {
  const cache = await caches.open(STATIC);
  const cached = await cache.match(request);
  const network = fetch(request)
    .then((res) => {
      if (res.ok) void cache.put(request, res.clone());
      return res;
    })
    .catch(() => cached || Response.error());
  return cached || network;
}

self.addEventListener("fetch", (event) => {
  const { request } = event;
  if (request.method !== "GET") return;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;
  if (url.pathname.startsWith("/api/") || url.pathname.startsWith("/auth/")) return;

  if (request.mode === "navigate") {
    event.respondWith(navigation(request));
    return;
  }
  // Datos de navegación de Next (RSC): sin conexión fallan y Next recarga la página,
  // que la sirve la copia guardada.
  if (request.headers.get("RSC") === "1" || url.searchParams.has("_rsc")) return;

  if (url.pathname.startsWith("/_next/static/")) {
    event.respondWith(cacheFirst(request));
    return;
  }
  event.respondWith(staleWhileRevalidate(request));
});
