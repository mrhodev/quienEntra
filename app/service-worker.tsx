"use client";

import { useEffect } from "react";

/** Registra el service worker en producción (en desarrollo interferiría con la recarga en caliente). */
export function ServiceWorker() {
  useEffect(() => {
    if (process.env.NODE_ENV !== "production" || !("serviceWorker" in navigator)) return;
    const v = process.env.NEXT_PUBLIC_BUILD_ID ?? "dev";
    navigator.serviceWorker.register(`/sw.js?v=${encodeURIComponent(v)}`, { scope: "/", updateViaCache: "none" }).catch(() => {
      // Sin service worker la app sigue funcionando online.
    });
  }, []);
  return null;
}
