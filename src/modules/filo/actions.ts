"use server";

import { revalidatePath } from "next/cache";
import { and, eq } from "drizzle-orm";
import { driverDocuments, drivers, fuelCards, vehicleCompanies, vehicles } from "@/db/schema";
import { withTenant } from "@/db/tenant";
import { requireModule } from "@/lib/auth";
import { writeAuditLog } from "@/lib/audit";
import { isInScope } from "@/lib/scope";
import { DriverSchema, FuelCardSchema, VehicleSchema } from "./validators";

export type ActionState = { error: string } | { ok: string } | null;

/** Postgres tekil dizin ihlali — plaka çakışması. */
function isUniqueViolation(error: unknown): boolean {
  return typeof error === "object" && error !== null && (error as { code?: string }).code === "23505";
}

export async function saveVehicleAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const isUpdate = Boolean(formData.get("id"));
  const session = await requireModule(isUpdate ? "araclar:update" : "araclar:create", "filo");

  const parsed = VehicleSchema.safeParse({
    id: formData.get("id") || undefined,
    plate: formData.get("plate") ?? "",
    companyId: formData.get("companyId") ?? "",
    brand: formData.get("brand") ?? "",
    model: formData.get("model") ?? "",
    modelYear: formData.get("modelYear") ?? "",
    capacity: formData.get("capacity") ?? "",
    vehicleType: formData.get("vehicleType") ?? "",
    titleHolder: formData.get("titleHolder") ?? "",
    status: formData.get("status") ?? "aktif",
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
          .update(vehicles)
          .set({ ...values, updatedAt: new Date() })
          .where(and(eq(vehicles.tenantId, session.tenantId), eq(vehicles.id, id)));
      } else {
        await tx.insert(vehicles).values({ ...values, tenantId: session.tenantId });
      }
    });
  } catch (error) {
    if (isUniqueViolation(error)) return { error: `${values.plate} plakası zaten kayıtlı.` };
    throw error;
  }

  await writeAuditLog({
    tenantId: session.tenantId,
    userId: session.userId,
    event: isUpdate ? "vehicle.updated" : "vehicle.created",
    entityType: "vehicle",
    entityId: id,
    metadata: { plate: values.plate },
  });
  revalidatePath("/filo/araclar");
  return { ok: isUpdate ? "Araç güncellendi." : "Araç eklendi." };
}

export async function deleteVehicleAction(formData: FormData): Promise<void> {
  const session = await requireModule("araclar:delete", "filo");
  const id = String(formData.get("id") ?? "");
  if (!id) return;
  await withTenant(session.tenantId, (tx) =>
    tx.delete(vehicles).where(and(eq(vehicles.tenantId, session.tenantId), eq(vehicles.id, id))),
  );
  await writeAuditLog({
    tenantId: session.tenantId,
    userId: session.userId,
    event: "vehicle.deleted",
    entityType: "vehicle",
    entityId: id,
  });
  revalidatePath("/filo/araclar");
}

export async function saveDriverAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const isUpdate = Boolean(formData.get("id"));
  const session = await requireModule(isUpdate ? "suruculer:update" : "suruculer:create", "filo");

  const parsed = DriverSchema.safeParse({
    id: formData.get("id") || undefined,
    fullName: formData.get("fullName") ?? "",
    companyId: formData.get("companyId") ?? "",
    phone: formData.get("phone") ?? "",
    idNumber: formData.get("idNumber") ?? "",
    licenseClass: formData.get("licenseClass") ?? "",
    licenseExpiry: formData.get("licenseExpiry") ?? "",
    status: formData.get("status") ?? "aktif",
    notes: formData.get("notes") ?? "",
  });
  if (!parsed.success) return { error: parsed.error.issues[0]!.message };
  const { id, ...values } = parsed.data;

  if (values.companyId && !isInScope(session.scope, values.companyId)) {
    return { error: "Seçilen firma kapsamınızda değil." };
  }

  await withTenant(session.tenantId, async (tx) => {
    if (isUpdate && id) {
      await tx
        .update(drivers)
        .set({ ...values, updatedAt: new Date() })
        .where(and(eq(drivers.tenantId, session.tenantId), eq(drivers.id, id)));
    } else {
      await tx.insert(drivers).values({ ...values, tenantId: session.tenantId });
    }
  });

  await writeAuditLog({
    tenantId: session.tenantId,
    userId: session.userId,
    event: isUpdate ? "driver.updated" : "driver.created",
    entityType: "driver",
    entityId: id,
    metadata: { fullName: values.fullName },
  });
  revalidatePath("/filo/suruculer");
  return { ok: isUpdate ? "Sürücü güncellendi." : "Sürücü eklendi." };
}

export async function deleteDriverAction(formData: FormData): Promise<void> {
  const session = await requireModule("suruculer:delete", "filo");
  const id = String(formData.get("id") ?? "");
  if (!id) return;
  await withTenant(session.tenantId, (tx) =>
    tx.delete(drivers).where(and(eq(drivers.tenantId, session.tenantId), eq(drivers.id, id))),
  );
  await writeAuditLog({
    tenantId: session.tenantId,
    userId: session.userId,
    event: "driver.deleted",
    entityType: "driver",
    entityId: id,
  });
  revalidatePath("/filo/suruculer");
}

export async function saveFuelCardAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const isUpdate = Boolean(formData.get("id"));
  const session = await requireModule(
    isUpdate ? "yakit_kartlari:update" : "yakit_kartlari:create",
    "filo",
  );

  const parsed = FuelCardSchema.safeParse({
    id: formData.get("id") || undefined,
    cardNo: formData.get("cardNo") ?? "",
    provider: formData.get("provider") ?? "",
    vehicleId: formData.get("vehicleId") ?? "",
    companyId: formData.get("companyId") ?? "",
    limitKind: formData.get("limitKind") ?? "sinirsiz",
    limitValue: formData.get("limitValue") ?? "",
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
          .update(fuelCards)
          .set({ ...values, updatedAt: new Date() })
          .where(and(eq(fuelCards.tenantId, session.tenantId), eq(fuelCards.id, id)));
      } else {
        await tx.insert(fuelCards).values({ ...values, tenantId: session.tenantId });
      }
    });
  } catch (error) {
    if (isUniqueViolation(error)) return { error: "Bu kart numarası zaten kayıtlı." };
    throw error;
  }

  revalidatePath("/filo/yakit-kartlari");
  return { ok: isUpdate ? "Kart güncellendi." : "Kart eklendi." };
}

export async function deleteFuelCardAction(formData: FormData): Promise<void> {
  const session = await requireModule("yakit_kartlari:delete", "filo");
  const id = String(formData.get("id") ?? "");
  if (!id) return;
  await withTenant(session.tenantId, (tx) =>
    tx.delete(fuelCards).where(and(eq(fuelCards.tenantId, session.tenantId), eq(fuelCards.id, id))),
  );
  revalidatePath("/filo/yakit-kartlari");
}

/** Araca ek firma atar — bir araç birden çok firmaya hizmet edebilir. */
export async function addVehicleCompanyAction(formData: FormData): Promise<void> {
  const session = await requireModule("araclar:update", "filo");
  const vehicleId = String(formData.get("vehicleId") ?? "");
  const companyId = String(formData.get("companyId") ?? "");
  if (!vehicleId || !companyId) return;
  if (!isInScope(session.scope, companyId)) return;

  await withTenant(session.tenantId, (tx) =>
    tx
      .insert(vehicleCompanies)
      .values({ tenantId: session.tenantId, vehicleId, companyId })
      .onConflictDoNothing(),
  );
  revalidatePath(`/filo/araclar/${vehicleId}`);
}

export async function removeVehicleCompanyAction(formData: FormData): Promise<void> {
  const session = await requireModule("araclar:update", "filo");
  const id = String(formData.get("id") ?? "");
  const vehicleId = String(formData.get("vehicleId") ?? "");
  if (!id) return;
  await withTenant(session.tenantId, (tx) =>
    tx
      .delete(vehicleCompanies)
      .where(and(eq(vehicleCompanies.tenantId, session.tenantId), eq(vehicleCompanies.id, id))),
  );
  revalidatePath(`/filo/araclar/${vehicleId}`);
}

/** Sürücü belgesi ekler — ehliyet, SRC, psikoteknik. */
export async function saveDriverDocumentAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const session = await requireModule("suruculer:update", "filo");

  const driverId = String(formData.get("driverId") ?? "");
  const docType = String(formData.get("docType") ?? "").trim();
  if (!driverId || docType.length === 0) return { error: "Belge tipi gerekli." };

  const day = (value: FormDataEntryValue | null): string | null => {
    const raw = String(value ?? "").trim();
    return /^\d{4}-\d{2}-\d{2}$/.test(raw) ? raw : null;
  };

  await withTenant(session.tenantId, (tx) =>
    tx.insert(driverDocuments).values({
      tenantId: session.tenantId,
      driverId,
      docType,
      label: String(formData.get("label") ?? "").trim() || null,
      issuedOn: day(formData.get("issuedOn")),
      expiresOn: day(formData.get("expiresOn")),
      notes: String(formData.get("notes") ?? "").trim() || null,
    }),
  );
  revalidatePath(`/filo/suruculer/${driverId}`);
  return { ok: "Belge eklendi." };
}

export async function deleteDriverDocumentAction(formData: FormData): Promise<void> {
  const session = await requireModule("suruculer:update", "filo");
  const id = String(formData.get("id") ?? "");
  const driverId = String(formData.get("driverId") ?? "");
  if (!id) return;
  await withTenant(session.tenantId, (tx) =>
    tx
      .delete(driverDocuments)
      .where(and(eq(driverDocuments.tenantId, session.tenantId), eq(driverDocuments.id, id))),
  );
  revalidatePath(`/filo/suruculer/${driverId}`);
}
