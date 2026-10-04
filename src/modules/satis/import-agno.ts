import { and, eq, sql } from "drizzle-orm";
import { z } from "zod";
import { crmActivities, crmDeals, crmDeletedExternal, crmLeads, crmStages, users } from "@/db/schema";
import { withTenant, type TenantTx } from "@/db/tenant";
import { checkLimit } from "@/lib/limits";
import { findDuplicateLead, isTombstoned } from "./leads";
import { buildLeadKeys, foldText } from "./normalize";
import { resolveScore } from "./scoring";

/**
 * Agno CRM → AtriCRM veri taşıma. Kaynak, Agno CRM'den alınan bir JSON dışa aktarımıdır (`agno-crm-export`
 * v1, bkz. docs/integrations/agno-crm-tasima.md). Kaynak veritabanına bağlanılmaz: salt okur ve kaynak
 * şemasından bağımsız.
 *
 * İlkeler:
 *  - İdempotent: aynı dosya ikinci kez içe aktarılınca yeni kayıt açmaz.
 *  - Varsayılan DENEME: `apply: false` ise her şey bir transaction içinde gerçekten çalıştırılır (yinelenenler,
 *    eşleşmeler dahil) ve geri alınır; rapor gerçek sonucu gösterir.
 *  - Giden webhook üretmez (toplu taşıma bir olay yağmuru yaratmasın).
 *  - Silinmiş kişiler (`deletedExternal`) önce mezar taşına yazılır; onlara ait kayıtlar atlanır (KVKK).
 */

const text = (max: number) =>
  z
    .string()
    .max(max)
    .nullish()
    .transform((v) => (v == null || v.trim() === "" ? null : v.trim()));
const id = z.union([z.string(), z.number()]).transform((v) => String(v).trim()).pipe(z.string().min(1).max(100));
const dateText = z.string().max(40).nullish().transform((v) => (v ? v : null));

export const AgnoLeadSchema = z.object({
  id,
  name: z.string().trim().min(1).max(255),
  contactName: text(255),
  phone: text(40),
  email: text(255),
  website: text(255),
  address: text(1000),
  city: text(100),
  sector: text(100),
  note: text(4000),
  source: text(40),
  externalId: text(100),
  interestedService: text(255),
  score: z.number().nullish(),
  status: text(40),
  ownerEmail: text(255),
  followUpAt: dateText,
  createdAt: dateText,
});

export const AgnoDealSchema = z.object({
  id,
  leadId: id.nullish(),
  title: z.string().trim().min(1).max(255),
  stage: text(100),
  value: z.union([z.number(), z.string()]).nullish(),
  lostReason: text(1000),
  ownerEmail: text(255),
  createdAt: dateText,
  closedAt: dateText,
});

export const AgnoActivitySchema = z.object({
  id,
  leadId: id.nullish(),
  dealId: id.nullish(),
  type: text(40),
  subject: z.string().trim().min(1).max(255),
  note: text(4000),
  assigneeEmail: text(255),
  createdAt: dateText,
  dueAt: dateText,
  doneAt: dateText,
});

export const AgnoExportSchema = z.object({
  format: z.literal("agno-crm-export"),
  version: z.literal(1),
  leads: z.array(z.unknown()).max(200_000),
  deals: z.array(z.unknown()).max(200_000).optional(),
  activities: z.array(z.unknown()).max(500_000).optional(),
  deletedExternal: z.array(z.object({ source: z.string().max(40), externalId: z.string().max(100) })).max(200_000).optional(),
});

export type AgnoLead = z.infer<typeof AgnoLeadSchema>;
export type AgnoDeal = z.infer<typeof AgnoDealSchema>;
export type AgnoActivity = z.infer<typeof AgnoActivitySchema>;

// ---- Eşleme (saf) ---------------------------------------------------------------------------

export type MappedSource = { source: "atricard" | "api"; externalId: string; label: string | null };

/** Atricard kaynaklı lead kimliğini korur (silme olayı ve mezar taşı tutarlı kalsın); diğerleri `api` + `agno:<id>`. */
export function mapSource(lead: Pick<AgnoLead, "id" | "source" | "externalId">): MappedSource {
  if (foldText(lead.source ?? "") === "atricard" && lead.externalId) {
    return { source: "atricard", externalId: lead.externalId, label: null };
  }
  return { source: "api", externalId: `agno:${lead.id}`, label: lead.source ?? null };
}

type LeadStatus = "new" | "contacted" | "qualified" | "disqualified" | "converted";

const STATUS_ALIASES: Record<string, LeadStatus> = {
  new: "new", yeni: "new", open: "new",
  contacted: "contacted", arandi: "contacted", gorusuldu: "contacted",
  qualified: "qualified", nitelikli: "qualified", quoted: "qualified", teklif: "qualified", teklifverildi: "qualified",
  disqualified: "disqualified", lost: "disqualified", kaybedildi: "disqualified", elendi: "disqualified", uygundegil: "disqualified",
  converted: "converted", won: "converted", kazanildi: "converted", musterioldu: "converted",
};

export function mapStatus(raw: string | null | undefined): { status: LeadStatus; recognized: boolean } {
  if (!raw) return { status: "new", recognized: true };
  const mapped = STATUS_ALIASES[foldText(raw)];
  return mapped ? { status: mapped, recognized: true } : { status: "new", recognized: false };
}

const ACTIVITY_TYPES: Record<string, "call" | "meeting" | "email" | "note" | "task"> = {
  call: "call", arama: "call", telefon: "call",
  meeting: "meeting", gorusme: "meeting", toplanti: "meeting",
  email: "email", eposta: "email", mail: "email",
  task: "task", gorev: "task", todo: "task",
  note: "note", not: "note",
};

export function mapActivityType(raw: string | null | undefined): "call" | "meeting" | "email" | "note" | "task" {
  return ACTIVITY_TYPES[foldText(raw ?? "")] ?? "note";
}

export type StageRef = { id: string; label: string; kind: "open" | "won" | "lost" };

/** Aşama adı (büyük/küçük harf ve Türkçe karakter fark etmez) → aşama; eşleşmezse türüne göre ilk aşama. */
export function mapStage(raw: string | null | undefined, stages: readonly StageRef[]): { stage: StageRef | null; matched: boolean } {
  const first = (kind: StageRef["kind"]): StageRef | null => stages.find((s) => s.kind === kind) ?? null;
  const folded = foldText(raw ?? "");
  const byName = folded ? stages.find((s) => foldText(s.label) === folded) : undefined;
  if (byName) return { stage: byName, matched: true };
  if (["won", "kazanildi", "kazanilan", "closedwon"].includes(folded)) return { stage: first("won"), matched: true };
  if (["lost", "kaybedildi", "kaybedilen", "closedlost"].includes(folded)) return { stage: first("lost"), matched: true };
  return { stage: first("open"), matched: folded === "" };
}

export function parseDate(raw: string | null | undefined, fallback: Date): Date {
  if (!raw) return fallback;
  const date = new Date(raw);
  return Number.isNaN(date.getTime()) ? fallback : date;
}

export function parseAmount(raw: number | string | null | undefined): string {
  if (raw == null || raw === "") return "0.00";
  const n = typeof raw === "number" ? raw : Number(String(raw).replace(",", "."));
  return Number.isFinite(n) && n >= 0 ? n.toFixed(2) : "0.00";
}

// ---- İçe aktarma ----------------------------------------------------------------------------

export type ImportReport = {
  mode: "deneme" | "uygulandi";
  leads: { toplam: number; olusturuldu: number; zatenVar: number; yinelenen: number; mezarTasi: number; gecersiz: number };
  deals: { toplam: number; olusturuldu: number; zatenVar: number; leadsiz: number; gecersiz: number };
  activities: { toplam: number; olusturuldu: number; zatenVar: number; baglantisiz: number; gecersiz: number };
  mezarTaslari: number;
  eslesmeyenAsamalar: Record<string, number>;
  taninmayanDurumlar: Record<string, number>;
  eslesmeyenSahipler: string[];
  uyarilar: string[];
  hatalar: string[];
};

class DryRun extends Error {
  constructor(readonly report: ImportReport) {
    super("dry-run");
  }
}

const emptyReport = (mode: ImportReport["mode"]): ImportReport => ({
  mode,
  leads: { toplam: 0, olusturuldu: 0, zatenVar: 0, yinelenen: 0, mezarTasi: 0, gecersiz: 0 },
  deals: { toplam: 0, olusturuldu: 0, zatenVar: 0, leadsiz: 0, gecersiz: 0 },
  activities: { toplam: 0, olusturuldu: 0, zatenVar: 0, baglantisiz: 0, gecersiz: 0 },
  mezarTaslari: 0,
  eslesmeyenAsamalar: {},
  taninmayanDurumlar: {},
  eslesmeyenSahipler: [],
  uyarilar: [],
  hatalar: [],
});

const bump = (record: Record<string, number>, key: string): void => {
  record[key] = (record[key] ?? 0) + 1;
};

export async function importAgnoExport(
  tenantId: string,
  raw: unknown,
  options: { apply: boolean; ignoreLimit?: boolean; now?: Date } = { apply: false },
): Promise<ImportReport> {
  const now = options.now ?? new Date();
  const envelope = AgnoExportSchema.safeParse(raw);
  if (!envelope.success) {
    throw new Error(`Dışa aktarım biçimi geçersiz: ${envelope.error.issues[0]?.path.join(".") ?? ""} ${envelope.error.issues[0]?.message ?? ""}`.trim());
  }
  const data = envelope.data;
  const report = emptyReport(options.apply ? "uygulandi" : "deneme");

  if (!options.ignoreLimit) {
    const limit = await checkLimit(tenantId, "satis", "max_leads", data.leads.length);
    if (!limit.ok) throw new Error(`${limit.message} (${data.leads.length} aday içe aktarılmak isteniyor; sınırı yok saymak için --ignore-limit)`);
  }

  const run = async (tx: TenantTx): Promise<ImportReport> => {
    const members = await tx.select({ id: users.id, email: users.email }).from(users).where(and(eq(users.tenantId, tenantId), eq(users.isActive, true)));
    const byEmail = new Map(members.map((m) => [m.email.toLowerCase(), m.id]));
    const unmatched = new Set<string>();
    const owner = (email: string | null): string | null => {
      if (!email) return null;
      const found = byEmail.get(email.toLowerCase());
      if (!found) unmatched.add(email.toLowerCase());
      return found ?? null;
    };

    const stages = (await tx
      .select({ id: crmStages.id, label: crmStages.label, kind: crmStages.kind })
      .from(crmStages)
      .where(eq(crmStages.tenantId, tenantId))
      .orderBy(crmStages.position)) as StageRef[];

    // Mezar taşları önce: sonraki adımlar onlara saygı duyar
    for (const tomb of data.deletedExternal ?? []) {
      const source = foldText(tomb.source) === "atricard" ? "atricard" : "api";
      const externalId = source === "atricard" ? tomb.externalId : `agno:${tomb.externalId}`;
      await tx.insert(crmDeletedExternal).values({ tenantId, source, externalId }).onConflictDoNothing();
      report.mezarTaslari += 1;
    }

    const leadMap = new Map<string, string | null>(); // Agno lead kimliği → AtriCRM aday kimliği (null: atlandı)
    for (const row of data.leads) {
      report.leads.toplam += 1;
      const parsed = AgnoLeadSchema.safeParse(row);
      if (!parsed.success) {
        report.leads.gecersiz += 1;
        if (report.hatalar.length < 50) report.hatalar.push(`Aday satırı geçersiz: ${parsed.error.issues[0]?.path.join(".") ?? ""} ${parsed.error.issues[0]?.message ?? ""}`.trim());
        continue;
      }
      const lead = parsed.data;
      const mapped = mapSource(lead);

      if (await isTombstoned(tx, tenantId, mapped.source, mapped.externalId)) {
        report.leads.mezarTasi += 1;
        leadMap.set(lead.id, null);
        continue;
      }
      const [existing] = await tx
        .select({ id: crmLeads.id })
        .from(crmLeads)
        .where(and(eq(crmLeads.tenantId, tenantId), eq(crmLeads.source, mapped.source), eq(crmLeads.externalId, mapped.externalId)))
        .limit(1);
      if (existing) {
        report.leads.zatenVar += 1;
        leadMap.set(lead.id, existing.id);
        continue;
      }

      const keys = buildLeadKeys({ name: lead.name, city: lead.city, phone: lead.phone, email: lead.email, website: lead.website });
      const duplicate = await findDuplicateLead(tx, tenantId, keys);
      if (duplicate) {
        report.leads.yinelenen += 1;
        leadMap.set(lead.id, duplicate.id); // çocuk kayıtlar eşleşen adaya bağlanır
        continue;
      }

      const status = mapStatus(lead.status);
      if (!status.recognized) bump(report.taninmayanDurumlar, lead.status ?? "");
      const created = parseDate(lead.createdAt, now);
      const score =
        lead.score != null && Number.isFinite(lead.score)
          ? Math.min(100, Math.max(0, Math.round(lead.score)))
          : resolveScore({ website: lead.website, email: lead.email, phone: lead.phone });
      const noteParts = [lead.note, mapped.label ? `Agno CRM kaynağı: ${mapped.label}` : null, lead.address ? `Adres: ${lead.address}` : null].filter(Boolean);

      const [row2] = await tx
        .insert(crmLeads)
        .values({
          tenantId,
          name: lead.name,
          contactName: lead.contactName,
          phone: lead.phone,
          phoneKey: keys.phoneKey,
          email: lead.email,
          emailKey: keys.emailKey,
          website: lead.website,
          websiteKey: keys.websiteKey,
          nameKey: keys.nameKey,
          city: lead.city,
          sector: lead.sector,
          service: lead.interestedService,
          note: noteParts.length > 0 ? noteParts.join("\n") : null,
          score,
          status: status.status,
          source: mapped.source,
          externalId: mapped.externalId,
          ownerUserId: owner(lead.ownerEmail),
          followUpAt: lead.followUpAt ? parseDate(lead.followUpAt, now) : null,
          createdAt: created,
          updatedAt: created,
        })
        .returning({ id: crmLeads.id });
      report.leads.olusturuldu += 1;
      leadMap.set(lead.id, row2!.id);
    }

    const dealMap = new Map<string, string>();
    for (const row of data.deals ?? []) {
      report.deals.toplam += 1;
      const parsed = AgnoDealSchema.safeParse(row);
      if (!parsed.success) {
        report.deals.gecersiz += 1;
        continue;
      }
      const deal = parsed.data;
      const leadId = deal.leadId ? leadMap.get(deal.leadId) : undefined;
      if (deal.leadId && leadId === null) continue; // mezar taşındaki kişinin fırsatı
      if (deal.leadId && leadId === undefined) report.deals.leadsiz += 1;

      const { stage, matched } = mapStage(deal.stage, stages);
      if (!stage) {
        report.deals.gecersiz += 1;
        report.hatalar.push("Pipeline'da açık/kazanıldı/kaybedildi aşaması yok; fırsatlar aktarılamadı.");
        break;
      }
      if (!matched) bump(report.eslesmeyenAsamalar, deal.stage ?? "");

      const [existing] = await tx
        .select({ id: crmDeals.id })
        .from(crmDeals)
        .where(
          and(
            eq(crmDeals.tenantId, tenantId),
            eq(crmDeals.title, deal.title),
            leadId ? eq(crmDeals.leadId, leadId) : sql`${crmDeals.leadId} is null`,
          ),
        )
        .limit(1);
      if (existing) {
        report.deals.zatenVar += 1;
        dealMap.set(deal.id, existing.id);
        continue;
      }
      const created = parseDate(deal.createdAt, now);
      const [row2] = await tx
        .insert(crmDeals)
        .values({
          tenantId,
          title: deal.title,
          stageId: stage.id,
          value: parseAmount(deal.value),
          leadId: leadId ?? null,
          ownerUserId: owner(deal.ownerEmail),
          closedAt: stage.kind === "open" ? null : parseDate(deal.closedAt, created),
          lostReason: stage.kind === "lost" ? deal.lostReason ?? "Agno CRM'den aktarıldı" : null,
          createdAt: created,
          updatedAt: created,
        })
        .returning({ id: crmDeals.id });
      report.deals.olusturuldu += 1;
      dealMap.set(deal.id, row2!.id);
    }

    for (const row of data.activities ?? []) {
      report.activities.toplam += 1;
      const parsed = AgnoActivitySchema.safeParse(row);
      if (!parsed.success) {
        report.activities.gecersiz += 1;
        continue;
      }
      const act = parsed.data;
      const leadId = act.leadId ? leadMap.get(act.leadId) : undefined;
      const dealId = act.dealId ? dealMap.get(act.dealId) : undefined;
      if (act.leadId && leadId === null) continue; // mezar taşı: kişisel not taşıyabilir, atla
      if (!leadId && !dealId) {
        report.activities.baglantisiz += 1;
        continue;
      }
      const created = parseDate(act.createdAt, now);
      const type = mapActivityType(act.type);
      const [existing] = await tx
        .select({ id: crmActivities.id })
        .from(crmActivities)
        .where(
          and(
            eq(crmActivities.tenantId, tenantId),
            eq(crmActivities.subject, act.subject),
            // Kaynakta tarih yoksa "şimdi" her çalıştırmada farklı olur ve tekilleştirme hiç eşleşmez:
            // tarih verilmemişse yalnız (üst kayıt, konu) ile eşleştir.
            act.createdAt ? eq(crmActivities.createdAt, created) : undefined,
            leadId ? eq(crmActivities.leadId, leadId) : sql`${crmActivities.leadId} is null`,
            dealId ? eq(crmActivities.dealId, dealId) : sql`${crmActivities.dealId} is null`,
          ),
        )
        .limit(1);
      if (existing) {
        report.activities.zatenVar += 1;
        continue;
      }
      await tx.insert(crmActivities).values({
        tenantId,
        type,
        subject: act.subject,
        note: act.note,
        dueAt: act.dueAt ? parseDate(act.dueAt, created) : null,
        doneAt: act.doneAt ? parseDate(act.doneAt, created) : type === "task" ? null : created,
        assigneeUserId: owner(act.assigneeEmail),
        leadId: leadId ?? null,
        dealId: dealId ?? null,
        createdAt: created,
        updatedAt: created,
      });
      report.activities.olusturuldu += 1;
    }

    report.eslesmeyenSahipler = [...unmatched].sort();
    if (report.eslesmeyenSahipler.length > 0) {
      report.uyarilar.push(`${report.eslesmeyenSahipler.length} sahip e-postası bu kiracıdaki bir kullanıcıyla eşleşmedi; ilgili kayıtlar sahipsiz aktarıldı.`);
    }
    if (Object.keys(report.eslesmeyenAsamalar).length > 0) {
      report.uyarilar.push("Bazı fırsat aşamaları pipeline'daki bir aşamayla eşleşmedi; ilk açık aşamaya konuldu.");
    }
    if (!options.apply) throw new DryRun(report);
    return report;
  };

  try {
    return await withTenant(tenantId, run);
  } catch (error: unknown) {
    if (error instanceof DryRun) return error.report;
    throw error;
  }
}
