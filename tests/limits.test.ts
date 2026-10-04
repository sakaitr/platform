import { beforeEach, describe, expect, it } from "vitest";
import { and, eq } from "drizzle-orm";
import { dbAdmin } from "@/db/admin";
import { crmLeads, invites, subscriptions, tenantModules, tenants, users } from "@/db/schema";
import { applySectorPack } from "@/lib/sector/install";
import { assertWithinLimit, checkLimit, evaluateLimit, LimitExceededError } from "@/lib/limits";
import { resetDatabase } from "./setup";

describe("limit kararı (saf)", () => {
  it("tanımsız sınır = sınırsız", () => {
    expect(evaluateLimit({}, "max_leads", 1_000_000)).toEqual({ ok: true });
  });
  it("sınıra kadar izin verir, aşınca reddeder", () => {
    expect(evaluateLimit({ max_leads: 3 }, "max_leads", 2)).toEqual({ ok: true });
    const over = evaluateLimit({ max_leads: 3 }, "max_leads", 3);
    expect(over.ok).toBe(false);
    if (!over.ok) expect(over.message).toContain("3 aday");
  });
  it("toplu ekleme toplamı sınırı aşıyorsa reddeder", () => {
    expect(evaluateLimit({ max_leads: 10 }, "max_leads", 8, 2)).toEqual({ ok: true });
    expect(evaluateLimit({ max_leads: 10 }, "max_leads", 8, 3).ok).toBe(false);
  });
  it("geçersiz değerler sınırsız sayılır", () => {
    expect(evaluateLimit({ max_leads: "x" }, "max_leads", 5).ok).toBe(true);
    expect(evaluateLimit({ max_leads: -1 }, "max_leads", 5).ok).toBe(true);
  });
});

describe("limit yardımcısı (veritabanı)", () => {
  beforeEach(async () => {
    await resetDatabase();
  });

  async function seed(limits: Record<string, number>) {
    const [t] = await dbAdmin
      .insert(tenants)
      .values({ name: "S", slug: "s", sectorPack: "satis_crm", sectorPackVersion: "1.0.0" })
      .returning();
    await dbAdmin.insert(subscriptions).values({
      tenantId: t!.id,
      status: "active",
      currentPeriodEnd: new Date(Date.now() + 30 * 86_400_000),
    });
    await applySectorPack(t!.id, "satis_crm");
    await dbAdmin
      .update(tenantModules)
      .set({ limits })
      .where(and(eq(tenantModules.tenantId, t!.id), eq(tenantModules.moduleKey, "satis")));
    return t!;
  }

  it("varsayılan sınırsız: kayıt ekleme engellenmez", async () => {
    const t = await seed({});
    expect(await checkLimit(t.id, "satis", "max_leads")).toEqual({ ok: true });
  });

  it("max_leads dolunca yeni aday engellenir", async () => {
    const t = await seed({ max_leads: 2 });
    await dbAdmin.insert(crmLeads).values([
      { tenantId: t.id, name: "A" },
      { tenantId: t.id, name: "B" },
    ]);
    await expect(assertWithinLimit(t.id, "satis", "max_leads")).rejects.toBeInstanceOf(
      LimitExceededError,
    );
  });

  it("max_users kullanıcıları ve bekleyen davetleri sayar, kabul edilmiş daveti ikinci kez saymaz", async () => {
    const t = await seed({ max_users: 3 });
    await dbAdmin.insert(users).values({ tenantId: t.id, email: "a@x.com", name: "A", passwordHash: "x" });
    const future = new Date(Date.now() + 86_400_000);
    await dbAdmin.insert(invites).values({
      tenantId: t.id, email: "b@x.com", name: "B", role: "member", tokenHash: "h1", expiresAt: future,
    });
    await dbAdmin.insert(invites).values({
      tenantId: t.id, email: "c@x.com", name: "C", role: "member", tokenHash: "h2",
      expiresAt: future, acceptedAt: new Date(),
    });
    // 1 kullanıcı + 1 bekleyen davet = 2; bir tane daha sığar, ikincisi sığmaz
    expect(await checkLimit(t.id, "satis", "max_users")).toEqual({ ok: true });
    expect((await checkLimit(t.id, "satis", "max_users", 2)).ok).toBe(false);
  });
});
