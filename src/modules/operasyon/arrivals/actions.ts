"use server";

import { revalidatePath } from "next/cache";
import { and, eq } from "drizzle-orm";
import { companyShifts, vehicleArrivals, vehicles } from "@/db/schema";
import { withTenant } from "@/db/tenant";
import { requireModule } from "@/lib/auth";
import { writeAuditLog } from "@/lib/audit";
import { istanbulTime } from "@/lib/time";
import { isInScope } from "@/lib/scope";
import { ArrivalSchema } from "../validators";

export type ActionState = { error: string } | { ok: string } | null;

export async function saveArrivalAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const isUpdate = Boolean(formData.get("id"));
  const session = await requireModule(isUpdate ? "arrivals:update" : "arrivals:create", "operasyon");

  const parsed = ArrivalSchema.safeParse({
    id: formData.get("id") || undefined,
    vehicleId: formData.get("vehicleId") ?? "",
    companyId: formData.get("companyId") ?? "",
    driverId: formData.get("driverId") ?? "",
    arrivalDate: formData.get("arrivalDate") ?? "",
    shift: formData.get("shift") ?? "",
    arrivedAt: formData.get("arrivedAt") ?? "",
    plannedAt: formData.get("plannedAt") ?? "",
    note: formData.get("note") ?? "",
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
          .update(vehicleArrivals)
          .set(values)
          .where(and(eq(vehicleArrivals.tenantId, session.tenantId), eq(vehicleArrivals.id, id)));
      } else {
        await tx
          .insert(vehicleArrivals)
          .values({ ...values, tenantId: session.tenantId, recordedBy: session.userId });
      }
    });
  } catch (error) {
    if ((error as { code?: string }).code === "23505") {
      return { error: "Bu araç için aynı gün ve vardiyada zaten kayıt var." };
    }
    throw error;
  }

  await writeAuditLog({
    tenantId: session.tenantId,
    userId: session.userId,
    event: isUpdate ? "arrival.updated" : "arrival.created",
    entityType: "vehicle_arrival",
    entityId: id,
    metadata: { date: values.arrivalDate, shift: values.shift },
  });
  revalidatePath("/operasyon/giris-kontrol");
  return { ok: "Geliş kaydedildi." };
}

export async function deleteArrivalAction(formData: FormData): Promise<void> {
  const session = await requireModule("arrivals:delete", "operasyon");
  const id = String(formData.get("id") ?? "");
  if (!id) return;
  await withTenant(session.tenantId, (tx) =>
    tx
      .delete(vehicleArrivals)
      .where(and(eq(vehicleArrivals.tenantId, session.tenantId), eq(vehicleArrivals.id, id))),
  );
  await writeAuditLog({
    tenantId: session.tenantId,
    userId: session.userId,
    event: "arrival.deleted",
    entityType: "vehicle_arrival",
    entityId: id,
  });
  revalidatePath("/operasyon/giris-kontrol");
}

/* ---------- Giriş kontrol tahtası ---------- */

/**
 * Aracı gelmiş olarak işaretler. Kapıdaki görevlinin ana eylemi:
 * saat verilmezse şu an alınır, planlanan saat vardiyadan gelir.
 * Aynı araç/gün/vardiya için ikinci kayıt açılmaz — varsa saati güncellenir.
 */
export async function markArrivalAction(formData: FormData): Promise<void> {
  const session = await requireModule("arrivals:create", "operasyon");

  const vehicleId = String(formData.get("vehicleId") ?? "");
  const companyId = String(formData.get("companyId") ?? "");
  const date = String(formData.get("date") ?? "");
  const shift = String(formData.get("shift") ?? "");
  const arrivedAt = String(formData.get("arrivedAt") ?? "") || istanbulTime();
  if (!vehicleId || !companyId || !date || !shift) return;
  if (!isInScope(session.scope, companyId)) return;

  const planned = await withTenant(session.tenantId, async (tx) => {
    const rows = await tx
      .select({ expectedAt: companyShifts.expectedAt })
      .from(companyShifts)
      .where(
        and(
          eq(companyShifts.tenantId, session.tenantId),
          eq(companyShifts.companyId, companyId),
          eq(companyShifts.name, shift),
        ),
      );
    return rows[0]?.expectedAt ?? null;
  });

  await withTenant(session.tenantId, (tx) =>
    tx
      .insert(vehicleArrivals)
      .values({
        tenantId: session.tenantId,
        companyId,
        vehicleId,
        arrivalDate: date,
        shift,
        arrivedAt,
        plannedAt: planned,
        recordedBy: session.userId,
      })
      .onConflictDoUpdate({
        target: [vehicleArrivals.vehicleId, vehicleArrivals.arrivalDate, vehicleArrivals.shift],
        set: { arrivedAt, recordedBy: session.userId },
      }),
  );
  revalidatePath("/operasyon/giris-kontrol");
}

/** İşareti geri alır — yanlış araca basıldığında. */
export async function unmarkArrivalAction(formData: FormData): Promise<void> {
  const session = await requireModule("arrivals:delete", "operasyon");
  const id = String(formData.get("arrivalId") ?? "");
  if (!id) return;
  await withTenant(session.tenantId, (tx) =>
    tx
      .delete(vehicleArrivals)
      .where(and(eq(vehicleArrivals.tenantId, session.tenantId), eq(vehicleArrivals.id, id))),
  );
  revalidatePath("/operasyon/giris-kontrol");
}

/** Tümü geldi — henüz işaretlenmemiş araçları tek seferde işaretler. */
export async function markAllArrivalsAction(formData: FormData): Promise<void> {
  const session = await requireModule("arrivals:bulk", "operasyon");

  const companyId = String(formData.get("companyId") ?? "");
  const date = String(formData.get("date") ?? "");
  const shift = String(formData.get("shift") ?? "");
  const ids = formData.getAll("vehicleIds").map(String).filter(Boolean);
  if (!companyId || !date || !shift || ids.length === 0) return;
  if (!isInScope(session.scope, companyId)) return;

  const now = istanbulTime();
  const planned = await withTenant(session.tenantId, async (tx) => {
    const rows = await tx
      .select({ expectedAt: companyShifts.expectedAt })
      .from(companyShifts)
      .where(
        and(
          eq(companyShifts.tenantId, session.tenantId),
          eq(companyShifts.companyId, companyId),
          eq(companyShifts.name, shift),
        ),
      );
    return rows[0]?.expectedAt ?? null;
  });

  await withTenant(session.tenantId, (tx) =>
    tx
      .insert(vehicleArrivals)
      .values(
        ids.map((vehicleId) => ({
          tenantId: session.tenantId,
          companyId,
          vehicleId,
          arrivalDate: date,
          shift,
          arrivedAt: now,
          plannedAt: planned,
          recordedBy: session.userId,
        })),
      )
      // Zaten işaretli araçların saatini bozmamak için dokunmuyoruz.
      .onConflictDoNothing(),
  );

  await writeAuditLog({
    tenantId: session.tenantId,
    userId: session.userId,
    event: "arrival.bulk_marked",
    entityType: "vehicle_arrival",
    metadata: { date, shift, count: ids.length },
  });
  revalidatePath("/operasyon/giris-kontrol");
}

/** Yolcu sayısı ve notu günceller. */
export async function updateArrivalDetailAction(formData: FormData): Promise<void> {
  const session = await requireModule("arrivals:update", "operasyon");
  const id = String(formData.get("arrivalId") ?? "");
  if (!id) return;

  const toInt = (value: FormDataEntryValue | null): number | null => {
    const raw = String(value ?? "").trim();
    if (raw.length === 0) return null;
    const parsed = Number(raw);
    return Number.isInteger(parsed) && parsed >= 0 ? parsed : null;
  };

  await withTenant(session.tenantId, (tx) =>
    tx
      .update(vehicleArrivals)
      .set({
        expectedPassengers: toInt(formData.get("expectedPassengers")),
        actualPassengers: toInt(formData.get("actualPassengers")),
        note: String(formData.get("note") ?? "").trim() || null,
        arrivedAt: String(formData.get("arrivedAt") ?? "").trim() || undefined,
      })
      .where(and(eq(vehicleArrivals.tenantId, session.tenantId), eq(vehicleArrivals.id, id))),
  );
  revalidatePath("/operasyon/giris-kontrol");
}

/** Tahtadaki araç sırasını kaydeder. */
export async function saveVehicleOrderAction(formData: FormData): Promise<void> {
  const session = await requireModule("araclar:update", "filo");
  const ids = formData.getAll("vehicleIds").map(String).filter(Boolean);
  if (ids.length === 0) return;

  await withTenant(session.tenantId, async (tx) => {
    for (const [index, id] of ids.entries()) {
      await tx
        .update(vehicles)
        .set({ sortOrder: index })
        .where(and(eq(vehicles.tenantId, session.tenantId), eq(vehicles.id, id)));
    }
  });
  revalidatePath("/operasyon/giris-kontrol");
}
