import { expect, type Page } from "@playwright/test";
import { execSync } from "node:child_process";

export const SUPABASE_URL = "http://127.0.0.1:54321";
const MAILPIT = "http://127.0.0.1:54324";
/** Clave de servicio de la Supabase LOCAL, leída de `supabase status` (no se guarda en el repo). */
function serviceKey(): string {
  if (process.env.SUPABASE_SERVICE_KEY) return process.env.SUPABASE_SERVICE_KEY;
  const out = execSync("npx supabase status -o json", { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] });
  const status = JSON.parse(out.slice(out.indexOf("{"), out.lastIndexOf("}") + 1)) as { SECRET_KEY?: string; SERVICE_ROLE_KEY?: string };
  return (process.env.SUPABASE_SERVICE_KEY = status.SECRET_KEY ?? status.SERVICE_ROLE_KEY ?? "");
}

/** Ingresa con link por email (RF-01): pide el link en la UI y lo abre desde Mailpit. */
export async function login(page: Page, email: string) {
  await page.goto("/login");
  await page.getByLabel("Email").fill(email);
  await page.getByRole("button", { name: "Mandame el link" }).click();
  await expect(page.getByText("Revisá tu email")).toBeVisible();

  let link: string | null = null;
  for (let i = 0; i < 40 && !link; i++) {
    const res = await fetch(`${MAILPIT}/api/v1/search?query=${encodeURIComponent(`to:"${email}"`)}`);
    const { messages } = (await res.json()) as { messages: { ID: string }[] };
    if (messages?.length) {
      const msg = (await (await fetch(`${MAILPIT}/api/v1/message/${messages[0].ID}`)).json()) as { Text: string };
      link = /(http:\/\/127\.0\.0\.1:54321\/auth\/v1\/verify\?[^\s)]+)/.exec(msg.Text)?.[1] ?? null;
    }
    if (!link) await new Promise((r) => setTimeout(r, 250));
  }
  if (!link) throw new Error("No llegó el email con el link");
  await page.goto(link.replace(/&amp;/g, "&"));
}

/** Consulta directa a la base local, saltando RLS (solo para verificar en los tests). */
export async function rest<T>(path: string): Promise<T> {
  const key = serviceKey();
  const res = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
    headers: { apikey: key, Authorization: `Bearer ${key}` },
  });
  if (!res.ok) throw new Error(`${path}: ${res.status} ${await res.text()}`);
  return (await res.json()) as T;
}

export async function waitSynced(page: Page) {
  await expect(page.getByRole("button", { name: /^Sincronizado/ }).first()).toBeVisible({ timeout: 20_000 });
}
