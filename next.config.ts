import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  env: {
    // Versión del service worker: cambia en cada deploy para renovar las copias guardadas.
    NEXT_PUBLIC_BUILD_ID: process.env.VERCEL_GIT_COMMIT_SHA ?? String(Date.now()),
    // Modo simulación (RF-41): en desarrollo y en los deploys de la rama `beta`, nunca en `main`.
    NEXT_PUBLIC_SIMULATION:
      process.env.SIMULATION === "1" ||
      process.env.VERCEL_GIT_COMMIT_REF === "beta" ||
      process.env.NODE_ENV !== "production"
        ? "1"
        : "0",
  },
  async headers() {
    return [
      {
        source: "/sw.js",
        headers: [
          { key: "Cache-Control", value: "no-cache, no-store, must-revalidate" },
          { key: "Service-Worker-Allowed", value: "/" },
        ],
      },
    ];
  },
};

export default nextConfig;
