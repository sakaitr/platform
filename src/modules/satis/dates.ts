import { istanbulDayKey, shiftDay } from "@/lib/time";

/**
 * "Bugün" Europe/Istanbul takvim günüdür. Türkiye'de yaz saati yok (UTC+3 sabit), bu yüzden
 * gün sınırı sabit +03:00 ofsetiyle kurulur. UTC gün sınırı kullanmak gece yarısından sonra
 * görevleri bir gün kaydırırdı.
 */
export function istanbulDayStart(dayKey: string): Date {
  return new Date(`${dayKey}T00:00:00+03:00`);
}

/** [başlangıç, ertesi günün başlangıcı) aralığı. */
export function istanbulDayRange(dayKey: string): { start: Date; end: Date } {
  return { start: istanbulDayStart(dayKey), end: istanbulDayStart(shiftDay(dayKey, 1)) };
}

/** `from` gününden `days` gün sonrasının 09:00'ı (İstanbul): otomatik takip önerisi için. */
export function followUpAfter(days: number, from: Date = new Date()): Date {
  return new Date(`${shiftDay(istanbulDayKey(from), days)}T09:00:00+03:00`);
}

export type TaskBucket = "overdue" | "today" | "upcoming" | "later" | "none";

/** Görevin vade grubu: tamamlanmamış bir görev için. */
export function taskBucket(dueAt: Date | null, now: Date = new Date()): TaskBucket {
  if (!dueAt) return "none";
  const today = istanbulDayKey(now);
  const { start, end } = istanbulDayRange(today);
  if (dueAt.getTime() < start.getTime()) return "overdue";
  if (dueAt.getTime() < end.getTime()) return "today";
  const weekEnd = istanbulDayStart(shiftDay(today, 8));
  return dueAt.getTime() < weekEnd.getTime() ? "upcoming" : "later";
}
