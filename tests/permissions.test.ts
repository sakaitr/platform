import { describe, expect, it } from "vitest";
import { ALL_PERMISSIONS, isValidPermission, PERMISSION_CATALOG, permissionsFor } from "@/lib/permissions";

describe("izin kataloğu", () => {
  it("kaynak:eylem deseninde anahtar üretir", () => {
    expect(ALL_PERMISSIONS).toContain("araclar:read");
    expect(ALL_PERMISSIONS).toContain("hakedis:approve");
    expect(ALL_PERMISSIONS).toContain("audit:export");
  });

  it("her anahtar tam olarak bir iki nokta içerir", () => {
    for (const key of ALL_PERMISSIONS) {
      expect(key.split(":")).toHaveLength(2);
    }
  });

  it("anahtarlar benzersizdir", () => {
    expect(new Set(ALL_PERMISSIONS).size).toBe(ALL_PERMISSIONS.length);
  });

  it("geçerli/geçersiz anahtarı ayırt eder", () => {
    expect(isValidPermission("araclar:read")).toBe(true);
    expect(isValidPermission("uydurma:read")).toBe(false);
    expect(isValidPermission("araclar:ucmak")).toBe(false);
  });

  it("kaynağın eylemlerini döner", () => {
    expect(permissionsFor("araclar")).toContain("araclar:read");
    expect(permissionsFor("araclar")).toContain("araclar:create");
    expect(permissionsFor("uydurma")).toEqual([]);
  });

  it("çekirdek kaynaklar tanımlıdır", () => {
    for (const r of ["dashboard", "users", "roles", "settings", "terminology", "fields", "audit"]) {
      expect(PERMISSION_CATALOG[r]).toBeDefined();
    }
  });
});
