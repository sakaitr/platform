import Link from "next/link";
import { requireAuth } from "@/lib/auth";
import { getTenantAccess } from "@/lib/licensing";
import { buildNavigation } from "@/lib/modules/registry";
import { getPack } from "@/lib/sector/install";

export default async function DashboardPage() {
  const session = await requireAuth();
  const access = await getTenantAccess(session.tenantId);
  const pack = getPack(access.tenant.sectorPack);
  const modules = buildNavigation({ ...access, permissions: session.permissions }).filter((m) => m.key !== "dashboard");

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">Merhaba, {session.name}</h1>
        <p className="text-sm text-neutral-500">
          {pack.name} ·{" "}
          {new Date().toLocaleDateString("tr-TR", { day: "numeric", month: "long", year: "numeric" })}
        </p>
      </div>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {modules.map((module) => (
          <Link
            key={module.key}
            href={module.href}
            className="rounded-xl border border-neutral-200 bg-white p-5 hover:border-neutral-400"
          >
            <p className="font-medium">{module.label}</p>
            <p className="mt-1 text-sm text-neutral-500">Modüle git</p>
          </Link>
        ))}
        {modules.length === 0 ? (
          <p className="text-sm text-neutral-500">Henüz size açılmış bir modül yok.</p>
        ) : null}
      </div>
    </div>
  );
}
