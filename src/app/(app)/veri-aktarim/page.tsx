import { Badge, Button, EmptyRow, PageHeader, Table, Td } from "@/components/ui";
import { pageContext } from "@/lib/page-context";
import { ensureImportTargetsRegistered, listImportTargets } from "@/lib/import/targets";
import { formatDateTime } from "@/lib/time";
import { applyImportAction, rollbackImportAction } from "@/modules/imports/actions";
import { listImportJobs } from "@/modules/imports/queries";
import { UploadForm } from "./upload-form";

const STATUS_LABEL: Record<string, string> = {
  draft: "Taslak",
  validated: "Doğrulandı",
  applied: "Uygulandı",
  rolled_back: "Geri alındı",
  failed: "Hatalı",
};

const STATUS_TONE: Record<string, string> = {
  validated: "info",
  applied: "ok",
  rolled_back: "mute",
  failed: "bad",
};

export default async function VeriAktarimPage() {
  const { session } = await pageContext("imports:read");
  await ensureImportTargetsRegistered();

  const targets = listImportTargets(session.permissions);
  const jobs = await listImportJobs(session.tenantId);

  const canUpload = session.permissions.has("imports:create") && targets.length > 0;
  const canApply = session.permissions.has("imports:execute");
  const canRollback = session.permissions.has("imports:rollback");
  const targetLabel = new Map(targets.map((t) => [t.key, t.label]));

  return (
    <div className="space-y-4">
      <PageHeader
        title="Veri Aktarımı"
        description="Dosya yüklenir, doğrulanır, önizlenir; uygulamadan hiçbir kayıt oluşmaz. Uygulanan iş geri alınabilir."
      />

      {canUpload ? (
        <UploadForm targets={targets} />
      ) : (
        <p className="text-sm text-neutral-500">Aktarım yetkiniz yok.</p>
      )}

      <Table head={["Dosya", "Hedef", "Satır", "Geçerli", "Hatalı", "Durum", "Zaman", ""]}>
        {jobs.length === 0 ? (
          <EmptyRow colSpan={8} text="Henüz aktarım yapılmadı." />
        ) : (
          jobs.map((job) => (
            <tr key={job.id} className="hover:bg-neutral-50">
              <Td className="font-medium">{job.fileName}</Td>
              <Td className="text-neutral-500">{targetLabel.get(job.targetKey) ?? job.targetKey}</Td>
              <Td>{job.totalRows}</Td>
              <Td className="text-emerald-700">{job.validRows}</Td>
              <Td className={job.errorRows > 0 ? "text-red-600" : "text-neutral-400"}>{job.errorRows}</Td>
              <Td>
                <Badge tone={STATUS_TONE[job.status]}>{STATUS_LABEL[job.status] ?? job.status}</Badge>
              </Td>
              <Td className="text-neutral-500">{formatDateTime(job.createdAt)}</Td>
              <Td>
                <div className="flex justify-end gap-2">
                  {job.status === "validated" && canApply && job.validRows > 0 ? (
                    <form action={applyImportAction}>
                      <input type="hidden" name="jobId" value={job.id} />
                      <Button type="submit">Uygula ({job.validRows})</Button>
                    </form>
                  ) : null}
                  {job.status === "applied" && canRollback ? (
                    <form action={rollbackImportAction}>
                      <input type="hidden" name="jobId" value={job.id} />
                      <Button type="submit" variant="danger">
                        Geri Al
                      </Button>
                    </form>
                  ) : null}
                </div>
              </Td>
            </tr>
          ))
        )}
      </Table>
    </div>
  );
}
