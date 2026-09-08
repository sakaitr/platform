import { requireAuth } from "@/lib/auth";
import { getTenantAccess } from "@/lib/licensing";

export default async function LockedPage() {
  const session = await requireAuth();
  const access = await getTenantAccess(session.tenantId);

  return (
    <main className="flex min-h-screen items-center justify-center px-4">
      <div className="max-w-md space-y-3 rounded-2xl border border-neutral-200 bg-white p-8 text-center">
        <h1 className="text-lg font-semibold">Erişiminiz kısıtlandı</h1>
        <p className="text-sm text-neutral-600">
          {access.tenant.name} için abonelik süresi sona erdi. Verileriniz korunuyor; aboneliğiniz
          yenilendiğinde her şey olduğu gibi geri gelecek.
        </p>
        <p className="text-sm text-neutral-500">Lütfen bizimle iletişime geçin.</p>
        <form action="/api/auth/logout" method="POST">
          <button type="submit" className="mt-2 rounded-lg border border-neutral-300 px-4 py-2 text-sm">
            Çıkış yap
          </button>
        </form>
      </div>
    </main>
  );
}
