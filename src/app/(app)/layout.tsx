import { redirect } from "next/navigation";
import { GraceBanner } from "@/components/layout/grace-banner";
import { Sidebar, type NavItem } from "@/components/layout/sidebar";
import { Topbar } from "@/components/layout/topbar";
import { requireAuth } from "@/lib/auth";
import { getTenantAccess } from "@/lib/licensing";
import { buildNavigation, visibleChildren } from "@/lib/modules/registry";
import { getPack } from "@/lib/sector/install";
import { getTerms } from "@/lib/sector/terminology";
import { isOperator } from "@/lib/operator";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const session = await requireAuth();
  const access = await getTenantAccess(session.tenantId);

  if (access.state === "locked") redirect("/kilitli");

  const pack = getPack(access.tenant.sectorPack);
  const terms = await getTerms(session.tenantId, pack.terminology);

  const items: NavItem[] = buildNavigation({ ...access, permissions: session.permissions }).map((module) => {
    const termKey = `module.${module.key}`;
    const translated = terms.t(termKey);
    return {
      key: module.key,
      label: translated === termKey ? module.label : translated,
      icon: module.icon,
      href: module.href,
      children: visibleChildren(module, access, session.permissions).map((c) => ({ label: c.label, href: c.href })),
    };
  });

  // Operatör bağlantısı kiracı modülü değil — kiracının rolleri bunu veremez.
  if (isOperator(session.email)) {
    items.push({
      key: "operator",
      label: "Operatör",
      icon: "ShieldCheck",
      href: "/operator",
      children: [],
    });
  }

  return (
    <div className="flex h-screen print:block print:h-auto">
      <Sidebar items={items} tenantName={access.tenant.name} />
      <div className="flex min-w-0 flex-1 flex-col">
        <Topbar name={session.name} email={session.email} />
        {access.state === "grace" ? (
          <GraceBanner periodEnd={access.subscription.currentPeriodEnd} />
        ) : null}
        <main className="flex-1 overflow-y-auto p-6 print:overflow-visible print:p-0">{children}</main>
      </div>
    </div>
  );
}
