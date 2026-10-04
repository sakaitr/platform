import { and, asc, desc, eq, gte, lte, sql, type SQL } from "drizzle-orm";
import type { PgColumn } from "drizzle-orm/pg-core";
import {
  companies,
  earnings,
  reconciliations,
  tasks,
  ticketMessages,
  tickets,
  users,
  vehiclePenalties,
  vehicles,
  warnings,
} from "@/db/schema";
import { withTenant } from "@/db/tenant";
import { registerReport } from "@/lib/reports/engine";

function between(column: PgColumn, from?: string, to?: string): SQL[] {
  const parts: SQL[] = [];
  if (from) parts.push(gte(column, from));
  if (to) parts.push(lte(column, to));
  return parts;
}

export function registerEkRaporlar(): void {
  registerReport({
    key: "tahakkuk",
    name: "Tahakkuk Raporu",
    category: "Muhasebe",
    description: "Hakediş durumlarına göre tutar dağılımı",
    permission: "hakedis:read",
    needsDateRange: true,
    run: async (ctx) => {
      const rows = await withTenant(ctx.tenantId, (tx) =>
        tx
          .select({
            durum: earnings.status,
            adet: sql<number>`count(*)`,
            brut: sql<string>`coalesce(sum(${earnings.gross}), 0)`,
            net: sql<string>`coalesce(sum(${earnings.net}), 0)`,
          })
          .from(earnings)
          .where(and(eq(earnings.tenantId, ctx.tenantId), ...between(earnings.periodStart, ctx.from, ctx.to)))
          .groupBy(earnings.status),
      );

      return {
        columns: [
          { key: "durum", label: "Durum" },
          { key: "adet", label: "Adet" },
          { key: "brut", label: "Brüt (₺)" },
          { key: "net", label: "Net (₺)" },
        ],
        rows: rows.map((r) => ({
          durum: r.durum,
          adet: Number(r.adet),
          brut: Number(r.brut),
          net: Number(r.net),
        })),
      };
    },
  });

  registerReport({
    key: "mutabakat_durumu",
    name: "Mutabakat Raporu",
    category: "Muhasebe",
    description: "Dönem bazlı mutabakat durumu ve bakiyeler",
    permission: "mutabakat:read",
    needsDateRange: false,
    run: async (ctx) => {
      const rows = await withTenant(ctx.tenantId, (tx) =>
        tx
          .select({
            firma: companies.name,
            donem: reconciliations.period,
            bakiye: reconciliations.balance,
            durum: reconciliations.status,
            itiraz: reconciliations.objection,
          })
          .from(reconciliations)
          .innerJoin(companies, eq(companies.id, reconciliations.companyId))
          .where(eq(reconciliations.tenantId, ctx.tenantId))
          .orderBy(desc(reconciliations.period), asc(companies.name)),
      );

      return {
        columns: [
          { key: "firma", label: "Firma" },
          { key: "donem", label: "Dönem" },
          { key: "bakiye", label: "Bakiye (₺)" },
          { key: "durum", label: "Durum" },
          { key: "itiraz", label: "İtiraz" },
        ],
        rows: rows.map((r) => ({
          firma: r.firma,
          donem: r.donem,
          bakiye: Number(r.bakiye),
          durum: r.durum,
          itiraz: r.itiraz ?? "—",
        })),
      };
    },
  });

  registerReport({
    key: "uyari_ihlal",
    name: "Uyarı ve İhlal Raporu",
    category: "Filo",
    description: "Uyarı tutanakları ve ödenmemiş cezalar",
    permission: "filo_ceza:read",
    needsDateRange: true,
    run: async (ctx) => {
      const [uyarilar, cezalar] = await withTenant(ctx.tenantId, async (tx) => [
        await tx
          .select({
            tur: sql<string>`'Uyarı'`,
            belge: warnings.documentNo,
            plaka: vehicles.plate,
            tarih: warnings.deadline,
            aciklama: warnings.reason,
            tutar: sql<string>`0`,
            kapali: warnings.isDone,
          })
          .from(warnings)
          .leftJoin(vehicles, eq(vehicles.id, warnings.vehicleId))
          .where(eq(warnings.tenantId, ctx.tenantId)),
        await tx
          .select({
            tur: sql<string>`'Ceza'`,
            belge: vehiclePenalties.documentNo,
            plaka: vehicles.plate,
            tarih: vehiclePenalties.penaltyDate,
            aciklama: vehiclePenalties.kind,
            tutar: vehiclePenalties.amount,
            kapali: vehiclePenalties.isPaid,
          })
          .from(vehiclePenalties)
          .innerJoin(vehicles, eq(vehicles.id, vehiclePenalties.vehicleId))
          .where(
            and(
              eq(vehiclePenalties.tenantId, ctx.tenantId),
              ...between(vehiclePenalties.penaltyDate, ctx.from, ctx.to),
            ),
          ),
      ]);

      const rows = [...uyarilar, ...cezalar]
        .sort((a, b) => String(b.tarih ?? "").localeCompare(String(a.tarih ?? "")))
        .map((r) => ({
          tur: r.tur,
          belge: r.belge ?? "—",
          plaka: r.plaka ?? "—",
          tarih: r.tarih ? String(r.tarih) : "—",
          aciklama: r.aciklama ?? "—",
          tutar: Number(r.tutar ?? 0),
          durum: r.kapali ? "Kapandı" : "Açık",
        }));

      return {
        columns: [
          { key: "tur", label: "Tür" },
          { key: "belge", label: "Belge No" },
          { key: "plaka", label: "Plaka" },
          { key: "tarih", label: "Tarih" },
          { key: "aciklama", label: "Açıklama" },
          { key: "tutar", label: "Tutar (₺)" },
          { key: "durum", label: "Durum" },
        ],
        rows,
      };
    },
  });

  registerReport({
    key: "gorev_raporu",
    name: "Personel Görev Raporu",
    category: "Yönetim",
    description: "Kişi başına açık, biten ve geciken görevler",
    permission: "gorevler:read",
    needsDateRange: false,
    run: async (ctx) => {
      const rows = await withTenant(ctx.tenantId, (tx) =>
        tx
          .select({
            kisi: users.name,
            toplam: sql<number>`count(*)`,
            biten: sql<number>`count(*) filter (where ${tasks.status} = 'bitti')`,
            geciken: sql<number>`count(*) filter (where ${tasks.status} <> 'bitti' and ${tasks.dueDate} < current_date)`,
          })
          .from(tasks)
          .innerJoin(users, eq(users.id, tasks.assignedTo))
          .where(eq(tasks.tenantId, ctx.tenantId))
          .groupBy(users.name)
          .orderBy(desc(sql`2`)),
      );

      return {
        columns: [
          { key: "kisi", label: "Kişi" },
          { key: "toplam", label: "Toplam" },
          { key: "biten", label: "Biten" },
          { key: "acik", label: "Açık" },
          { key: "geciken", label: "Geciken" },
        ],
        rows: rows.map((r) => ({
          kisi: r.kisi,
          toplam: Number(r.toplam),
          biten: Number(r.biten),
          acik: Number(r.toplam) - Number(r.biten),
          geciken: Number(r.geciken),
        })),
      };
    },
  });

  registerReport({
    key: "talep_analizi",
    name: "Sorun / Talep Analizi",
    category: "Yönetim",
    description: "Durum ve kaynağa göre destek talepleri, ortalama yanıt sayısı",
    permission: "sorunlar:read",
    needsDateRange: false,
    run: async (ctx) => {
      const rows = await withTenant(ctx.tenantId, (tx) =>
        tx
          .select({
            durum: tickets.status,
            kaynak: tickets.source,
            adet: sql<number>`count(*)`,
            mesaj: sql<string>`coalesce(round(avg(
              (select count(*) from ticket_messages m where m.ticket_id = ${tickets.id})
            )::numeric, 1), 0)`,
          })
          .from(tickets)
          .where(eq(tickets.tenantId, ctx.tenantId))
          .groupBy(tickets.status, tickets.source)
          .orderBy(desc(sql`3`)),
      );
      void ticketMessages;

      return {
        columns: [
          { key: "durum", label: "Durum" },
          { key: "kaynak", label: "Kaynak" },
          { key: "adet", label: "Adet" },
          { key: "mesaj", label: "Ort. Mesaj" },
        ],
        rows: rows.map((r) => ({
          durum: r.durum,
          kaynak: r.kaynak === "portal" ? "Müşteri portalı" : "İç talep",
          adet: Number(r.adet),
          mesaj: Number(r.mesaj),
        })),
      };
    },
  });
}
