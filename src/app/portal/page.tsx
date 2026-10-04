import Link from "next/link";
import { Card } from "@/components/ui";
import { requirePortal } from "@/lib/portal/guards";
import { istanbulDayKey, shiftDay } from "@/lib/time";
import { portalArrivals, portalTickets } from "@/modules/portal/queries";

export default async function PortalOzetPage() {
  const session = await requirePortal();
  const today = istanbulDayKey();

  const [tickets, arrivals] = await Promise.all([
    portalTickets(session),
    portalArrivals(session, shiftDay(today, -7)),
  ]);

  const openTickets = tickets.filter((t) => t.status !== "kapandi" && t.status !== "cozuldu").length;
  const todayArrivals = arrivals.filter((a) => a.arrivalDate === today).length;

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-xl font-semibold">Merhaba {session.fullName}</h1>
        <p className="text-sm text-neutral-500">{session.companyNames.join(", ")}</p>
      </div>

      <div className="grid gap-3 sm:grid-cols-3">
        <Link href="/portal/gelisler">
          <Card className="p-5 transition hover:border-neutral-400">
            <p className="text-xs uppercase tracking-wide text-neutral-500">Bugünkü geliş</p>
            <p className="mt-1 text-3xl font-semibold">{todayArrivals}</p>
          </Card>
        </Link>
        <Link href="/portal/gelisler">
          <Card className="p-5 transition hover:border-neutral-400">
            <p className="text-xs uppercase tracking-wide text-neutral-500">Son 7 gün</p>
            <p className="mt-1 text-3xl font-semibold">{arrivals.length}</p>
          </Card>
        </Link>
        <Link href="/portal/talepler">
          <Card className="p-5 transition hover:border-neutral-400">
            <p className="text-xs uppercase tracking-wide text-neutral-500">Açık talep</p>
            <p className="mt-1 text-3xl font-semibold">{openTickets}</p>
          </Card>
        </Link>
      </div>
    </div>
  );
}
