"use server";

import { revalidatePath } from "next/cache";
import { and, eq } from "drizzle-orm";
import { passengers, paymentPlans, serviceChanges } from "@/db/schema";
import { withTenant } from "@/db/tenant";
import { requireModule } from "@/lib/auth";
import { writeAuditLog } from "@/lib/audit";
import { isInScope } from "@/lib/scope";
import {
  BulkPassengerSchema,
  PassengerSchema,
  PaymentPlanSchema,
  ServiceChangeSchema,
} from "../validators";

export type ActionState = { error: string } | { ok: string } | null;

export async function savePassengerAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const isUpdate = Boolean(formData.get("id"));
  const session = await requireModule(isUpdate ? "yolcular:update" : "yolcular:create", "operasyon");

  const parsed = PassengerSchema.safeParse({
    id: formData.get("id") || undefined,
    fullName: formData.get("fullName") ?? "",
    companyId: formData.get("companyId") ?? "",
    phone: formData.get("phone") ?? "",
    email: formData.get("email") ?? "",
    idNumber: formData.get("idNumber") ?? "",
    type: formData.get("type") ?? "yolcu",
    grade: formData.get("grade") ?? "",
    branch: formData.get("branch") ?? "",
    barcode: formData.get("barcode") ?? "",
    pickupAddress: formData.get("pickupAddress") ?? "",
    pickupLat: formData.get("pickupLat") ?? "",
    pickupLng: formData.get("pickupLng") ?? "",
    dropoffAddress: formData.get("dropoffAddress") ?? "",
    serviceStatus: formData.get("serviceStatus") ?? "aktif",
    contractStatus: formData.get("contractStatus") ?? "yok",
    direction: formData.get("direction") ?? "her_iki",
    paymentPlanId: formData.get("paymentPlanId") ?? "",
    routeId: formData.get("routeId") ?? "",
    isActive: formData.get("isActive") === "on",
    notes: formData.get("notes") ?? "",
  });
  if (!parsed.success) return { error: parsed.error.issues[0]!.message };
  const { id, ...values } = parsed.data;

  if (values.companyId && !isInScope(session.scope, values.companyId)) {
    return { error: "Seçilen firma kapsamınızda değil." };
  }

  try {
    await withTenant(session.tenantId, async (tx) => {
      if (isUpdate && id) {
        await tx
          .update(passengers)
          .set({ ...values, updatedAt: new Date() })
          .where(and(eq(passengers.tenantId, session.tenantId), eq(passengers.id, id)));
      } else {
        await tx.insert(passengers).values({ ...values, tenantId: session.tenantId, createdBy: session.userId });
      }
    });
  } catch (error) {
    if ((error as { code?: string }).code === "23505") {
      return { error: "Bu barkod numarası zaten kullanılıyor." };
    }
    throw error;
  }

  await writeAuditLog({
    tenantId: session.tenantId,
    userId: session.userId,
    event: isUpdate ? "passenger.updated" : "passenger.created",
    entityType: "passenger",
    entityId: id,
    metadata: { fullName: values.fullName },
  });
  revalidatePath("/operasyon/yolcular");
  return { ok: isUpdate ? "Kayıt güncellendi." : "Kayıt eklendi." };
}

export async function deletePassengerAction(formData: FormData): Promise<void> {
  const session = await requireModule("yolcular:delete", "operasyon");
  const id = String(formData.get("id") ?? "");
  if (!id) return;
  await withTenant(session.tenantId, (tx) =>
    tx.delete(passengers).where(and(eq(passengers.tenantId, session.tenantId), eq(passengers.id, id))),
  );
  await writeAuditLog({
    tenantId: session.tenantId,
    userId: session.userId,
    event: "passenger.deleted",
    entityType: "passenger",
    entityId: id,
  });
  revalidatePath("/operasyon/yolcular");
}

/**
 * Toplu yolcu ekleme. Her satır "Ad Soyad;Telefon;TC" — noktalı virgül
 * ya da sekme ile ayrılır. Ad zorunlu, kalanı boş bırakılabilir.
 * Adres ve güzergah hepsine ortak uygulanır.
 */
export async function bulkAddPassengersAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const session = await requireModule("yolcular:create", "operasyon");

  const parsed = BulkPassengerSchema.safeParse({
    companyId: formData.get("companyId") ?? "",
    routeId: formData.get("routeId") ?? "",
    type: formData.get("type") ?? "personel",
    pickupAddress: formData.get("pickupAddress") ?? "",
    dropoffAddress: formData.get("dropoffAddress") ?? "",
    rows: formData.get("rows") ?? "",
  });
  if (!parsed.success) return { error: parsed.error.issues[0]!.message };
  const input = parsed.data;

  if (input.companyId && !isInScope(session.scope, input.companyId)) {
    return { error: "Seçilen firma kapsamınızda değil." };
  }

  const values = input.rows.map((line) => {
    const [fullName, phone, idNumber] = line.split(/[;\t]/).map((part) => part.trim());
    return {
      tenantId: session.tenantId,
      companyId: input.companyId,
      routeId: input.routeId,
      type: input.type,
      fullName: fullName ?? "",
      phone: phone || null,
      idNumber: idNumber || null,
      pickupAddress: input.pickupAddress,
      dropoffAddress: input.dropoffAddress,
      createdBy: session.userId,
    };
  });

  const invalid = values.findIndex((v) => v.fullName.length < 2);
  if (invalid >= 0) return { error: `${invalid + 1}. satırda ad soyad eksik.` };

  await withTenant(session.tenantId, (tx) => tx.insert(passengers).values(values));

  await writeAuditLog({
    tenantId: session.tenantId,
    userId: session.userId,
    event: "passenger.bulk_created",
    entityType: "passenger",
    metadata: { count: values.length },
  });
  revalidatePath("/operasyon/yolcular");
  return { ok: `${values.length} kayıt eklendi.` };
}

/** Geçici güzergah ataması — dönem bitince yolcu eski hattına döner. */
export async function saveServiceChangeAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const session = await requireModule("yolcular:update", "operasyon");

  const parsed = ServiceChangeSchema.safeParse({
    passengerId: formData.get("passengerId") ?? "",
    temporaryRouteId: formData.get("temporaryRouteId") ?? "",
    startsOn: formData.get("startsOn") ?? "",
    endsOn: formData.get("endsOn") ?? "",
    direction: formData.get("direction") ?? "her_iki",
    notes: formData.get("notes") ?? "",
  });
  if (!parsed.success) return { error: parsed.error.issues[0]!.message };
  const input = parsed.data;

  if (input.endsOn && input.endsOn < input.startsOn) {
    return { error: "Bitiş tarihi başlangıçtan önce olamaz." };
  }

  await withTenant(session.tenantId, async (tx) => {
    const [current] = await tx
      .select({ routeId: passengers.routeId })
      .from(passengers)
      .where(and(eq(passengers.tenantId, session.tenantId), eq(passengers.id, input.passengerId)));

    await tx.insert(serviceChanges).values({
      tenantId: session.tenantId,
      passengerId: input.passengerId,
      originalRouteId: current?.routeId ?? null,
      temporaryRouteId: input.temporaryRouteId,
      startsOn: input.startsOn,
      endsOn: input.endsOn,
      direction: input.direction,
      notes: input.notes,
      createdBy: session.userId,
    });
  });

  revalidatePath("/operasyon/yolcular");
  return { ok: "Servis değişikliği kaydedildi." };
}

export async function deleteServiceChangeAction(formData: FormData): Promise<void> {
  const session = await requireModule("yolcular:update", "operasyon");
  const id = String(formData.get("id") ?? "");
  if (!id) return;
  await withTenant(session.tenantId, (tx) =>
    tx
      .delete(serviceChanges)
      .where(and(eq(serviceChanges.tenantId, session.tenantId), eq(serviceChanges.id, id))),
  );
  revalidatePath("/operasyon/yolcular");
}

export async function savePaymentPlanAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const session = await requireModule("yolcular:update", "operasyon");

  const parsed = PaymentPlanSchema.safeParse({
    id: formData.get("id") || undefined,
    name: formData.get("name") ?? "",
    totalAmount: formData.get("totalAmount") ?? "",
    installments: formData.get("installments") ?? "",
    notes: formData.get("notes") ?? "",
    isActive: formData.get("isActive") === "on",
  });
  if (!parsed.success) return { error: parsed.error.issues[0]!.message };
  const { id, ...values } = parsed.data;

  try {
    await withTenant(session.tenantId, async (tx) => {
      if (id) {
        await tx
          .update(paymentPlans)
          .set(values)
          .where(and(eq(paymentPlans.tenantId, session.tenantId), eq(paymentPlans.id, id)));
      } else {
        await tx.insert(paymentPlans).values({ ...values, tenantId: session.tenantId });
      }
    });
  } catch (error) {
    if ((error as { code?: string }).code === "23505") return { error: "Bu plan adı zaten var." };
    throw error;
  }

  revalidatePath("/operasyon/yolcular/odeme-planlari");
  return { ok: id ? "Plan güncellendi." : "Plan eklendi." };
}
