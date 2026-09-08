"use server";

import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { dbAdmin } from "@/db/admin";
import { users } from "@/db/schema";
import { AUTH_COOKIE_NAME, createSession, SESSION_DURATION_DAYS, verifyPassword } from "@/lib/auth";

const LoginSchema = z.object({
  email: z.string().email("Geçerli bir e-posta adresi girin."),
  password: z.string().min(1, "Şifre boş olamaz."),
});

export type LoginState = { error: string } | null;

export async function loginAction(_prev: LoginState, formData: FormData): Promise<LoginState> {
  const parsed = LoginSchema.safeParse({
    email: formData.get("email"),
    password: formData.get("password"),
  });
  if (!parsed.success) return { error: parsed.error.issues[0]!.message };

  const [user] = await dbAdmin.select().from(users).where(eq(users.email, parsed.data.email)).limit(1);
  if (!user || !user.isActive || !(await verifyPassword(parsed.data.password, user.passwordHash))) {
    return { error: "E-posta veya şifre hatalı." };
  }

  const token = await createSession(user.id, user.tenantId);
  const store = await cookies();
  store.set(AUTH_COOKIE_NAME, token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: SESSION_DURATION_DAYS * 86_400,
  });

  await dbAdmin.update(users).set({ lastLoginAt: new Date() }).where(eq(users.id, user.id));
  redirect("/dashboard");
}
