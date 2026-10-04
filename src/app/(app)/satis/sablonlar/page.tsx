import { Badge, Button, Card, PageHeader } from "@/components/ui";
import { EntityForm } from "@/components/ui/entity-form";
import { one, pageContext, type SearchParams } from "@/lib/page-context";
import { deleteTemplateAction, saveTemplateAction } from "@/modules/satis/template-actions";
import { getTemplate, listTemplates } from "@/modules/satis/template-queries";

const CHANNEL = { whatsapp: "WhatsApp", email: "E-posta" } as const;

export default async function SablonlarPage({ searchParams }: { searchParams: SearchParams }) {
  const params = await searchParams;
  const { session } = await pageContext("satis_sablon:read", "satis");
  const templates = await listTemplates(session.tenantId);
  const editingId = one(params, "duzenle");
  const editing = editingId ? await getTemplate(session.tenantId, editingId) : null;
  const canCreate = session.permissions.has("satis_sablon:create");
  const canUpdate = session.permissions.has("satis_sablon:update");
  const canDelete = session.permissions.has("satis_sablon:delete");

  const fields = [
    { name: "name", label: "Şablon adı", type: "text" as const, required: true },
    { name: "channel", label: "Kanal", type: "select" as const, options: [{ value: "whatsapp", label: "WhatsApp" }, { value: "email", label: "E-posta" }] },
    { name: "subject", label: "E-posta konusu", type: "text" as const, hint: "Yalnız e-posta için" },
    { name: "body", label: "Mesaj", type: "textarea" as const, wide: true, hint: "Yer tutucular: {firma} {ad} {hizmet} {sehir} {sektor}" },
  ];

  return (
    <div className="space-y-4">
      <PageHeader
        title="Mesaj şablonları"
        description="Şablonlar adaydan WhatsApp ya da e-posta olarak açılır. Mesajı uygulama göndermez, siz gönderirsiniz."
        action={
          canCreate && !editing ? (
            <EntityForm action={saveTemplateAction} fields={fields} values={{ channel: "whatsapp" }} openLabel="Yeni şablon" />
          ) : null
        }
      />

      {editing && canUpdate ? (
        <EntityForm action={saveTemplateAction} fields={fields} values={editing} idValue={editing.id} openLabel="Düzenle" alwaysOpen />
      ) : null}

      {templates.length === 0 ? (
        <Card className="p-6 text-sm text-neutral-500">Henüz şablon yok.</Card>
      ) : (
        <ul className="grid gap-3 lg:grid-cols-2">
          {templates.map((t) => (
            <li key={t.id}>
              <Card className="space-y-2 p-4">
                <div className="flex items-center justify-between gap-2">
                  <h2 className="text-sm font-semibold">{t.name}</h2>
                  <Badge tone={t.channel === "whatsapp" ? "ok" : "info"}>{CHANNEL[t.channel]}</Badge>
                </div>
                {t.subject ? <p className="text-xs text-neutral-500">Konu: {t.subject}</p> : null}
                <p className="whitespace-pre-wrap text-sm text-neutral-700">{t.body}</p>
                <div className="flex gap-2">
                  {canUpdate ? (
                    <a href={`/satis/sablonlar?duzenle=${t.id}`} className="rounded-lg border border-neutral-300 px-3 py-1.5 text-xs hover:bg-neutral-50">Düzenle</a>
                  ) : null}
                  {canDelete ? (
                    <form action={deleteTemplateAction}>
                      <input type="hidden" name="id" value={t.id} />
                      <Button type="submit" variant="danger">Sil</Button>
                    </form>
                  ) : null}
                </div>
              </Card>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
