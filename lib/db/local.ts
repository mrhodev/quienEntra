import Dexie, { type Table } from "dexie";
import { rowKey, type TableName, type TableRows } from "./types";

/** Cambio pendiente de enviar a Supabase (RF-33). */
export interface OutboxEntry {
  seq?: number;
  table: TableName;
  key: string;
  row: TableRows[TableName];
  /** Aumenta cada vez que se reemplaza la fila; sirve para no borrar una versión más nueva. */
  rev: number;
}

export interface MetaEntry {
  key: string;
  value: unknown;
}

export class LocalDb extends Dexie {
  teams!: Table<TableRows["teams"], string>;
  players!: Table<TableRows["players"], string>;
  tournaments!: Table<TableRows["tournaments"], string>;
  matches!: Table<TableRows["matches"], string>;
  match_players!: Table<TableRows["match_players"], [string, string]>;
  match_plans!: Table<TableRows["match_plans"], string>;
  match_events!: Table<TableRows["match_events"], string>;
  match_player_stats!: Table<TableRows["match_player_stats"], [string, string]>;
  outbox!: Table<OutboxEntry, number>;
  meta!: Table<MetaEntry, string>;

  constructor(name = "quienentra") {
    super(name);
    this.version(1).stores({
      teams: "id, updated_at",
      players: "id, team_id",
      tournaments: "id, team_id",
      matches: "id, team_id, tournament_id",
      match_players: "[match_id+player_id], match_id, team_id",
      match_plans: "id, match_id",
      match_events: "id, match_id",
      match_player_stats: "[match_id+player_id], match_id, team_id",
      outbox: "++seq, [table+key]",
      meta: "key",
    });
  }

  table_<T extends TableName>(name: T): Table<TableRows[T], unknown> {
    return this.table(name) as Table<TableRows[T], unknown>;
  }
}

let instance: LocalDb | null = null;

export function db(): LocalDb {
  instance ??= new LocalDb();
  return instance;
}

/** Solo para tests. */
export function setDb(next: LocalDb | null) {
  instance = next;
}

export function nowIso(): string {
  return new Date().toISOString();
}

export function newId(): string {
  return crypto.randomUUID();
}

/**
 * Escritura local + cola de salida en una sola transacción (§7.2: la UI nunca espera a la red).
 * Si la fila ya estaba pendiente, se reemplaza en su lugar de la cola.
 */
export async function write<T extends TableName>(table: T, rows: TableRows[T][]): Promise<void> {
  if (!rows.length) return;
  const d = db();
  await d.transaction("rw", d.table(table), d.outbox, async () => {
    for (const row of rows) {
      await d.table_(table).put(row);
      const key = rowKey(table, row);
      const pending = await d.outbox.where("[table+key]").equals([table, key]).first();
      if (pending) await d.outbox.update(pending.seq!, { row, rev: pending.rev + 1 });
      else await d.outbox.add({ table, key, row, rev: 0 });
    }
  });
}

export async function getMeta<T>(key: string): Promise<T | undefined> {
  return (await db().meta.get(key))?.value as T | undefined;
}

export async function setMeta(key: string, value: unknown): Promise<void> {
  await db().meta.put({ key, value });
}
