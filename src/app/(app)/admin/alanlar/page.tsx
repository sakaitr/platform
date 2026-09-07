import { requirePermission } from "@/lib/auth";
import { listAllFields } from "@/modules/admin/queries";

const TYPE_LABELS: Record<string, string> = {
  text: "Metin",
  number: "Sayı",
  date: "Tarih",
  select: "Seçim",
  boolean: "Evet/Hayır",
};

export default async function AdminFieldsPage() {
  const session = await requirePermission("fields:read");
  const fields = await listAllFields(session.tenantId);

  return (
    <div className="space-y-4">
      <h1 className="text-xl font-semibold">Özel Alanlar</h1>
      <p className="text-sm text-neutral-500">
        Sektör paketinizle gelen ve size özel eklenen alanlar.
      </p>
      <div className="divide-y divide-neutral-200 rounded-xl border border-neutral-200 bg-white">
        {fields.map((field) => (
          <div key={field.id} className="flex items-center justify-between px-5 py-3">
            <div>
              <p className="text-sm font-medium">{field.label}</p>
              <p className="text-xs text-neutral-500">
                {field.entityKey}.{field.fieldKey}
                {field.required ? " · zorunlu" : ""}
              </p>
            </div>
            <span className="text-xs text-neutral-600">{TYPE_LABELS[field.type] ?? field.type}</span>
          </div>
        ))}
        {fields.length === 0 ? (
          <p className="px-5 py-3 text-sm text-neutral-500">Tanımlı özel alan yok.</p>
        ) : null}
      </div>
    </div>
  );
}
