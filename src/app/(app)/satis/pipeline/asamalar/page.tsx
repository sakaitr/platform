import Link from "next/link";
import { count, eq } from "drizzle-orm";
import { Card, PageHeader } from "@/components/ui";
import { EntityForm } from "@/components/ui/entity-form";
import { crmDeals } from "@/db/schema";
import { withTenant } from "@/db/tenant";
import { pageContext } from "@/lib/page-context";
import { saveStageAction } from "@/modules/satis/pipeline-actions";
import { listStages } from "@/modules/satis/pipeline-queries";
import { StageRow } from "./stage-row";

export default async function AsamalarPage() {
  const { session } = await pageContext("satis_asama:update", "satis");
  const stages = await listStages(session.tenantId);
  const counts = await withTenant(session.tenantId, (tx) =>
    tx
      .select({ stageId: crmDeals.stageId, n: count() })
      .from(crmDeals)
      .where(eq(crmDeals.tenantId, session.tenantId))
      .groupBy(crmDeals.stageId),
  );
  const dealCount = new Map(counts.map((c) => [c.stageId, c.n]));

  return (
    <div className="space-y-4">
      <PageHeader
        title="Pipeline aşamaları"
        description="Fırsatlar bu aşamalardan geçer. En az bir açık, bir kazanıldı ve bir kaybedildi aşaması kalmalı."
        action={
          <div className="flex flex-wrap items-start gap-2">
            <Link href="/satis/pipeline" className="rounded-lg border border-neutral-300 px-3 py-1.5 text-xs hover:bg-neutral-50">
              Pipeline'a dön
            </Link>
            <EntityForm
              action={saveStageAction}
              fields={[
                { name: "label", label: "Aşama adı", type: "text", required: true },
                {
                  name: "kind",
                  label: "Tür",
                  type: "select",
                  options: [
                    { value: "open", label: "Açık" },
                    { value: "won", label: "Kazanıldı" },
                    { value: "lost", label: "Kaybedildi" },
                  ],
                },
              ]}
              values={{ kind: "open" }}
              openLabel="Yeni aşama"
            />
          </div>
        }
      />
      <Card className="p-3 text-xs text-neutral-500">
        Fırsatı olan aşamanın türü değişmez; silerken fırsatlar aynı türdeki başka bir aşamaya taşınır.
      </Card>
      <ul className="space-y-2">
        {stages.map((stage, index) => (
          <StageRow
            key={stage.id}
            stage={{ id: stage.id, label: stage.label, kind: stage.kind, color: stage.color, deals: dealCount.get(stage.id) ?? 0 }}
            sameKind={stages.filter((s) => s.kind === stage.kind && s.id !== stage.id).map((s) => ({ id: s.id, label: s.label }))}
            first={index === 0}
            last={index === stages.length - 1}
          />
        ))}
      </ul>
    </div>
  );
}
