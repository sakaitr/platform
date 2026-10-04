import { and, desc, eq, gte, lte } from "drizzle-orm";
import { auditLogs, roles, users } from "@/db/schema";
import { withTenant } from "@/db/tenant";
import { registerReport } from "@/lib/reports/engine";

/** Çekirdek raporlar — modül gerektirmez, her kiracıda çalışır. */
export function registerCoreReports(): void {
  registerReport({
    key: "kullanicilar",
    name: "Kullanıcı Listesi",
    category: "Yönetim",
    description: "Kiracıdaki kullanıcılar, rolleri ve durumları",
    permission: "raporlar:read",
    needsDateRange: false,
    run: async (ctx) => {
      const rows = await withTenant(ctx.tenantId, (tx) =>
        tx
          .select({
            name: users.name,
            email: users.email,
            role: roles.label,
            durum: users.isActive,
          })
          .from(users)
          .leftJoin(roles, eq(roles.id, users.roleId))
          .where(eq(users.tenantId, ctx.tenantId))
          .orderBy(users.name),
      );

      return {
        columns: [
          { key: "name", label: "İsim" },
          { key: "email", label: "E-posta" },
          { key: "role", label: "Rol" },
          { key: "durum", label: "Durum" },
        ],
        rows: rows.map((r) => ({
          name: r.name,
          email: r.email,
          role: r.role ?? "—",
          durum: r.durum ? "Aktif" : "Pasif",
        })),
        summary: { "Toplam kullanıcı": String(rows.length) },
      };
    },
  });

  registerReport({
    key: "denetim_izi",
    name: "Denetim İzi",
    category: "Yönetim",
    description: "Sistemde yapılan işlemlerin kaydı",
    permission: "audit:read",
    needsDateRange: true,
    run: async (ctx) => {
      const rows = await withTenant(ctx.tenantId, (tx) => {
        const conditions = [eq(auditLogs.tenantId, ctx.tenantId)];
        if (ctx.from) conditions.push(gte(auditLogs.createdAt, new Date(`${ctx.from}T00:00:00`)));
        if (ctx.to) conditions.push(lte(auditLogs.createdAt, new Date(`${ctx.to}T23:59:59`)));

        return tx
          .select({
            createdAt: auditLogs.createdAt,
            event: auditLogs.event,
            entityType: auditLogs.entityType,
            userName: users.name,
          })
          .from(auditLogs)
          .leftJoin(users, eq(users.id, auditLogs.userId))
          .where(and(...conditions))
          .orderBy(desc(auditLogs.createdAt))
          .limit(1000);
      });

      return {
        columns: [
          { key: "tarih", label: "Tarih" },
          { key: "event", label: "Olay" },
          { key: "entityType", label: "Varlık" },
          { key: "userName", label: "Kullanıcı" },
        ],
        rows: rows.map((r) => ({
          tarih: r.createdAt.toLocaleString("tr-TR"),
          event: r.event,
          entityType: r.entityType ?? "—",
          userName: r.userName ?? "sistem",
        })),
        summary: { "Kayıt sayısı": String(rows.length) },
      };
    },
  });
}
