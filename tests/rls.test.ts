import { beforeEach, describe, expect, it } from "vitest";
import { sql } from "drizzle-orm";
import { db } from "@/db";
import { dbAdmin } from "@/db/admin";
import { tenants, users } from "@/db/schema";
import { withTenant } from "@/db/tenant";
import { resetDatabase } from "./setup";

async function seedTwoTenants() {
  const [a] = await dbAdmin
    .insert(tenants)
    .values({ name: "A", slug: "a", sectorPack: "turizm", sectorPackVersion: "1.0.0" })
    .returning();
  const [b] = await dbAdmin
    .insert(tenants)
    .values({ name: "B", slug: "b", sectorPack: "lojistik", sectorPackVersion: "1.0.0" })
    .returning();
  await dbAdmin.insert(users).values([
    { tenantId: a!.id, email: "a@x.com", name: "A", passwordHash: "x" },
    { tenantId: b!.id, email: "b@x.com", name: "B", passwordHash: "x" },
  ]);
  return { a: a!, b: b! };
}

describe("row level security", () => {
  beforeEach(async () => {
    await resetDatabase();
  });

  it("withTenant sadece kendi kiracısının satırlarını görür", async () => {
    const { a } = await seedTwoTenants();
    const rows = await withTenant(a.id, (tx) => tx.select().from(users));
    expect(rows).toHaveLength(1);
    expect(rows[0]!.email).toBe("a@x.com");
  });

  it("tenant context olmadan uygulama rolü hiçbir satır göremez", async () => {
    await seedTwoTenants();
    const rows = await db.select().from(users);
    expect(rows).toHaveLength(0);
  });

  it("ham SQL ile bile başka kiracının satırı okunamaz", async () => {
    const { a } = await seedTwoTenants();
    const result = await withTenant(a.id, (tx) => tx.execute(sql`SELECT email FROM users`));
    expect(result.rows).toHaveLength(1);
  });

  it("tenant context transaction dışına sızmaz", async () => {
    const { a } = await seedTwoTenants();
    await withTenant(a.id, (tx) => tx.select().from(users));
    const after = await db.select().from(users);
    expect(after).toHaveLength(0);
  });
});
