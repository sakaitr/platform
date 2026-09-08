import { and, asc, desc, eq, gte, lte, sql } from "drizzle-orm";
import {
  companies,
  earnings,
  financeCategories,
  financeTransactions,
  ledgerEntries,
  vehicles,
} from "@/db/schema";
import { withTenant } from "@/db/tenant";
import { registerReport } from "@/lib/reports/engine";

export function registerMuhasebeReports(): void {
  registerReport({
    key: "gelir_gider_ozeti",
    name: "Gelir / Gider Özeti",
    category: "Muhasebe",
    description: "Kategori bazlı gelir ve gider toplamları",
    permission: "finans_gider:read",
    needsDateRange: true,
    run: async (ctx) => {
      const filters = [
        eq(financeTransactions.tenantId, ctx.tenantId),
        eq(financeTransactions.status, "tamamlandi"),
      ];
      if (ctx.from) filters.push(gte(financeTransactions.entryDate, ctx.from));
      if (ctx.to) filters.push(lte(financeTransactions.entryDate, ctx.to));

      const rows = await withTenant(ctx.tenantId, (tx) =>
        tx
          .select({
            kategori: financeCategories.name,
            tur: financeTransactions.kind,
            adet: sql<number>`count(*)`,
            toplam: sql<string>`coalesce(sum(${financeTransactions.amountTry}), 0)`,
          })
          .from(financeTransactions)
          .leftJoin(financeCategories, eq(financeCategories.id, financeTransactions.categoryId))
          .where(and(...filters))
          .groupBy(financeCategories.name, financeTransactions.kind)
          .orderBy(desc(sql`4`)),
      );

      return {
        columns: [
          { key: "kategori", label: "Kategori" },
          { key: "tur", label: "Tür" },
          { key: "adet", label: "Adet" },
          { key: "toplam", label: "Toplam (₺)" },
        ],
        rows: rows.map((r) => ({
          kategori: r.kategori ?? "Kategorisiz",
          tur: r.tur === "gelir" ? "Gelir" : "Gider",
          adet: Number(r.adet),
          toplam: Number(r.toplam),
        })),
      };
    },
  });

  registerReport({
    key: "cari_bakiye",
    name: "Cari Bakiye Listesi",
    category: "Muhasebe",
    description: "Firma bazlı borç, alacak ve bakiye",
    permission: "cari:read",
    needsDateRange: false,
    run: async (ctx) => {
      const rows = await withTenant(ctx.tenantId, (tx) =>
        tx
          .select({
            firma: companies.name,
            borc: sql<string>`coalesce(sum(${ledgerEntries.debit}), 0)`,
            alacak: sql<string>`coalesce(sum(${ledgerEntries.credit}), 0)`,
            bakiye: sql<string>`coalesce(sum(${ledgerEntries.debit}) - sum(${ledgerEntries.credit}), 0)`,
          })
          .from(ledgerEntries)
          .innerJoin(companies, eq(companies.id, ledgerEntries.companyId))
          .where(eq(ledgerEntries.tenantId, ctx.tenantId))
          .groupBy(companies.name)
          .orderBy(asc(companies.name)),
      );

      return {
        columns: [
          { key: "firma", label: "Firma" },
          { key: "borc", label: "Borç (₺)" },
          { key: "alacak", label: "Alacak (₺)" },
          { key: "bakiye", label: "Bakiye (₺)" },
        ],
        rows: rows.map((r) => ({
          firma: r.firma,
          borc: Number(r.borc),
          alacak: Number(r.alacak),
          bakiye: Number(r.bakiye),
        })),
      };
    },
  });

  registerReport({
    key: "hakedis_ozeti",
    name: "Hakediş Özeti",
    category: "Muhasebe",
    description: "İşleten bazlı sefer, brüt, tevkifat ve net tutarlar",
    permission: "hakedis:read",
    needsDateRange: true,
    run: async (ctx) => {
      const filters = [eq(earnings.tenantId, ctx.tenantId)];
      if (ctx.from) filters.push(gte(earnings.periodStart, ctx.from));
      if (ctx.to) filters.push(lte(earnings.periodEnd, ctx.to));

      const rows = await withTenant(ctx.tenantId, (tx) =>
        tx
          .select({
            belge: earnings.documentNo,
            isleten: companies.name,
            plaka: vehicles.plate,
            baslangic: earnings.periodStart,
            bitis: earnings.periodEnd,
            sefer: earnings.tripCount,
            brut: earnings.gross,
            kdv: earnings.vat,
            tevkifat: earnings.withholding,
            net: earnings.net,
            durum: earnings.status,
          })
          .from(earnings)
          .innerJoin(companies, eq(companies.id, earnings.operatorId))
          .leftJoin(vehicles, eq(vehicles.id, earnings.vehicleId))
          .where(and(...filters))
          .orderBy(desc(earnings.periodStart), asc(companies.name)),
      );

      return {
        columns: [
          { key: "belge", label: "Belge No" },
          { key: "isleten", label: "İşleten" },
          { key: "plaka", label: "Plaka" },
          { key: "donem", label: "Dönem" },
          { key: "sefer", label: "Sefer" },
          { key: "brut", label: "Brüt (₺)" },
          { key: "kdv", label: "KDV (₺)" },
          { key: "tevkifat", label: "Tevkifat (₺)" },
          { key: "net", label: "Net (₺)" },
          { key: "durum", label: "Durum" },
        ],
        rows: rows.map((r) => ({
          belge: r.belge ?? "—",
          isleten: r.isleten,
          plaka: r.plaka ?? "tümü",
          donem: `${r.baslangic} – ${r.bitis}`,
          sefer: Number(r.sefer),
          brut: Number(r.brut),
          kdv: Number(r.kdv),
          tevkifat: Number(r.tevkifat),
          net: Number(r.net),
          durum: r.durum,
        })),
      };
    },
  });
}
