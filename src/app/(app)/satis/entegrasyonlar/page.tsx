import { redirect } from "next/navigation";
import { Card, PageHeader } from "@/components/ui";
import { pageContext } from "@/lib/page-context";

export default async function Page() {
  const { can } = await pageContext("satis_entegrasyon:read", "satis");
  if (!can("satis.entegrasyon")) redirect("/dashboard");
  return (
    <div className="space-y-4">
      <PageHeader title={"Entegrasyonlar"} />
      <Card className="p-6 text-sm text-neutral-500">Atricard bağlantısı ve giden webhook'lar burada yönetilir.</Card>
    </div>
  );
}
