import Link from "next/link";
import { Card, PageHeader } from "@/components/ui";
import { pageContext } from "@/lib/page-context";
import { ImportForm } from "./import-form";

export default async function IceAktarPage() {
  await pageContext("satis_aday:import", "satis");
  return (
    <div className="space-y-4">
      <PageHeader
        title="CSV ile aday içe aktar"
        description="Aynı telefon, e-posta, web sitesi ya da ad ve şehir zaten kayıtlıysa o satır atlanır."
        action={
          <Link href="/satis/adaylar" className="rounded-lg border border-neutral-300 px-3 py-1.5 text-xs hover:bg-neutral-50">
            Listeye dön
          </Link>
        }
      />
      <Card className="space-y-2 p-4 text-sm text-neutral-600">
        <p>İlk satır başlık olmalı. Tanınan başlıklar:</p>
        <p className="text-xs">
          Ad (ya da Firma), Yetkili, Telefon, E-posta, Web sitesi, Şehir, Sektör, Mesaj, Hizmet, Not, Tahmini değer, Sıcaklık (Sıcak, Ilık, Soğuk).
        </p>
        <p className="text-xs">Ayraç virgül ya da noktalı virgül olabilir. En fazla 5.000 satır ve 2 MB.</p>
      </Card>
      <ImportForm />
    </div>
  );
}
