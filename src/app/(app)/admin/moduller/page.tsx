import { Badge, Button, EmptyRow, PageHeader, Table, Td } from "@/components/ui";
import { pageContext } from "@/lib/page-context";
import { formatDate } from "@/lib/time";
import { toggleCapabilityAction, toggleModuleAction } from "@/modules/admin/actions";
import {
  getSubscription,
  listTenantCapabilities,
  listTenantModules,
} from "@/modules/admin/queries";

const STATE_LABEL: Record<string, string> = {
  trial: "Deneme",
  active: "Aktif",
  grace: "Ödemesiz dönem",
  locked: "Kilitli",
};

export default async function ModullerPage() {
  const { session, access } = await pageContext("modules:read", "admin");

  const [modules, capabilities, subscription] = await Promise.all([
    listTenantModules(session.tenantId),
    listTenantCapabilities(session.tenantId),
    getSubscription(session.tenantId),
  ]);

  const canAssign = session.permissions.has("modules:assign");

  return (
    <div className="space-y-6">
      <PageHeader
        title="Modüller ve Lisans"
        description={`${access.tenant.name} · ${access.tenant.sectorPack} paketi v${access.tenant.sectorPackVersion}`}
        action={<Badge tone={access.state === "locked" ? "bad" : access.state === "grace" ? "warn" : "ok"}>
          {STATE_LABEL[access.state]}
        </Badge>}
      />

      {subscription ? (
        <p className="text-sm text-neutral-500">
          Plan: {subscription.planKey}
          {subscription.trialEndsAt ? ` · Deneme bitişi ${formatDate(subscription.trialEndsAt)}` : ""}
          {subscription.currentPeriodEnd
            ? ` · Dönem bitişi ${formatDate(subscription.currentPeriodEnd)}`
            : ""}
        </p>
      ) : null}

      <Table head={["Modül", "Durum", "Bitiş", ""]}>
        {modules.map((m) => (
          <tr key={m.key} className="hover:bg-neutral-50">
            <Td className="font-medium">{m.label}</Td>
            <Td>
              <Badge tone={m.row ? "ok" : "mute"}>{m.row ? "Açık" : "Kapalı"}</Badge>
            </Td>
            <Td className="text-neutral-500">{m.row?.endsAt ? formatDate(m.row.endsAt) : "—"}</Td>
            <Td>
              {canAssign ? (
                <form action={toggleModuleAction} className="flex justify-end">
                  <input type="hidden" name="moduleKey" value={m.key} />
                  <input type="hidden" name="enable" value={m.row ? "0" : "1"} />
                  <Button type="submit" variant={m.row ? "danger" : "primary"}>
                    {m.row ? "Kapat" : "Aç"}
                  </Button>
                </form>
              ) : null}
            </Td>
          </tr>
        ))}
      </Table>

      <PageHeader
        title="Alt Yetenekler"
        description="Modül içinde sektöre göre açılıp kapanan parçalar"
      />
      <Table head={["Modül", "Yetenek", "Durum", ""]}>
        {capabilities.length === 0 ? (
          <EmptyRow colSpan={4} text="Alt yetenek tanımlı değil." />
        ) : (
          capabilities.map((c) => (
            <tr key={c.key} className="hover:bg-neutral-50">
              <Td className="text-neutral-500">{c.moduleLabel}</Td>
              <Td className="font-medium">{c.key}</Td>
              <Td>
                <Badge tone={c.enabled ? "ok" : "mute"}>{c.enabled ? "Açık" : "Kapalı"}</Badge>
              </Td>
              <Td>
                {canAssign ? (
                  <form action={toggleCapabilityAction} className="flex justify-end">
                    <input type="hidden" name="capabilityKey" value={c.key} />
                    <input type="hidden" name="enable" value={c.enabled ? "0" : "1"} />
                    <Button type="submit" variant={c.enabled ? "danger" : "primary"}>
                      {c.enabled ? "Kapat" : "Aç"}
                    </Button>
                  </form>
                ) : null}
              </Td>
            </tr>
          ))
        )}
      </Table>

      <p className="text-xs text-neutral-500">
        Modülü kapatmak veriyi silmez, yalnız erişimi keser. Yeniden açıldığında kayıtlar yerinde durur.
      </p>
    </div>
  );
}
