import { beforeEach, describe, expect, it } from "vitest";
import { and, asc, eq } from "drizzle-orm";
import { dbAdmin } from "@/db/admin";
import { crmActivities, crmDeals, crmLeads, crmStages, subscriptions, tenants } from "@/db/schema";
import { withTenant } from "@/db/tenant";
import { applySectorPack } from "@/lib/sector/install";
import { followUpAfter, istanbulDayRange, taskBucket } from "@/modules/satis/dates";
import { createActivity, createDeal, DealError, moveDeal } from "@/modules/satis/deals";
import { createLeadIfNew } from "@/modules/satis/leads";
import { addStage, deleteStage, moveStage, StageError, updateStage } from "@/modules/satis/stage-service";
import { stageKeyFromLabel, swapPosition, validateStageSet } from "@/modules/satis/stages";
import { resetDatabase } from "./setup";

describe("aşama kuralları (saf)", () => {
  const ok = [
    { label: "Yeni", kind: "open" as const },
    { label: "Kazanıldı", kind: "won" as const },
    { label: "Kaybedildi", kind: "lost" as const },
  ];
  it("geçerli küme", () => expect(validateStageSet(ok)).toBeNull());
  it("açık, kazanıldı, kaybedildi eksikse hata", () => {
    expect(validateStageSet([])).toMatch(/en az bir aşama/);
    expect(validateStageSet(ok.filter((s) => s.kind !== "open"))).toMatch(/açık/);
    expect(validateStageSet(ok.filter((s) => s.kind !== "won"))).toMatch(/kazanıldı/);
    expect(validateStageSet(ok.filter((s) => s.kind !== "lost"))).toMatch(/kaybedildi/);
  });
  it("etiket boş, uzun ya da (Türkçe harf farkı gözetmeden) tekrarsa hata", () => {
    expect(validateStageSet([...ok, { label: "  ", kind: "open" }])).toMatch(/boş/);
    expect(validateStageSet([...ok, { label: "x".repeat(101), kind: "open" }])).toMatch(/100/);
    expect(validateStageSet([...ok, { label: "YENİ", kind: "open" }])).toMatch(/iki aşama/);
  });
  it("anahtar etiketten türer", () => {
    expect(stageKeyFromLabel("Görüşüldü")).toBe("gorusuldu");
    expect(stageKeyFromLabel("!!!")).toBe("asama");
  });
  it("sıra değiştirme: komşuyla takas, sınırda değişiklik yok, eşit konumlar yeniden numaralanır", () => {
    const s = [{ id: "a", position: 1 }, { id: "b", position: 2 }, { id: "c", position: 3 }];
    expect(swapPosition(s, "b", "up")).toEqual([{ id: "a", position: 2 }, { id: "b", position: 1 }, { id: "c", position: 3 }]);
    expect(swapPosition(s, "a", "up")).toEqual([]);
    expect(swapPosition(s, "c", "down")).toEqual([]);
    expect(swapPosition(s, "yok", "up")).toEqual([]);
    const ties = [{ id: "a", position: 0 }, { id: "b", position: 0 }];
    const swapped = swapPosition(ties, "b", "up");
    expect(swapped.find((x) => x.id === "b")!.position).toBe(1);
    expect(swapped.find((x) => x.id === "a")!.position).toBe(2);
  });
});

describe("İstanbul günü ve görev grupları", () => {
  it("gün aralığı +03:00 sabit ofsetli", () => {
    const { start, end } = istanbulDayRange("2026-10-04");
    expect(start.toISOString()).toBe("2026-10-03T21:00:00.000Z");
    expect(end.toISOString()).toBe("2026-10-04T21:00:00.000Z");
  });
  it("gece yarısından hemen sonra (İstanbul) bugün sayılır, UTC günü değil", () => {
    // 2026-10-04 00:30 İstanbul = 2026-10-03 21:30 UTC
    const now = new Date("2026-10-03T21:30:00Z");
    expect(taskBucket(new Date("2026-10-04T08:00:00+03:00"), now)).toBe("today");
    expect(taskBucket(new Date("2026-10-03T23:00:00+03:00"), now)).toBe("overdue");
  });
  it("gruplar: gecikmiş, bugün, bu hafta, sonra, vadesiz", () => {
    const now = new Date("2026-10-04T12:00:00+03:00");
    expect(taskBucket(new Date("2026-10-03T09:00:00+03:00"), now)).toBe("overdue");
    expect(taskBucket(new Date("2026-10-04T23:59:00+03:00"), now)).toBe("today");
    expect(taskBucket(new Date("2026-10-05T00:00:00+03:00"), now)).toBe("upcoming");
    expect(taskBucket(new Date("2026-10-11T23:00:00+03:00"), now)).toBe("upcoming");
    expect(taskBucket(new Date("2026-10-12T00:00:00+03:00"), now)).toBe("later");
    expect(taskBucket(null, now)).toBe("none");
  });
  it("takip önerisi: N gün sonrası 09:00 İstanbul", () => {
    const from = new Date("2026-10-03T22:00:00Z"); // 4 Ekim 01:00 İstanbul
    expect(followUpAfter(3, from).toISOString()).toBe("2026-10-07T06:00:00.000Z");
  });
});

async function seedTenant(slug = "t1") {
  const [t] = await dbAdmin
    .insert(tenants)
    .values({ name: slug, slug, sectorPack: "satis_crm", sectorPackVersion: "1.0.0" })
    .returning();
  await dbAdmin.insert(subscriptions).values({ tenantId: t!.id, status: "active" });
  await applySectorPack(t!.id, "satis_crm");
  return t!.id;
}

const stageByKey = async (tenantId: string, key: string) => {
  const [s] = await dbAdmin.select().from(crmStages).where(and(eq(crmStages.tenantId, tenantId), eq(crmStages.key, key)));
  return s!;
};

describe("fırsat ve aşama taşıma", () => {
  let tenantId: string;
  beforeEach(async () => {
    await resetDatabase();
    tenantId = await seedTenant();
  });

  const newDeal = (leadId?: string) =>
    withTenant(tenantId, (tx) => createDeal(tx, tenantId, { title: "Web sitesi", value: 5000, leadId: leadId ?? null }));

  it("fırsat ilk açık aşamada açılır; kapalı aşama istenirse yine ilk açık aşama", async () => {
    const id = await newDeal();
    const [deal] = await dbAdmin.select().from(crmDeals).where(eq(crmDeals.id, id));
    expect(deal!.stageId).toBe((await stageByKey(tenantId, "yeni")).id);
    expect(deal!.value).toBe("5000.00");

    const won = await stageByKey(tenantId, "kazanildi");
    const id2 = await withTenant(tenantId, (tx) => createDeal(tx, tenantId, { title: "X", stageId: won.id }));
    const [d2] = await dbAdmin.select().from(crmDeals).where(eq(crmDeals.id, id2));
    expect(d2!.stageId).toBe((await stageByKey(tenantId, "yeni")).id);
    expect(d2!.closedAt).toBeNull();
  });

  it("başka kiracının aşamasıyla fırsat açılamaz", async () => {
    const other = await seedTenant("t2");
    const foreign = await stageByKey(other, "yeni");
    await expect(
      withTenant(tenantId, (tx) => createDeal(tx, tenantId, { title: "X", stageId: foreign.id })),
    ).rejects.toMatchObject({ code: "stage_not_found" });
  });

  it("kazanıldı: closed_at yazılır, bağlı aday converted olur, zaman çizelgesine kayıt düşer", async () => {
    const lead = await withTenant(tenantId, (tx) => createLeadIfNew(tx, tenantId, { name: "Mavi Tur", source: "manual" }));
    if (lead.status !== "created") throw new Error("seed");
    const dealId = await newDeal(lead.id);
    const won = await stageByKey(tenantId, "kazanildi");
    const result = await withTenant(tenantId, (tx) => moveDeal(tx, tenantId, dealId, won.id, { userId: null }));
    expect(result).toMatchObject({ changed: true, leadConverted: true });
    expect(result.from.label).toBe("Yeni");
    expect(result.to.kind).toBe("won");

    const [deal] = await dbAdmin.select().from(crmDeals).where(eq(crmDeals.id, dealId));
    expect(deal!.closedAt).not.toBeNull();
    const [row] = await dbAdmin.select().from(crmLeads).where(eq(crmLeads.id, lead.id));
    expect(row!.status).toBe("converted");
    const acts = await dbAdmin.select().from(crmActivities).where(eq(crmActivities.dealId, dealId));
    expect(acts.map((a) => a.subject)).toContain("Aşama: Yeni → Kazanıldı");
  });

  it("kaybedildi neden olmadan reddedilir ve hiçbir şeyi değiştirmez; nedenle kabul edilir", async () => {
    const dealId = await newDeal();
    const lost = await stageByKey(tenantId, "kaybedildi");
    for (const reason of [undefined, null, "", "   "]) {
      await expect(
        withTenant(tenantId, (tx) => moveDeal(tx, tenantId, dealId, lost.id, { lostReason: reason })),
      ).rejects.toMatchObject({ code: "lost_reason_required" });
    }
    const [unchanged] = await dbAdmin.select().from(crmDeals).where(eq(crmDeals.id, dealId));
    expect(unchanged).toMatchObject({ closedAt: null, lostReason: null });

    await withTenant(tenantId, (tx) => moveDeal(tx, tenantId, dealId, lost.id, { lostReason: " Bütçe yok " }));
    const [done] = await dbAdmin.select().from(crmDeals).where(eq(crmDeals.id, dealId));
    expect(done!.lostReason).toBe("Bütçe yok");
    expect(done!.closedAt).not.toBeNull();
  });

  it("kapalı aşamadan açığa dönünce closed_at ve neden temizlenir", async () => {
    const dealId = await newDeal();
    const lost = await stageByKey(tenantId, "kaybedildi");
    const open = await stageByKey(tenantId, "gorusuldu");
    await withTenant(tenantId, (tx) => moveDeal(tx, tenantId, dealId, lost.id, { lostReason: "x" }));
    await withTenant(tenantId, (tx) => moveDeal(tx, tenantId, dealId, open.id));
    const [deal] = await dbAdmin.select().from(crmDeals).where(eq(crmDeals.id, dealId));
    expect(deal).toMatchObject({ closedAt: null, lostReason: null, stageId: open.id });
  });

  it("aynı aşamaya taşıma değişiklik sayılmaz ve kayıt yazmaz", async () => {
    const dealId = await newDeal();
    const same = await stageByKey(tenantId, "yeni");
    const before = (await dbAdmin.select().from(crmActivities).where(eq(crmActivities.dealId, dealId))).length;
    const result = await withTenant(tenantId, (tx) => moveDeal(tx, tenantId, dealId, same.id));
    expect(result.changed).toBe(false);
    expect((await dbAdmin.select().from(crmActivities).where(eq(crmActivities.dealId, dealId))).length).toBe(before);
  });

  it("olmayan fırsat ya da başka kiracının aşaması hata verir", async () => {
    const dealId = await newDeal();
    const other = await seedTenant("t2");
    const foreign = await stageByKey(other, "kazanildi");
    await expect(withTenant(tenantId, (tx) => moveDeal(tx, tenantId, dealId, foreign.id))).rejects.toBeInstanceOf(DealError);
    const yeni = await stageByKey(tenantId, "yeni");
    await expect(
      withTenant(tenantId, (tx) => moveDeal(tx, tenantId, "00000000-0000-0000-0000-000000000000", yeni.id)),
    ).rejects.toMatchObject({ code: "not_found" });
  });

  it("aktivite: bağlantısız reddedilir; görev açık, not tamamlanmış yazılır", async () => {
    const dealId = await newDeal();
    await expect(
      withTenant(tenantId, (tx) => createActivity(tx, tenantId, { type: "note", subject: "x" })),
    ).rejects.toThrow(/bağlı olmalı/);
    const task = await withTenant(tenantId, (tx) => createActivity(tx, tenantId, { type: "task", subject: "Ara", dealId, dueAt: new Date() }));
    const note = await withTenant(tenantId, (tx) => createActivity(tx, tenantId, { type: "note", subject: "Görüştük", dealId }));
    const rows = await dbAdmin.select().from(crmActivities).where(eq(crmActivities.dealId, dealId));
    expect(rows.find((r) => r.id === task)!.doneAt).toBeNull();
    expect(rows.find((r) => r.id === note)!.doneAt).not.toBeNull();
  });
});

describe("aşama yönetimi (veritabanı)", () => {
  let tenantId: string;
  beforeEach(async () => {
    await resetDatabase();
    tenantId = await seedTenant();
  });
  const run = <T,>(fn: (tx: Parameters<Parameters<typeof withTenant>[1]>[0]) => Promise<T>) => withTenant(tenantId, fn);
  const labels = async () =>
    (await dbAdmin.select().from(crmStages).where(eq(crmStages.tenantId, tenantId)).orderBy(asc(crmStages.position))).map((s) => s.label);

  it("yeni aşama sona eklenir, anahtarı benzersizdir", async () => {
    await run((tx) => addStage(tx, tenantId, { label: "Demo", kind: "open" }));
    expect((await labels()).at(-1)).toBe("Demo");
    // Türkçe harf ve noktalama farkı gözetmeden aynı ad: reddedilir
    for (const dup of ["demo", "DEMO!", " Demo "]) {
      await expect(run((tx) => addStage(tx, tenantId, { label: dup, kind: "open" })), dup).rejects.toBeInstanceOf(StageError);
    }
  });

  it("anahtar çakışmasında sayı eklenir", async () => {
    // Etiketler farklı ama anahtar ilk 40 karakterden türediği için çakışır
    const long = "a".repeat(40);
    await run((tx) => addStage(tx, tenantId, { label: `${long}1`, kind: "open" }));
    await run((tx) => addStage(tx, tenantId, { label: `${long}2`, kind: "open" }));
    const keys = (await dbAdmin.select().from(crmStages).where(eq(crmStages.tenantId, tenantId))).map((s) => s.key);
    expect(new Set(keys).size).toBe(keys.length);
    expect(keys).toContain(long);
    expect(keys).toContain(`${long}2`);
  });

  it("sıra değiştirme ve yeniden adlandırma", async () => {
    const teklif = await stageByKey(tenantId, "teklif");
    await run((tx) => moveStage(tx, tenantId, teklif.id, "up"));
    expect((await labels()).slice(0, 3)).toEqual(["Yeni", "Teklif", "Görüşüldü"]);
    await run((tx) => updateStage(tx, tenantId, teklif.id, { label: "Teklif verildi", kind: "open", color: "#fff" }));
    expect(await labels()).toContain("Teklif verildi");
  });

  it("son kazanıldı ya da kaybedildi aşaması silinemez/türü değiştirilemez", async () => {
    const won = await stageByKey(tenantId, "kazanildi");
    await expect(run((tx) => deleteStage(tx, tenantId, won.id))).rejects.toThrow(/kazanıldı/);
    await expect(run((tx) => updateStage(tx, tenantId, won.id, { label: "Kazanıldı", kind: "open" }))).rejects.toThrow(/kazanıldı/);
    expect(await labels()).toContain("Kazanıldı");
  });

  it("fırsatı olan aşama taşıma hedefi olmadan silinemez; aynı türe taşıyarak silinir", async () => {
    const teklif = await stageByKey(tenantId, "teklif");
    const yeni = await stageByKey(tenantId, "yeni");
    const won = await stageByKey(tenantId, "kazanildi");
    const dealId = await withTenant(tenantId, (tx) => createDeal(tx, tenantId, { title: "D", stageId: teklif.id }));

    await expect(run((tx) => deleteStage(tx, tenantId, teklif.id))).rejects.toThrow(/1 fırsat var/);
    await expect(run((tx) => deleteStage(tx, tenantId, teklif.id, won.id))).rejects.toThrow(/aynı türdeki/);
    await expect(run((tx) => deleteStage(tx, tenantId, teklif.id, "00000000-0000-0000-0000-000000000000"))).rejects.toThrow(/1 fırsat var/);
    expect(await labels()).toContain("Teklif");

    const res = await run((tx) => deleteStage(tx, tenantId, teklif.id, yeni.id));
    expect(res.moved).toBe(1);
    const [deal] = await dbAdmin.select().from(crmDeals).where(eq(crmDeals.id, dealId));
    expect(deal!.stageId).toBe(yeni.id);
    expect(await labels()).not.toContain("Teklif");
  });

  it("fırsatı olan aşamanın türü değişmez", async () => {
    const teklif = await stageByKey(tenantId, "teklif");
    await withTenant(tenantId, (tx) => createDeal(tx, tenantId, { title: "D", stageId: teklif.id }));
    await expect(run((tx) => updateStage(tx, tenantId, teklif.id, { label: "Teklif", kind: "won" }))).rejects.toThrow(/fırsat var/);
  });

  it("başka kiracının aşaması değiştirilemez", async () => {
    const other = await seedTenant("t2");
    const foreign = await stageByKey(other, "yeni");
    await expect(run((tx) => updateStage(tx, tenantId, foreign.id, { label: "Ele geçirildi", kind: "open" }))).rejects.toThrow(/bulunamadı/);
    await expect(run((tx) => deleteStage(tx, tenantId, foreign.id))).rejects.toThrow(/bulunamadı/);
  });
});

describe("satis modülü başka pakete sonradan açıldığında", () => {
  it("varsayılan aşamalar ilk kullanımda kurulur ve çoğalmaz", async () => {
    await resetDatabase();
    const { listStages } = await import("@/modules/satis/pipeline-queries");
    const [t] = await dbAdmin
      .insert(tenants)
      .values({ name: "Tur", slug: "tur", sectorPack: "turizm", sectorPackVersion: "1.0.0" })
      .returning();
    await dbAdmin.insert(subscriptions).values({ tenantId: t!.id, status: "active" });
    await applySectorPack(t!.id, "turizm");
    expect(await dbAdmin.select().from(crmStages).where(eq(crmStages.tenantId, t!.id))).toHaveLength(0);

    const first = await listStages(t!.id);
    expect(first.map((s) => s.label)).toEqual(["Yeni", "Görüşüldü", "Teklif", "Kazanıldı", "Kaybedildi"]);
    // eşzamanlı ilk kullanımlar da çoğaltmaz
    await Promise.all([listStages(t!.id), listStages(t!.id), listStages(t!.id)]);
    expect(await dbAdmin.select().from(crmStages).where(eq(crmStages.tenantId, t!.id))).toHaveLength(5);

    const dealId = await withTenant(t!.id, (tx) => createDeal(tx, t!.id, { title: "İlk" }));
    expect(dealId).toBeTruthy();
  });

  it("kullanıcı bir aşamayı sildiyse varsayılanlar geri gelmez (yalnız hiç aşama yokken kurulur)", async () => {
    await resetDatabase();
    const tenantId = await seedTenant("t9");
    const gorusuldu = await stageByKey(tenantId, "gorusuldu");
    await withTenant(tenantId, (tx) => deleteStage(tx, tenantId, gorusuldu.id));
    const { listStages } = await import("@/modules/satis/pipeline-queries");
    expect((await listStages(tenantId)).map((s) => s.label)).toEqual(["Yeni", "Teklif", "Kazanıldı", "Kaybedildi"]);
  });
});
