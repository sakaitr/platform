"use server";

import { revalidatePath } from "next/cache";
import { and, eq } from "drizzle-orm";
import { transferPassengers, transfers } from "@/db/schema";
import { withTenant } from "@/db/tenant";
import { requireModule } from "@/lib/auth";
import { writeAuditLog } from "@/lib/audit";
import { isInScope } from "@/lib/scope";
import { TransferSchema } from "../validators";
import { canTransition, isTransferStatus, type TransferStatus } from "./state";

export type ActionState = { error: string } | { ok: string } | null;

const KEYS = [
  "title", "companyId", "vehicleId", "driverId", "pickupLocation", "dropoffLocation",
  "transferDate", "transferTime", "passengerCount", "price", "notes",
] as const;

export async function saveTransferAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const isUpdate = Boolean(formData.get("id"));
  const session = await requireModule(isUpdate ? "transferler:update" : "transferler:create", "operasyon");

  const parsed = TransferSchema.safeParse({
    ...Object.fromEntries(KEYS.map((k) => [k, String(formData.get(k) ?? "")])),
    id: formData.get("id") || undefined,
  });
  if (!parsed.success) return { error: parsed.error.issues[0]!.message };
  const { id, ...values } = parsed.data;

  if (values.companyId && !isInScope(session.scope, values.companyId)) {
    return { error: "Seçilen firma kapsamınızda değil." };
  }

  await withTenant(session.tenantId, async (tx) => {
    if (isUpdate && id) {
      await tx
        .update(transfers)
        .set({ ...values, updatedAt: new Date() })
        .where(and(eq(transfers.tenantId, session.tenantId), eq(transfers.id, id)));
    } else {
      await tx.insert(transfers).values({ ...values, tenantId: session.tenantId, createdBy: session.userId });
    }
  });

  revalidatePath("/operasyon/transferler");
  return { ok: isUpdate ? "Transfer güncellendi." : "Transfer oluşturuldu." };
}

export async function setTransferStatusAction(formData: FormData): Promise<void> {
  const session = await requireModule("transferler:update", "operasyon");
  const id = String(formData.get("id") ?? "");
  const to = String(formData.get("status") ?? "") as TransferStatus;
  const reason = String(formData.get("reason") ?? "").trim() || null;
  if (!id || !isTransferStatus(to)) return;

  await withTenant(session.tenantId, async (tx) => {
    const current = await tx
      .select({ status: transfers.status })
      .from(transfers)
      .where(and(eq(transfers.tenantId, session.tenantId), eq(transfers.id, id)));
    const from = current[0]?.status;
    if (!from || !canTransition(from, to)) return;

    const now = new Date();
    await tx
      .update(transfers)
      .set({
        status: to,
        startedAt: to === "yolda" ? now : undefined,
        completedAt: to === "tamamlandi" ? now : undefined,
        cancelledAt: to === "iptal" ? now : undefined,
        cancellationReason: to === "iptal" ? reason : undefined,
        updatedAt: now,
      })
      .where(eq(transfers.id, id));
  });

  await writeAuditLog({
    tenantId: session.tenantId,
    userId: session.userId,
    event: "transfer.status_changed",
    entityType: "transfer",
    entityId: id,
    metadata: { to },
  });
  revalidatePath("/operasyon/transferler");
}

export async function addTransferPassengerAction(formData: FormData): Promise<void> {
  const session = await requireModule("transferler:update", "operasyon");
  const transferId = String(formData.get("transferId") ?? "");
  const name = String(formData.get("name") ?? "").trim();
  if (!transferId || name.length < 2) return;

  await withTenant(session.tenantId, (tx) =>
    tx.insert(transferPassengers).values({
      tenantId: session.tenantId,
      transferId,
      name,
      phone: String(formData.get("phone") ?? "").trim() || null,
    }),
  );
  revalidatePath(`/operasyon/transferler/${transferId}`);
}

export async function removeTransferPassengerAction(formData: FormData): Promise<void> {
  const session = await requireModule("transferler:update", "operasyon");
  const id = String(formData.get("id") ?? "");
  const transferId = String(formData.get("transferId") ?? "");
  if (!id) return;
  await withTenant(session.tenantId, (tx) =>
    tx
      .delete(transferPassengers)
      .where(and(eq(transferPassengers.tenantId, session.tenantId), eq(transferPassengers.id, id))),
  );
  revalidatePath(`/operasyon/transferler/${transferId}`);
}

export async function deleteTransferAction(formData: FormData): Promise<void> {
  const session = await requireModule("transferler:delete", "operasyon");
  const id = String(formData.get("id") ?? "");
  if (!id) return;
  await withTenant(session.tenantId, (tx) =>
    tx.delete(transfers).where(and(eq(transfers.tenantId, session.tenantId), eq(transfers.id, id))),
  );
  revalidatePath("/operasyon/transferler");
}
