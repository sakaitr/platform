import { Badge, EmptyRow, PageHeader, Table, Td } from "@/components/ui";
import { pageContext } from "@/lib/page-context";
import { formatDateTime } from "@/lib/time";
import { companyOptions } from "@/modules/crm/queries";
import { listPortalUsers } from "@/modules/isbirligi/queries";
import { PortalUserForm } from "./portal-user-form";

export default async function PortalKullanicilariPage() {
  const { session, t } = await pageContext("portal:manage", "admin");

  const [rows, firmalar] = await Promise.all([
    listPortalUsers(session.tenantId),
    companyOptions(session.tenantId, session.scope),
  ]);

  return (
    <div className="space-y-4">
      <PageHeader
        title="Portal Kullanıcıları"
        description="Müşterilerin kendi verilerini görebildiği dış erişim hesapları"
        action={<PortalUserForm companies={firmalar} />}
      />

      <Table head={["Ad Soyad", "E-posta", t("customer_plural"), "Son Giriş", "Durum"]}>
        {rows.length === 0 ? (
          <EmptyRow colSpan={5} text="Portal kullanıcısı yok." />
        ) : (
          rows.map((u) => (
            <tr key={u.id} className="hover:bg-neutral-50">
              <Td className="font-medium">{u.fullName}</Td>
              <Td className="text-neutral-500">{u.email}</Td>
              <Td className="text-neutral-500">{u.companies.join(", ") || "—"}</Td>
              <Td className="text-neutral-500">
                {u.lastLoginAt ? formatDateTime(u.lastLoginAt) : "hiç girmemiş"}
              </Td>
              <Td>
                <Badge tone={u.isActive ? "ok" : "mute"}>{u.isActive ? "Aktif" : "Pasif"}</Badge>
              </Td>
            </tr>
          ))
        )}
      </Table>

      <p className="text-xs text-neutral-500">
        Portal kullanıcıları personel hesaplarından ayrıdır; yalnız kendilerine bağlı firmaların
        verisini görürler.
      </p>
    </div>
  );
}
