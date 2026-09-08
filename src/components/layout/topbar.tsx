"use client";

import { useRouter } from "next/navigation";

export function Topbar({ name, email }: { name: string; email: string }) {
  const router = useRouter();

  async function handleLogout(): Promise<void> {
    await fetch("/api/auth/logout", { method: "POST" });
    router.push("/login");
  }

  return (
    <header className="flex h-14 shrink-0 items-center justify-between border-b border-neutral-200 bg-white px-6">
      <div />
      <div className="flex items-center gap-3">
        <div className="text-right">
          <p className="text-sm font-medium leading-tight">{name}</p>
          <p className="text-xs leading-tight text-neutral-500">{email}</p>
        </div>
        <button
          onClick={handleLogout}
          className="rounded-lg border border-neutral-300 px-3 py-1.5 text-xs hover:bg-neutral-50"
        >
          Çıkış
        </button>
      </div>
    </header>
  );
}
