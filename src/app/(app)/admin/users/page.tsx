import { requirePermission } from "@/lib/auth";
import { listUsers } from "@/modules/admin/queries";

const ROLE_LABELS: Record<string, string> = {
  owner: "Sahip",
  admin: "Yönetici",
  manager: "Müdür",
  member: "Üye",
  viewer: "İzleyici",
};

export default async function AdminUsersPage() {
  const session = await requirePermission("users.manage");
  const rows = await listUsers(session.tenantId);

  return (
    <div className="space-y-4">
      <h1 className="text-xl font-semibold">Kullanıcılar</h1>
      <div className="divide-y divide-neutral-200 rounded-xl border border-neutral-200 bg-white">
        {rows.map((user) => (
          <div key={user.id} className="flex items-center justify-between px-5 py-3">
            <div>
              <p className="text-sm font-medium">{user.name}</p>
              <p className="text-xs text-neutral-500">{user.email}</p>
            </div>
            <span className="text-xs text-neutral-600">{ROLE_LABELS[user.role] ?? user.role}</span>
          </div>
        ))}
      </div>
    </div>
  );
}
