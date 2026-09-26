/** Formatos de fecha y minutos en es-AR. */

export function formatKickoff(iso: string | null): string {
  if (!iso) return "Sin fecha";
  const d = new Date(iso);
  return d.toLocaleString("es-AR", { weekday: "short", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });
}

export function formatDate(iso: string | null): string {
  if (!iso) return "";
  return new Date(iso).toLocaleDateString("es-AR", { day: "numeric", month: "short" });
}

export function minutes(seconds: number): string {
  return `${Math.round(seconds / 60)}'`;
}

export function pct(share: number | null): string {
  return share === null ? "—" : `${Math.round(share * 100)}%`;
}

/** Para <input type="datetime-local">. */
export function toLocalInput(iso: string | null): string {
  const d = iso ? new Date(iso) : new Date();
  const off = d.getTimezoneOffset() * 60_000;
  return new Date(d.getTime() - off).toISOString().slice(0, 16);
}

export function fromLocalInput(value: string): string | null {
  return value ? new Date(value).toISOString() : null;
}
