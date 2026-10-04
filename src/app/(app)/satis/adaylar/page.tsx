import { Card, PageHeader } from "@/components/ui";
import { pageContext } from "@/lib/page-context";

export default async function Page() {
  const { t } = await pageContext("satis_aday:read", "satis");
  return (
    <div className="space-y-4">
      <PageHeader title={t("lead_plural")} />
      <Card className="p-6 text-sm text-neutral-500">Atricard, form, CSV ya da elle gelen adaylar burada listelenir.</Card>
    </div>
  );
}
