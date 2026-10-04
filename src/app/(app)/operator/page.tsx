import { Badge, Button, EmptyRow, PageHeader, Table, Td } from "@/components/ui";
import { EntityForm, type FieldSpec } from "@/components/ui/entity-form";
import { requireOperator } from "@/lib/operator";
import { SECTOR_PACKS } from "@/lib/sector/packs";
import { formatDate } from "@/lib/time";
import { listAllTenants } from "@/modules/admin/queries";
import {
  provisionTenantAction,
  reapplyPackAction,
  setTenantStatusAction,
} from "@/modules/operator/actions";

const STATUS_LABEL: Record<string, string> = {
  trial: "Deneme",
  active: "Aktif",
  grace: "Ödemesiz dönem",
  expired: "Süresi doldu",
  suspended: "Askıya alındı",
};

const STATUS_TONE: Record<string, string> = {
  trial: "info",
  active: "ok",
  grace: "warn",
  expired: "bad",
  suspended: "bad",
};

export default async function OperatorPage() {
  const session = await requireOperator();
  const tenants = await listAllTenants();

  const packOptions = Object.values(SECTOR_PACKS).map((p) => ({
    value: p.key,
    label: `${p.name} (${p.modules.length} modül)`,
  }));

  const fields: readonly FieldSpec[] = [
    { name: "name", label: "Kiracı Adı", type: "text", required: true },
    { name: "slug", label: "Kısa Ad", type: "text", required: true, hint: "küçük harf, rakam, tire" },
    { name: "sectorPack", label: "Sektör Paketi", type: "select", required: true, options: packOptions },
    { name: "trialDays", label: "Deneme Süresi (gün)", type: "number" },
    { name: "ownerName", label: "Sahip Ad Soyad", type: "text", required: true },
    { name: "ownerEmail", label: "Sahip E-posta", type: "email", required: true },
    { name: "ownerPassword", label: "Sahip Şifresi", type: "text", required: true, hint: "En az 8 karakter" },
  ];

  return (
    <div className="space-y-6">
      <PageHeader
        title="Operatör Paneli"
        description={`${tenants.length} kiracı · ${session.email}`}
        action={
          <EntityForm
            action={provisionTenantAction}
            fields={fields}
            values={{ trialDays: 14, sectorPack: "turizm" }}
            openLabel="Yeni Kiracı Kur"
          />
        }
      />

      <Table head={["Kiracı", "Kısa Ad", "Paket", "Kullanıcı", "Durum", "Bitiş", "Kuruluş", ""]}>
        {tenants.length === 0 ? (
          <EmptyRow colSpan={8} text="Kiracı yok." />
        ) : (
          tenants.map((t) => {
            const packVersion = SECTOR_PACKS[t.sectorPack]?.version;
            const stale = packVersion && packVersion !== t.sectorPackVersion;
            return (
              <tr key={t.id} className="hover:bg-neutral-50">
                <Td className="font-medium">{t.name}</Td>
                <Td className="text-neutral-500">{t.slug}</Td>
                <Td>
                  {t.sectorPack} v{t.sectorPackVersion}
                  {stale ? <Badge tone="warn">güncel değil</Badge> : null}
                </Td>
                <Td>{t.userCount}</Td>
                <Td>
                  <Badge tone={STATUS_TONE[t.status ?? ""] ?? "mute"}>
                    {STATUS_LABEL[t.status ?? ""] ?? "—"}
                  </Badge>
                </Td>
                <Td className="text-neutral-500">
                  {t.status === "trial"
                    ? t.trialEndsAt
                      ? formatDate(t.trialEndsAt)
                      : "—"
                    : t.currentPeriodEnd
                      ? formatDate(t.currentPeriodEnd)
                      : "—"}
                </Td>
                <Td className="text-neutral-500">{formatDate(t.createdAt)}</Td>
                <Td>
                  <div className="flex flex-wrap justify-end gap-2">
                    <form action={setTenantStatusAction} className="flex items-center gap-1">
                      <input type="hidden" name="tenantId" value={t.id} />
                      <input type="hidden" name="status" value="active" />
                      <input
                        name="months"
                        type="number"
                        min={1}
                        max={36}
                        defaultValue={12}
                        className="w-14 rounded-lg border border-neutral-300 px-2 py-1 text-xs"
                      />
                      <Button type="submit">Aktifleştir</Button>
                    </form>
                    <form action={setTenantStatusAction}>
                      <input type="hidden" name="tenantId" value={t.id} />
                      <input type="hidden" name="status" value="suspended" />
                      <Button type="submit" variant="danger">
                        Askıya Al
                      </Button>
                    </form>
                    <form action={reapplyPackAction}>
                      <input type="hidden" name="tenantId" value={t.id} />
                      <Button type="submit" variant="ghost">
                        Paketi Yenile
                      </Button>
                    </form>
                  </div>
                </Td>
              </tr>
            );
          })
        )}
      </Table>

      <p className="text-xs text-neutral-500">
        Operatör listesi PLATFORM_OPERATORS ortam değişkeninden gelir; hiçbir kiracı rolü bu
        yetkiyi veremez. &quot;Aktifleştir&quot; girilen ay kadar dönem açar, &quot;Paketi Yenile&quot;
        sektör paketindeki yeni modül ve alanları mevcut kiracıya işler.
      </p>
    </div>
  );
}
