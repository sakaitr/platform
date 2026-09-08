import { describe, expect, it } from "vitest";
import {
  failedLabels,
  resolveResult,
  summarize,
  type CriterionAnswer,
} from "@/modules/filo/denetim/logic";

const answer = (
  label: string,
  value: CriterionAnswer["answer"],
): CriterionAnswer => ({ criterionId: label, label, answer: value });

describe("denetim sonucu", () => {
  it("hepsi onaysa geçti", () => {
    expect(resolveResult([answer("Lastik", "onay"), answer("Fren", "onay")])).toBe("gecti");
  });

  it("bir red varsa kaldı, koşullu olsa bile", () => {
    expect(
      resolveResult([answer("Lastik", "onay"), answer("Fren", "red"), answer("Işık", "kosullu")]),
    ).toBe("kaldi");
  });

  it("koşullu varsa şartlı", () => {
    expect(resolveResult([answer("Lastik", "onay"), answer("Işık", "kosullu")])).toBe("sartli");
  });

  it("hepsi atlandıysa bekliyor", () => {
    expect(resolveResult([answer("Lastik", "atlandi"), answer("Fren", "atlandi")])).toBe("bekliyor");
  });

  it("hiç kriter yoksa bekliyor", () => {
    expect(resolveResult([])).toBe("bekliyor");
  });

  it("atlanan kriter sonucu etkilemez", () => {
    expect(resolveResult([answer("Lastik", "onay"), answer("Fren", "atlandi")])).toBe("gecti");
  });
});

describe("denetim özeti", () => {
  const answers = [
    answer("Lastik", "onay"),
    answer("Fren", "onay"),
    answer("Işık", "red"),
    answer("Cam", "kosullu"),
    answer("Klima", "atlandi"),
  ];

  it("her cevabı sayar", () => {
    const s = summarize(answers);
    expect(s.toplam).toBe(5);
    expect(s.onay).toBe(2);
    expect(s.red).toBe(1);
    expect(s.kosullu).toBe(1);
    expect(s.atlandi).toBe(1);
  });

  it("başarı oranı atlananları saymaz", () => {
    // 2 onay / 4 değerlendirilen = %50
    expect(summarize(answers).basariOrani).toBe(50);
  });

  it("hiç değerlendirilmemişse oran sıfır", () => {
    expect(summarize([answer("Lastik", "atlandi")]).basariOrani).toBe(0);
    expect(summarize([]).basariOrani).toBe(0);
  });

  it("hepsi onaysa oran yüz", () => {
    expect(summarize([answer("A", "onay"), answer("B", "onay")]).basariOrani).toBe(100);
  });
});

describe("eksik kriterler", () => {
  it("red ve koşullu olanları döner", () => {
    expect(
      failedLabels([
        answer("Lastik", "onay"),
        answer("Fren", "red"),
        answer("Cam", "kosullu"),
        answer("Klima", "atlandi"),
      ]),
    ).toEqual(["Fren", "Cam"]);
  });

  it("eksik yoksa boş döner", () => {
    expect(failedLabels([answer("Lastik", "onay")])).toEqual([]);
  });
});
