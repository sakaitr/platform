export type CriterionAnswer = {
  criterionId: string;
  label: string;
  answer: "onay" | "red" | "kosullu" | "atlandi";
  note?: string | null;
};

export type InspectionResult = "gecti" | "kaldi" | "sartli" | "bekliyor";

/**
 * Denetim sonucu kriterlerden çıkar, elle seçilmez:
 * bir kriter bile "red" ise kaldı, "koşullu" varsa şartlı, hepsi onaysa geçti.
 * Hiç değerlendirilmediyse bekliyor.
 */
export function resolveResult(answers: readonly CriterionAnswer[]): InspectionResult {
  const answered = answers.filter((a) => a.answer !== "atlandi");
  if (answered.length === 0) return "bekliyor";
  if (answered.some((a) => a.answer === "red")) return "kaldi";
  if (answered.some((a) => a.answer === "kosullu")) return "sartli";
  return "gecti";
}

/** Denetim özeti — kaç kriter onaylandı, kaç eksik. */
export function summarize(answers: readonly CriterionAnswer[]): {
  toplam: number;
  onay: number;
  red: number;
  kosullu: number;
  atlandi: number;
  basariOrani: number;
} {
  const count = (value: CriterionAnswer["answer"]): number =>
    answers.filter((a) => a.answer === value).length;

  const onay = count("onay");
  const degerlendirilen = answers.length - count("atlandi");
  return {
    toplam: answers.length,
    onay,
    red: count("red"),
    kosullu: count("kosullu"),
    atlandi: count("atlandi"),
    basariOrani: degerlendirilen === 0 ? 0 : Math.round((onay / degerlendirilen) * 100),
  };
}

/** Reddedilen ve koşullu kriterler — görev açarken açıklamaya girer. */
export function failedLabels(answers: readonly CriterionAnswer[]): string[] {
  return answers.filter((a) => a.answer === "red" || a.answer === "kosullu").map((a) => a.label);
}
