import { requirePermission } from "@/lib/auth";
import { getTenantAccess } from "@/lib/licensing";
import { ensureReportsRegistered, listCategories, listReports } from "@/lib/reports/engine";

export default async function ReportsPage() {
  const session = await requirePermission("raporlar:read");
  await ensureReportsRegistered();

  const access = await getTenantAccess(session.tenantId);
  const licensed = new Set([...access.modules].filter(([, m]) => m.allowed).map(([key]) => key));
  const reports = listReports(session.permissions, licensed);
  const categories = listCategories(session.permissions, licensed);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-semibold">Raporlar</h1>
        <p className="text-sm text-neutral-500">
          {reports.length} rapor · CSV ve Excel olarak indirilebilir
        </p>
      </div>

      {categories.map((category) => (
        <div key={category} className="space-y-2">
          <h2 className="text-sm font-medium text-neutral-700">{category}</h2>
          <div className="divide-y divide-neutral-200 rounded-xl border border-neutral-200 bg-white">
            {reports
              .filter((r) => r.category === category)
              .map((report) => (
                <div key={report.key} className="flex items-center justify-between gap-4 px-5 py-3">
                  <div className="min-w-0">
                    <p className="text-sm font-medium">{report.name}</p>
                    <p className="truncate text-xs text-neutral-500">{report.description}</p>
                  </div>
                  <div className="flex shrink-0 gap-2">
                    <a
                      href={`/api/reports/${report.key}?format=csv`}
                      className="rounded-lg border border-neutral-300 px-3 py-1.5 text-xs hover:bg-neutral-50"
                    >
                      CSV
                    </a>
                    <a
                      href={`/api/reports/${report.key}?format=xlsx`}
                      className="rounded-lg bg-neutral-900 px-3 py-1.5 text-xs text-white hover:bg-neutral-800"
                    >
                      Excel
                    </a>
                  </div>
                </div>
              ))}
          </div>
        </div>
      ))}

      {reports.length === 0 ? (
        <p className="text-sm text-neutral-500">Görüntüleyebileceğiniz rapor yok.</p>
      ) : null}
    </div>
  );
}
