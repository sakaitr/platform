import { Card, PageHeader } from "@/components/ui";
import { pageContext } from "@/lib/page-context";

export default async function Page() {
  await pageContext("satis_sablon:read", "satis");
  return (
    <div className="space-y-4">
      <PageHeader title={"Şablonlar"} />
      <Card className="p-6 text-sm text-neutral-500">WhatsApp ve e-posta mesaj şablonları burada yönetilir.</Card>
    </div>
  );
}
