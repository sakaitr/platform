import { and, asc, desc, eq, gte, isNotNull, lt, sql, type SQL } from "drizzle-orm";
import { crmActivities, crmDeals, crmLeads, crmStages, users } from "@/db/schema";
import { withTenant } from "@/db/tenant";
import { registerReport, type ReportContext } from "@/lib/reports/engine";
import { istanbulDayRange } from "./dates";
import { SOURCE_LABEL } from "./labels";

/**
 * Satış raporları. Hepsi `satis_hepsi:read` ister (Yönetici, İzleyici): raporlar kiracının TÜM satış verisini
 * toplar, oysa Satışçı yalnız kendi kayıtlarını görmeli; toplu rakamlar başkasının verisini sızdırırdı.
 * Tutarlar SQL `numeric` toplamıdır, JavaScript'te para aritmetiği yapılmaz (yalnız oranlar hesaplanır).
 */

const KIND_LABEL = { open: "Açık", won: "Kazanıldı", lost: "Kaybedildi" } as const;
const PERMISSION = "satis_hepsi:read";
const NO_OWNER = "Sahipsiz";

/** Tarih aralığı İstanbul gün sınırlarıyla: [from 00:00, to'dan sonraki gün 00:00). */
export function reportRange(ctx: Pick<ReportContext, "from" | "to">): { from: Date | null; toExclusive: Date | null } {
  return {
    from: ctx.from ? istanbulDayRange(ctx.from).start : null,
    toExclusive: ctx.to ? istanbulDayRange(ctx.to).end : null,
  };
}

const num = (value: unknown): number => Number(value ?? 0);
const money = (value: unknown): number => Math.round(num(value) * 100) / 100;
/** Yüzde, bir ondalık; payda sıfırsa "—". */
export function percent(part: number, total: number): number | string {
  return total === 0 ? "—" : Math.round((part / total) * 1000) / 10;
}

function between(column: Parameters<typeof gte>[0], range: ReturnType<typeof reportRange>): SQL[] {
  const parts: SQL[] = [];
  if (range.from) parts.push(gte(column, range.from));
  if (range.toExclusive) parts.push(lt(column, range.toExclusive));
  return parts;
}

export function registerSatisReports(): void {
  registerReport({
    key: "satis_huni",
    name: "Satış Hunisi",
    category: "Satış",
    description: "Pipeline aşamalarına göre fırsat sayısı ve tutarı",
    permission: PERMISSION,
    module: "satis",
    needsDateRange: false,
    run: async (ctx) => {
      const rows = await withTenant(ctx.tenantId, (tx) =>
        tx
          .select({
            label: crmStages.label,
            kind: crmStages.kind,
            adet: sql<number>`count(${crmDeals.id})::int`,
            toplam: sql<string>`coalesce(sum(${crmDeals.value}), 0)`,
          })
          .from(crmStages)
          .leftJoin(crmDeals, and(eq(crmDeals.stageId, crmStages.id), eq(crmDeals.tenantId, ctx.tenantId)))
          .where(eq(crmStages.tenantId, ctx.tenantId))
          .groupBy(crmStages.id, crmStages.label, crmStages.kind, crmStages.position)
          .orderBy(asc(crmStages.position)),
      );
      const open = rows.filter((r) => r.kind === "open");
      const openCount = open.reduce((n, r) => n + num(r.adet), 0);
      const openValue = await withTenant(ctx.tenantId, async (tx) => {
        const [row] = await tx
          .select({ toplam: sql<string>`coalesce(sum(${crmDeals.value}), 0)` })
          .from(crmDeals)
          .innerJoin(crmStages, eq(crmStages.id, crmDeals.stageId))
          .where(and(eq(crmDeals.tenantId, ctx.tenantId), eq(crmStages.kind, "open")));
        return money(row?.toplam);
      });
      return {
        columns: [
          { key: "asama", label: "Aşama" },
          { key: "tur", label: "Tür" },
          { key: "adet", label: "Fırsat", align: "right" },
          { key: "toplam", label: "Tutar (₺)", align: "right" },
          { key: "ortalama", label: "Ortalama (₺)", align: "right" },
        ],
        rows: rows.map((r) => ({
          asama: r.label,
          tur: KIND_LABEL[r.kind],
          adet: num(r.adet),
          toplam: money(r.toplam),
          ortalama: num(r.adet) === 0 ? 0 : money(num(r.toplam) / num(r.adet)),
        })),
        summary: { "Açık fırsat": String(openCount), "Açık fırsat tutarı (₺)": String(openValue) },
      };
    },
  });

  registerReport({
    key: "satis_kaynak",
    name: "Kaynağa Göre Aday",
    category: "Satış",
    description: "Adayların geldiği kaynaklara göre sayı, müşteriye dönüşüm ve tahmini değer",
    permission: PERMISSION,
    module: "satis",
    needsDateRange: true,
    run: async (ctx) => {
      const range = reportRange(ctx);
      const rows = await withTenant(ctx.tenantId, (tx) =>
        tx
          .select({
            source: crmLeads.source,
            adet: sql<number>`count(*)::int`,
            donusen: sql<number>`count(*) filter (where ${crmLeads.status} = 'converted')::int`,
            deger: sql<string>`coalesce(sum(${crmLeads.estimatedValue}), 0)`,
          })
          .from(crmLeads)
          .where(and(eq(crmLeads.tenantId, ctx.tenantId), ...between(crmLeads.createdAt, range)))
          .groupBy(crmLeads.source)
          .orderBy(desc(sql`2`), asc(crmLeads.source)),
      );
      const total = rows.reduce((n, r) => n + num(r.adet), 0);
      const converted = rows.reduce((n, r) => n + num(r.donusen), 0);
      return {
        columns: [
          { key: "kaynak", label: "Kaynak" },
          { key: "adet", label: "Aday", align: "right" },
          { key: "donusen", label: "Müşteri oldu", align: "right" },
          { key: "oran", label: "Dönüşüm (%)", align: "right" },
          { key: "deger", label: "Tahmini değer (₺)", align: "right" },
        ],
        rows: rows.map((r) => ({
          kaynak: SOURCE_LABEL[r.source] ?? r.source,
          adet: num(r.adet),
          donusen: num(r.donusen),
          oran: percent(num(r.donusen), num(r.adet)),
          deger: money(r.deger),
        })),
        summary: { "Toplam aday": String(total), "Genel dönüşüm (%)": String(percent(converted, total)) },
      };
    },
  });

  registerReport({
    key: "satis_kazanma",
    name: "Kazanma Oranı",
    category: "Satış",
    description: "Kapanan fırsatlarda ay ay kazanılan/kaybedilen sayı, tutar ve kazanma oranı",
    permission: PERMISSION,
    module: "satis",
    needsDateRange: true,
    run: async (ctx) => {
      const range = reportRange(ctx);
      const rows = await withTenant(ctx.tenantId, (tx) =>
        tx
          .select({
            ay: sql<string>`to_char(${crmDeals.closedAt} at time zone 'Europe/Istanbul', 'YYYY-MM')`,
            kind: crmStages.kind,
            adet: sql<number>`count(*)::int`,
            toplam: sql<string>`coalesce(sum(${crmDeals.value}), 0)`,
          })
          .from(crmDeals)
          .innerJoin(crmStages, eq(crmStages.id, crmDeals.stageId))
          .where(
            and(
              eq(crmDeals.tenantId, ctx.tenantId),
              isNotNull(crmDeals.closedAt),
              sql`${crmStages.kind} in ('won', 'lost')`,
              ...between(crmDeals.closedAt, range),
            ),
          )
          .groupBy(sql`1`, crmStages.kind)
          .orderBy(asc(sql`1`)),
      );

      const months = new Map<string, { won: number; lost: number; wonValue: number; lostValue: number }>();
      for (const row of rows) {
        const entry = months.get(row.ay) ?? { won: 0, lost: 0, wonValue: 0, lostValue: 0 };
        if (row.kind === "won") {
          entry.won += num(row.adet);
          entry.wonValue = money(entry.wonValue + num(row.toplam));
        } else {
          entry.lost += num(row.adet);
          entry.lostValue = money(entry.lostValue + num(row.toplam));
        }
        months.set(row.ay, entry);
      }
      const all = [...months.values()].reduce(
        (a, m) => ({ won: a.won + m.won, lost: a.lost + m.lost, wonValue: money(a.wonValue + m.wonValue), lostValue: money(a.lostValue + m.lostValue) }),
        { won: 0, lost: 0, wonValue: 0, lostValue: 0 },
      );
      return {
        columns: [
          { key: "ay", label: "Ay" },
          { key: "kazanilan", label: "Kazanılan", align: "right" },
          { key: "kaybedilen", label: "Kaybedilen", align: "right" },
          { key: "oran", label: "Kazanma (%)", align: "right" },
          { key: "kazanilanTutar", label: "Kazanılan tutar (₺)", align: "right" },
          { key: "kaybedilenTutar", label: "Kaybedilen tutar (₺)", align: "right" },
        ],
        rows: [...months.entries()].map(([ay, m]) => ({
          ay,
          kazanilan: m.won,
          kaybedilen: m.lost,
          oran: percent(m.won, m.won + m.lost),
          kazanilanTutar: m.wonValue,
          kaybedilenTutar: m.lostValue,
        })),
        summary: {
          "Kazanılan": String(all.won),
          "Kaybedilen": String(all.lost),
          "Kazanma oranı (%)": String(percent(all.won, all.won + all.lost)),
          "Kazanılan tutar (₺)": String(all.wonValue),
        },
      };
    },
  });

  registerReport({
    key: "satis_performans",
    name: "Satışçı Performansı",
    category: "Satış",
    description: "Satışçı bazında aday, açık fırsat, kazanılan/kaybedilen fırsat ve tamamlanan görev",
    permission: PERMISSION,
    module: "satis",
    needsDateRange: true,
    run: async (ctx) => {
      const range = reportRange(ctx);
      const data = await withTenant(ctx.tenantId, async (tx) => {
        const people = await tx
          .select({ id: users.id, name: users.name })
          .from(users)
          .where(and(eq(users.tenantId, ctx.tenantId), eq(users.isActive, true)))
          .orderBy(asc(users.name));
        const leadRows = await tx
          .select({ owner: crmLeads.ownerUserId, adet: sql<number>`count(*)::int` })
          .from(crmLeads)
          .where(and(eq(crmLeads.tenantId, ctx.tenantId), ...between(crmLeads.createdAt, range)))
          .groupBy(crmLeads.ownerUserId);
        const dealRows = await tx
          .select({
            owner: crmDeals.ownerUserId,
            kind: crmStages.kind,
            adet: sql<number>`count(*)::int`,
            toplam: sql<string>`coalesce(sum(${crmDeals.value}), 0)`,
          })
          .from(crmDeals)
          .innerJoin(crmStages, eq(crmStages.id, crmDeals.stageId))
          .where(
            and(
              eq(crmDeals.tenantId, ctx.tenantId),
              // açık fırsatlar anlık durumdur; kapananlar kapanış tarihine göre aralığa girer
              sql`(${crmStages.kind} = 'open' or ${and(isNotNull(crmDeals.closedAt), ...between(crmDeals.closedAt, range))})`,
            ),
          )
          .groupBy(crmDeals.ownerUserId, crmStages.kind);
        const taskRows = await tx
          .select({ owner: crmActivities.assigneeUserId, adet: sql<number>`count(*)::int` })
          .from(crmActivities)
          .where(
            and(
              eq(crmActivities.tenantId, ctx.tenantId),
              eq(crmActivities.type, "task"),
              isNotNull(crmActivities.doneAt),
              ...between(crmActivities.doneAt, range),
            ),
          )
          .groupBy(crmActivities.assigneeUserId);
        return { people, leadRows, dealRows, taskRows };
      });

      type Row = { ad: string; aday: number; acik: number; acikTutar: number; kazanilan: number; kazanilanTutar: number; kaybedilen: number; gorev: number };
      const empty = (ad: string): Row => ({ ad, aday: 0, acik: 0, acikTutar: 0, kazanilan: 0, kazanilanTutar: 0, kaybedilen: 0, gorev: 0 });
      const byOwner = new Map<string | null, Row>(data.people.map((p) => [p.id, empty(p.name)]));
      byOwner.set(null, empty(NO_OWNER));
      const row = (owner: string | null): Row => {
        const existing = byOwner.get(owner);
        if (existing) return existing;
        const created = empty("Silinmiş kullanıcı");
        byOwner.set(owner, created);
        return created;
      };
      for (const r of data.leadRows) row(r.owner).aday += num(r.adet);
      for (const r of data.taskRows) row(r.owner).gorev += num(r.adet);
      for (const r of data.dealRows) {
        const target = row(r.owner);
        if (r.kind === "open") {
          target.acik += num(r.adet);
          target.acikTutar = money(target.acikTutar + num(r.toplam));
        } else if (r.kind === "won") {
          target.kazanilan += num(r.adet);
          target.kazanilanTutar = money(target.kazanilanTutar + num(r.toplam));
        } else {
          target.kaybedilen += num(r.adet);
        }
      }

      const list = [...byOwner.values()]
        .filter((r) => r.aday + r.acik + r.kazanilan + r.kaybedilen + r.gorev > 0 || r.ad !== NO_OWNER)
        .sort((a, b) => b.kazanilanTutar - a.kazanilanTutar || b.kazanilan - a.kazanilan || a.ad.localeCompare(b.ad, "tr"));
      return {
        columns: [
          { key: "ad", label: "Satışçı" },
          { key: "aday", label: "Aday", align: "right" },
          { key: "acik", label: "Açık fırsat", align: "right" },
          { key: "acikTutar", label: "Açık tutar (₺)", align: "right" },
          { key: "kazanilan", label: "Kazanılan", align: "right" },
          { key: "kazanilanTutar", label: "Kazanılan tutar (₺)", align: "right" },
          { key: "kaybedilen", label: "Kaybedilen", align: "right" },
          { key: "oran", label: "Kazanma (%)", align: "right" },
          { key: "gorev", label: "Tamamlanan görev", align: "right" },
        ],
        rows: list.map((r) => ({ ...r, oran: percent(r.kazanilan, r.kazanilan + r.kaybedilen) })),
        summary: {
          "Satışçı": String(list.filter((r) => r.ad !== NO_OWNER).length),
          "Kazanılan tutar (₺)": String(money(list.reduce((s, r) => s + r.kazanilanTutar, 0))),
        },
      };
    },
  });

  registerReport({
    key: "satis_kapanis_suresi",
    name: "Ortalama Kapanış Süresi",
    category: "Satış",
    description: "Kazanılan fırsatların açılıştan kapanışa geçen süresi (gün), satışçı bazında",
    permission: PERMISSION,
    module: "satis",
    needsDateRange: true,
    run: async (ctx) => {
      const range = reportRange(ctx);
      const days = sql<number>`extract(epoch from (${crmDeals.closedAt} - ${crmDeals.createdAt})) / 86400.0`;
      const rows = await withTenant(ctx.tenantId, (tx) =>
        tx
          .select({
            ad: sql<string>`coalesce(${users.name}, ${NO_OWNER})`,
            adet: sql<number>`count(*)::int`,
            ortalama: sql<string>`round(avg(${days})::numeric, 1)`,
            enHizli: sql<string>`round(min(${days})::numeric, 1)`,
            enYavas: sql<string>`round(max(${days})::numeric, 1)`,
            toplamGun: sql<string>`sum(${days})`,
          })
          .from(crmDeals)
          .innerJoin(crmStages, eq(crmStages.id, crmDeals.stageId))
          .leftJoin(users, eq(users.id, crmDeals.ownerUserId))
          .where(
            and(
              eq(crmDeals.tenantId, ctx.tenantId),
              eq(crmStages.kind, "won"),
              isNotNull(crmDeals.closedAt),
              ...between(crmDeals.closedAt, range),
            ),
          )
          .groupBy(users.id, users.name)
          .orderBy(asc(sql`round(avg(${days})::numeric, 1)`)),
      );
      const count = rows.reduce((n, r) => n + num(r.adet), 0);
      const sumDays = rows.reduce((n, r) => n + num(r.toplamGun), 0);
      return {
        columns: [
          { key: "ad", label: "Satışçı" },
          { key: "adet", label: "Kazanılan", align: "right" },
          { key: "ortalama", label: "Ortalama (gün)", align: "right" },
          { key: "enHizli", label: "En hızlı (gün)", align: "right" },
          { key: "enYavas", label: "En yavaş (gün)", align: "right" },
        ],
        rows: rows.map((r) => ({ ad: r.ad, adet: num(r.adet), ortalama: num(r.ortalama), enHizli: num(r.enHizli), enYavas: num(r.enYavas) })),
        summary: {
          "Kazanılan fırsat": String(count),
          "Genel ortalama (gün)": count === 0 ? "—" : String(Math.round((sumDays / count) * 10) / 10),
        },
      };
    },
  });
}
