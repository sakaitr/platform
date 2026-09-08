import { beforeEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { dbAdmin } from "@/db/admin";
import {
  companies,
  drivers,
  leaveRequests,
  portalUserCompanies,
  portalUsers,
  tasks,
  ticketMessages,
  tickets,
  tenants,
  users,
} from "@/db/schema";
import { listTicketMessages, listPortalUsers, ticketSummary } from "@/modules/isbirligi/queries";
import { resetDatabase } from "./setup";

async function seed() {
  const [tenant] = await dbAdmin
    .insert(tenants)
    .values({ name: "T", slug: "t", sectorPack: "turizm", sectorPackVersion: "1.0.0" })
    .returning();
  const tenantId = tenant!.id;
  const [user] = await dbAdmin
    .insert(users)
    .values({ tenantId, email: "a@x.com", name: "Ayşe Personel", passwordHash: "x" })
    .returning();
  const firms = await dbAdmin
    .insert(companies)
    .values([
      { tenantId, name: "Alfa" },
      { tenantId, name: "Beta" },
    ])
    .returning();
  return { tenantId, user: user!, alfa: firms[0]!, beta: firms[1]! };
}

describe("destek talepleri", () => {
  beforeEach(async () => {
    await resetDatabase();
  });

  it("talep numarası kiracı içinde tekildir", async () => {
    const { tenantId } = await seed();
    await dbAdmin.insert(tickets).values({ tenantId, ticketNo: "TLP2026-000001", title: "Bir konu" });
    await expect(
      dbAdmin.insert(tickets).values({ tenantId, ticketNo: "TLP2026-000001", title: "Başka konu" }),
    ).rejects.toThrow();
  });

  it("aynı numara farklı kiracıda serbesttir", async () => {
    const a = await seed();
    const [tenantB] = await dbAdmin
      .insert(tenants)
      .values({ name: "B", slug: "b", sectorPack: "lojistik", sectorPackVersion: "1.0.0" })
      .returning();
    await dbAdmin.insert(tickets).values({ tenantId: a.tenantId, ticketNo: "TLP2026-000001", title: "A" });
    await dbAdmin.insert(tickets).values({ tenantId: tenantB!.id, ticketNo: "TLP2026-000001", title: "B" });
    const rows = await dbAdmin.select().from(tickets);
    expect(rows).toHaveLength(2);
  });

  it("iç notlar portal görünümünde gizlenir", async () => {
    const { tenantId, user } = await seed();
    const [ticket] = await dbAdmin
      .insert(tickets)
      .values({ tenantId, ticketNo: "TLP2026-000001", title: "Konu" })
      .returning();
    await dbAdmin.insert(ticketMessages).values([
      { tenantId, ticketId: ticket!.id, body: "Müşteriye görünen", userId: user.id },
      { tenantId, ticketId: ticket!.id, body: "Sadece ekip", userId: user.id, isInternal: true },
    ]);

    const staffView = await listTicketMessages(tenantId, ticket!.id, true);
    const portalView = await listTicketMessages(tenantId, ticket!.id, false);
    expect(staffView).toHaveLength(2);
    expect(portalView).toHaveLength(1);
    expect(portalView[0]!.body).toBe("Müşteriye görünen");
  });

  it("özet durumlara göre sayar", async () => {
    const { tenantId } = await seed();
    await dbAdmin.insert(tickets).values([
      { tenantId, ticketNo: "T1", title: "a", status: "acik" },
      { tenantId, ticketNo: "T2", title: "b", status: "acik" },
      { tenantId, ticketNo: "T3", title: "c", status: "cozuldu" },
    ]);
    const summary = await ticketSummary(tenantId);
    expect(summary.acik).toBe(2);
    expect(summary.cozuldu).toBe(1);
    expect(summary.kapandi).toBe(0);
  });

  it("talep silinince mesajları da gider", async () => {
    const { tenantId, user } = await seed();
    const [ticket] = await dbAdmin
      .insert(tickets)
      .values({ tenantId, ticketNo: "T1", title: "Konu" })
      .returning();
    await dbAdmin.insert(ticketMessages).values({ tenantId, ticketId: ticket!.id, body: "x", userId: user.id });
    await dbAdmin.delete(tickets).where(eq(tickets.id, ticket!.id));
    const rows = await dbAdmin.select().from(ticketMessages);
    expect(rows).toHaveLength(0);
  });
});

describe("görevler", () => {
  beforeEach(async () => {
    await resetDatabase();
  });

  it("atanan kullanıcı silinince görev kalır, atama boşalır", async () => {
    const { tenantId, user } = await seed();
    await dbAdmin.insert(tasks).values({ tenantId, title: "Görev", assignedTo: user.id });
    await dbAdmin.delete(users).where(eq(users.id, user.id));
    const rows = await dbAdmin.select().from(tasks).where(eq(tasks.tenantId, tenantId));
    expect(rows).toHaveLength(1);
    expect(rows[0]!.assignedTo).toBeNull();
  });
});

describe("izin talepleri", () => {
  beforeEach(async () => {
    await resetDatabase();
  });

  it("kullanıcı silinince talepleri de silinir", async () => {
    const { tenantId, user } = await seed();
    await dbAdmin.insert(leaveRequests).values({
      tenantId,
      userId: user.id,
      startsOn: "2026-09-10",
      endsOn: "2026-09-12",
      dayCount: 3,
    });
    await dbAdmin.delete(users).where(eq(users.id, user.id));
    const rows = await dbAdmin.select().from(leaveRequests);
    expect(rows).toHaveLength(0);
  });
});

describe("portal kullanıcıları", () => {
  beforeEach(async () => {
    await resetDatabase();
  });

  it("çok firmalı kullanıcı tek satırda toplanır", async () => {
    const { tenantId, alfa, beta } = await seed();
    const [pu] = await dbAdmin
      .insert(portalUsers)
      .values({ tenantId, email: "m@x.com", fullName: "Mehmet Müşteri", passwordHash: "x" })
      .returning();
    await dbAdmin.insert(portalUserCompanies).values([
      { tenantId, portalUserId: pu!.id, companyId: alfa.id },
      { tenantId, portalUserId: pu!.id, companyId: beta.id },
    ]);

    const rows = await listPortalUsers(tenantId);
    expect(rows).toHaveLength(1);
    expect(rows[0]!.companies.sort()).toEqual(["Alfa", "Beta"]);
  });

  it("aynı e-posta kiracı içinde ikinci kez eklenemez", async () => {
    const { tenantId } = await seed();
    await dbAdmin
      .insert(portalUsers)
      .values({ tenantId, email: "m@x.com", fullName: "Mehmet", passwordHash: "x" });
    await expect(
      dbAdmin.insert(portalUsers).values({ tenantId, email: "m@x.com", fullName: "Başka", passwordHash: "x" }),
    ).rejects.toThrow();
  });

  it("firma silinince o firmanın bağı gider, kullanıcı kalır", async () => {
    const { tenantId, alfa, beta } = await seed();
    const [pu] = await dbAdmin
      .insert(portalUsers)
      .values({ tenantId, email: "m@x.com", fullName: "Mehmet", passwordHash: "x" })
      .returning();
    await dbAdmin.insert(portalUserCompanies).values([
      { tenantId, portalUserId: pu!.id, companyId: alfa.id },
      { tenantId, portalUserId: pu!.id, companyId: beta.id },
    ]);
    await dbAdmin.delete(companies).where(eq(companies.id, alfa.id));

    const rows = await listPortalUsers(tenantId);
    expect(rows).toHaveLength(1);
    expect(rows[0]!.companies).toEqual(["Beta"]);
  });
});

describe("sürücü sicili", () => {
  beforeEach(async () => {
    await resetDatabase();
  });

  it("sürücü silinince sicili de silinir", async () => {
    const { tenantId } = await seed();
    const [driver] = await dbAdmin
      .insert(drivers)
      .values({ tenantId, fullName: "Ali Şoför" })
      .returning();
    const { driverRecords } = await import("@/db/schema");
    await dbAdmin.insert(driverRecords).values({
      tenantId,
      driverId: driver!.id,
      incidentDate: "2026-09-01",
      description: "Olay",
    });
    await dbAdmin.delete(drivers).where(eq(drivers.id, driver!.id));
    const rows = await dbAdmin.select().from(driverRecords);
    expect(rows).toHaveLength(0);
  });
});
