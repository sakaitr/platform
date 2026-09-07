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
