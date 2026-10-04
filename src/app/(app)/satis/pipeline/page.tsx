import { Card, PageHeader } from "@/components/ui";
import { pageContext } from "@/lib/page-context";

export default async function Page() {
  await pageContext("satis_firsat:read", "satis");
  return (
    <div className="space-y-4">
      <PageHeader title={"Pipeline"} />
      <Card className="p-6 text-sm text-neutral-500">Fırsatlar aşamalara göre burada görünür.</Card>
    </div>
  );
}
