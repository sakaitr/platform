"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import * as Icons from "lucide-react";
import { cn } from "@/lib/utils";

export type NavItem = {
  key: string;
  label: string;
  icon: string;
  href: string;
  children: { label: string; href: string }[];
};

function Icon({ name }: { name: string }) {
  const Component = (Icons as unknown as Record<string, React.ElementType>)[name] ?? Icons.Circle;
  return <Component className="h-4 w-4" />;
}

export function Sidebar({ items, tenantName }: { items: NavItem[]; tenantName: string }) {
  const pathname = usePathname();

  return (
    <aside className="flex w-60 shrink-0 flex-col border-r border-neutral-200 bg-white">
      <div className="border-b border-neutral-200 px-5 py-4">
        <p className="text-sm font-semibold">Agno Platform</p>
        <p className="truncate text-xs text-neutral-500">{tenantName}</p>
      </div>
      <nav className="flex-1 space-y-1 overflow-y-auto p-3">
        {items.map((item) => (
          <div key={item.key}>
            <Link
              href={item.href}
              className={cn(
                "flex items-center gap-2 rounded-lg px-3 py-2 text-sm text-neutral-700 hover:bg-neutral-100",
                pathname === item.href && "bg-neutral-900 text-white hover:bg-neutral-900",
              )}
            >
              <Icon name={item.icon} />
              {item.label}
            </Link>
            {item.children.length > 0 ? (
              <div className="ml-4 mt-1 space-y-0.5 border-l border-neutral-200 pl-3">
                {item.children.map((child) => (
                  <Link
                    key={child.href}
                    href={child.href}
                    className={cn(
                      "block rounded-md px-2 py-1.5 text-xs text-neutral-600 hover:bg-neutral-100",
                      pathname === child.href && "font-medium text-neutral-900",
                    )}
                  >
                    {child.label}
                  </Link>
                ))}
              </div>
            ) : null}
          </div>
        ))}
      </nav>
    </aside>
  );
}
