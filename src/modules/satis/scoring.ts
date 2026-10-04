/**
 * Aday puanı (0-100). Agno CRM `scoreLead` kuralları: web sitesi 30, e-posta 25, telefon 20,
 * yüksek puan 15, sektör eşleşmesi 10, tavan 100. Atricard `temperature` gelirse puanı belirler.
 */

export type ScoreInput = {
  website?: string | null;
  email?: string | null;
  phone?: string | null;
  /** Dış kaynaktan gelen değerlendirme (0-5). */
  rating?: number | null;
  /** Kiracının hedef sektörüyle eşleşiyor mu. Hedef sektör ayarı henüz yok: çağıran bilirse verir. */
  sectorMatch?: boolean;
};

export type Temperature = "hot" | "warm" | "cold";

export const TEMPERATURE_SCORE: Record<Temperature, number> = { hot: 80, warm: 50, cold: 20 };

export const HIGH_RATING_THRESHOLD = 4.5;

export function scoreLead(input: ScoreInput): number {
  let score = 0;
  if (input.website?.trim()) score += 30;
  if (input.email?.trim()) score += 25;
  if (input.phone?.trim()) score += 20;
  if (typeof input.rating === "number" && input.rating >= HIGH_RATING_THRESHOLD) score += 15;
  if (input.sectorMatch) score += 10;
  return Math.min(100, score);
}

/** Sıcaklık varsa puanı o belirler, yoksa alan doluluğundan hesaplanır. */
export function resolveScore(input: ScoreInput & { temperature?: Temperature | null }): number {
  return input.temperature ? TEMPERATURE_SCORE[input.temperature] : scoreLead(input);
}
