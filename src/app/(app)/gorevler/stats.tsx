import { Badge, Card, EmptyRow, Table, Td } from "@/components/ui";
import type { TaskStats } from "@/modules/isbirligi/queries";

const STATUS_LABEL: Record<string, string> = {
  yapilacak: "Yapılacak",
  yapiliyor: "Yapılıyor",
  bekliyor: "Beklemede",
  bitti: "Bitti",
};

const PRIORITY_LABEL: Record<string, string> = {
  dusuk: "Düşük",
  normal: "Orta",
  yuksek: "Yüksek",
  kritik: "Kritik",
};

const PRIORITY_TONE: Record<string, string> = {
  dusuk: "mute",
  normal: "info",
  yuksek: "warn",
  kritik: "bad",
};

/** Yatay oranlı çubuk — grafik kütüphanesi gerektirmez. */
function Bar({ label, value, total, tone }: { label: string; value: number; total: number; tone?: string }) {
  const percent = total === 0 ? 0 : Math.round((value / total) * 100);
  return (
    <div className="space-y-1">
      <div className="flex items-center justify-between text-xs">
        <span className="text-neutral-600">{label}</span>
        <span className="text-neutral-500">
          {value} · %{percent}
        </span>
      </div>
      <div className="h-2 overflow-hidden rounded-full bg-neutral-100">
        <div
          className={`h-full rounded-full ${
            tone === "bad" ? "bg-red-500" : tone === "warn" ? "bg-amber-500" : tone === "ok" ? "bg-emerald-500" : "bg-neutral-800"
          }`}
          style={{ width: `${percent}%` }}
        />
      </div>
    </div>
  );
}

export function TaskStatsPanel({ stats }: { stats: TaskStats }) {
  const durumToplam = stats.durum.reduce((sum, d) => sum + d.adet, 0);
  const oncelikToplam = stats.oncelik.reduce((sum, o) => sum + o.adet, 0);
  const trendMax = Math.max(1, ...stats.aylik.map((a) => Math.max(a.olusturulan, a.cozulen)));

  return (
    <div className="space-y-4">
      <div className="grid gap-3 sm:grid-cols-3">
        <Card className="p-4">
          <p className="mb-3 text-xs uppercase tracking-wide text-neutral-500">Durum Dağılımı</p>
          <div className="space-y-2">
            {stats.durum.length === 0 ? (
              <p className="text-sm text-neutral-500">Veri yok</p>
            ) : (
              stats.durum.map((d) => (
                <Bar
                  key={d.durum}
                  label={STATUS_LABEL[d.durum] ?? d.durum}
                  value={d.adet}
                  total={durumToplam}
                  tone={d.durum === "bitti" ? "ok" : undefined}
                />
              ))
            )}
          </div>
        </Card>

        <Card className="p-4">
          <p className="mb-3 text-xs uppercase tracking-wide text-neutral-500">Öncelik Dağılımı</p>
          <div className="space-y-2">
            {stats.oncelik.length === 0 ? (
              <p className="text-sm text-neutral-500">Veri yok</p>
            ) : (
              stats.oncelik.map((o) => (
                <Bar
                  key={o.oncelik}
                  label={PRIORITY_LABEL[o.oncelik] ?? o.oncelik}
                  value={o.adet}
                  total={oncelikToplam}
                  tone={PRIORITY_TONE[o.oncelik]}
                />
              ))
            )}
          </div>
        </Card>

        <Card className="p-4">
          <p className="mb-3 text-xs uppercase tracking-wide text-neutral-500">Çözüm Süresi</p>
          <div className="space-y-2 text-sm">
            <div className="flex justify-between">
              <span className="text-neutral-600">Ortalama</span>
              <span className="font-medium">{stats.sure.ortalamaGun} gün</span>
            </div>
            <div className="flex justify-between">
              <span className="text-neutral-600">En hızlı</span>
              <span className="font-medium">{stats.sure.enHizliGun} gün</span>
            </div>
            <div className="flex justify-between">
              <span className="text-neutral-600">En uzun</span>
              <span className="font-medium">{stats.sure.enUzunGun} gün</span>
            </div>
          </div>
        </Card>
      </div>

      <Card className="p-4">
        <p className="mb-3 text-xs uppercase tracking-wide text-neutral-500">
          Aylık Trend (Son 6 Ay)
        </p>
        {stats.aylik.length === 0 ? (
          <p className="text-sm text-neutral-500">Bu aralıkta veri yok</p>
        ) : (
          <div className="flex items-end gap-4 overflow-x-auto">
            {stats.aylik.map((a) => (
              <div key={a.ay} className="flex min-w-16 flex-col items-center gap-1">
                <div className="flex h-24 items-end gap-1">
                  <div
                    title={`${a.olusturulan} oluşturulan`}
                    className="w-4 rounded-t bg-neutral-800"
                    style={{ height: `${(a.olusturulan / trendMax) * 100}%` }}
                  />
                  <div
                    title={`${a.cozulen} çözülen`}
                    className="w-4 rounded-t bg-emerald-500"
                    style={{ height: `${(a.cozulen / trendMax) * 100}%` }}
                  />
                </div>
                <span className="text-xs text-neutral-500">{a.ay.slice(5)}</span>
              </div>
            ))}
          </div>
        )}
        <p className="mt-2 text-xs text-neutral-400">
          Koyu: oluşturulan · Yeşil: çözülen
        </p>
      </Card>

      <div>
        <p className="mb-2 text-xs uppercase tracking-wide text-neutral-500">Kişi Bazlı</p>
        <Table head={["Kişi", "Toplam", "Biten", "Açık", "Geciken", "Oran"]}>
          {stats.kisi.length === 0 ? (
            <EmptyRow colSpan={6} text="Atanmış görev yok." />
          ) : (
            stats.kisi.map((k) => (
              <tr key={k.kisi} className="hover:bg-neutral-50">
                <Td className="font-medium">{k.kisi}</Td>
                <Td>{k.toplam}</Td>
                <Td className="text-emerald-700">{k.biten}</Td>
                <Td>{k.toplam - k.biten}</Td>
                <Td>
                  {k.geciken > 0 ? <Badge tone="bad">{k.geciken}</Badge> : <span className="text-neutral-400">0</span>}
                </Td>
                <Td>%{k.toplam === 0 ? 0 : Math.round((k.biten / k.toplam) * 100)}</Td>
              </tr>
            ))
          )}
        </Table>
      </div>
    </div>
  );
}
