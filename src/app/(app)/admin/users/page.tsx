import { requirePermission } from "@/lib/auth";
import { listRolesWithCounts } from "@/lib/rbac";
import { assignRoleAction } from "@/modules/admin/actions";
import { listUsersWithRoles } from "@/modules/admin/queries";

export default async function AdminUsersPage() {
  const session = await requirePermission("users:read");
  const [rows, roleList] = await Promise.all([
    listUsersWithRoles(session.tenantId),
    listRolesWithCounts(session.tenantId),
  ]);
  const canAssign = session.permissions.has("roles:assign");

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-xl font-semibold">Kullanıcılar</h1>
        <p className="text-sm text-neutral-500">
          Rol değiştirildiğinde kullanıcının açık oturumları kapatılır.
        </p>
      </div>

      <div className="divide-y divide-neutral-200 rounded-xl border border-neutral-200 bg-white">
        {rows.map((user) => (
          <div key={user.id} className="flex items-center justify-between gap-4 px-5 py-3">
            <div className="min-w-0">
              <p className="truncate text-sm font-medium">{user.name}</p>
              <p className="truncate text-xs text-neutral-500">{user.email}</p>
            </div>

            {canAssign ? (
              <form action={assignRoleAction} className="flex items-center gap-2">
                <input type="hidden" name="userId" value={user.id} />
                <select
                  name="roleId"
                  defaultValue={user.roleId ?? ""}
                  className="rounded-lg border border-neutral-300 px-2 py-1.5 text-xs"
                >
                  <option value="" disabled>
                    Rol seçin
                  </option>
                  {roleList.map((role) => (
                    <option key={role.id} value={role.id}>
                      {role.label}
                    </option>
                  ))}
                </select>
                <button
                  type="submit"
                  className="rounded-lg border border-neutral-300 px-3 py-1.5 text-xs hover:bg-neutral-50"
                >
                  Ata
                </button>
              </form>
            ) : (
              <span className="text-xs text-neutral-600">{user.roleLabel ?? "rol atanmamış"}</span>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
