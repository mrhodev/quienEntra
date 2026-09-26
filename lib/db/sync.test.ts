import "fake-indexeddb/auto";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { db, LocalDb, setDb, write } from "./local";
import { pull, push, type Remote } from "./sync";
import { PRIMARY_KEY, type PlayerRow, type TableName, type MatchEventRow } from "./types";

/** Servidor en memoria: asigna `updated_at` al guardar, como el trigger de Postgres. */
function fakeRemote() {
  const tables = new Map<TableName, Map<string, Record<string, unknown>>>();
  let clock = Date.parse("2026-01-01T00:00:00Z");
  const tick = () => new Date((clock += 1000)).toISOString();
  const store = (t: TableName) => {
    if (!tables.has(t)) tables.set(t, new Map());
    return tables.get(t)!;
  };
  let failNext = false;
  const remote: Remote = {
    async upsert(table, rows, { ignoreDuplicates }) {
      if (failNext) {
        failNext = false;
        throw new Error("sin conexión");
      }
      for (const r of rows as Record<string, unknown>[]) {
        const key = PRIMARY_KEY[table].map((k) => String(r[k])).join("|");
        const prev = store(table).get(key);
        if (prev && ignoreDuplicates) continue;
        const now = tick();
        store(table).set(key, { ...prev, ...r, created_at: prev?.created_at ?? now, updated_at: now });
      }
    },
    async pull(table, since, limit) {
      return [...store(table).values()]
        .filter((r) => !since || (r.updated_at as string) >= since)
        .sort((a, b) => ((a.updated_at as string) < (b.updated_at as string) ? -1 : 1))
        .slice(0, limit);
    },
  };
  return { remote, store, failOnce: () => (failNext = true) };
}

const player = (id: string, name: string): PlayerRow => ({
  id,
  team_id: "t1",
  name,
  nickname: null,
  shirt_number: null,
  primary_position: "MED",
  secondary_positions: [],
  active: true,
  created_at: "2026-01-01T00:00:00Z",
  updated_at: "2026-01-01T00:00:00Z",
  deleted_at: null,
});

let n = 0;
beforeEach(() => setDb(new LocalDb(`test-${n++}`)));
afterEach(async () => {
  await db().delete();
  setDb(null);
});

describe("sincronización (RF-33, RF-35)", () => {
  it("escribe local, encola y al enviar vacía la cola; el servidor pone las fechas", async () => {
    const { remote, store } = fakeRemote();
    await write("players", [player("p1", "Tomás")]);
    expect(await db().outbox.count()).toBe(1);
    expect(await push(remote)).toBe(1);
    expect(await db().outbox.count()).toBe(0);
    expect(store("players").get("p1")!.updated_at).not.toBe("2026-01-01T00:00:00Z");
  });

  it("varias ediciones de la misma fila sin conexión se envían una sola vez, con la última versión", async () => {
    const { remote, store } = fakeRemote();
    await write("players", [player("p1", "Tomás")]);
    await write("players", [player("p1", "Tomi")]);
    expect(await db().outbox.count()).toBe(1);
    await push(remote);
    expect(store("players").get("p1")!.name).toBe("Tomi");
  });

  it("si el envío falla, la cola queda intacta para reintentar", async () => {
    const { remote, failOnce, store } = fakeRemote();
    await write("players", [player("p1", "Tomás")]);
    failOnce();
    await expect(push(remote)).rejects.toThrow();
    expect(await db().outbox.count()).toBe(1);
    await push(remote);
    expect(store("players").has("p1")).toBe(true);
  });

  it("los eventos repetidos no se duplican ni pisan al original (CA-03)", async () => {
    const { remote, store } = fakeRemote();
    const ev = (name: string): MatchEventRow => ({
      id: "e1",
      team_id: "t1",
      match_id: "m1",
      seq: 0,
      type: "goal_for",
      payload: { scorerId: name },
      match_time_ms: 0,
      wall_time: "2026-01-01T00:00:00Z",
      device_id: "d1",
      created_at: "",
      updated_at: "",
    });
    await write("match_events", [ev("a")]);
    await push(remote);
    await write("match_events", [ev("b")]);
    await push(remote);
    expect(store("match_events").size).toBe(1);
    expect(store("match_events").get("e1")!.payload).toEqual({ scorerId: "a" });
  });

  it("descarga lo que cambió en otro dispositivo, sin pisar cambios locales pendientes", async () => {
    const { remote } = fakeRemote();
    // Otro dispositivo sube dos jugadores.
    await remote.upsert("players", [player("p1", "Tomás"), player("p2", "Benja")], {
      onConflict: "id",
      ignoreDuplicates: false,
    });
    // Acá hay un cambio local pendiente sobre p2.
    await write("players", [player("p2", "Benjamín")]);
    await pull(remote);
    expect((await db().players.get("p1"))!.name).toBe("Tomás");
    expect((await db().players.get("p2"))!.name).toBe("Benjamín");

    // Al enviar, gana la versión local; el próximo pull la trae con la fecha del servidor.
    await push(remote);
    await pull(remote);
    expect((await db().players.get("p2"))!.name).toBe("Benjamín");
  });

  it("dos dispositivos que registran eventos del mismo partido terminan con el log unido (RF-35)", async () => {
    const { remote } = fakeRemote();
    const event = (id: string, seq: number, device: string): MatchEventRow => ({
      id,
      team_id: "t1",
      match_id: "m1",
      seq,
      type: "goal_for",
      payload: {},
      match_time_ms: seq * 1000,
      wall_time: "2026-01-01T00:00:00Z",
      device_id: device,
      created_at: "",
      updated_at: "",
    });
    const a = new LocalDb("dev-a");
    const b = new LocalDb("dev-b");
    setDb(a);
    await write("match_events", [event("a1", 0, "a"), event("a2", 1, "a")]);
    await push(remote);
    setDb(b);
    await write("match_events", [event("b1", 0, "b")]);
    await push(remote);
    await pull(remote);
    expect((await db().match_events.toArray()).map((e) => e.id).sort()).toEqual(["a1", "a2", "b1"]);
    setDb(a);
    await pull(remote);
    expect((await db().match_events.toArray()).map((e) => e.id).sort()).toEqual(["a1", "a2", "b1"]);
    await a.delete();
    await b.delete();
  });
});
