import { NextResponse, type NextRequest } from "next/server";
import { requireAuth } from "@/lib/auth";
import { writeAuditLog } from "@/lib/audit";
import { getTenantAccess } from "@/lib/licensing";
import { formatDate } from "@/lib/time";
import { buildCsvText } from "@/modules/satis/csv";
import { SOURCE_LABEL, STATUS_LABEL, TEMPERATURE_LABEL } from "@/modules/satis/labels";
import { listLeadsForExport } from "@/modules/satis/queries";

export async function GET(request: NextRequest): Promise<NextResponse> {
  const session = await requireAuth();
  if (!session.permissions.has("satis_aday:export")) {
    return NextResponse.json({ error: "Dışa aktarma yetkiniz yok." }, { status: 403 });
  }
  const access = await getTenantAccess(session.tenantId);
  if (access.modules.get("satis")?.allowed !== true) {
    return NextResponse.json({ error: "Satış CRM lisansınız bu işlemi içermiyor." }, { status: 403 });
  }

  const q = request.nextUrl.searchParams;
  const rows = await listLeadsForExport(session, {
    q: q.get("q") ?? undefined,
    status: q.get("durum") ?? undefined,
    temperature: q.get("sicaklik") ?? undefined,
    source: q.get("kaynak") ?? undefined,
    owner: q.get("sahip") ?? undefined,
  });

  const day = (value: Date | null): string => (value ? formatDate(value) : "");
  const csv = buildCsvText(
    ["Ad", "Yetkili", "Telefon", "E-posta", "Web sitesi", "Şehir", "Sektör", "Hizmet", "Durum", "Sıcaklık", "Puan", "Kaynak", "Fuar", "Sahip", "Tahmini değer", "Takip", "Mesaj", "Not", "Eklenme"],
    rows.map((r) => [
      r.name, r.contactName, r.phone, r.email, r.website, r.city, r.sector, r.service,
      STATUS_LABEL[r.status], r.temperature ? TEMPERATURE_LABEL[r.temperature] : "", r.score,
      SOURCE_LABEL[r.source], r.eventName, r.ownerName ?? "", r.estimatedValue,
      day(r.followUpAt), r.message, r.note, day(r.createdAt),
    ]),
  );

  await writeAuditLog({
    tenantId: session.tenantId,
    userId: session.userId,
    event: "lead.exported",
    entityType: "crm_lead",
    metadata: { count: rows.length },
  });

  return new NextResponse(csv, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": 'attachment; filename="adaylar.csv"',
      "Cache-Control": "no-store",
    },
  });
}
