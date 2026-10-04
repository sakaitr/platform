import { redirect } from "next/navigation";
import { getCurrentPortalSession } from "@/lib/portal/guards";
import { PortalLoginForm } from "./login-form";

export default async function PortalGirisPage() {
  const session = await getCurrentPortalSession();
  if (session) redirect("/portal");

  return (
    <div className="mx-auto max-w-sm py-10">
      <h1 className="text-lg font-semibold">Müşteri Girişi</h1>
      <p className="mb-5 text-sm text-neutral-500">
        Firmanıza ait servis bilgilerini ve taleplerinizi görmek için giriş yapın.
      </p>
      <PortalLoginForm />
    </div>
  );
}
