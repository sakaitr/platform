import { z } from "zod";

export const InviteSchema = z.object({
  email: z.string().email("Geçerli bir e-posta adresi girin."),
  name: z.string().min(2, "İsim en az 2 karakter olmalı."),
  role: z.enum(["owner", "admin", "manager", "member", "viewer"]),
});

export const SetTermSchema = z.object({
  termKey: z.string().min(1, "Terim anahtarı gerekli."),
  value: z.string().min(1, "Değer boş olamaz."),
});

export const AssignRoleSchema = z.object({
  userId: z.string().uuid("Geçersiz kullanıcı."),
  roleId: z.string().uuid("Geçersiz rol."),
});
