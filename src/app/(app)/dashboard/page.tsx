import Link from "next/link";
import { Card } from "@/components/ui";
import { requireAuth } from "@/lib/auth";
import { getTenantAccess } from "@/lib/licensing";
import { buildNavigation } from "@/lib/modules/registry";
import { getPack } from "@/lib/sector/install";
import { dashboardTiles } from "@/modules/dashboard/queries";

export default async function DashboardPage() {
  const session = await requireAuth();
  const access = await getTenantAccess(session.tenantId);
  const pack = getPack(access.tenant.sectorPack);

  const modules = buildNavigation({ ...access, permissions: session.permissions }).filter(
    (m) => m.key !== "dashboard",
  );
  const allowed = new Set(modules.map((m) => m.key));
  const tiles = await dashboardTiles(
    session.tenantId,
    session.permissions,
    allowed,
    access.capabilities,
  );

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">Merhaba, {session.name}</h1>
        <p className="text-sm text-neutral-500">
          {pack.name} ·{" "}
          {new Date().toLocaleDateString("tr-TR", { day: "numeric", month: "long", year: "numeric" })}
        </p>
      </div>

      {tiles.length > 0 ? (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          {tiles.map((tile) => (
            <Link key={tile.label} href={tile.href}>
              <Card
                className={`p-5 transition hover:border-neutral-400 ${
                  tile.alert ? "border-amber-300 bg-amber-50" : ""
                }`}
              >
                <p className="text-xs uppercase tracking-wide text-neutral-500">{tile.label}</p>
                <p
                  className={`mt-1 text-2xl font-semibold ${tile.alert ? "text-amber-800" : ""}`}
                >
                  {tile.value}
                </p>
              </Card>
            </Link>
          ))}
        </div>
      ) : null}

      <div>
        <h2 className="mb-3 text-sm font-medium text-neutral-600">Modüller</h2>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {modules.map((module) => (
            <Link key={module.key} href={module.href}>
              <Card className="p-5 transition hover:border-neutral-400">
                <p className="font-medium">{module.label}</p>
                {module.children && module.children.length > 0 ? (
                  <p className="mt-1 text-xs text-neutral-500">
                    {module.children.map((c) => c.label).join(" · ")}
                  </p>
                ) : (
                  <p className="mt-1 text-sm text-neutral-500">Modüle git</p>
                )}
              </Card>
            </Link>
          ))}
          {modules.length === 0 ? (
            <p className="text-sm text-neutral-500">Henüz size açılmış bir modül yok.</p>
          ) : null}
        </div>
      </div>
    </div>
  );
}
