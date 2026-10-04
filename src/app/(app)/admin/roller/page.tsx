import { requirePermission } from "@/lib/auth";
import { getRolePermissions, listRolesWithCounts } from "@/lib/rbac";

export default async function AdminRolesPage() {
  const session = await requirePermission("roles:read");
  const roleList = await listRolesWithCounts(session.tenantId);

  const withPermissions = await Promise.all(
    roleList.map(async (role) => ({
      ...role,
      permissions: [...(await getRolePermissions(session.tenantId, role.id))].sort(),
    })),
  );

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-xl font-semibold">Roller</h1>
        <p className="text-sm text-neutral-500">
          Sektör paketinizle gelen roller ve izinleri. Sistem rolleri değiştirilemez.
        </p>
      </div>

      <div className="space-y-3">
        {withPermissions.map((role) => (
          <div key={role.id} className="rounded-xl border border-neutral-200 bg-white p-5">
            <div className="flex items-center justify-between">
              <div>
                <div className="flex items-center gap-2">
                  <p className="font-medium">{role.label}</p>
                  {role.isSystem ? (
                    <span className="rounded bg-neutral-100 px-2 py-0.5 text-xs text-neutral-600">
                      sistem
                    </span>
                  ) : null}
                </div>
                <p className="text-xs text-neutral-500">
                  {role.key} · seviye {role.hierarchyLevel}
                </p>
              </div>
              <span className="text-sm text-neutral-600">{role.permissionCount} izin</span>
            </div>

            <div className="mt-3 flex flex-wrap gap-1">
              {role.permissions.slice(0, 24).map((p) => (
                <span key={p} className="rounded bg-neutral-100 px-2 py-0.5 text-xs text-neutral-700">
                  {p}
                </span>
              ))}
              {role.permissions.length > 24 ? (
                <span className="px-2 py-0.5 text-xs text-neutral-500">
                  +{role.permissions.length - 24} daha
                </span>
              ) : null}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
