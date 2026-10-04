import { and, asc, desc, eq, gte, lte, sql, type SQL } from "drizzle-orm";
import type { PgColumn } from "drizzle-orm/pg-core";
import {
  companies,
  dailyEntries,
  drivers,
  openRoutes,
  routes,
  tripLogs,
  users,
  vehicleArrivals,
  vehicles,
} from "@/db/schema";
import { withTenant } from "@/db/tenant";
import { registerReport } from "@/lib/reports/engine";

/** Tarih aralığı süzgeci — hangi tablonun tarih kolonu olursa olsun. */
function between(column: PgColumn, from?: string, to?: string): SQL[] {
  const parts: SQL[] = [];
  if (from) parts.push(gte(column, from));
  if (to) parts.push(lte(column, to));
  return parts;
}

export function registerOperasyonEkRaporlar(): void {
  registerReport({
    key: "gecikme_analizi",
    name: "Gecikme Analizi",
    category: "Operasyon",
    description: "Araç bazlı gecikme sayısı, ortalama ve en uzun gecikme",
    permission: "arrivals:read",
    needsDateRange: true,
    run: async (ctx) => {
      const rows = await withTenant(ctx.tenantId, (tx) =>
        tx
          .select({
            plaka: vehicles.plate,
            firma: companies.name,
            toplam: sql<number>`count(*)`,
            geciken: sql<number>`count(*) filter (where ${vehicleArrivals.plannedAt} is not null and ${vehicleArrivals.arrivedAt} > ${vehicleArrivals.plannedAt})`,
            ortalamaDk: sql<string>`coalesce(round(avg(
              case when ${vehicleArrivals.plannedAt} is not null
                   then extract(epoch from (${vehicleArrivals.arrivedAt}::time - ${vehicleArrivals.plannedAt}::time)) / 60 end
            )::numeric, 1), 0)`,
            enUzunDk: sql<string>`coalesce(max(
              case when ${vehicleArrivals.plannedAt} is not null
                   then extract(epoch from (${vehicleArrivals.arrivedAt}::time - ${vehicleArrivals.plannedAt}::time)) / 60 end
            )::numeric, 0)`,
          })
          .from(vehicleArrivals)
          .innerJoin(vehicles, eq(vehicles.id, vehicleArrivals.vehicleId))
          .leftJoin(companies, eq(companies.id, vehicleArrivals.companyId))
          .where(
            and(eq(vehicleArrivals.tenantId, ctx.tenantId), ...between(vehicleArrivals.arrivalDate, ctx.from, ctx.to)),
          )
          .groupBy(vehicles.plate, companies.name)
          .orderBy(desc(sql`4`)),
      );

      return {
        columns: [
          { key: "plaka", label: "Plaka" },
          { key: "firma", label: "Firma" },
          { key: "toplam", label: "Sefer" },
          { key: "geciken", label: "Geciken" },
          { key: "oran", label: "Gecikme %" },
          { key: "ortalama", label: "Ort. Dakika" },
          { key: "enUzun", label: "En Uzun (dk)" },
        ],
        rows: rows.map((r) => ({
          plaka: r.plaka,
          firma: r.firma ?? "—",
          toplam: Number(r.toplam),
          geciken: Number(r.geciken),
          oran: Number(r.toplam) === 0 ? 0 : Math.round((Number(r.geciken) / Number(r.toplam)) * 100),
          ortalama: Number(r.ortalamaDk),
          enUzun: Number(r.enUzunDk),
        })),
      };
    },
  });

  registerReport({
    key: "yolcu_doluluk",
    name: "Yolcu Doluluk Raporu",
    category: "Operasyon",
    description: "Gerçekleşen yolcu sayısının kapasiteye oranı",
    permission: "arrivals:read",
    needsDateRange: true,
    run: async (ctx) => {
      const rows = await withTenant(ctx.tenantId, (tx) =>
        tx
          .select({
            plaka: vehicles.plate,
            kapasite: vehicles.capacity,
            sefer: sql<number>`count(*)`,
            ortalamaYolcu: sql<string>`coalesce(round(avg(${vehicleArrivals.actualPassengers})::numeric, 1), 0)`,
          })
          .from(vehicleArrivals)
          .innerJoin(vehicles, eq(vehicles.id, vehicleArrivals.vehicleId))
          .where(
            and(eq(vehicleArrivals.tenantId, ctx.tenantId), ...between(vehicleArrivals.arrivalDate, ctx.from, ctx.to)),
          )
          .groupBy(vehicles.plate, vehicles.capacity)
          .orderBy(asc(vehicles.plate)),
      );

      return {
        columns: [
          { key: "plaka", label: "Plaka" },
          { key: "kapasite", label: "Kapasite" },
          { key: "sefer", label: "Sefer" },
          { key: "ortalama", label: "Ort. Yolcu" },
          { key: "doluluk", label: "Doluluk %" },
        ],
        rows: rows.map((r) => ({
          plaka: r.plaka,
          kapasite: r.kapasite ?? "—",
          sefer: Number(r.sefer),
          ortalama: Number(r.ortalamaYolcu),
          doluluk:
            r.kapasite && r.kapasite > 0
              ? Math.round((Number(r.ortalamaYolcu) / r.kapasite) * 100)
              : "—",
        })),
      };
    },
  });

  registerReport({
    key: "sefer_performans",
    name: "Sefer Performans Raporu",
    category: "Operasyon",
    description: "Çetele bazlı sefer sayısı ve onay durumu",
    permission: "cetele:read",
    needsDateRange: true,
    run: async (ctx) => {
      const rows = await withTenant(ctx.tenantId, (tx) =>
        tx
          .select({
            firma: companies.name,
            guzergah: routes.name,
            toplam: sql<number>`count(*)`,
            onayli: sql<number>`count(*) filter (where ${tripLogs.status} = 'onaylandi')`,
            iptal: sql<number>`count(*) filter (where ${tripLogs.status} = 'iptal')`,
            yolcu: sql<string>`coalesce(sum(${tripLogs.passengerCount}), 0)`,
          })
          .from(tripLogs)
          .leftJoin(companies, eq(companies.id, tripLogs.companyId))
          .leftJoin(routes, eq(routes.id, tripLogs.routeId))
          .where(and(eq(tripLogs.tenantId, ctx.tenantId), ...between(tripLogs.logDate, ctx.from, ctx.to)))
          .groupBy(companies.name, routes.name)
          .orderBy(desc(sql`3`)),
      );

      return {
        columns: [
          { key: "firma", label: "Firma" },
          { key: "guzergah", label: "Güzergah" },
          { key: "toplam", label: "Sefer" },
          { key: "onayli", label: "Onaylı" },
          { key: "iptal", label: "İptal" },
          { key: "yolcu", label: "Toplam Yolcu" },
        ],
        rows: rows.map((r) => ({
          firma: r.firma ?? "—",
          guzergah: r.guzergah ?? "—",
          toplam: Number(r.toplam),
          onayli: Number(r.onayli),
          iptal: Number(r.iptal),
          yolcu: Number(r.yolcu),
        })),
      };
    },
  });

  registerReport({
    key: "guzergah_kullanim",
    name: "Güzergah Kullanım Raporu",
    category: "Operasyon",
    description: "Güzergah başına atanmış yolcu ve kapasite kullanımı",
    permission: "guzergahlar:read",
    needsDateRange: false,
    run: async (ctx) => {
      const rows = await withTenant(ctx.tenantId, (tx) =>
        tx
          .select({
            guzergah: routes.name,
            kod: routes.code,
            firma: companies.name,
            kapasite: routes.capacity,
            plaka: vehicles.plate,
            yolcu: sql<number>`(select count(*) from route_passengers rp where rp.route_id = ${routes.id})`,
          })
          .from(routes)
          .leftJoin(companies, eq(companies.id, routes.companyId))
          .leftJoin(vehicles, eq(vehicles.id, routes.vehicleId))
          .where(and(eq(routes.tenantId, ctx.tenantId), eq(routes.isActive, true)))
          .orderBy(asc(routes.name)),
      );

      return {
        columns: [
          { key: "guzergah", label: "Güzergah" },
          { key: "kod", label: "Kod" },
          { key: "firma", label: "Firma" },
          { key: "plaka", label: "Araç" },
          { key: "kapasite", label: "Kapasite" },
          { key: "yolcu", label: "Yolcu" },
          { key: "doluluk", label: "Doluluk %" },
        ],
        rows: rows.map((r) => ({
          guzergah: r.guzergah,
          kod: r.kod ?? "—",
          firma: r.firma ?? "—",
          plaka: r.plaka ?? "atanmadı",
          kapasite: r.kapasite ?? "—",
          yolcu: Number(r.yolcu),
          doluluk:
            r.kapasite && r.kapasite > 0 ? Math.round((Number(r.yolcu) / r.kapasite) * 100) : "—",
        })),
      };
    },
  });

  registerReport({
    key: "acik_guzergah_maliyeti",
    name: "Açık Güzergah Maliyeti",
    category: "Operasyon",
    description: "Fiyat bekleyen ve fiyatlanmış açık güzergahlar",
    permission: "guzergahlar:read",
    needsDateRange: false,
    run: async (ctx) => {
      const rows = await withTenant(ctx.tenantId, (tx) =>
        tx
          .select({
            ad: openRoutes.name,
            firma: companies.name,
            mesafe: openRoutes.distanceKm,
            sure: openRoutes.durationMin,
            fiyat: openRoutes.price,
            durum: openRoutes.status,
          })
          .from(openRoutes)
          .leftJoin(companies, eq(companies.id, openRoutes.companyId))
          .where(eq(openRoutes.tenantId, ctx.tenantId))
          .orderBy(desc(openRoutes.createdAt)),
      );

      return {
        columns: [
          { key: "ad", label: "Güzergah" },
          { key: "firma", label: "Firma" },
          { key: "mesafe", label: "Mesafe (km)" },
          { key: "sure", label: "Süre (dk)" },
          { key: "fiyat", label: "Fiyat (₺)" },
          { key: "kmBasi", label: "₺/km" },
          { key: "durum", label: "Durum" },
        ],
        rows: rows.map((r) => ({
          ad: r.ad,
          firma: r.firma ?? "—",
          mesafe: r.mesafe ? Number(r.mesafe) : "—",
          sure: r.sure ?? "—",
          fiyat: r.fiyat ? Number(r.fiyat) : "—",
          kmBasi:
            r.fiyat && r.mesafe && Number(r.mesafe) > 0
              ? Math.round((Number(r.fiyat) / Number(r.mesafe)) * 100) / 100
              : "—",
          durum: r.durum,
        })),
      };
    },
  });

  registerReport({
    key: "gunluk_ozet",
    name: "İş Günlükleri Özeti",
    category: "Operasyon",
    description: "Kim hangi gün günlük check-in doldurdu",
    permission: "gunluk:read",
    needsDateRange: true,
    run: async (ctx) => {
      const rows = await withTenant(ctx.tenantId, (tx) =>
        tx
          .select({
            kisi: users.name,
            gun: sql<number>`count(*)`,
            sonKayit: sql<string>`max(${dailyEntries.entryDate})`,
          })
          .from(dailyEntries)
          .innerJoin(users, eq(users.id, dailyEntries.userId))
          .where(and(eq(dailyEntries.tenantId, ctx.tenantId), ...between(dailyEntries.entryDate, ctx.from, ctx.to)))
          .groupBy(users.name)
          .orderBy(desc(sql`2`)),
      );

      return {
        columns: [
          { key: "kisi", label: "Kişi" },
          { key: "gun", label: "Doldurulan Gün" },
          { key: "son", label: "Son Kayıt" },
        ],
        rows: rows.map((r) => ({ kisi: r.kisi, gun: Number(r.gun), son: r.sonKayit })),
      };
    },
  });

  registerReport({
    key: "sofor_sicil",
    name: "Şoför Sicil Raporu",
    category: "Filo",
    description: "Sürücü başına sicil kaydı ve ağırlık ortalaması",
    permission: "suruculer:read",
    needsDateRange: true,
    run: async (ctx) => {
      const rows = await withTenant(ctx.tenantId, (tx) =>
        tx
          .select({
            surucu: drivers.fullName,
            kayit: sql<number>`count(dr.id)`,
            agirlik: sql<string>`coalesce(round(avg(dr.severity)::numeric, 1), 0)`,
            enAgir: sql<string>`coalesce(max(dr.severity), 0)`,
          })
          .from(drivers)
          .leftJoin(sql`driver_records dr`, sql`dr.driver_id = ${drivers.id}`)
          .where(eq(drivers.tenantId, ctx.tenantId))
          .groupBy(drivers.fullName)
          .orderBy(desc(sql`2`)),
      );

      return {
        columns: [
          { key: "surucu", label: "Sürücü" },
          { key: "kayit", label: "Sicil Kaydı" },
          { key: "agirlik", label: "Ort. Ağırlık" },
          { key: "enAgir", label: "En Ağır" },
        ],
        rows: rows.map((r) => ({
          surucu: r.surucu,
          kayit: Number(r.kayit),
          agirlik: Number(r.agirlik),
          enAgir: Number(r.enAgir),
        })),
      };
    },
  });
}
