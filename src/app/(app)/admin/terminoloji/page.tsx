import { requirePermission } from "@/lib/auth";
import { getTenantAccess } from "@/lib/licensing";
import { getPack } from "@/lib/sector/install";
import { getTerms } from "@/lib/sector/terminology";

export default async function AdminTerminologyPage() {
  const session = await requirePermission("terminology.manage");
  const access = await getTenantAccess(session.tenantId);
  const pack = getPack(access.tenant.sectorPack);
  const terms = await getTerms(session.tenantId, pack.terminology);

  return (
    <div className="space-y-4">
      <h1 className="text-xl font-semibold">Terimler</h1>
      <p className="text-sm text-neutral-500">
        {pack.name} paketinden gelen terimler. Kendi sözcüklerinizle değiştirebilirsiniz.
      </p>
      <div className="divide-y divide-neutral-200 rounded-xl border border-neutral-200 bg-white">
        {Object.entries(terms.all)
          .sort(([a], [b]) => a.localeCompare(b))
          .map(([key, value]) => (
            <div key={key} className="flex items-center justify-between px-5 py-2.5">
              <span className="text-xs text-neutral-500">{key}</span>
              <span className="text-sm">{value}</span>
            </div>
          ))}
      </div>
    </div>
  );
}
