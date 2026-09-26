import type { NextRequest } from "next/server";
import { createClient } from "@/lib/supabase/server";

/** Redirección relativa: el navegador la resuelve contra el mismo host donde quedaron las cookies. */
function redirect(path: string) {
  return new Response(null, { status: 303, headers: { Location: path } });
}

/** Vuelta del link por email o de Google: canjea el código por la sesión (cookies) y entra a la app. */
export async function GET(request: NextRequest) {
  const params = request.nextUrl.searchParams;
  const code = params.get("code");
  const next = params.get("next") ?? "/partidos";
  if (code) {
    const supabase = await createClient();
    const { error } = await supabase.auth.exchangeCodeForSession(code);
    if (!error) return redirect(next.startsWith("/") && !next.startsWith("//") ? next : "/partidos");
  }
  return redirect("/login?error=link");
}
