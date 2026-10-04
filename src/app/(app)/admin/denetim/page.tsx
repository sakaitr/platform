import { EmptyRow, Field, FilterBar, PageHeader, Pagination, Table, Td, inputClass } from "@/components/ui";
import { one, pageContext, type SearchParams } from "@/lib/page-context";
import { formatDateTime } from "@/lib/time";
import { listAuditLogs, listUsers } from "@/modules/admin/queries";

export default async function DenetimPage({ searchParams }: { searchParams: SearchParams }) {
  const params = await searchParams;
  const { session } = await pageContext("audit:read", "admin");

  const filter = {
    event: one(params, "olay"),
    userId: one(params, "kisi"),
    from: one(params, "baslangic"),
    to: one(params, "bitis"),
    page: Number(one(params, "sayfa") ?? 1),
  };

  const [result, kullanicilar] = await Promise.all([
    listAuditLogs(session.tenantId, filter),
    listUsers(session.tenantId),
  ]);

  return (
    <div className="space-y-4">
      <PageHeader
        title="Denetim İzi"
        description={`${result.total} kayıt · kim, ne zaman, neyi değiştirdi`}
      />

      <FilterBar action="/admin/denetim">
        <Field label="Olay">
          <input name="olay" defaultValue={filter.event ?? ""} placeholder="earning, user…" className={inputClass} />
        </Field>
        <Field label="Kişi">
          <select name="kisi" defaultValue={filter.userId ?? ""} className={inputClass}>
            <option value="">Hepsi</option>
            {kullanicilar.map((u) => (
              <option key={u.id} value={u.id}>
                {u.name}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Başlangıç">
          <input type="date" name="baslangic" defaultValue={filter.from ?? ""} className={inputClass} />
        </Field>
        <Field label="Bitiş">
          <input type="date" name="bitis" defaultValue={filter.to ?? ""} className={inputClass} />
        </Field>
      </FilterBar>

      <Table head={["Zaman", "Kişi", "Olay", "Nesne", "Ayrıntı"]}>
        {result.rows.length === 0 ? (
          <EmptyRow colSpan={5} text="Kayıt yok." />
        ) : (
          result.rows.map((r) => (
            <tr key={r.id} className="hover:bg-neutral-50">
              <Td className="text-neutral-500">{formatDateTime(r.createdAt)}</Td>
              <Td className="font-medium">{r.userName ?? "sistem"}</Td>
              <Td>{r.event}</Td>
              <Td className="text-neutral-500">{r.entityType ?? "—"}</Td>
              <td className="max-w-md px-4 py-2.5 text-xs text-neutral-500">
                {r.metadata && r.metadata !== "{}" ? String(r.metadata) : "—"}
              </td>
            </tr>
          ))
        )}
      </Table>

      <Pagination
        basePath="/admin/denetim"
        page={result.page}
        pageCount={result.pageCount}
        query={{ olay: filter.event, kisi: filter.userId, baslangic: filter.from, bitis: filter.to }}
      />
    </div>
  );
}
