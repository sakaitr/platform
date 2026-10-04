import { redirect } from "next/navigation";
import { Card, PageHeader } from "@/components/ui";
import { pageContext } from "@/lib/page-context";

export default async function Page() {
  const { can } = await pageContext("satis_teklif:read", "satis");
  if (!can("satis.teklif")) redirect("/dashboard");
  return (
    <div className="space-y-4">
      <PageHeader title={"Teklifler"} />
      <Card className="p-6 text-sm text-neutral-500">Fırsatlara bağlı teklifler burada listelenir.</Card>
    </div>
  );
}
