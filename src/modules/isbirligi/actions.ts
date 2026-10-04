"use server";

import { revalidatePath } from "next/cache";
import { and, eq } from "drizzle-orm";
import {
  announcements,
  blacklist,
  contacts,
  driverEvaluations,
  driverRecords,
  leaveRequests,
  leaveTypes,
  portalUserCompanies,
  portalUsers,
  suggestions,
  tasks,
  ticketMessages,
  tickets,
  warnings,
} from "@/db/schema";
import { withTenant } from "@/db/tenant";
import { hashPassword, requireModule, requirePermission } from "@/lib/auth";
import { writeAuditLog } from "@/lib/audit";
import { nextNumber } from "@/lib/numbering";
import { isInScope } from "@/lib/scope";
import {
  AnnouncementSchema,
  BlacklistSchema,
  ContactSchema,
  DriverEvaluationSchema,
  DriverRecordSchema,
  LeaveRequestSchema,
  LeaveTypeSchema,
  PortalUserSchema,
  SuggestionSchema,
  TaskSchema,
  TicketMessageSchema,
  TicketSchema,
  WarningSchema,
} from "./validators";

export type ActionState = { error: string } | { ok: string } | null;

const read = (formData: FormData, keys: readonly string[]): Record<string, string> =>
  Object.fromEntries(keys.map((k) => [k, String(formData.get(k) ?? "")]));

/** Gün sayısı — bitiş dahil. */
function dayCount(startsOn: string, endsOn: string): number {
  const start = Date.parse(`${startsOn}T00:00:00Z`);
  const end = Date.parse(`${endsOn}T00:00:00Z`);
  return Math.floor((end - start) / 86_400_000) + 1;
}

/* ---------- Görevler ---------- */

export async function saveTaskAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const isUpdate = Boolean(formData.get("id"));
  const session = await requirePermission(isUpdate ? "gorevler:update" : "gorevler:create");

  const parsed = TaskSchema.safeParse({
    ...read(formData, ["title", "description", "status", "priority", "assignedTo", "companyId", "dueDate"]),
    id: formData.get("id") || undefined,
  });
  if (!parsed.success) return { error: parsed.error.issues[0]!.message };
  const { id, ...values } = parsed.data;

  await withTenant(session.tenantId, async (tx) => {
    const completedAt = values.status === "bitti" ? new Date() : null;
    if (isUpdate && id) {
      await tx
        .update(tasks)
        .set({ ...values, completedAt, updatedAt: new Date() })
        .where(and(eq(tasks.tenantId, session.tenantId), eq(tasks.id, id)));
    } else {
      await tx
        .insert(tasks)
        .values({ ...values, completedAt, tenantId: session.tenantId, createdBy: session.userId });
    }
  });

  revalidatePath("/gorevler");
  return { ok: isUpdate ? "Görev güncellendi." : "Görev eklendi." };
}

export async function setTaskStatusAction(formData: FormData): Promise<void> {
  const session = await requirePermission("gorevler:update");
  const id = String(formData.get("id") ?? "");
  const status = String(formData.get("status") ?? "");
  if (!id || !["yapilacak", "yapiliyor", "bekliyor", "bitti"].includes(status)) return;

  await withTenant(session.tenantId, (tx) =>
    tx
      .update(tasks)
      .set({
        status: status as "bitti",
        completedAt: status === "bitti" ? new Date() : null,
        updatedAt: new Date(),
      })
      .where(and(eq(tasks.tenantId, session.tenantId), eq(tasks.id, id))),
  );
  revalidatePath("/gorevler");
}

export async function deleteTaskAction(formData: FormData): Promise<void> {
  const session = await requirePermission("gorevler:delete");
  const id = String(formData.get("id") ?? "");
  if (!id) return;
  await withTenant(session.tenantId, (tx) =>
    tx.delete(tasks).where(and(eq(tasks.tenantId, session.tenantId), eq(tasks.id, id))),
  );
  revalidatePath("/gorevler");
}

/* ---------- Destek talepleri ---------- */

export async function createTicketAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const session = await requirePermission("sorunlar:create");

  const parsed = TicketSchema.safeParse(
    read(formData, ["title", "description", "priority", "companyId", "vehicleId", "assignedTo"]),
  );
  if (!parsed.success) return { error: parsed.error.issues[0]!.message };
  const values = parsed.data;

  if (values.companyId && !isInScope(session.scope, values.companyId)) {
    return { error: "Seçilen firma kapsamınızda değil." };
  }

  const ticketNo = await withTenant(session.tenantId, async (tx) => {
    const no = await nextNumber(tx, session.tenantId, "talep");
    await tx.insert(tickets).values({
      ...values,
      ticketNo: no,
      tenantId: session.tenantId,
      createdBy: session.userId,
    });
    return no;
  });

  await writeAuditLog({
    tenantId: session.tenantId,
    userId: session.userId,
    event: "ticket.created",
    entityType: "ticket",
    metadata: { ticketNo },
  });
  revalidatePath("/destek");
  return { ok: `${ticketNo} açıldı.` };
}

export async function addTicketMessageAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const session = await requirePermission("sorunlar:update");

  const parsed = TicketMessageSchema.safeParse({
    ticketId: formData.get("ticketId") ?? "",
    body: formData.get("body") ?? "",
    isInternal: formData.get("isInternal") === "on",
  });
  if (!parsed.success) return { error: parsed.error.issues[0]!.message };

  await withTenant(session.tenantId, (tx) =>
    tx.insert(ticketMessages).values({
      tenantId: session.tenantId,
      ticketId: parsed.data.ticketId,
      body: parsed.data.body,
      isInternal: parsed.data.isInternal,
      userId: session.userId,
    }),
  );
  revalidatePath(`/destek/${parsed.data.ticketId}`);
  return { ok: "Mesaj eklendi." };
}

const TICKET_FLOW: Record<string, readonly string[]> = {
  acik: ["islemde", "bekliyor", "kapandi"],
  islemde: ["bekliyor", "cozuldu", "kapandi"],
  bekliyor: ["islemde", "cozuldu", "kapandi"],
  cozuldu: ["kapandi", "islemde"],
  kapandi: [],
};

export async function setTicketStatusAction(formData: FormData): Promise<void> {
  const session = await requirePermission("sorunlar:update");
  const id = String(formData.get("id") ?? "");
  const to = String(formData.get("status") ?? "");
  if (!id || !(to in TICKET_FLOW)) return;

  await withTenant(session.tenantId, async (tx) => {
    const [current] = await tx
      .select({ status: tickets.status })
      .from(tickets)
      .where(and(eq(tickets.tenantId, session.tenantId), eq(tickets.id, id)));
    if (!current || !TICKET_FLOW[current.status]!.includes(to)) return;

    const now = new Date();
    await tx
      .update(tickets)
      .set({
        status: to as "cozuldu",
        solvedAt: to === "cozuldu" ? now : undefined,
        closedAt: to === "kapandi" ? now : undefined,
        updatedAt: now,
      })
      .where(eq(tickets.id, id));
  });
  revalidatePath("/destek");
  revalidatePath(`/destek/${id}`);
}

export async function assignTicketAction(formData: FormData): Promise<void> {
  const session = await requirePermission("sorunlar:assign");
  const id = String(formData.get("id") ?? "");
  const assignedTo = String(formData.get("assignedTo") ?? "") || null;
  if (!id) return;
  await withTenant(session.tenantId, (tx) =>
    tx
      .update(tickets)
      .set({ assignedTo, updatedAt: new Date() })
      .where(and(eq(tickets.tenantId, session.tenantId), eq(tickets.id, id))),
  );
  revalidatePath(`/destek/${id}`);
}

/* ---------- Öneri / uyarı ---------- */

export async function saveSuggestionAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const session = await requirePermission("oneriler:create");

  const parsed = SuggestionSchema.safeParse(read(formData, ["title", "description", "kind", "assignedTo"]));
  if (!parsed.success) return { error: parsed.error.issues[0]!.message };

  const no = await withTenant(session.tenantId, async (tx) => {
    const documentNo = await nextNumber(tx, session.tenantId, "oneri");
    await tx
      .insert(suggestions)
      .values({ ...parsed.data, documentNo, tenantId: session.tenantId, createdBy: session.userId });
    return documentNo;
  });

  revalidatePath("/oneriler");
  return { ok: `${no} kaydedildi.` };
}

export async function closeSuggestionAction(formData: FormData): Promise<void> {
  const session = await requirePermission("oneriler:update");
  const id = String(formData.get("id") ?? "");
  if (!id) return;
  await withTenant(session.tenantId, (tx) =>
    tx
      .update(suggestions)
      .set({ isOpen: false, closedAt: new Date(), updatedAt: new Date() })
      .where(and(eq(suggestions.tenantId, session.tenantId), eq(suggestions.id, id))),
  );
  revalidatePath("/oneriler");
}

export async function saveWarningAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const session = await requireModule("suruculer:update", "filo");

  const parsed = WarningSchema.safeParse(read(formData, ["vehicleId", "driverId", "reason", "deadline"]));
  if (!parsed.success) return { error: parsed.error.issues[0]!.message };

  const no = await withTenant(session.tenantId, async (tx) => {
    const documentNo = await nextNumber(tx, session.tenantId, "uyari");
    await tx
      .insert(warnings)
      .values({ ...parsed.data, documentNo, tenantId: session.tenantId, createdBy: session.userId });
    return documentNo;
  });

  revalidatePath("/filo/uyarilar");
  return { ok: `${no} düzenlendi.` };
}

export async function completeWarningAction(formData: FormData): Promise<void> {
  const session = await requireModule("suruculer:update", "filo");
  const id = String(formData.get("id") ?? "");
  if (!id) return;
  await withTenant(session.tenantId, (tx) =>
    tx
      .update(warnings)
      .set({ isDone: true, doneAt: new Date(), updatedAt: new Date() })
      .where(and(eq(warnings.tenantId, session.tenantId), eq(warnings.id, id))),
  );
  revalidatePath("/filo/uyarilar");
}

/* ---------- İK ---------- */

export async function saveLeaveTypeAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const session = await requirePermission("users:update");

  const parsed = LeaveTypeSchema.safeParse({
    id: formData.get("id") || undefined,
    name: formData.get("name") ?? "",
    annualDays: formData.get("annualDays") ?? "0",
    isActive: formData.get("isActive") === "on",
  });
  if (!parsed.success) return { error: parsed.error.issues[0]!.message };
  const { id, ...values } = parsed.data;

  try {
    await withTenant(session.tenantId, async (tx) => {
      if (id) {
        await tx
          .update(leaveTypes)
          .set(values)
          .where(and(eq(leaveTypes.tenantId, session.tenantId), eq(leaveTypes.id, id)));
      } else {
        await tx.insert(leaveTypes).values({ ...values, tenantId: session.tenantId });
      }
    });
  } catch (error) {
    if ((error as { code?: string }).code === "23505") return { error: "Bu izin türü zaten var." };
    throw error;
  }

  revalidatePath("/izinler");
  return { ok: "İzin türü kaydedildi." };
}

/** Herkes kendi izin talebini açabilir — ayrı izin gerekmez. */
export async function createLeaveRequestAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const session = await requirePermission("dashboard:read");

  const parsed = LeaveRequestSchema.safeParse(read(formData, ["leaveTypeId", "startsOn", "endsOn", "reason"]));
  if (!parsed.success) return { error: parsed.error.issues[0]!.message };
  const values = parsed.data;

  if (values.endsOn < values.startsOn) return { error: "Bitiş tarihi başlangıçtan önce olamaz." };
  const days = dayCount(values.startsOn, values.endsOn);

  await withTenant(session.tenantId, (tx) =>
    tx.insert(leaveRequests).values({
      ...values,
      dayCount: days,
      tenantId: session.tenantId,
      userId: session.userId,
    }),
  );
  revalidatePath("/izinler");
  return { ok: `${days} günlük izin talebi oluşturuldu.` };
}

export async function decideLeaveAction(formData: FormData): Promise<void> {
  const session = await requirePermission("users:update");
  const id = String(formData.get("id") ?? "");
  const status = String(formData.get("status") ?? "");
  const note = String(formData.get("note") ?? "").trim() || null;
  if (!id || !["onaylandi", "reddedildi"].includes(status)) return;

  await withTenant(session.tenantId, (tx) =>
    tx
      .update(leaveRequests)
      .set({
        status: status as "onaylandi",
        approverId: session.userId,
        approverNote: note,
        decidedAt: new Date(),
        updatedAt: new Date(),
      })
      .where(
        and(
          eq(leaveRequests.tenantId, session.tenantId),
          eq(leaveRequests.id, id),
          // Karar verilmiş talep yeniden karara açılmaz.
          eq(leaveRequests.status, "bekliyor"),
        ),
      ),
  );
  await writeAuditLog({
    tenantId: session.tenantId,
    userId: session.userId,
    event: "leave.decided",
    entityType: "leave_request",
    entityId: id,
    metadata: { status },
  });
  revalidatePath("/izinler");
}

/* ---------- Sürücü sicili ---------- */

export async function saveDriverRecordAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const session = await requireModule("suruculer:update", "filo");

  const parsed = DriverRecordSchema.safeParse(
    read(formData, ["driverId", "vehicleId", "incidentDate", "category", "severity", "description", "actionTaken"]),
  );
  if (!parsed.success) return { error: parsed.error.issues[0]!.message };
  const { id, ...values } = parsed.data;
  void id;

  await withTenant(session.tenantId, (tx) =>
    tx.insert(driverRecords).values({ ...values, tenantId: session.tenantId, createdBy: session.userId }),
  );
  revalidatePath("/filo/sicil");
  return { ok: "Sicil kaydı eklendi." };
}

export async function saveDriverEvaluationAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const session = await requireModule("suruculer:update", "filo");

  const parsed = DriverEvaluationSchema.safeParse(
    read(formData, [
      "driverId", "vehicleId", "companyId", "evaluationDate", "punctuality",
      "driving", "communication", "cleanliness", "routeCompliance", "appearance", "notes",
    ]),
  );
  if (!parsed.success) return { error: parsed.error.issues[0]!.message };

  await withTenant(session.tenantId, (tx) =>
    tx
      .insert(driverEvaluations)
      .values({ ...parsed.data, tenantId: session.tenantId, createdBy: session.userId }),
  );
  revalidatePath("/filo/degerlendirme");
  return { ok: "Değerlendirme kaydedildi." };
}

/* ---------- Portal kullanıcıları ---------- */

export async function savePortalUserAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const session = await requirePermission("portal:manage");

  const parsed = PortalUserSchema.safeParse({
    id: formData.get("id") || undefined,
    email: formData.get("email") ?? "",
    fullName: formData.get("fullName") ?? "",
    password: String(formData.get("password") ?? ""),
    companyIds: formData.getAll("companyIds").map(String).filter(Boolean),
    isActive: formData.get("isActive") === "on",
  });
  if (!parsed.success) return { error: parsed.error.issues[0]!.message };
  const { id, password, companyIds, ...values } = parsed.data;

  if (!id && !password) return { error: "Yeni kullanıcı için şifre gerekli." };
  for (const companyId of companyIds) {
    if (!isInScope(session.scope, companyId)) return { error: "Seçilen firma kapsamınızda değil." };
  }

  try {
    await withTenant(session.tenantId, async (tx) => {
      let userId = id;
      if (id) {
        await tx
          .update(portalUsers)
          .set({
            ...values,
            ...(password ? { passwordHash: await hashPassword(password) } : {}),
            updatedAt: new Date(),
          })
          .where(and(eq(portalUsers.tenantId, session.tenantId), eq(portalUsers.id, id)));
      } else {
        const [row] = await tx
          .insert(portalUsers)
          .values({
            ...values,
            passwordHash: await hashPassword(password!),
            tenantId: session.tenantId,
          })
          .returning({ id: portalUsers.id });
        userId = row!.id;
      }

      // Firma bağlarını tamamen yeniden kur — kaldırılanlar da gitsin.
      await tx
        .delete(portalUserCompanies)
        .where(
          and(
            eq(portalUserCompanies.tenantId, session.tenantId),
            eq(portalUserCompanies.portalUserId, userId!),
          ),
        );
      await tx.insert(portalUserCompanies).values(
        companyIds.map((companyId) => ({
          tenantId: session.tenantId,
          portalUserId: userId!,
          companyId,
        })),
      );
    });
  } catch (error) {
    if ((error as { code?: string }).code === "23505") {
      return { error: "Bu e-posta ile bir portal kullanıcısı zaten var." };
    }
    throw error;
  }

  revalidatePath("/admin/portal");
  return { ok: id ? "Portal kullanıcısı güncellendi." : "Portal kullanıcısı oluşturuldu." };
}

/* ---------- Rehber, kara liste, duyuru ---------- */

export async function saveContactAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const session = await requirePermission("notlar:create");

  const parsed = ContactSchema.safeParse({
    ...read(formData, ["name", "category", "title", "phone", "email", "companyId", "notes"]),
    id: formData.get("id") || undefined,
  });
  if (!parsed.success) return { error: parsed.error.issues[0]!.message };
  const { id, ...values } = parsed.data;

  await withTenant(session.tenantId, async (tx) => {
    if (id) {
      await tx
        .update(contacts)
        .set(values)
        .where(and(eq(contacts.tenantId, session.tenantId), eq(contacts.id, id)));
    } else {
      await tx.insert(contacts).values({ ...values, tenantId: session.tenantId });
    }
  });
  revalidatePath("/rehber");
  return { ok: id ? "Kayıt güncellendi." : "Rehbere eklendi." };
}

export async function deleteContactAction(formData: FormData): Promise<void> {
  const session = await requirePermission("notlar:delete");
  const id = String(formData.get("id") ?? "");
  if (!id) return;
  await withTenant(session.tenantId, (tx) =>
    tx.delete(contacts).where(and(eq(contacts.tenantId, session.tenantId), eq(contacts.id, id))),
  );
  revalidatePath("/rehber");
}

export async function saveBlacklistAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const session = await requirePermission("notlar:create");

  const parsed = BlacklistSchema.safeParse({
    ...read(formData, ["fullName", "idNumber", "plate", "reason", "addedOn"]),
    id: formData.get("id") || undefined,
    isActive: formData.get("isActive") === "on",
  });
  if (!parsed.success) return { error: parsed.error.issues[0]!.message };
  const { id, ...values } = parsed.data;

  await withTenant(session.tenantId, async (tx) => {
    if (id) {
      await tx
        .update(blacklist)
        .set(values)
        .where(and(eq(blacklist.tenantId, session.tenantId), eq(blacklist.id, id)));
    } else {
      await tx.insert(blacklist).values({ ...values, tenantId: session.tenantId, createdBy: session.userId });
    }
  });
  await writeAuditLog({
    tenantId: session.tenantId,
    userId: session.userId,
    event: id ? "blacklist.updated" : "blacklist.added",
    entityType: "blacklist",
    entityId: id,
  });
  revalidatePath("/rehber/kara-liste");
  return { ok: id ? "Kayıt güncellendi." : "Kara listeye eklendi." };
}

export async function saveAnnouncementAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const session = await requirePermission("notlar:create");

  const parsed = AnnouncementSchema.safeParse({
    ...read(formData, ["title", "body", "startsOn", "endsOn"]),
    id: formData.get("id") || undefined,
    showInPortal: formData.get("showInPortal") === "on",
    isActive: formData.get("isActive") === "on",
  });
  if (!parsed.success) return { error: parsed.error.issues[0]!.message };
  const { id, ...values } = parsed.data;

  await withTenant(session.tenantId, async (tx) => {
    if (id) {
      await tx
        .update(announcements)
        .set({ ...values, updatedAt: new Date() })
        .where(and(eq(announcements.tenantId, session.tenantId), eq(announcements.id, id)));
    } else {
      await tx
        .insert(announcements)
        .values({ ...values, tenantId: session.tenantId, createdBy: session.userId });
    }
  });
  revalidatePath("/duyurular");
  return { ok: id ? "Duyuru güncellendi." : "Duyuru yayımlandı." };
}

export async function deleteAnnouncementAction(formData: FormData): Promise<void> {
  const session = await requirePermission("notlar:delete");
  const id = String(formData.get("id") ?? "");
  if (!id) return;
  await withTenant(session.tenantId, (tx) =>
    tx
      .delete(announcements)
      .where(and(eq(announcements.tenantId, session.tenantId), eq(announcements.id, id))),
  );
  revalidatePath("/duyurular");
}
