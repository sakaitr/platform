const TZ = "Europe/Istanbul";

/** İstanbul yerel gününü YYYY-MM-DD olarak döner. UTC toISOString() gün kaydırır — kullanma. */
export function istanbulDayKey(date: Date = new Date()): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: TZ,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(date);
  const get = (type: string): string => parts.find((p) => p.type === type)!.value;
  return `${get("year")}-${get("month")}-${get("day")}`;
}

export function istanbulPeriodKey(
  reset: "none" | "yearly" | "monthly",
  date: Date = new Date(),
): string {
  if (reset === "none") return "";
  const day = istanbulDayKey(date);
  return reset === "yearly" ? day.slice(0, 4) : day.slice(0, 7);
}

/** YYYY-MM-DD → 08.09.2026. Boş değerde tire döner. */
export function formatDate(value: string | Date | null | undefined): string {
  if (!value) return "—";
  const key = typeof value === "string" ? value.slice(0, 10) : istanbulDayKey(value);
  const [y, m, d] = key.split("-");
  return y && m && d ? `${d}.${m}.${y}` : key;
}

/** YYYY-MM-DDTHH:mm → 08.09.2026 14:30 */
export function formatDateTime(value: string | Date | null | undefined): string {
  if (!value) return "—";
  const date = typeof value === "string" ? new Date(value) : value;
  if (Number.isNaN(date.getTime())) return String(value);
  return new Intl.DateTimeFormat("tr-TR", {
    timeZone: TZ,
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(date);
}

/** Bugünün İstanbul saatini HH:mm olarak döner. */
export function istanbulTime(date: Date = new Date()): string {
  return new Intl.DateTimeFormat("tr-TR", {
    timeZone: TZ,
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(date);
}

/** Tarih bugünden `days` gün içinde mi (veya geçmiş mi) — belge/ehliyet uyarıları için. */
export function isExpiringSoon(value: string | null | undefined, days: number): boolean {
  if (!value) return false;
  const today = istanbulDayKey();
  const limit = new Date(`${today}T00:00:00Z`);
  limit.setUTCDate(limit.getUTCDate() + days);
  return value.slice(0, 10) <= istanbulDayKey(limit);
}

/** Gün kaydırma: "2026-09-08" + 1 → "2026-09-09". Takvim gezinmesi için. */
export function shiftDay(dayKey: string, delta: number): string {
  const date = new Date(`${dayKey}T12:00:00Z`);
  date.setUTCDate(date.getUTCDate() + delta);
  return date.toISOString().slice(0, 10);
}
