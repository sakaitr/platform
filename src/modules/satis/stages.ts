import { foldText } from "./normalize";

export type StageKind = "open" | "won" | "lost";

export type StageDraft = { label: string; kind: StageKind };

/** Aşama anahtarı etiketten türetilir (küçük harf, ASCII); boşsa `asama`. */
export function stageKeyFromLabel(label: string): string {
  return foldText(label).slice(0, 40) || "asama";
}

/**
 * Pipeline kuralları: en az bir açık, bir kazanıldı, bir kaybedildi aşaması olmalı
 * (fırsat açılamaz ya da kapatılamaz hale gelmesin) ve etiketler benzersiz olmalı.
 */
export function validateStageSet(stages: readonly StageDraft[]): string | null {
  if (stages.length === 0) return "Pipeline'da en az bir aşama olmalı.";
  for (const stage of stages) {
    const label = stage.label.trim();
    if (label.length === 0) return "Aşama adı boş olamaz.";
    if (label.length > 100) return "Aşama adı en fazla 100 karakter olabilir.";
  }
  const seen = new Set<string>();
  for (const stage of stages) {
    const key = foldText(stage.label);
    if (seen.has(key)) return `"${stage.label.trim()}" adında iki aşama olamaz.`;
    seen.add(key);
  }
  if (!stages.some((s) => s.kind === "open")) return "En az bir açık aşama olmalı.";
  if (!stages.some((s) => s.kind === "won")) return "En az bir 'kazanıldı' aşaması olmalı.";
  if (!stages.some((s) => s.kind === "lost")) return "En az bir 'kaybedildi' aşaması olmalı.";
  return null;
}

/** Konumu yer değiştirerek taşır; sınırdaysa aynı diziyi döner. */
export function swapPosition<T extends { id: string; position: number }>(
  stages: readonly T[],
  id: string,
  direction: "up" | "down",
): { id: string; position: number }[] {
  const sorted = [...stages].sort((a, b) => a.position - b.position || a.id.localeCompare(b.id));
  const index = sorted.findIndex((s) => s.id === id);
  const neighbour = direction === "up" ? index - 1 : index + 1;
  if (index === -1 || neighbour < 0 || neighbour >= sorted.length) return [];
  // Konumlar eşit olabilir (eski veri): sıra numarasıyla yeniden numaralandır, sonra takas et.
  const renumbered = sorted.map((s, i) => ({ id: s.id, position: i + 1 }));
  const a = renumbered[index]!;
  const b = renumbered[neighbour]!;
  [a.position, b.position] = [b.position, a.position];
  return renumbered;
}
