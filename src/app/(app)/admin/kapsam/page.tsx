import { requirePermission } from "@/lib/auth";
import { getUserScope } from "@/lib/scope";
import { setUserScopeAction } from "@/modules/admin/actions";
import { listUsersWithRoles } from "@/modules/admin/queries";

export default async function AdminScopePage() {
  const session = await requirePermission("scopes:read");
  const rows = await listUsersWithRoles(session.tenantId);

  const withScope = await Promise.all(
    rows.map(async (user) => ({
      ...user,
      scope: await getUserScope(session.tenantId, user.id),
    })),
  );

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-xl font-semibold">Firma Kapsamı</h1>
        <p className="text-sm text-neutral-500">
          Boş bırakılan kullanıcı kiracının tamamını görür. Virgülle ayırarak birden fazla firma
          kimliği girebilirsiniz.
        </p>
      </div>

      <div className="divide-y divide-neutral-200 rounded-xl border border-neutral-200 bg-white">
        {withScope.map((user) => (
          <form
            key={user.id}
            action={setUserScopeAction}
            className="flex items-center justify-between gap-4 px-5 py-3"
          >
            <div className="min-w-0">
              <p className="truncate text-sm font-medium">{user.name}</p>
              <p className="truncate text-xs text-neutral-500">
                {user.scope === null ? "kısıtlama yok" : `${user.scope.length} firma`}
              </p>
            </div>
            <input type="hidden" name="userId" value={user.id} />
            <input
              name="companyIds"
              defaultValue={user.scope?.join(",") ?? ""}
              placeholder="firma kimlikleri (virgülle)"
              className="w-72 rounded-lg border border-neutral-300 px-2 py-1.5 text-xs"
            />
            <button
              type="submit"
              className="rounded-lg border border-neutral-300 px-3 py-1.5 text-xs hover:bg-neutral-50"
            >
              Kaydet
            </button>
          </form>
        ))}
      </div>
    </div>
  );
}
