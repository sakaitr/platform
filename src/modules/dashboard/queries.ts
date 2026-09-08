import { and, eq, gte, isNull, lte, ne, or, sql } from "drizzle-orm";
import {
  earnings,
  financeTransactions,
  leaveRequests,
  tasks,
  tickets,
  tripLogs,
  vehicleArrivals,
  vehicleDocuments,
  vehicleInsurances,
  vehicles,
  visitorLogs,
} from "@/db/schema";
import { withTenant } from "@/db/tenant";
import { istanbulDayKey, shiftDay } from "@/lib/time";

export type DashboardTile = {
  label: string;
  value: string | number;
  href: string;
  /** Dikkat çekmesi gereken sayı (gecikme, süresi geçen) */
  alert?: boolean;
};

/**
 * Dashboard sayaçları. Her biri kullanıcının izniyle ve kiracının lisansıyla
 * süzülür — göremeyeceği modülün sayısı da gösterilmez.
 */
export async function dashboardTiles(
  tenantId: string,
  permissions: Set<string>,
  allowedModules: Set<string>,
  capabilities: Set<string>,
): Promise<DashboardTile[]> {
  const today = istanbulDayKey();
  const monthStart = `${today.slice(0, 7)}-01`;
  const soon = shiftDay(today, 30);
  const tiles: DashboardTile[] = [];

  /**
   * Sayaç hem izne, hem modül lisansına, hem de (varsa) alt yeteneğe bağlı.
   * Yalnız modüle bakmak yetmiyordu: lojistikte operasyon açık ama çetele
   * kapalı; sayaç görünüp tıklayınca yönlendirme yapıyordu.
   */
  const can = (permission: string, moduleKey: string, capability?: string): boolean =>
    permissions.has(permission) &&
    allowedModules.has(moduleKey) &&
    (capability === undefined || capabilities.has(capability));

  await withTenant(tenantId, async (tx) => {
    const scalar = async (query: Promise<Array<{ value: unknown }>>): Promise<number> =>
      Number((await query)[0]?.value ?? 0);

    if (can("arrivals:read", "operasyon")) {
      tiles.push({
        label: "Bugünkü geliş",
        href: "/operasyon/giris-kontrol",
        value: await scalar(
          tx
            .select({ value: sql`count(*)` })
            .from(vehicleArrivals)
            .where(
              and(eq(vehicleArrivals.tenantId, tenantId), eq(vehicleArrivals.arrivalDate, today)),
            ),
        ),
      });

      const inside = await scalar(
        tx
          .select({ value: sql`count(*)` })
          .from(visitorLogs)
          .where(and(eq(visitorLogs.tenantId, tenantId), isNull(visitorLogs.exitedAt))),
      );
      if (inside > 0) {
        tiles.push({ label: "İçerideki ziyaretçi", href: "/operasyon/ziyaretciler", value: inside });
      }
    }

    if (can("cetele:read", "operasyon", "operasyon.cetele")) {
      const pending = await scalar(
        tx
          .select({ value: sql`count(*)` })
          .from(tripLogs)
          .where(and(eq(tripLogs.tenantId, tenantId), eq(tripLogs.status, "bekliyor"))),
      );
      tiles.push({
        label: "Onay bekleyen çetele",
        href: "/operasyon/cetele",
        value: pending,
        alert: pending > 0,
      });
    }

    if (can("araclar:read", "filo")) {
      tiles.push({
        label: "Aktif araç",
        href: "/filo/araclar",
        value: await scalar(
          tx
            .select({ value: sql`count(*)` })
            .from(vehicles)
            .where(and(eq(vehicles.tenantId, tenantId), eq(vehicles.status, "aktif"))),
        ),
      });
    }

    if (can("belgeler:read", "filo")) {
      const expiring =
        (await scalar(
          tx
            .select({ value: sql`count(*)` })
            .from(vehicleDocuments)
            .where(
              and(eq(vehicleDocuments.tenantId, tenantId), lte(vehicleDocuments.expiresOn, soon)),
            ),
        )) +
        (await scalar(
          tx
            .select({ value: sql`count(*)` })
            .from(vehicleInsurances)
            .where(
              and(eq(vehicleInsurances.tenantId, tenantId), lte(vehicleInsurances.endsOn, soon)),
            ),
        ));
      tiles.push({
        label: "30 günde biten belge",
        href: "/filo/belgeler",
        value: expiring,
        alert: expiring > 0,
      });
    }

    if (can("finans_gider:read", "muhasebe")) {
      const rows = await tx
        .select({
          kind: financeTransactions.kind,
          toplam: sql<string>`coalesce(sum(${financeTransactions.amountTry}), 0)`,
        })
        .from(financeTransactions)
        .where(
          and(
            eq(financeTransactions.tenantId, tenantId),
            eq(financeTransactions.status, "tamamlandi"),
            gte(financeTransactions.entryDate, monthStart),
          ),
        )
        .groupBy(financeTransactions.kind);

      const gelir = Number(rows.find((r) => r.kind === "gelir")?.toplam ?? 0);
      const gider = Number(rows.find((r) => r.kind === "gider")?.toplam ?? 0);
      const fark = gelir - gider;
      tiles.push({
        label: "Bu ay kâr",
        href: "/muhasebe/kar-zarar",
        value: new Intl.NumberFormat("tr-TR", { style: "currency", currency: "TRY" }).format(fark),
        alert: fark < 0,
      });
    }

    if (can("hakedis:read", "muhasebe", "muhasebe.hakedis")) {
      const waiting = await scalar(
        tx
          .select({ value: sql`count(*)` })
          .from(earnings)
          .where(
            and(
              eq(earnings.tenantId, tenantId),
              or(eq(earnings.status, "taslak"), eq(earnings.status, "tahakkuk"))!,
            ),
          ),
      );
      if (waiting > 0) {
        tiles.push({ label: "Bekleyen hakediş", href: "/muhasebe/hakedis", value: waiting });
      }
    }

    if (can("sorunlar:read", "destek")) {
      const open = await scalar(
        tx
          .select({ value: sql`count(*)` })
          .from(tickets)
          .where(
            and(
              eq(tickets.tenantId, tenantId),
              ne(tickets.status, "kapandi"),
              ne(tickets.status, "cozuldu"),
            ),
          ),
      );
      tiles.push({ label: "Açık destek talebi", href: "/destek", value: open, alert: open > 0 });
    }

    if (can("gorevler:read", "gorevler")) {
      const overdue = await scalar(
        tx
          .select({ value: sql`count(*)` })
          .from(tasks)
          .where(
            and(eq(tasks.tenantId, tenantId), ne(tasks.status, "bitti"), lte(tasks.dueDate, today)),
          ),
      );
      tiles.push({
        label: "Gecikmiş görev",
        href: "/gorevler",
        value: overdue,
        alert: overdue > 0,
      });
    }

    if (permissions.has("users:update") && allowedModules.has("ik")) {
      const pending = await scalar(
        tx
          .select({ value: sql`count(*)` })
          .from(leaveRequests)
          .where(and(eq(leaveRequests.tenantId, tenantId), eq(leaveRequests.status, "bekliyor"))),
      );
      if (pending > 0) {
        tiles.push({ label: "Onay bekleyen izin", href: "/izinler", value: pending, alert: true });
      }
    }
  });

  return tiles;
}
