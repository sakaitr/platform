import { Card, PageHeader } from "@/components/ui";
import { pageContext } from "@/lib/page-context";

export default async function Page() {
  await pageContext("satis_aktivite:read", "satis");
  return (
    <div className="space-y-4">
      <PageHeader title={"Görevler"} />
      <Card className="p-6 text-sm text-neutral-500">Bugün aranacaklar ve geciken görevler burada görünür.</Card>
    </div>
  );
}
