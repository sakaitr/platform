import { NextResponse, type NextRequest } from "next/server";
import { requireAuth } from "@/lib/auth";
import { getTenantAccess } from "@/lib/licensing";
import { ensureReportsRegistered, REPORT_CATALOG, runReport } from "@/lib/reports/engine";
import { buildCsv, buildXlsx, contentDisposition } from "@/lib/reports/export";

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ key: string }> },
): Promise<NextResponse> {
  const session = await requireAuth();
  await ensureReportsRegistered();

  const { key } = await params;
  const def = REPORT_CATALOG[key];
  if (!def) return NextResponse.json({ error: "Rapor bulunamadı." }, { status: 404 });
  if (!session.permissions.has(def.permission)) {
    return NextResponse.json({ error: "Bu rapor için yetkiniz yok." }, { status: 403 });
  }

  if (def.module) {
    const access = await getTenantAccess(session.tenantId);
    if (access.modules.get(def.module)?.allowed !== true) {
      return NextResponse.json({ error: "Bu rapor lisansınıza dahil değil." }, { status: 403 });
    }
  }

  const url = request.nextUrl;
  const result = await runReport(key, {
    tenantId: session.tenantId,
    from: url.searchParams.get("from") ?? undefined,
    to: url.searchParams.get("to") ?? undefined,
  });

  const format = url.searchParams.get("format") ?? "csv";
  if (format === "xlsx") {
    const buffer = await buildXlsx(def.name, result);
    return new NextResponse(new Uint8Array(buffer), {
      headers: {
        "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        "Content-Disposition": contentDisposition(def.name, "xlsx"),
      },
    });
  }

  return new NextResponse(buildCsv(result), {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": contentDisposition(def.name, "csv"),
    },
  });
}
