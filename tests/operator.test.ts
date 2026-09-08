import { afterEach, describe, expect, it } from "vitest";
import { isOperator, operatorEmails } from "@/lib/operator";

const original = process.env.PLATFORM_OPERATORS;

afterEach(() => {
  process.env.PLATFORM_OPERATORS = original;
});

describe("operatör listesi", () => {
  it("virgülle ayrılmış listeyi okur ve boşlukları temizler", () => {
    process.env.PLATFORM_OPERATORS = " a@x.com , b@y.com ";
    expect(operatorEmails()).toEqual(["a@x.com", "b@y.com"]);
  });

  it("büyük/küçük harf fark etmez", () => {
    process.env.PLATFORM_OPERATORS = "Kayra@Agno.Digital";
    expect(isOperator("kayra@agno.digital")).toBe(true);
    expect(isOperator("KAYRA@AGNO.DIGITAL")).toBe(true);
  });

  it("listede olmayan operatör değildir", () => {
    process.env.PLATFORM_OPERATORS = "a@x.com";
    expect(isOperator("b@y.com")).toBe(false);
  });

  it("değişken boşsa kimse operatör değildir", () => {
    process.env.PLATFORM_OPERATORS = "";
    expect(operatorEmails()).toEqual([]);
    expect(isOperator("a@x.com")).toBe(false);
  });

  it("değişken tanımsızsa kimse operatör değildir", () => {
    delete process.env.PLATFORM_OPERATORS;
    expect(isOperator("a@x.com")).toBe(false);
  });
});
