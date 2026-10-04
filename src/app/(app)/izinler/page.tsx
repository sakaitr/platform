import { Badge, Button, EmptyRow, Field, FilterBar, PageHeader, Table, Td, inputClass } from "@/components/ui";
import { EntityForm, type FieldSpec } from "@/components/ui/entity-form";
import { one, pageContext, type SearchParams } from "@/lib/page-context";
import { formatDate, istanbulDayKey } from "@/lib/time";
import {
  createLeaveRequestAction,
  decideLeaveAction,
  saveLeaveTypeAction,
} from "@/modules/isbirligi/actions";
import { listLeaveRequests, listLeaveTypes } from "@/modules/isbirligi/queries";

const STATUS_LABEL: Record<string, string> = {
  bekliyor: "Bekliyor",
  onaylandi: "Onaylandı",
  reddedildi: "Reddedildi",
};

const TONE: Record<string, string> = { bekliyor: "warn", onaylandi: "ok", reddedildi: "bad" };

const TYPE_FIELDS: readonly FieldSpec[] = [
  { name: "name", label: "İzin Türü", type: "text", required: true },
  { name: "annualDays", label: "Yıllık Hak (gün)", type: "number", hint: "0 = sınırsız" },
  { name: "isActive", label: "Aktif", type: "checkbox" },
];

export default async function IzinlerPage({ searchParams }: { searchParams: SearchParams }) {
  const params = await searchParams;
  const { session } = await pageContext("dashboard:read", "ik");

  // Yönetici yetkisi olan herkesin talebini görür; olmayan yalnız kendisininkini.
  const canDecide = session.permissions.has("users:update");
  const status = one(params, "durum");
  const [rows, types] = await Promise.all([
    listLeaveRequests(session.tenantId, {
      userId: canDecide ? undefined : session.userId,
      status,
    }),
    listLeaveTypes(session.tenantId),
  ]);

  const requestFields: readonly FieldSpec[] = [
    {
      name: "leaveTypeId",
      label: "İzin Türü",
      type: "select",
      options: types.filter((t) => t.isActive).map((t) => ({ value: t.id, label: t.name })),
    },
    { name: "startsOn", label: "Başlangıç", type: "date", required: true },
    { name: "endsOn", label: "Bitiş", type: "date", required: true },
    { name: "reason", label: "Açıklama", type: "textarea", wide: true },
  ];

  const today = istanbulDayKey();

  return (
    <div className="space-y-6">
      <PageHeader
        title="İzinler"
        description={canDecide ? "Tüm talepler" : "Kendi talepleriniz"}
        action={
          <EntityForm
            action={createLeaveRequestAction}
            fields={requestFields}
            values={{ startsOn: today, endsOn: today }}
            openLabel="İzin Talebi"
          />
        }
      />

      <FilterBar action="/izinler">
        <Field label="Durum">
          <select name="durum" defaultValue={status ?? ""} className={inputClass}>
            <option value="">Hepsi</option>
            {Object.entries(STATUS_LABEL).map(([v, l]) => (
              <option key={v} value={v}>
                {l}
              </option>
            ))}
          </select>
        </Field>
      </FilterBar>

      <Table head={["Kişi", "Tür", "Başlangıç", "Bitiş", "Gün", "Açıklama", "Durum", ""]}>
        {rows.length === 0 ? (
          <EmptyRow colSpan={8} text="Talep yok." />
        ) : (
          rows.map((r) => (
            <tr key={r.id} className="hover:bg-neutral-50">
              <Td className="font-medium">{r.userName}</Td>
              <Td className="text-neutral-500">{r.typeName ?? "—"}</Td>
              <Td>{formatDate(r.startsOn)}</Td>
              <Td>{formatDate(r.endsOn)}</Td>
              <Td>{r.dayCount}</Td>
              <Td className="max-w-xs truncate text-neutral-500">{r.reason ?? "—"}</Td>
              <Td>
                <Badge tone={TONE[r.status]}>{STATUS_LABEL[r.status]}</Badge>
                {r.approverNote ? (
                  <span className="ml-2 text-xs text-neutral-500">{r.approverNote}</span>
                ) : null}
              </Td>
              <Td>
                {canDecide && r.status === "bekliyor" ? (
                  <div className="flex justify-end gap-2">
                    <form action={decideLeaveAction}>
                      <input type="hidden" name="id" value={r.id} />
                      <input type="hidden" name="status" value="onaylandi" />
                      <Button type="submit">Onayla</Button>
                    </form>
                    <form action={decideLeaveAction} className="flex items-center gap-1">
                      <input type="hidden" name="id" value={r.id} />
                      <input type="hidden" name="status" value="reddedildi" />
                      <input
                        name="note"
                        placeholder="Gerekçe"
                        className="w-28 rounded-lg border border-neutral-300 px-2 py-1 text-xs"
                      />
                      <Button type="submit" variant="danger">
                        Reddet
                      </Button>
                    </form>
                  </div>
                ) : null}
              </Td>
            </tr>
          ))
        )}
      </Table>

      {canDecide ? (
        <>
          <PageHeader
            title="İzin Türleri"
            action={
              <EntityForm
                action={saveLeaveTypeAction}
                fields={TYPE_FIELDS}
                values={{ isActive: true, annualDays: 0 }}
                openLabel="Yeni Tür"
              />
            }
          />
          <Table head={["Tür", "Yıllık Hak", "Durum"]}>
            {types.length === 0 ? (
              <EmptyRow colSpan={3} text="İzin türü tanımlanmamış." />
            ) : (
              types.map((t) => (
                <tr key={t.id} className="hover:bg-neutral-50">
                  <Td className="font-medium">{t.name}</Td>
                  <Td className="text-neutral-500">{t.annualDays > 0 ? `${t.annualDays} gün` : "sınırsız"}</Td>
                  <Td>
                    <Badge tone={t.isActive ? "ok" : "mute"}>{t.isActive ? "Aktif" : "Pasif"}</Badge>
                  </Td>
                </tr>
              ))
            )}
          </Table>
        </>
      ) : null}
    </div>
  );
}
