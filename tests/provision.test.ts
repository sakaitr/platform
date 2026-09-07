import { beforeEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { dbAdmin } from "@/db/admin";
import { subscriptions, tenantModules, tenants, users } from "@/db/schema";
import { verifyPassword } from "@/lib/auth";
import { provisionTenant } from "@/lib/sector/install";
import { resetDatabase } from "./setup";

describe("provizyon", () => {
  beforeEach(async () => {
    await resetDatabase();
  });

  it("kiracı, owner kullanıcı, abonelik ve paketi tek seferde kurar", async () => {
    const { tenantId, userId } = await provisionTenant({
      name: "Demo Lojistik",
      slug: "demo-lojistik",
      sectorPack: "lojistik",
      ownerEmail: "owner@demo.com",
      ownerName: "Demo Owner",
      ownerPassword: "Gizli1234!",
      trialDays: 14,
    });

    const [tenant] = await dbAdmin.select().from(tenants).where(eq(tenants.id, tenantId));
    expect(tenant!.sectorPack).toBe("lojistik");

    const [user] = await dbAdmin.select().from(users).where(eq(users.id, userId));
    expect(user!.role).toBe("owner");
    expect(await verifyPassword("Gizli1234!", user!.passwordHash)).toBe(true);

    const [sub] = await dbAdmin
      .select()
      .from(subscriptions)
      .where(eq(subscriptions.tenantId, tenantId));
    expect(sub!.status).toBe("trial");
    expect(sub!.trialEndsAt).not.toBeNull();

    const mods = await dbAdmin
      .select()
      .from(tenantModules)
      .where(eq(tenantModules.tenantId, tenantId));
    expect(mods.map((m) => m.moduleKey)).toContain("muhasebe");
  });

  it("aynı slug ile ikinci kez provizyon hata verir", async () => {
    const input = {
      name: "X",
      slug: "ayni",
      sectorPack: "turizm",
      ownerEmail: "a@x.com",
      ownerName: "A",
      ownerPassword: "Gizli1234!",
    };
    await provisionTenant(input);
    await expect(provisionTenant({ ...input, ownerEmail: "b@x.com" })).rejects.toThrow();
  });
});
