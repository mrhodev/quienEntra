import { createClient } from "@supabase/supabase-js";

/** Latido diario (spec §11, cron de Vercel): evita que Supabase Free pause el proyecto. */
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  // Vercel manda "Authorization: Bearer $CRON_SECRET" en los crons; si está configurado, se exige.
  const secret = process.env.CRON_SECRET;
  if (secret && request.headers.get("authorization") !== `Bearer ${secret}`) {
    return new Response("No autorizado", { status: 401 });
  }
  const supabase = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!, {
    auth: { persistSession: false },
  });
  const { error } = await supabase.rpc("keepalive");
  return Response.json({ ok: !error }, { status: error ? 500 : 200 });
}
