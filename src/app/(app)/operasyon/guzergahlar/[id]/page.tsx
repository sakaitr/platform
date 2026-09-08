import { notFound } from "next/navigation";
import { Badge, Button, Card, EmptyRow, PageHeader, Table, Td } from "@/components/ui";
import { EntityForm, type FieldSpec } from "@/components/ui/entity-form";
import { pageContext } from "@/lib/page-context";
import { formatDate, istanbulDayKey } from "@/lib/time";
import { vehicleOptions } from "@/modules/filo/queries";
import {
  addRoutePassengerAction,
  assignRouteAction,
  attachTagAction,
  detachTagAction,
  deleteTimeSlotAction,
  removeRoutePassengerAction,
  saveTimeSlotAction,
} from "@/modules/operasyon/guzergah/actions";
import {
  activeRoutePrice,
  getRoute,
  listAssignments,
  listRoutePassengers,
  listTimeSlots,
  tagsOfRoute,
} from "@/modules/operasyon/guzergah/queries";
import { listPassengers } from "@/modules/operasyon/yolcular/queries";

const KIND_TONE: Record<string, string> = { atama: "ok", devir: "info", iptal: "bad" };

export default async function GuzergahDetayPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { session, t } = await pageContext("guzergahlar:read", "operasyon");

  const route = await getRoute(session.tenantId, id);
  if (!route) notFound();

  const [assignments, routePax, allPax, araclar, slots, tags, price] = await Promise.all([
    listAssignments(session.tenantId, id),
    listRoutePassengers(session.tenantId, id),
    listPassengers(session.tenantId, { scope: session.scope, durum: "aktif" }),
    vehicleOptions(session.tenantId, session.scope),
    listTimeSlots(session.tenantId, id),
    tagsOfRoute(session.tenantId, id),
    activeRoutePrice(session.tenantId, id),
  ]);

  const canAssign = session.permissions.has("guzergahlar:assign");
  const assignedIds = new Set(routePax.map((p) => p.passengerId));
  const free = allPax.rows.filter((p) => !assignedIds.has(p.id));
  const overCapacity = route.capacity !== null && routePax.length > route.capacity;

  const assignFields: readonly FieldSpec[] = [
    {
      name: "vehicleId",
      label: t("asset"),
      type: "select",
      required: true,
      options: araclar.map((v) => ({ value: v.id, label: v.plate })),
    },
    { name: "tripType", label: "Hareket Tipi", type: "text", hint: "Boş = tüm hareketler" },
    { name: "startsOn", label: "Başlangıç", type: "date", required: true },
    { name: "notes", label: "Açıklama", type: "text", wide: true },
  ];

  return (
    <div className="space-y-6">
      <PageHeader
        title={route.name}
        description={[route.code, route.shiftName, route.capacity ? `${route.capacity} kişilik` : null]
          .filter(Boolean)
          .join(" · ")}
      />

      <div className="grid gap-3 sm:grid-cols-5">
        {[
          { label: "Atanmış yolcu", value: routePax.length },
          { label: "Kapasite", value: route.capacity ?? "—" },
          { label: "Mesafe", value: route.distanceKm ? `${route.distanceKm} km` : "—" },
          { label: "Süre", value: route.durationMin ? `${route.durationMin} dk` : "—" },
          { label: "Aktif Fiyat", value: price ? `${price.price} ₺` : "—" },
        ].map((tile) => (
          <Card key={tile.label} className="p-4">
            <p className="text-xs uppercase tracking-wide text-neutral-500">{tile.label}</p>
            <p className="mt-1 text-2xl font-semibold">{tile.value}</p>
          </Card>
        ))}
      </div>

      {overCapacity ? (
        <Card className="border-amber-300 bg-amber-50 p-3 text-sm text-amber-800">
          Atanan yolcu sayısı kapasiteyi aşıyor ({routePax.length} / {route.capacity}).
        </Card>
      ) : null}

      <Card className="p-4">
        <p className="mb-2 text-xs uppercase tracking-wide text-neutral-500">Etiketler</p>
        <div className="mb-3 flex flex-wrap items-center gap-2">
          {tags.length === 0 ? (
            <span className="text-xs text-neutral-500">Henüz etiket tanımlanmadı.</span>
          ) : (
            tags.map((tag) => (
              <span key={tag.linkId} className="inline-flex items-center gap-1">
                <Badge tone="info">{tag.name}</Badge>
                {canAssign ? (
                  <form action={detachTagAction}>
                    <input type="hidden" name="linkId" value={tag.linkId} />
                    <input type="hidden" name="routeId" value={id} />
                    <button type="submit" className="text-xs text-neutral-400 hover:text-red-600">
                      ×
                    </button>
                  </form>
                ) : null}
              </span>
            ))
          )}
        </div>
        {canAssign ? (
          <form action={attachTagAction} className="flex flex-wrap items-end gap-2">
            <input type="hidden" name="routeId" value={id} />
            <input
              name="tagName"
              required
              placeholder="Etiket adı"
              className="rounded-lg border border-neutral-300 px-3 py-1.5 text-sm"
            />
            <Button type="submit" variant="ghost">
              Etiket Ekle
            </Button>
          </form>
        ) : null}
      </Card>

      <PageHeader
        title="Vardiya / Saat Dilimleri"
        description="Bir hat birden çok vardiyaya hizmet edebilir"
        action={
          canAssign ? (
            <EntityForm
              action={saveTimeSlotAction}
              fields={[
                { name: "name", label: "Vardiya Adı", type: "text", required: true },
                { name: "arriveAt", label: "Varış", type: "time" },
                { name: "departAt", label: "Kalkış", type: "time" },
                { name: "position", label: "Sıra", type: "number" },
              ]}
              extraHidden={{ routeId: id }}
              openLabel="Saat Dilimi Ekle"
            />
          ) : null
        }
      />
      <Table head={["Vardiya", "Varış", "Kalkış", "Sıra", "Durum", ""]}>
        {slots.length === 0 ? (
          <EmptyRow colSpan={6} text="Saat dilimi tanımlanmadı." />
        ) : (
          slots.map((slot) => (
            <tr key={slot.id} className="hover:bg-neutral-50">
              <Td className="font-medium">{slot.name}</Td>
              <Td>{slot.arriveAt ?? "—"}</Td>
              <Td>{slot.departAt ?? "—"}</Td>
              <Td className="text-neutral-500">{slot.position}</Td>
              <Td>
                <Badge tone={slot.isActive ? "ok" : "mute"}>{slot.isActive ? "Aktif" : "Pasif"}</Badge>
              </Td>
              <Td>
                {canAssign ? (
                  <form action={deleteTimeSlotAction} className="flex justify-end">
                    <input type="hidden" name="id" value={slot.id} />
                    <input type="hidden" name="routeId" value={id} />
                    <Button type="submit" variant="danger">
                      Sil
                    </Button>
                  </form>
                ) : null}
              </Td>
            </tr>
          ))
        )}
      </Table>

      <PageHeader
        title="Araç Atama Geçmişi"
        description="Yeni atama açıldığında önceki atama otomatik kapanır."
        action={
          canAssign ? (
            <EntityForm
              action={assignRouteAction}
              fields={assignFields}
              values={{ startsOn: istanbulDayKey() }}
              extraHidden={{ routeId: id }}
              openLabel="Araç Ata"
            />
          ) : null
        }
      />
      <Table head={[t("asset"), t("staff"), "Hareket", "Başlangıç", "Bitiş", "İşlem", "Açıklama"]}>
        {assignments.length === 0 ? (
          <EmptyRow colSpan={7} text="Henüz atama yapılmamış." />
        ) : (
          assignments.map((a) => (
            <tr key={a.id} className={a.endsOn === null ? "bg-emerald-50/40" : "hover:bg-neutral-50"}>
              <Td className="font-medium">{a.plate}</Td>
              <Td className="text-neutral-500">{a.driverName ?? "—"}</Td>
              <Td className="text-neutral-500">{a.tripType ?? "tümü"}</Td>
              <Td>{formatDate(a.startsOn)}</Td>
              <Td>{a.endsOn ? formatDate(a.endsOn) : <Badge tone="ok">güncel</Badge>}</Td>
              <Td>
                <Badge tone={KIND_TONE[a.kind]}>{a.kind}</Badge>
              </Td>
              <Td className="max-w-xs truncate text-neutral-500">{a.notes ?? "—"}</Td>
            </tr>
          ))
        )}
      </Table>

      <PageHeader title="Atanmış Yolcular" description={`${routePax.length} kişi`} />
      {canAssign && free.length > 0 ? (
        <Card className="p-3">
          <form action={addRoutePassengerAction} className="flex flex-wrap items-end gap-2">
            <input type="hidden" name="routeId" value={id} />
            <label className="text-sm">
              <span className="mb-1 block text-xs font-medium text-neutral-600">Yolcu</span>
              <select
                name="passengerId"
                required
                className="rounded-lg border border-neutral-300 px-3 py-1.5 text-sm"
              >
                {free.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.fullName}
                  </option>
                ))}
              </select>
            </label>
            <label className="text-sm">
              <span className="mb-1 block text-xs font-medium text-neutral-600">Durak</span>
              <input name="stopName" className="rounded-lg border border-neutral-300 px-3 py-1.5 text-sm" />
            </label>
            <Button type="submit">Ekle</Button>
          </form>
        </Card>
      ) : null}

      <Table head={["Yolcu", "Telefon", "Durak", ""]}>
        {routePax.length === 0 ? (
          <EmptyRow colSpan={4} text="Bu güzergaha yolcu atanmamış." />
        ) : (
          routePax.map((p) => (
            <tr key={p.id} className="hover:bg-neutral-50">
              <Td className="font-medium">{p.fullName}</Td>
              <Td className="text-neutral-500">{p.phone ?? "—"}</Td>
              <Td className="text-neutral-500">{p.stopName ?? "—"}</Td>
              <Td>
                {canAssign ? (
                  <form action={removeRoutePassengerAction} className="flex justify-end">
                    <input type="hidden" name="id" value={p.id} />
                    <input type="hidden" name="routeId" value={id} />
                    <Button type="submit" variant="danger">
                      Çıkar
                    </Button>
                  </form>
                ) : null}
              </Td>
            </tr>
          ))
        )}
      </Table>
    </div>
  );
}
