import { Badge, Button, Card, EmptyRow, PageHeader, Table, Td } from "@/components/ui";
import { EntityForm, type FieldSpec } from "@/components/ui/entity-form";
import { pageContext } from "@/lib/page-context";
import { formatDate } from "@/lib/time";
import { deleteAnnouncementAction, saveAnnouncementAction } from "@/modules/isbirligi/actions";
import { listAnnouncements } from "@/modules/isbirligi/queries";

const FIELDS: readonly FieldSpec[] = [
  { name: "title", label: "Başlık", type: "text", required: true, wide: true },
  { name: "body", label: "İçerik", type: "textarea", required: true, wide: true },
  { name: "startsOn", label: "Başlangıç", type: "date" },
  { name: "endsOn", label: "Bitiş", type: "date" },
  { name: "showInPortal", label: "Müşteri portalında da göster", type: "checkbox" },
  { name: "isActive", label: "Yayında", type: "checkbox" },
];

export default async function DuyurularPage() {
  const { session } = await pageContext("notlar:read", "gorevler");
  const rows = await listAnnouncements(session.tenantId);
  const canWrite = session.permissions.has("notlar:create");

  const live = rows.filter((r) => r.isActive);

  return (
    <div className="space-y-4">
      <PageHeader
        title="Duyurular"
        description={`${live.length} yayında`}
        action={
          canWrite ? (
            <EntityForm
              action={saveAnnouncementAction}
              fields={FIELDS}
              values={{ isActive: true }}
              openLabel="Yeni Duyuru"
            />
          ) : null
        }
      />

      {live.length > 0 ? (
        <div className="space-y-2">
          {live.map((a) => (
            <Card key={a.id} className="p-4">
              <div className="flex flex-wrap items-center gap-2">
                <p className="font-medium">{a.title}</p>
                {a.showInPortal ? <Badge tone="info">portalda görünür</Badge> : null}
              </div>
              <p className="mt-1 whitespace-pre-wrap text-sm text-neutral-600">{a.body}</p>
            </Card>
          ))}
        </div>
      ) : null}

      <PageHeader title="Tüm Duyurular" />
      <Table head={["Başlık", "Başlangıç", "Bitiş", "Portal", "Durum", ""]}>
        {rows.length === 0 ? (
          <EmptyRow colSpan={6} text="Duyuru yok." />
        ) : (
          rows.map((a) => (
            <tr key={a.id} className="hover:bg-neutral-50">
              <Td className="font-medium">{a.title}</Td>
              <Td className="text-neutral-500">{a.startsOn ? formatDate(a.startsOn) : "—"}</Td>
              <Td className="text-neutral-500">{a.endsOn ? formatDate(a.endsOn) : "—"}</Td>
              <Td>{a.showInPortal ? "Evet" : "Hayır"}</Td>
              <Td>
                <Badge tone={a.isActive ? "ok" : "mute"}>{a.isActive ? "Yayında" : "Kapalı"}</Badge>
              </Td>
              <Td>
                {canWrite ? (
                  <form action={deleteAnnouncementAction} className="flex justify-end">
                    <input type="hidden" name="id" value={a.id} />
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
    </div>
  );
}
