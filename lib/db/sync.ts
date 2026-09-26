import type { SupabaseClient } from "@supabase/supabase-js";
import { db, getMeta, setMeta, type OutboxEntry } from "./local";
import { PRIMARY_KEY, rowKey, TABLES, type TableName, type TableRows } from "./types";

/** Acceso remoto mínimo que necesita la sincronización; en los tests se reemplaza por uno en memoria. */
export interface Remote {
  upsert(table: TableName, rows: object[], opts: { onConflict: string; ignoreDuplicates: boolean }): Promise<void>;
  /** Filas con `updated_at >= since`, ordenadas por `updated_at`. */
  pull(table: TableName, since: string | null, limit: number): Promise<object[]>;
}

export function supabaseRemote(client: SupabaseClient): Remote {
  return {
    async upsert(table, rows, opts) {
      const { error } = await client.from(table).upsert(rows, opts);
      if (error) throw new Error(`${table}: ${error.message}`);
    },
    async pull(table, since, limit) {
      let q = client.from(table).select("*").order("updated_at").limit(limit);
      if (since) q = q.gte("updated_at", since);
      const { data, error } = await q;
      if (error) throw new Error(`${table}: ${error.message}`);
      return data ?? [];
    },
  };
}

const PUSH_BATCH = 200;
const PULL_LIMIT = 1000;
/** Margen para no perder filas confirmadas con un `updated_at` apenas anterior al cursor. */
const PULL_OVERLAP_MS = 10_000;

/**
 * Envía la cola en orden (RF-33). Las fechas las pone el servidor: `created_at`/`updated_at`
 * no se envían, así el cursor de descarga no depende del reloj de cada dispositivo.
 * Devuelve cuántos cambios se confirmaron.
 */
export async function push(remote: Remote): Promise<number> {
  const entries = await db().outbox.orderBy("seq").toArray();
  let done = 0;
  let i = 0;
  while (i < entries.length) {
    const table = entries[i].table;
    const batch: OutboxEntry[] = [];
    while (i < entries.length && entries[i].table === table && batch.length < PUSH_BATCH) batch.push(entries[i++]);

    const rows = batch.map((e) => {
      const rest = { ...(e.row as unknown as Record<string, unknown>) };
      delete rest.created_at;
      delete rest.updated_at;
      return rest;
    });
    await remote.upsert(table, rows, {
      onConflict: PRIMARY_KEY[table].join(","),
      // El log de eventos es solo de agregado: un evento repetido no pisa al original.
      ignoreDuplicates: table === "match_events",
    });

    const d = db();
    await d.transaction("rw", d.outbox, async () => {
      for (const e of batch) {
        const current = await d.outbox.get(e.seq!);
        // Si la fila cambió mientras se enviaba, queda en la cola con la versión nueva.
        if (current && current.rev === e.rev) await d.outbox.delete(e.seq!);
      }
    });
    done += batch.length;
  }
  return done;
}

/**
 * Descarga incremental por tabla con un cursor de `updated_at` (§7.2). Una fila con cambios
 * locales pendientes no se pisa: gana la versión local, que se enviará en el próximo push.
 */
export async function pull(remote: Remote): Promise<number> {
  let total = 0;
  for (const table of TABLES) {
    let cursor = await getMeta<string>(`cursor:${table}`);
    for (;;) {
      const since = cursor ? new Date(Date.parse(cursor) - PULL_OVERLAP_MS).toISOString() : null;
      const rows = (await remote.pull(table, since, PULL_LIMIT)) as TableRows[TableName][];
      if (!rows.length) break;
      const d = db();
      await d.transaction("rw", d.table(table), d.outbox, async () => {
        for (const row of rows) {
          const pending = await d.outbox.where("[table+key]").equals([table, rowKey(table, row)]).count();
          if (!pending) await d.table(table).put(row);
        }
      });
      total += rows.length;
      const last = (rows[rows.length - 1] as { updated_at: string }).updated_at;
      const advanced = !cursor || last > cursor;
      cursor = last;
      await setMeta(`cursor:${table}`, cursor);
      if (rows.length < PULL_LIMIT || !advanced) break;
    }
  }
  return total;
}

export async function pendingCount(): Promise<number> {
  return db().outbox.count();
}

/** Borra los datos locales (por ejemplo, al entrar con otro usuario). */
export async function resetLocal(): Promise<void> {
  const d = db();
  await d.transaction("rw", d.tables, async () => {
    for (const t of d.tables) await t.clear();
  });
}
