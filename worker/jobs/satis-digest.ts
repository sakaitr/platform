import { and, asc, eq, inArray, isNull, lt } from "drizzle-orm";
import { dbAdmin } from "@/db/admin";
import { crmActivities, crmLeads, tenantModules, tenants, users } from "@/db/schema";
import { getTenantAccess } from "@/lib/licensing";
import type { EmailJob } from "@/lib/queue";
import { formatDateTime, istanbulDayKey } from "@/lib/time";
import { istanbulDayRange } from "@/modules/satis/dates";

export type DigestTask = { subject: string; dueAt: Date | null; about: string | null };
export type DigestLead = { name: string; phone: string | null };

/** Özet 08:00'dan sonra, günde bir kez (İstanbul günü). */
export const DIGEST_HOUR = 8;

export function shouldRunDigest(now: Date, lastRunDay: string | null): boolean {
  const hour = Number(
    new Intl.DateTimeFormat("en-GB", { timeZone: "Europe/Istanbul", hour: "2-digit", hour12: false }).format(now),
  );
  return hour >= DIGEST_HOUR && lastRunDay !== istanbulDayKey(now);
}

/** Saf: gönderilecek bir şey yoksa `null`. */
export function buildDigest(input: {
  userName: string;
  tenantName: string;
  overdue: readonly DigestTask[];
  today: readonly DigestTask[];
  followUps: readonly DigestLead[];
  link: string;
}): { subject: string; body: string } | null {
  const total = input.overdue.length + input.today.length + input.followUps.length;
  if (total === 0) return null;

  const taskLine = (t: DigestTask): string =>
    `- ${t.subject}${t.about ? ` (${t.about})` : ""}${t.dueAt ? `, vade ${formatDateTime(t.dueAt)}` : ""}`;
  const sections: string[] = [`Merhaba ${input.userName},`, ""];
  if (input.overdue.length > 0) {
    sections.push(`Geciken görevler (${input.overdue.length}):`, ...input.overdue.map(taskLine), "");
  }
  if (input.today.length > 0) {
    sections.push(`Bugün yapılacaklar (${input.today.length}):`, ...input.today.map(taskLine), "");
  }
  if (input.followUps.length > 0) {
    sections.push(
      `Bugün aranacak adaylar (${input.followUps.length}):`,
      ...input.followUps.map((l) => `- ${l.name}${l.phone ? `, ${l.phone}` : ""}`),
      "",
    );
  }
  sections.push(`Görevlere git: ${input.link}`);
  return {
    subject: `${input.tenantName}: bugün ${total} iş sizi bekliyor`,
    body: sections.join("\n"),
  };
}

export type DigestDeps = {
  now?: Date;
  /** Aynı (kullanıcı, gün) için ikinci gönderimi engeller. `true` = ilk kez, gönder. */
  claim: (key: string) => Promise<boolean>;
  send: (job: EmailJob) => Promise<void>;
  appUrl?: string;
};

/**
 * Günlük görev özeti. Kiracılar-üstü olduğu için dbAdmin kullanır (lisans süre kontrolüyle aynı
 * operatör istisnası): yalnız satış modülü açık kiracıların, kendine atanmış geciken/bugünkü görevleri
 * ve takip tarihi gelen adayları okunur. Sahipsiz kayıtlar özete girmez (herkese giderdi).
 */
export async function runSatisDigest(deps: DigestDeps): Promise<{ emails: number }> {
  const now = deps.now ?? new Date();
  const dayKey = istanbulDayKey(now);
  const { end } = istanbulDayRange(dayKey);
  const { start } = istanbulDayRange(dayKey);
  const link = `${deps.appUrl ?? process.env.APP_URL ?? ""}/satis/gorevler`;

  const licensed = await dbAdmin
    .select({ tenantId: tenantModules.tenantId, tenantName: tenants.name })
    .from(tenantModules)
    .innerJoin(tenants, eq(tenants.id, tenantModules.tenantId))
    .where(and(eq(tenantModules.moduleKey, "satis"), eq(tenants.isActive, true)));

  let emails = 0;
  for (const tenant of licensed) {
    const access = await getTenantAccess(tenant.tenantId);
    if (access.modules.get("satis")?.allowed !== true) continue;

    const members = await dbAdmin
      .select({ id: users.id, name: users.name, email: users.email })
      .from(users)
      .where(and(eq(users.tenantId, tenant.tenantId), eq(users.isActive, true)));

    for (const user of members) {
      const tasks = await dbAdmin
        .select({
          subject: crmActivities.subject,
          dueAt: crmActivities.dueAt,
          leadName: crmLeads.name,
        })
        .from(crmActivities)
        .leftJoin(crmLeads, eq(crmLeads.id, crmActivities.leadId))
        .where(
          and(
            eq(crmActivities.tenantId, tenant.tenantId),
            eq(crmActivities.type, "task"),
            eq(crmActivities.assigneeUserId, user.id),
            isNull(crmActivities.doneAt),
            lt(crmActivities.dueAt, end),
          ),
        )
        .orderBy(asc(crmActivities.dueAt))
        .limit(50);
      const followUps = await dbAdmin
        .select({ name: crmLeads.name, phone: crmLeads.phone })
        .from(crmLeads)
        .where(
          and(
            eq(crmLeads.tenantId, tenant.tenantId),
            eq(crmLeads.ownerUserId, user.id),
            lt(crmLeads.followUpAt, end),
            inArray(crmLeads.status, ["new", "contacted", "qualified"]),
          ),
        )
        .orderBy(asc(crmLeads.followUpAt))
        .limit(50);

      const toTask = (t: (typeof tasks)[number]): DigestTask => ({ subject: t.subject, dueAt: t.dueAt, about: t.leadName });
      const digest = buildDigest({
        userName: user.name,
        tenantName: tenant.tenantName,
        overdue: tasks.filter((t) => t.dueAt && t.dueAt < start).map(toTask),
        today: tasks.filter((t) => t.dueAt && t.dueAt >= start).map(toTask),
        followUps,
        link,
      });
      if (!digest) continue;
      if (!(await deps.claim(`satis-digest:${user.id}:${dayKey}`))) continue;
      await deps.send({ to: user.email, subject: digest.subject, body: digest.body });
      emails += 1;
    }
  }
  return { emails };
}

