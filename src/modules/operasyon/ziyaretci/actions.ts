"use server";

import { revalidatePath } from "next/cache";
import { and, eq, isNull } from "drizzle-orm";
import { visitorLogs } from "@/db/schema";
import { withTenant } from "@/db/tenant";
import { requireModule } from "@/lib/auth";
import { writeAuditLog } from "@/lib/audit";
import { VisitorSchema } from "../validators";

export type ActionState = { error: string } | { ok: string } | null;

export async function saveVisitorAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const session = await requireModule("ziyaretci:create", "operasyon");

  const parsed = VisitorSchema.safeParse({
    visitorName: formData.get("visitorName") ?? "",
    reason: formData.get("reason") ?? "",
    hostName: formData.get("hostName") ?? "",
    companyId: formData.get("companyId") ?? "",
    plate: formData.get("plate") ?? "",
  });
  if (!parsed.success) return { error: parsed.error.issues[0]!.message };

  await withTenant(session.tenantId, (tx) =>
    tx.insert(visitorLogs).values({
      ...parsed.data,
      tenantId: session.tenantId,
      recordedBy: session.userId,
    }),
  );
  await writeAuditLog({
    tenantId: session.tenantId,
    userId: session.userId,
    event: "visitor.entered",
    entityType: "visitor_log",
    metadata: { visitorName: parsed.data.visitorName },
  });
  revalidatePath("/operasyon/ziyaretciler");
  return { ok: "Ziyaretçi girişi kaydedildi." };
}

/** Çıkış saatini yalnız bir kez yazar — ikinci tık kaydı değiştirmez. */
export async function checkoutVisitorAction(formData: FormData): Promise<void> {
  const session = await requireModule("ziyaretci:update", "operasyon");
  const id = String(formData.get("id") ?? "");
  if (!id) return;

  await withTenant(session.tenantId, (tx) =>
    tx
      .update(visitorLogs)
      .set({ exitedAt: new Date() })
      .where(
        and(
          eq(visitorLogs.tenantId, session.tenantId),
          eq(visitorLogs.id, id),
          isNull(visitorLogs.exitedAt),
        ),
      ),
  );
  await writeAuditLog({
    tenantId: session.tenantId,
    userId: session.userId,
    event: "visitor.exited",
    entityType: "visitor_log",
    entityId: id,
  });
  revalidatePath("/operasyon/ziyaretciler");
}
