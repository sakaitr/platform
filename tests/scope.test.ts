import { beforeEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { dbAdmin } from "@/db/admin";
import { companies, tenants, users } from "@/db/schema";
import { hashPassword } from "@/lib/auth";
import { getUserScope, isInScope, setUserScope } from "@/lib/scope";
import { resetDatabase } from "./setup";

/** isInScope saf fonksiyon — DB'ye dokunmayan testlerde uydurma id yeterli. */
const FAKE_A = "11111111-1111-4111-8111-111111111111";
const FAKE_B = "22222222-2222-4222-8222-222222222222";

async function seedUser() {
  const [tenant] = await dbAdmin
    .insert(tenants)
    .values({ name: "T", slug: "t", sectorPack: "turizm", sectorPackVersion: "1.0.0" })
    .returning();
  const [user] = await dbAdmin
    .insert(users)
    .values({
      tenantId: tenant!.id,
      email: "a@x.com",
      name: "A",
      passwordHash: await hashPassword("Gizli1234!"),
    })
    .returning();
  const inserted = await dbAdmin
    .insert(companies)
    .values([
      { tenantId: tenant!.id, name: "A Firma" },
      { tenantId: tenant!.id, name: "B Firma" },
    ])
    .returning();
  return {
    tenantId: tenant!.id,
    userId: user!.id,
    companyA: inserted[0]!.id,
    companyB: inserted[1]!.id,
  };
}

describe("kullanıcı kapsamı", () => {
  beforeEach(async () => {
    await resetDatabase();
  });

  it("kapsam tanımsızsa null döner (kısıtlama yok)", async () => {
    const { tenantId, userId } = await seedUser();
    expect(await getUserScope(tenantId, userId)).toBeNull();
  });

  it("kapsam atar ve okur", async () => {
    const { tenantId, userId, companyA, companyB } = await seedUser();
    await setUserScope(tenantId, userId, [companyA, companyB]);
    const scope = await getUserScope(tenantId, userId);
    expect(scope).toHaveLength(2);
    expect(scope).toContain(companyA);
  });

  it("boş dizi kapsamı kaldırır", async () => {
    const { tenantId, userId, companyA } = await seedUser();
    await setUserScope(tenantId, userId, [companyA]);
    await setUserScope(tenantId, userId, []);
    expect(await getUserScope(tenantId, userId)).toBeNull();
  });

  it("kapsam kontrolü", () => {
    expect(isInScope(null, FAKE_A)).toBe(true);
    expect(isInScope([FAKE_A], FAKE_A)).toBe(true);
    expect(isInScope([FAKE_A], FAKE_B)).toBe(false);
    expect(isInScope([], FAKE_A)).toBe(false);
  });
});

describe("kapsam bütünlüğü", () => {
  beforeEach(async () => {
    await resetDatabase();
  });

  it("var olmayan firmaya kapsam atanamaz", async () => {
    const { tenantId, userId } = await seedUser();
    await expect(setUserScope(tenantId, userId, [FAKE_A])).rejects.toThrow();
  });

  it("firma silinince kapsam kaydı da silinir", async () => {
    const { tenantId, userId, companyA, companyB } = await seedUser();
    await setUserScope(tenantId, userId, [companyA, companyB]);
    await dbAdmin.delete(companies).where(eq(companies.id, companyA));
    expect(await getUserScope(tenantId, userId)).toEqual([companyB]);
  });
});
