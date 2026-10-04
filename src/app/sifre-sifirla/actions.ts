"use server";

import { z } from "zod";
import { consumePasswordReset, createPasswordReset } from "@/lib/auth";
import { enqueueEmail } from "@/lib/queue";

const RequestSchema = z.object({ email: z.string().email("Geçerli bir e-posta adresi girin.") });
const ResetSchema = z.object({
  token: z.string().min(1),
  password: z.string().min(8, "Şifre en az 8 karakter olmalı."),
});

export type ResetState = { error: string } | { ok: string } | null;

export async function requestResetAction(_prev: ResetState, formData: FormData): Promise<ResetState> {
  const parsed = RequestSchema.safeParse({ email: formData.get("email") });
  if (!parsed.success) return { error: parsed.error.issues[0]!.message };

  const token = await createPasswordReset(parsed.data.email);
  if (token) {
    await enqueueEmail({
      to: parsed.data.email,
      subject: "Şifre sıfırlama",
      body: `Şifrenizi sıfırlamak için: ${process.env.APP_URL}/sifre-sifirla?token=${token}`,
    });
  }
  // Hesap varlığını sızdırma — her durumda aynı mesaj
  return { ok: "Eğer bu e-posta kayıtlıysa sıfırlama bağlantısı gönderildi." };
}

export async function performResetAction(_prev: ResetState, formData: FormData): Promise<ResetState> {
  const parsed = ResetSchema.safeParse({
    token: formData.get("token"),
    password: formData.get("password"),
  });
  if (!parsed.success) return { error: parsed.error.issues[0]!.message };

  const success = await consumePasswordReset(parsed.data.token, parsed.data.password);
  return success
    ? { ok: "Şifreniz güncellendi. Giriş yapabilirsiniz." }
    : { error: "Bağlantı geçersiz veya süresi dolmuş." };
}
