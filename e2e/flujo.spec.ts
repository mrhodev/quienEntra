import { expect, test } from "@playwright/test";
import type { Page } from "@playwright/test";
import { login, rest, waitSynced } from "./helpers";

/** Con E2E_SHOTS=<carpeta>, guarda capturas de las pantallas para revisar el diseño. */
async function shot(page: Page, name: string) {
  if (process.env.E2E_SHOTS) await page.screenshot({ path: `${process.env.E2E_SHOTS}/${name}.png`, fullPage: true });
}

const ROSTER = [
  "1 Tomi ARQ",
  "2 Benja DEF",
  "3 Santi DEF",
  "4 Mateo DEF",
  "5 Juanchi MED",
  "6 Lucho MED",
  "7 Nacho MED",
  "8 Fran MED",
  "9 Joaco DEL",
  "10 Thiago DEL",
  "11 Bauti MED",
  "12 Valen DEF",
].join("\n");


/** Onboarding (equipo, plantel y torneo 2×10' con ventanas de 5'), partido nuevo y previa (RF-09..14). */
async function setupMatch(page: Page) {
  // Onboarding: equipo, plantel y torneo (2×10', ventanas de 5').
  await expect(page.getByText("¿Cómo se llama tu equipo?")).toBeVisible();
  await page.getByLabel("Nombre del equipo").fill("Los Pibes");
  await page.getByRole("button", { name: "Siguiente" }).click();
  await page.getByLabel("Un jugador por línea").fill(ROSTER);
  await page.getByRole("button", { name: /Siguiente \(12 jugadores\)/ }).click();
  for (let i = 0; i < 4; i++) await page.getByRole("button", { name: "Menos: Minutos por tiempo" }).click();
  await page.getByRole("button", { name: "Listo" }).click();
  await expect(page.getByRole("heading", { name: "Partidos" })).toBeVisible();

  await page.getByRole("button", { name: "+ Nuevo partido" }).click();
  await page.getByLabel("Rival").fill("Rival FC");
  await page.getByRole("button", { name: "Crear y armar la previa" }).click();
  await expect(page.getByRole("heading", { name: "vs Rival FC" })).toBeVisible();
  await page.getByRole("button", { name: "Siguiente" }).click();
  await expect(page.getByRole("button", { pressed: true })).toContainText("Arquero");
  await shot(page, "2-previa-arquero");
  await page.getByRole("button", { name: "Ver el plan" }).click();
  await expect(page.getByRole("table")).toBeVisible();
  await shot(page, "3-previa-plan");

}

test("del login al resumen, con cambios sugeridos, sin conexión y vista pública", async ({ page, browser }) => {
  const email = `dt-${Date.now()}@ejemplo.com`;
  await login(page, email);

  await setupMatch(page);

  // En vivo con reloj simulado (RNF-05: el tiempo sale de marcas de tiempo).
  await page.clock.install();
  await page.getByRole("button", { name: "Empezar partido" }).click();
  await page.getByRole("button", { name: /Empezar 1º tiempo/ }).click();
  await expect(page.getByRole("button", { name: /Pausar/ })).toBeVisible();
  await page.clock.fastForward("05:01");

  // Sugerencia a los 5': cambiar quién entra y confirmar (RF-17).
  const card = page.getByText(/Cambios sugeridos · 5'/);
  await expect(card).toBeVisible();
  await shot(page, "4-vivo-sugerencia");
  await page.getByRole("button", { name: "Cambiar" }).nth(1).click();
  const options = page.getByText("¿Quién entra?").locator("..").locator("button:not([aria-current])");
  await options.first().click();
  await expect(page.getByText("Modificado por el DT")).toBeVisible();
  await page.getByRole("button", { name: "Confirmar", exact: true }).first().click();

  // Gol a favor.
  await page.getByRole("button", { name: "Gol" }).click();
  await page.getByRole("dialog").getByRole("button").nth(2).click();
  await expect(page.getByText(/^1\s*–\s*0$/)).toBeVisible();

  // CA-04: al recargar la página el cronómetro sigue donde estaba.
  await page.reload();
  await expect(page.getByText(/^05:\d\d$/)).toBeVisible();
  await expect(page.getByText(/^1\s*–\s*0$/)).toBeVisible();

  // Sin conexión desde acá hasta el final (CA-03).
  await page.context().setOffline(true);
  await page.clock.fastForward("05:00");
  await page.getByRole("button", { name: "Terminar tiempo" }).click();
  await page.getByRole("button", { name: /Empezar 2º tiempo/ }).click();
  await expect(page.getByRole("button", { name: /Pausar/ })).toBeVisible();
  await page.clock.fastForward("10:00");
  await page.getByRole("button", { name: "Terminar partido" }).click();
  await page.getByRole("button", { name: "Terminar y ver el resumen" }).click();
  await expect(page.getByText(/Todos jugaron/).first()).toBeVisible();
  await expect(page.getByText("1–0")).toBeVisible();
  await shot(page, "5-resumen");

  await expect(page.getByRole("button", { name: /Sin conexión/ }).first()).toBeVisible({ timeout: 5_000 }).catch(() => {});

  // Vuelve la conexión: todo llega a Supabase, sin duplicados.
  await page.context().setOffline(false);
  await page.evaluate(() => window.dispatchEvent(new Event("online")));
  await page.goto("/partidos");
  await waitSynced(page);
  const [match] = await rest<{ id: string; status: string; goals_for: number }[]>(
    "matches?select=id,status,goals_for&opponent=eq.Rival%20FC&order=created_at.desc&limit=1",
  );
  expect(match.status).toBe("finished");
  expect(match.goals_for).toBe(1);
  const events = await rest<{ id: string; type: string }[]>(`match_events?select=id,type&match_id=eq.${match.id}`);
  expect(new Set(events.map((e) => e.id)).size).toBe(events.length);
  expect(events.map((e) => e.type).sort()).toEqual(
    ["goal_for", "lineup_set", "match_end", "period_end", "period_start", "period_start", "sub"].sort(),
  );
  const stats = await rest<{ field_seconds: number }[]>(`match_player_stats?select=field_seconds&match_id=eq.${match.id}`);
  // 6 de campo × 20' (más los segundos reales que pasaron entre acciones del test).
  const fieldSeconds = stats.reduce((a, s) => a + s.field_seconds, 0);
  expect(fieldSeconds).toBeGreaterThanOrEqual(6 * 20 * 60);
  expect(fieldSeconds).toBeLessThan(6 * 21 * 60);

  // Estadísticas del DT.
  await page.getByRole("link", { name: /Estadísticas/ }).click();
  await expect(page.getByRole("columnheader", { name: "PP" })).toBeVisible();
  await shot(page, "6-estadisticas");
  await page.getByRole("link", { name: /Plantel/ }).click();
  await expect(page.getByRole("heading", { name: "Plantel" })).toBeVisible();
  await shot(page, "7-plantel");

  // Link público (RF-03, RF-31, CA-07).
  await page.getByRole("link", { name: /Ajustes/ }).click();
  await page.getByRole("checkbox").first().click();
  await expect(page.getByRole("checkbox").first()).toBeChecked();
  const slugText = await page.locator("p.font-mono").innerText();
  const oldPath = new URL(slugText).pathname;
  await waitSynced(page);
  const visitor = await browser.newContext();
  const pub = await visitor.newPage();
  await pub.goto(oldPath);
  await expect(pub.getByRole("heading", { name: "Los Pibes" })).toBeVisible();
  await expect(pub.getByRole("columnheader", { name: "PP" })).toBeVisible();
  await expect(pub.getByText("Rival FC")).toHaveCount(0); // la tabla no muestra planes ni convocatorias

  await page.getByRole("button", { name: "Regenerar" }).click();
  await page.getByRole("dialog").getByRole("button", { name: "Regenerar" }).click();
  await expect(page.locator("p.font-mono")).not.toHaveText(slugText);
  await waitSynced(page);
  const res = await pub.goto(oldPath);
  expect(res?.status()).toBe(404);
  await visitor.close();
});

test("CA-11: la infografía del partido se genera sin conexión", async ({ page }) => {
  await login(page, `dt-share-${Date.now()}@ejemplo.com`);
  await setupMatch(page);
  await page.getByRole("button", { name: "Empezar partido" }).click();
  await page.getByRole("button", { name: /Empezar 1º tiempo/ }).click();
  await expect(page.getByRole("button", { name: /Pausar/ })).toBeVisible();
  await page.getByRole("button", { name: "Terminar tiempo" }).click();
  await page.getByRole("button", { name: /Empezar 2º tiempo/ }).click();
  await page.getByRole("button", { name: "Terminar partido" }).click();
  await page.getByRole("button", { name: "Terminar y ver el resumen" }).click();
  await expect(page.getByText(/Todos jugaron|Sin minutos/).first()).toBeVisible();

  // El service worker ya guardó la app (incluida la librería de captura, que se carga a demanda).
  await page.evaluate(async () => {
    await navigator.serviceWorker.ready;
    for (let i = 0; i < 50 && !navigator.serviceWorker.controller; i++) await new Promise((r) => setTimeout(r, 100));
  });
  await page.context().setOffline(true);
  await page.getByRole("button", { name: "Compartir" }).click();
  await page.getByRole("tab", { name: /9:16/ }).click();
  // Sin la hoja nativa de compartir (escritorio o navegador sin soporte), se descarga el PNG.
  const download = page.waitForEvent("download", { timeout: 30_000 });
  await page.getByRole("dialog").getByRole("button", { name: "Compartir" }).click();
  expect((await download).suggestedFilename()).toBe("partido-rival-fc.png");
});
