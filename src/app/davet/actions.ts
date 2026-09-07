"use server";

import { z } from "zod";
import { acceptInvite } from "@/lib/auth";

const AcceptSchema = z.object({
  token: z.string().min(1),
  password: z.string().min(8, "Şifre en az 8 karakter olmalı."),
});

export type InviteState = { error: string } | { ok: string } | null;

export async function acceptInviteAction(_prev: InviteState, formData: FormData): Promise<InviteState> {
  const parsed = AcceptSchema.safeParse({
    token: formData.get("token"),
    password: formData.get("password"),
  });
  if (!parsed.success) return { error: parsed.error.issues[0]!.message };

  const success = await acceptInvite(parsed.data.token, parsed.data.password);
  return success
    ? { ok: "Hesabınız oluşturuldu. Giriş yapabilirsiniz." }
    : { error: "Davet geçersiz, kullanılmış veya süresi dolmuş." };
}
