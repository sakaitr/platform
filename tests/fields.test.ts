import { beforeEach, describe, expect, it } from "vitest";
import { dbAdmin } from "@/db/admin";
import { entityFields, tenants } from "@/db/schema";
import { buildCustomSchema, getEntityFields } from "@/lib/sector/fields";
import { resetDatabase } from "./setup";

async function seed() {
  const [t] = await dbAdmin
    .insert(tenants)
    .values({ name: "T", slug: "t", sectorPack: "lojistik", sectorPackVersion: "1.0.0" })
    .returning();
  await dbAdmin.insert(entityFields).values([
    { tenantId: t!.id, entityKey: "invoice", fieldKey: "irsaliye_no", label: "İrsaliye No", type: "text", required: true, position: 1 },
    { tenantId: t!.id, entityKey: "invoice", fieldKey: "sevk_tarihi", label: "Sevk Tarihi", type: "date", position: 2 },
    { tenantId: t!.id, entityKey: "customer", fieldKey: "vergi_no", label: "Vergi No", type: "text", position: 1 },
  ]);
  return t!;
}

describe("özel alanlar", () => {
  beforeEach(async () => {
    await resetDatabase();
  });

  it("varlığa göre alanları sırayla getirir", async () => {
    const tenant = await seed();
    const fields = await getEntityFields(tenant.id, "invoice");
    expect(fields.map((f) => f.fieldKey)).toEqual(["irsaliye_no", "sevk_tarihi"]);
  });

  it("zorunlu alan boşsa doğrulama hata verir", async () => {
    const tenant = await seed();
    const fields = await getEntityFields(tenant.id, "invoice");
    const schema = buildCustomSchema(fields);
    expect(schema.safeParse({ sevk_tarihi: "2026-09-07" }).success).toBe(false);
    expect(schema.safeParse({ irsaliye_no: "A-123" }).success).toBe(true);
  });

  it("tanımsız alanı reddetmez, yok sayar", async () => {
    const tenant = await seed();
    const fields = await getEntityFields(tenant.id, "customer");
    const schema = buildCustomSchema(fields);
    const result = schema.safeParse({ vergi_no: "123", uydurma: "x" });
    expect(result.success).toBe(true);
    if (result.success) expect(result.data).not.toHaveProperty("uydurma");
  });
});
