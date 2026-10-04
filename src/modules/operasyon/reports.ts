import { and, asc, count, eq, gte, lte, sql } from "drizzle-orm";
import { companies, passengers, vehicleArrivals, vehicles } from "@/db/schema";
import { withTenant } from "@/db/tenant";
import { registerReport } from "@/lib/reports/engine";

export function registerOperasyonReports(): void {
  registerReport({
    key: "gunluk_gelisler",
    name: "Günlük Araç Gelişleri",
    category: "Operasyon",
    description: "Tarih aralığındaki araç geliş kayıtları, gecikmeleriyle",
    permission: "arrivals:read",
    needsDateRange: true,
    run: async (ctx) => {
      const filters = [eq(vehicleArrivals.tenantId, ctx.tenantId)];
      if (ctx.from) filters.push(gte(vehicleArrivals.arrivalDate, ctx.from));
      if (ctx.to) filters.push(lte(vehicleArrivals.arrivalDate, ctx.to));

      const rows = await withTenant(ctx.tenantId, (tx) =>
        tx
          .select({
            tarih: vehicleArrivals.arrivalDate,
            plaka: vehicles.plate,
            firma: companies.name,
            vardiya: vehicleArrivals.shift,
            gelis: vehicleArrivals.arrivedAt,
            planlanan: vehicleArrivals.plannedAt,
          })
          .from(vehicleArrivals)
          .innerJoin(vehicles, eq(vehicles.id, vehicleArrivals.vehicleId))
          .leftJoin(companies, eq(companies.id, vehicleArrivals.companyId))
          .where(and(...filters))
          .orderBy(asc(vehicleArrivals.arrivalDate), asc(vehicleArrivals.arrivedAt)),
      );

      return {
        columns: [
          { key: "tarih", label: "Tarih" },
          { key: "plaka", label: "Plaka" },
          { key: "firma", label: "Firma" },
          { key: "vardiya", label: "Vardiya" },
          { key: "gelis", label: "Geliş" },
          { key: "planlanan", label: "Planlanan" },
          { key: "gecikme", label: "Gecikme (dk)" },
        ],
        rows: rows.map((r) => {
          const toMin = (v: string): number => {
            const [h, m] = v.split(":").map(Number);
            return (h ?? 0) * 60 + (m ?? 0);
          };
          return {
            tarih: r.tarih,
            plaka: r.plaka,
            firma: r.firma ?? "—",
            vardiya: r.vardiya,
            gelis: r.gelis,
            planlanan: r.planlanan ?? "—",
            gecikme: r.planlanan ? toMin(r.gelis) - toMin(r.planlanan) : "—",
          };
        }),
      };
    },
  });

  registerReport({
    key: "firma_gelis_ozeti",
    name: "Firma Bazlı Geliş Özeti",
    category: "Operasyon",
    description: "Firma başına toplam geliş ve geciken sefer sayısı",
    permission: "arrivals:read",
    needsDateRange: true,
    run: async (ctx) => {
      const filters = [eq(vehicleArrivals.tenantId, ctx.tenantId)];
      if (ctx.from) filters.push(gte(vehicleArrivals.arrivalDate, ctx.from));
      if (ctx.to) filters.push(lte(vehicleArrivals.arrivalDate, ctx.to));

      const rows = await withTenant(ctx.tenantId, (tx) =>
        tx
          .select({
            firma: companies.name,
            toplam: count(),
            geciken: sql<number>`count(*) filter (where ${vehicleArrivals.plannedAt} is not null and ${vehicleArrivals.arrivedAt} > ${vehicleArrivals.plannedAt})`,
          })
          .from(vehicleArrivals)
          .leftJoin(companies, eq(companies.id, vehicleArrivals.companyId))
          .where(and(...filters))
          .groupBy(companies.name)
          .orderBy(asc(companies.name)),
      );

      return {
        columns: [
          { key: "firma", label: "Firma" },
          { key: "toplam", label: "Toplam Geliş" },
          { key: "geciken", label: "Geciken" },
          { key: "oran", label: "Zamanında %" },
        ],
        rows: rows.map((r) => ({
          firma: r.firma ?? "—",
          toplam: r.toplam,
          geciken: Number(r.geciken),
          oran: r.toplam === 0 ? "—" : Math.round(((r.toplam - Number(r.geciken)) / r.toplam) * 100),
        })),
      };
    },
  });

  registerReport({
    key: "yolcu_listesi",
    name: "Yolcu Listesi",
    category: "Operasyon",
    description: "Firma, tip ve hizmet durumuyla tüm yolcular",
    permission: "yolcular:read",
    needsDateRange: false,
    run: async (ctx) => {
      const rows = await withTenant(ctx.tenantId, (tx) =>
        tx
          .select({
            ad: passengers.fullName,
            firma: companies.name,
            tip: passengers.type,
            telefon: passengers.phone,
            sinif: passengers.grade,
            durum: passengers.serviceStatus,
            binis: passengers.pickupAddress,
          })
          .from(passengers)
          .leftJoin(companies, eq(companies.id, passengers.companyId))
          .where(eq(passengers.tenantId, ctx.tenantId))
          .orderBy(asc(passengers.fullName)),
      );

      return {
        columns: [
          { key: "ad", label: "Ad Soyad" },
          { key: "firma", label: "Firma" },
          { key: "tip", label: "Tip" },
          { key: "telefon", label: "Telefon" },
          { key: "sinif", label: "Sınıf" },
          { key: "durum", label: "Hizmet Durumu" },
          { key: "binis", label: "Biniş Adresi" },
        ],
        rows: rows.map((r) => ({
          ad: r.ad,
          firma: r.firma ?? "—",
          tip: r.tip,
          telefon: r.telefon ?? "—",
          sinif: r.sinif ?? "—",
          durum: r.durum,
          binis: r.binis ?? "—",
        })),
      };
    },
  });

  registerReport({
    key: "arac_listesi",
    name: "Araç Listesi",
    category: "Filo",
    description: "Plaka, firma, kapasite ve durum",
    permission: "araclar:read",
    needsDateRange: false,
    run: async (ctx) => {
      const rows = await withTenant(ctx.tenantId, (tx) =>
        tx
          .select({
            plaka: vehicles.plate,
            firma: companies.name,
            marka: vehicles.brand,
            model: vehicles.model,
            yil: vehicles.modelYear,
            kapasite: vehicles.capacity,
            durum: vehicles.status,
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
          { key: "marka", label: "Marka" },
          { key: "model", label: "Model" },
          { key: "yil", label: "Model Yılı" },
          { key: "kapasite", label: "Kapasite" },
          { key: "durum", label: "Durum" },
        ],
        rows: rows.map((r) => ({
          plaka: r.plaka,
          firma: r.firma ?? "—",
          marka: r.marka ?? "—",
          model: r.model ?? "—",
          yil: r.yil ?? "—",
          kapasite: r.kapasite ?? "—",
          durum: r.durum,
        })),
      };
    },
  });
}
