import { and, asc, eq, gte, lte, sql } from "drizzle-orm";
import { companies, fuelPurchases, vehicleDocuments, vehicleInsurances, vehicles } from "@/db/schema";
import { withTenant } from "@/db/tenant";
import { registerReport } from "@/lib/reports/engine";
import { istanbulDayKey } from "@/lib/time";

export function registerFiloReports(): void {
  registerReport({
    key: "yaklasan_bitisler",
    name: "Yaklaşan Belge ve Sigorta Bitişleri",
    category: "Filo",
    description: "30 gün içinde biten ya da süresi geçmiş belge ve poliçeler",
    permission: "belgeler:read",
    needsDateRange: false,
    run: async (ctx) => {
      const limit = new Date();
      limit.setUTCDate(limit.getUTCDate() + 30);
      const limitKey = istanbulDayKey(limit);

      const [docs, policies] = await withTenant(ctx.tenantId, async (tx) => [
        await tx
          .select({
            plaka: vehicles.plate,
            tur: vehicleDocuments.docType,
            aciklama: vehicleDocuments.label,
            bitis: vehicleDocuments.expiresOn,
          })
          .from(vehicleDocuments)
          .innerJoin(vehicles, eq(vehicles.id, vehicleDocuments.vehicleId))
          .where(
            and(
              eq(vehicleDocuments.tenantId, ctx.tenantId),
              lte(vehicleDocuments.expiresOn, limitKey),
            ),
          ),
        await tx
          .select({
            plaka: vehicles.plate,
            tur: vehicleInsurances.kind,
            aciklama: vehicleInsurances.policyNo,
            bitis: vehicleInsurances.endsOn,
          })
          .from(vehicleInsurances)
          .innerJoin(vehicles, eq(vehicles.id, vehicleInsurances.vehicleId))
          .where(
            and(eq(vehicleInsurances.tenantId, ctx.tenantId), lte(vehicleInsurances.endsOn, limitKey)),
          ),
      ]);

      const today = istanbulDayKey();
      const rows = [...docs, ...policies]
        .filter((r) => r.bitis !== null)
        .sort((a, b) => String(a.bitis).localeCompare(String(b.bitis)))
        .map((r) => ({
          plaka: r.plaka,
          tur: r.tur,
          aciklama: r.aciklama ?? "—",
          bitis: String(r.bitis),
          durum: String(r.bitis) < today ? "SÜRESİ GEÇTİ" : "yaklaşıyor",
        }));

      return {
        columns: [
          { key: "plaka", label: "Plaka" },
          { key: "tur", label: "Tür" },
          { key: "aciklama", label: "Açıklama" },
          { key: "bitis", label: "Bitiş" },
          { key: "durum", label: "Durum" },
        ],
        rows,
      };
    },
  });

  registerReport({
    key: "arac_maliyet",
    name: "Araç Başına Maliyet",
    category: "Filo",
    description: "Bakım, ceza ve yakıt harcamalarının araç bazlı toplamı",
    permission: "araclar:read",
    needsDateRange: true,
    run: async (ctx) => {
      const rows = await withTenant(ctx.tenantId, (tx) =>
        tx
          .select({
            plaka: vehicles.plate,
            firma: companies.name,
            bakim: sql<string>`(
              select coalesce(sum(m.cost), 0) from vehicle_maintenance m
              where m.vehicle_id = ${vehicles.id}
                ${ctx.from ? sql`and m.maintenance_date >= ${ctx.from}` : sql``}
                ${ctx.to ? sql`and m.maintenance_date <= ${ctx.to}` : sql``}
            )`,
            ceza: sql<string>`(
              select coalesce(sum(p.amount), 0) from vehicle_penalties p
              where p.vehicle_id = ${vehicles.id}
                ${ctx.from ? sql`and p.penalty_date >= ${ctx.from}` : sql``}
                ${ctx.to ? sql`and p.penalty_date <= ${ctx.to}` : sql``}
            )`,
            yakit: sql<string>`(
              select coalesce(sum(f.total), 0) from fuel_purchases f
              where f.vehicle_id = ${vehicles.id}
                ${ctx.from ? sql`and f.purchase_date >= ${ctx.from}` : sql``}
                ${ctx.to ? sql`and f.purchase_date <= ${ctx.to}` : sql``}
            )`,
          })
          .from(vehicles)
          .leftJoin(companies, eq(companies.id, vehicles.companyId))
          .where(eq(vehicles.tenantId, ctx.tenantId))
          .orderBy(asc(vehicles.plate)),
      );

      return {
        columns: [
          { key: "plaka", label: "Plaka" },
          { key: "firma", label: "Firma" },
          { key: "bakim", label: "Bakım (₺)" },
          { key: "ceza", label: "Ceza (₺)" },
          { key: "yakit", label: "Yakıt (₺)" },
          { key: "toplam", label: "Toplam (₺)" },
        ],
        rows: rows.map((r) => {
          const bakim = Number(r.bakim);
          const ceza = Number(r.ceza);
          const yakit = Number(r.yakit);
          return {
            plaka: r.plaka,
            firma: r.firma ?? "—",
            bakim,
            ceza,
            yakit,
            toplam: bakim + ceza + yakit,
          };
        }),
      };
    },
  });

  registerReport({
    key: "yakit_tuketimi",
    name: "Yakıt Tüketimi",
    category: "Filo",
    description: "Araç bazlı ortalama tüketim (L/100km) ve toplam harcama",
    permission: "yakit_kartlari:read",
    needsDateRange: true,
    run: async (ctx) => {
      const filters = [eq(fuelPurchases.tenantId, ctx.tenantId)];
      if (ctx.from) filters.push(gte(fuelPurchases.purchaseDate, ctx.from));
      if (ctx.to) filters.push(lte(fuelPurchases.purchaseDate, ctx.to));

      const rows = await withTenant(ctx.tenantId, (tx) =>
        tx
          .select({
            plaka: vehicles.plate,
            dolum: sql<number>`count(*)`,
            litre: sql<string>`coalesce(sum(${fuelPurchases.liters}), 0)`,
            tutar: sql<string>`coalesce(sum(${fuelPurchases.total}), 0)`,
            km: sql<string>`coalesce(sum(
              case when ${fuelPurchases.currentKm} > ${fuelPurchases.previousKm}
                   then ${fuelPurchases.currentKm} - ${fuelPurchases.previousKm} end
            ), 0)`,
          })
          .from(fuelPurchases)
          .innerJoin(vehicles, eq(vehicles.id, fuelPurchases.vehicleId))
          .where(and(...filters))
          .groupBy(vehicles.plate)
          .orderBy(asc(vehicles.plate)),
      );

      return {
        columns: [
          { key: "plaka", label: "Plaka" },
          { key: "dolum", label: "Dolum" },
          { key: "litre", label: "Litre" },
          { key: "km", label: "KM" },
          { key: "tuketim", label: "L/100km" },
          { key: "tutar", label: "Tutar (₺)" },
        ],
        rows: rows.map((r) => {
          const litre = Number(r.litre);
          const km = Number(r.km);
          return {
            plaka: r.plaka,
            dolum: Number(r.dolum),
            litre,
            km,
            tuketim: km > 0 ? Math.round((litre / km) * 10000) / 100 : "—",
            tutar: Number(r.tutar),
          };
        }),
      };
    },
  });
}
