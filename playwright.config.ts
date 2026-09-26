import { defineConfig, devices } from "@playwright/test";

/**
 * E2E en viewport móvil (§7.1) contra la app compilada y Supabase local (`npx supabase start`).
 * `npm run test:e2e`.
 */
const PORT = 3100;

export default defineConfig({
  testDir: "e2e",
  timeout: 120_000,
  fullyParallel: false,
  workers: 1,
  reporter: [["list"]],
  use: {
    ...devices["Pixel 7"],
    baseURL: `http://127.0.0.1:${PORT}`,
    locale: "es-AR",
    timezoneId: "America/Argentina/Buenos_Aires",
    trace: "retain-on-failure",
  },
  webServer: {
    command: `npx next build && npx next start -p ${PORT} -H 127.0.0.1`,
    url: `http://127.0.0.1:${PORT}`,
    timeout: 300_000,
    reuseExistingServer: !process.env.CI,
    stdout: process.env.E2E_SERVER_LOG ? "pipe" : "ignore",
  },
});
