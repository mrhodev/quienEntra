import type { MetadataRoute } from "next";

/** PWA instalable (RF-32). */
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "quienEntra",
    short_name: "quienEntra",
    description: "Rotaciones equitativas y estadísticas de minutos para tu equipo de fútbol.",
    lang: "es-AR",
    start_url: "/partidos",
    scope: "/",
    display: "standalone",
    orientation: "portrait",
    background_color: "#f6f7f5",
    theme_color: "#16a34a",
    icons: [
      { src: "/icon-192.png", sizes: "192x192", type: "image/png", purpose: "maskable" },
      { src: "/icon-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
      { src: "/icon-512.png", sizes: "512x512", type: "image/png", purpose: "any" },
    ],
  };
}
