"use server";

import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { dbAdmin } from "@/db/admin";
import { portalUsers, ticketMessages, tickets } from "@/db/schema";
import { withTenant } from "@/db/tenant";
import { verifyPassword } from "@/lib/auth";
import { nextNumber } from "@/lib/numbering";
import { getCurrentPortalSession } from "@/lib/portal/guards";
import {
  createPortalSession,
  PORTAL_COOKIE_NAME,
  revokePortalSession,
} from "@/lib/portal/session";

export type PortalState = { error: string } | { ok: string } | null;

const LoginSchema = z.object({
  email: z.string().trim().email("Geçerli e-posta girin."),
  password: z.string().min(1, "Şifre girin."),
});

export async function portalLoginAction(_prev: PortalState, formData: FormData): Promise<PortalState> {
  const parsed = LoginSchema.safeParse({
    email: formData.get("email") ?? "",
    password: formData.get("password") ?? "",
  });
  if (!parsed.success) return { error: parsed.error.issues[0]!.message };

  const rows = await dbAdmin
    .select()
    .from(portalUsers)
    .where(eq(portalUsers.email, parsed.data.email.toLowerCase()))
    .limit(1);

  const user = rows[0];
  // Kullanıcı yok ve şifre yanlış aynı mesajı döner — hesap varlığı sızmasın.
  const valid = user ? await verifyPassword(parsed.data.password, user.passwordHash) : false;
  if (!user || !valid || !user.isActive) {
    return { error: "E-posta veya şifre hatalı." };
  }

  const token = await createPortalSession(user.id, user.tenantId);
  const store = await cookies();
  store.set(PORTAL_COOKIE_NAME, token, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/portal",
    maxAge: 14 * 86_400,
  });
  redirect("/portal");
}

export async function portalLogoutAction(): Promise<void> {
  const store = await cookies();
  const token = store.get(PORTAL_COOKIE_NAME)?.value;
  if (token) await revokePortalSession(token);
  store.delete(PORTAL_COOKIE_NAME);
  redirect("/portal/giris");
}

const TicketSchema = z.object({
  companyId: z.string().uuid("Firma seçin."),
  title: z.string().trim().min(3, "Konu en az 3 karakter olmalı.").max(255),
  description: z.string().trim().min(5, "Açıklama en az 5 karakter olmalı.").max(4000),
  priority: z.enum(["dusuk", "normal", "yuksek", "kritik"]).catch("normal"),
});

export async function portalCreateTicketAction(_prev: PortalState, formData: FormData): Promise<PortalState> {
  const session = await getCurrentPortalSession();
  if (!session) return { error: "Oturumunuz sona ermiş." };

  const parsed = TicketSchema.safeParse({
    companyId: formData.get("companyId") ?? "",
    title: formData.get("title") ?? "",
    description: formData.get("description") ?? "",
    priority: formData.get("priority") ?? "normal",
  });
  if (!parsed.success) return { error: parsed.error.issues[0]!.message };

  // Müşteri yalnız kendi firması adına talep açabilir.
  if (!session.companyIds.includes(parsed.data.companyId)) {
    return { error: "Bu firma için talep açamazsınız." };
  }

  const ticketNo = await withTenant(session.tenantId, async (tx) => {
    const no = await nextNumber(tx, session.tenantId, "talep");
    await tx.insert(tickets).values({
      ...parsed.data,
      ticketNo: no,
      source: "portal",
      tenantId: session.tenantId,
      portalUserId: session.portalUserId,
    });
    return no;
  });

  revalidatePath("/portal/talepler");
  return { ok: `${ticketNo} açıldı. Ekibimiz en kısa sürede dönecek.` };
}

const MessageSchema = z.object({
  ticketId: z.string().uuid(),
  body: z.string().trim().min(1, "Mesaj boş olamaz.").max(4000),
});

export async function portalReplyAction(_prev: PortalState, formData: FormData): Promise<PortalState> {
  const session = await getCurrentPortalSession();
  if (!session) return { error: "Oturumunuz sona ermiş." };

  const parsed = MessageSchema.safeParse({
    ticketId: formData.get("ticketId") ?? "",
    body: formData.get("body") ?? "",
  });
  if (!parsed.success) return { error: parsed.error.issues[0]!.message };

  const allowed = await withTenant(session.tenantId, (tx) =>
    tx
      .select({ id: tickets.id })
      .from(tickets)
      .where(and(eq(tickets.tenantId, session.tenantId), eq(tickets.id, parsed.data.ticketId))),
  );
  if (allowed.length === 0) return { error: "Talep bulunamadı." };

  await withTenant(session.tenantId, (tx) =>
    tx.insert(ticketMessages).values({
      tenantId: session.tenantId,
      ticketId: parsed.data.ticketId,
      body: parsed.data.body,
      fromCustomer: true,
      portalUserId: session.portalUserId,
    }),
  );
  revalidatePath(`/portal/talepler/${parsed.data.ticketId}`);
  return { ok: "Mesajınız iletildi." };
}
