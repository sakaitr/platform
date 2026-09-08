import { NextResponse, type NextRequest } from "next/server";
import { requireAuth } from "@/lib/auth";
import { contentDisposition } from "@/lib/reports/export";
import { readStoredFile } from "@/lib/storage";

/**
 * Dosya servisi. Dosyalar diskten doğrudan sunulmaz: her istek oturumdan
 * geçer ve yalnız kendi kiracısının dosyasını okuyabilir. Yol tahmin
 * edilerek başkasının dosyasına erişilemez.
 */
export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  const session = await requireAuth();
  const { id } = await params;

  const file = await readStoredFile(session.tenantId, id);
  if (!file) return NextResponse.json({ error: "Dosya bulunamadı." }, { status: 404 });

  return new NextResponse(new Uint8Array(file.body), {
    headers: {
      "Content-Type": file.mimeType,
      "Content-Disposition": contentDisposition(file.name, "", "inline"),
      // Kiracıya özel içerik: ara belleklerde tutulmamalı.
      "Cache-Control": "private, max-age=3600",
    },
  });
}
