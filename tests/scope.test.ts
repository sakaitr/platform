import { beforeEach, describe, expect, it } from "vitest";
import { dbAdmin } from "@/db/admin";
import { tenants, users } from "@/db/schema";
import { hashPassword } from "@/lib/auth";
import { getUserScope, isInScope, setUserScope } from "@/lib/scope";
import { resetDatabase } from "./setup";

const COMPANY_A = "11111111-1111-4111-8111-111111111111";
const COMPANY_B = "22222222-2222-4222-8222-222222222222";

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
  return { tenantId: tenant!.id, userId: user!.id };
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
    const { tenantId, userId } = await seedUser();
    await setUserScope(tenantId, userId, [COMPANY_A, COMPANY_B]);
    const scope = await getUserScope(tenantId, userId);
    expect(scope).toHaveLength(2);
    expect(scope).toContain(COMPANY_A);
  });

  it("boş dizi kapsamı kaldırır", async () => {
    const { tenantId, userId } = await seedUser();
    await setUserScope(tenantId, userId, [COMPANY_A]);
    await setUserScope(tenantId, userId, []);
    expect(await getUserScope(tenantId, userId)).toBeNull();
  });

  it("kapsam kontrolü", () => {
    expect(isInScope(null, COMPANY_A)).toBe(true);
    expect(isInScope([COMPANY_A], COMPANY_A)).toBe(true);
    expect(isInScope([COMPANY_A], COMPANY_B)).toBe(false);
    expect(isInScope([], COMPANY_A)).toBe(false);
  });
});
