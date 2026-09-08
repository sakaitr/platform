import { notFound } from "next/navigation";
import {
  Badge,
  Button,
  EmptyRow,
  Field,
  FilterBar,
  PageHeader,
  Pagination,
  Table,
  Td,
  inputClass,
} from "@/components/ui";
import { EntityForm } from "@/components/ui/entity-form";
import { one, pageContext, type SearchParams } from "@/lib/page-context";
import { formatDate, isExpiringSoon } from "@/lib/time";
import { companyOptions } from "@/modules/crm/queries";
import { listDrivers, vehicleOptions } from "@/modules/filo/queries";
import {
  deleteFiloRecordAction,
  saveFiloRecordAction,
} from "@/modules/filo/records/actions";
import {
  fuelCardOptions,
  getFiloRecordRow,
  listFiloRecords,
} from "@/modules/filo/records/queries";
import { getFiloRecord } from "@/modules/filo/records/registry";
import type { RecordColumn } from "@/modules/filo/records/types";

function Cell({ column, value }: { column: RecordColumn; value: unknown }) {
  if (value === null || value === undefined || value === "") {
    return <span className="text-neutral-400">—</span>;
  }
  switch (column.format) {
    case "date":
      return <>{formatDate(String(value))}</>;
    case "expiry": {
      const soon = isExpiringSoon(String(value), column.warnDays ?? 30);
      return soon ? <Badge tone="bad">{formatDate(String(value))}</Badge> : <>{formatDate(String(value))}</>;
    }
    case "money":
      return <>{Number(value).toLocaleString("tr-TR", { minimumFractionDigits: 2 })} ₺</>;
    case "number":
      return <>{Number(value).toLocaleString("tr-TR")}</>;
    case "bool":
      return value ? <Badge tone="ok">Evet</Badge> : <Badge tone="warn">Hayır</Badge>;
    case "badge":
      return (
        <Badge tone={column.tone?.[String(value)] ?? "mute"}>
          {column.labels?.[String(value)] ?? String(value)}
        </Badge>
      );
    default:
      return <>{String(value)}</>;
  }
}

export default async function FiloKayitPage({
  params,
  searchParams,
}: {
  params: Promise<{ kayit: string }>;
  searchParams: SearchParams;
}) {
  const { kayit } = await params;
  const def = getFiloRecord(kayit);
  if (!def) notFound();

  const query = await searchParams;
  const { session, t } = await pageContext(`${def.permission}:read`, "filo");

  const filter = {
    vehicleId: one(query, "arac"),
    from: one(query, "baslangic"),
    to: one(query, "bitis"),
    page: Number(one(query, "sayfa") ?? 1),
    scope: session.scope,
  };

  const [result, araclar, suruculer, firmalar, kartlar] = await Promise.all([
    listFiloRecords(session.tenantId, kayit, filter),
    vehicleOptions(session.tenantId, session.scope),
    listDrivers(session.tenantId, { scope: session.scope, status: "aktif" }),
    companyOptions(session.tenantId, session.scope),
    kayit === "yakit" ? fuelCardOptions(session.tenantId) : Promise.resolve([]),
  ]);

  const editingId = one(query, "duzenle");
  const editing = editingId ? await getFiloRecordRow(session.tenantId, kayit, editingId) : null;

  let fields = def.fields({
    vehicles: araclar.map((v) => ({ value: v.id, label: v.plate })),
    drivers: suruculer.rows.map((d) => ({ value: d.id, label: d.fullName })),
    companies: firmalar.map((f) => ({ value: f.id, label: f.name })),
    terms: t,
  });
  if (kayit === "yakit") {
    fields = fields.map((field) =>
      field.name === "cardId"
        ? {
            ...field,
            options: kartlar.map((c) => ({
              value: c.id,
              label: `${c.cardNo}${c.provider ? ` · ${c.provider}` : ""}`,
            })),
          }
        : field,
    );
  }

  const canWrite = session.permissions.has(`${def.permission}:create`);
  const canDelete = session.permissions.has(`${def.permission}:delete`);

  return (
    <div className="space-y-4">
      <PageHeader
        title={def.plural}
        description={`${result.total} kayıt · ${def.description}`}
        action={
          canWrite ? (
            <EntityForm
              action={saveFiloRecordAction}
              fields={fields}
              values={editing ?? def.defaults}
              idValue={editing ? String(editing.id) : undefined}
              extraHidden={{ kayit }}
              openLabel={`Yeni ${def.label}`}
            />
          ) : null
        }
      />

      <FilterBar action={`/filo/${kayit}`}>
        <Field label={t("asset")}>
          <select name="arac" defaultValue={filter.vehicleId ?? ""} className={inputClass}>
            <option value="">Hepsi</option>
            {araclar.map((v) => (
              <option key={v.id} value={v.id}>
                {v.plate}
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

      <Table head={[...def.columns.map((c) => c.label), ""]}>
        {result.rows.length === 0 ? (
          <EmptyRow colSpan={def.columns.length + 1} />
        ) : (
          result.rows.map((row) => (
            <tr key={String(row.id)} className="hover:bg-neutral-50">
              {def.columns.map((column) => (
                <Td key={column.key} className={column.key === "plate" ? "font-medium" : undefined}>
                  <Cell column={column} value={row[column.key]} />
                </Td>
              ))}
              <Td>
                <div className="flex justify-end gap-2">
                  {canWrite ? (
                    <a
                      href={`/filo/${kayit}?duzenle=${String(row.id)}`}
                      className="rounded-lg border border-neutral-300 px-3 py-1.5 text-xs hover:bg-neutral-50"
                    >
                      Düzenle
                    </a>
                  ) : null}
                  {canDelete ? (
                    <form action={deleteFiloRecordAction}>
                      <input type="hidden" name="kayit" value={kayit} />
                      <input type="hidden" name="id" value={String(row.id)} />
                      <Button type="submit" variant="danger">
                        Sil
                      </Button>
                    </form>
                  ) : null}
                </div>
              </Td>
            </tr>
          ))
        )}
      </Table>

      <Pagination
        basePath={`/filo/${kayit}`}
        page={result.page}
        pageCount={result.pageCount}
        query={{ arac: filter.vehicleId, baslangic: filter.from, bitis: filter.to }}
      />
    </div>
  );
}
