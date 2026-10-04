import { and, eq, gte, inArray, sql } from "drizzle-orm";
import { crmDeals, crmLeads, crmStages } from "@/db/schema";
import { withTenant } from "@/db/tenant";
import { istanbulDayKey } from "@/lib/time";
import type { DashboardTile } from "@/modules/dashboard/queries";
import { istanbulDayStart } from "./dates";
import { taskCounts } from "./pipeline-queries";
import { ownerVisibility, type VisibilitySession } from "./visibility";

const tl = (value: number): string =>
  new Intl.NumberFormat("tr-TR", { style: "currency", currency: "TRY", maximumFractionDigits: 0 }).format(value);

/**
 * Pano kartları. Sayılar kullanıcının görünürlüğüne uyar (Satışçı kendi ve sahipsiz kayıtlarının sayısını
 * görür, yönetici hepsini) ve her kart ilgili iznine bağlıdır.
 */
export async function satisTiles(session: VisibilitySession): Promise<DashboardTile[]> {
  const tiles: DashboardTile[] = [];
  const monthStart = istanbulDayStart(`${istanbulDayKey().slice(0, 7)}-01`);
  const can = (permission: string): boolean => session.permissions.has(permission);

  await withTenant(session.tenantId, async (tx) => {
    if (can("satis_aday:read")) {
      const [row] = await tx
        .select({ n: sql<number>`count(*)::int` })
        .from(crmLeads)
        .where(
          and(
            eq(crmLeads.tenantId, session.tenantId),
            ownerVisibility(crmLeads.ownerUserId, session),
            inArray(crmLeads.status, ["new"]),
          ),
        );
      tiles.push({ label: "Yeni aday", href: "/satis/adaylar?durum=new", value: row?.n ?? 0 });
    }

    if (can("satis_firsat:read")) {
      const [open] = await tx
        .select({ toplam: sql<string>`coalesce(sum(${crmDeals.value}), 0)` })
        .from(crmDeals)
        .innerJoin(crmStages, eq(crmStages.id, crmDeals.stageId))
        .where(and(eq(crmDeals.tenantId, session.tenantId), ownerVisibility(crmDeals.ownerUserId, session), eq(crmStages.kind, "open")));
      tiles.push({ label: "Açık fırsat tutarı", href: "/satis/pipeline", value: tl(Number(open?.toplam ?? 0)) });

      const [won] = await tx
        .select({ n: sql<number>`count(*)::int`, toplam: sql<string>`coalesce(sum(${crmDeals.value}), 0)` })
        .from(crmDeals)
        .innerJoin(crmStages, eq(crmStages.id, crmDeals.stageId))
        .where(
          and(
            eq(crmDeals.tenantId, session.tenantId),
            ownerVisibility(crmDeals.ownerUserId, session),
            eq(crmStages.kind, "won"),
            gte(crmDeals.closedAt, monthStart),
          ),
        );
      tiles.push({ label: "Bu ay kazanılan", href: "/satis/pipeline", value: `${won?.n ?? 0} · ${tl(Number(won?.toplam ?? 0))}` });
    }
  });

  if (can("satis_aktivite:read")) {
    const counts = await taskCounts(session);
    const due = counts.overdue + counts.today;
    tiles.push({ label: "Bugün yapılacak görev", href: "/satis/gorevler", value: due, alert: counts.overdue > 0 });
  }
  return tiles;
}
