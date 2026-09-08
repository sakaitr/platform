import Link from "next/link";
import { getCurrentPortalSession } from "@/lib/portal/guards";
import { portalLogoutAction } from "./actions";

/** Portal kabuğu — personel kabuğundan ayrı, sade ve dışa dönük. */
export default async function PortalLayout({ children }: { children: React.ReactNode }) {
  const session = await getCurrentPortalSession();

  return (
    <div className="min-h-screen bg-neutral-50">
      <header className="border-b border-neutral-200 bg-white">
        <div className="mx-auto flex max-w-5xl items-center justify-between gap-4 px-5 py-3">
          <Link href="/portal" className="text-sm font-semibold">
            Müşteri Portalı
          </Link>

          {session ? (
            <nav className="flex items-center gap-4 text-sm">
              <Link href="/portal" className="text-neutral-600 hover:text-neutral-900">
                Özet
              </Link>
              <Link href="/portal/talepler" className="text-neutral-600 hover:text-neutral-900">
                Talepler
              </Link>
              <Link href="/portal/gelisler" className="text-neutral-600 hover:text-neutral-900">
                Servis Gelişleri
              </Link>
              <span className="text-xs text-neutral-400">{session.fullName}</span>
              <form action={portalLogoutAction}>
                <button type="submit" className="text-xs text-neutral-500 hover:underline">
                  Çıkış
                </button>
              </form>
            </nav>
          ) : null}
        </div>
      </header>

      <main className="mx-auto max-w-5xl px-5 py-6">{children}</main>
    </div>
  );
}
