import { beforeEach, describe, expect, it } from "vitest";
import { sql, type SQL } from "drizzle-orm";
import { db } from "@/db";
import { dbAdmin } from "@/db/admin";
import {
  crmActivities,
  crmApiKeys,
  crmContacts,
  crmDeals,
  crmDeletedExternal,
  crmInboundEvents,
  crmIntegrations,
  crmLeads,
  crmQuotes,
  crmStages,
  crmTemplates,
  crmWebhookDeliveries,
  tenants,
} from "@/db/schema";
import { withTenant } from "@/db/tenant";
import { resetDatabase } from "./setup";

const TABLES = [
  "crm_stages",
  "crm_leads",
  "crm_contacts",
  "crm_deals",
  "crm_activities",
  "crm_quotes",
  "crm_templates",
  "crm_integrations",
  "crm_inbound_events",
  "crm_deleted_external",
  "crm_webhook_deliveries",
  "crm_api_keys",
] as const;

async function seedTenantData(slug: string) {
  const [tenant] = await dbAdmin
    .insert(tenants)
    .values({ name: slug, slug, sectorPack: "satis_crm", sectorPackVersion: "1.0.0" })
    .returning();
  const tenantId = tenant!.id;
  const [stage] = await dbAdmin
    .insert(crmStages)
    .values({ tenantId, key: "yeni", label: "Yeni", position: 1 })
    .returning();
  const [lead] = await dbAdmin
    .insert(crmLeads)
    .values({ tenantId, name: `${slug} adayı`, source: "atricard", externalId: "ext-1" })
    .returning();
  await dbAdmin.insert(crmContacts).values({ tenantId, leadId: lead!.id, fullName: "Kişi" });
  const [deal] = await dbAdmin
    .insert(crmDeals)
    .values({ tenantId, title: "Fırsat", stageId: stage!.id, leadId: lead!.id })
    .returning();
  await dbAdmin
    .insert(crmActivities)
    .values({ tenantId, type: "note", subject: "Not", leadId: lead!.id });
  await dbAdmin
    .insert(crmQuotes)
    .values({ tenantId, dealId: deal!.id, number: "TKL2026-00001", title: "Teklif" });
  await dbAdmin
    .insert(crmTemplates)
    .values({ tenantId, name: "Şablon", channel: "whatsapp", body: "Merhaba" });
  const [integration] = await dbAdmin
    .insert(crmIntegrations)
    .values({ tenantId, kind: "atricard_inbound", name: "Atricard", secretEnc: "v1:x:y:z" })
    .returning();
  await dbAdmin.insert(crmInboundEvents).values({
    tenantId,
    integrationId: integration!.id,
    event: "lead.created",
    status: "processed",
  });
  await dbAdmin
    .insert(crmDeletedExternal)
    .values({ tenantId, source: "atricard", externalId: "gone-1" });
  await dbAdmin.insert(crmWebhookDeliveries).values({
    tenantId,
    integrationId: integration!.id,
    event: "lead.created",
    payload: {},
  });
  await dbAdmin
    .insert(crmApiKeys)
    .values({ tenantId, name: "Anahtar", prefix: `p_${slug}`, keyHash: "h" });
  return { tenantId, stageId: stage!.id };
}

function count(table: string): SQL {
  return sql.raw(`SELECT count(*)::int AS n FROM ${table}`);
}

describe("satış CRM tabloları: RLS izolasyonu", () => {
  beforeEach(async () => {
    await resetDatabase();
  });

  it("her crm_ tablosunda RLS etkin ve zorunlu", async () => {
    const result = await dbAdmin.execute(sql`
      SELECT c.relname, c.relrowsecurity AS rls, c.relforcerowsecurity AS forced
      FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname = 'public' AND c.relname LIKE 'crm\\_%' AND c.relkind = 'r'
    `);
    const rows = result.rows as { relname: string; rls: boolean; forced: boolean }[];
    expect(rows.map((r) => r.relname).sort()).toEqual([...TABLES].sort());
    for (const row of rows) {
      expect(row.rls, row.relname).toBe(true);
      expect(row.forced, row.relname).toBe(true);
    }
  });

  it("A kiracısı B'nin satırını göremez, her tabloda yalnız kendi satırı döner", async () => {
    const a = await seedTenantData("a");
    await seedTenantData("b");
    for (const table of TABLES) {
      const result = await withTenant(a.tenantId, (tx) => tx.execute(count(table)));
      expect((result.rows[0] as { n: number }).n, table).toBe(1);
    }
  });

  it("withTenant dışında uygulama rolü hiçbir satış satırı göremez", async () => {
    await seedTenantData("a");
    for (const table of TABLES) {
      const result = await db.execute(count(table));
      expect((result.rows[0] as { n: number }).n, table).toBe(0);
    }
  });

  it("A kiracısı B adına satır yazamaz (WITH CHECK)", async () => {
    const a = await seedTenantData("a");
    const b = await seedTenantData("b");
    await expect(
      withTenant(a.tenantId, (tx) =>
        tx.insert(crmLeads).values({ tenantId: b.tenantId, name: "Sızıntı" }),
      ),
    ).rejects.toThrow();
  });

  it("A kiracısı B'nin adayını güncelleyemez ya da silemez", async () => {
    const a = await seedTenantData("a");
    await seedTenantData("b");
    await withTenant(a.tenantId, async (tx) => {
      await tx.execute(sql`UPDATE crm_leads SET name = 'ele geçirildi'`);
      await tx.execute(sql`DELETE FROM crm_deleted_external`);
    });
    const untouched = await dbAdmin.execute(
      sql`SELECT count(*)::int AS n FROM crm_leads WHERE name = 'b adayı'`,
    );
    expect((untouched.rows[0] as { n: number }).n).toBe(1);
    const tomb = await dbAdmin.execute(sql`SELECT count(*)::int AS n FROM crm_deleted_external`);
    expect((tomb.rows[0] as { n: number }).n).toBe(1);
  });

  it("aynı (kaynak, external_id) aynı kiracıda çakışır, başka kiracıda çakışmaz", async () => {
    const a = await seedTenantData("a");
    const b = await seedTenantData("b");
    await expect(
      dbAdmin
        .insert(crmLeads)
        .values({ tenantId: a.tenantId, name: "Tekrar", source: "atricard", externalId: "ext-1" }),
    ).rejects.toThrow();
    // external_id boşken kısıt uygulanmaz
    await dbAdmin.insert(crmLeads).values({ tenantId: a.tenantId, name: "Elle 1", source: "manual" });
    await dbAdmin.insert(crmLeads).values({ tenantId: a.tenantId, name: "Elle 2", source: "manual" });
    expect(b.tenantId).not.toBe(a.tenantId);
  });

  it("fırsatı olan aşama silinemez (taşınmadan silme engeli)", async () => {
    const a = await seedTenantData("a");
    await expect(
      dbAdmin.execute(sql`DELETE FROM crm_stages WHERE id = ${a.stageId}`),
    ).rejects.toThrow();
  });

  it("kiracı silinince satış verisi de gider", async () => {
    const a = await seedTenantData("a");
    await dbAdmin.execute(sql`DELETE FROM tenants WHERE id = ${a.tenantId}`);
    for (const table of TABLES) {
      const result = await dbAdmin.execute(count(table));
      expect((result.rows[0] as { n: number }).n, table).toBe(0);
    }
  });
});
