"use client";

import { useActionState, useState } from "react";
import { Button, Card, Field, inputClass } from "@/components/ui";
import type { FormActionState } from "@/components/ui/entity-form";
import { bulkAddPassengersAction } from "@/modules/operasyon/yolcular/actions";

/**
 * Toplu yolcu ekleme. Satır başına bir kişi; adres ve güzergah hepsine
 * ortak uygulanır — aynı servise binen 30 kişiyi tek tek girmemek için.
 */
export function BulkPassengerForm({
  companies,
  routes,
}: {
  companies: readonly { id: string; name: string }[];
  routes: readonly { id: string; name: string }[];
}) {
  const [open, setOpen] = useState(false);
  const [state, formAction, pending] = useActionState<FormActionState, FormData>(
    bulkAddPassengersAction,
    null,
  );

  if (!open) {
    return (
      <Button variant="ghost" onClick={() => setOpen(true)}>
        Toplu Yolcu Ekle
      </Button>
    );
  }

  return (
    <Card className="w-full p-4">
      <form action={formAction} className="grid gap-3 sm:grid-cols-2">
        <Field label="Firma">
          <select name="companyId" className={inputClass}>
            <option value="">Firma seçin (opsiyonel)</option>
            {companies.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Güzergah">
          <select name="routeId" className={inputClass}>
            <option value="">Güzergah seçin (opsiyonel)</option>
            {routes.map((r) => (
              <option key={r.id} value={r.id}>
                {r.name}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Tür">
          <select name="type" defaultValue="personel" className={inputClass}>
            <option value="personel">Personel</option>
            <option value="yolcu">Yolcu</option>
            <option value="musteri">Müşteri</option>
          </select>
        </Field>
        <Field label="Alış Noktası (hepsi için)">
          <input name="pickupAddress" className={inputClass} />
        </Field>
        <div className="sm:col-span-2">
          <Field label="Bırakış Noktası (hepsi için)">
            <input name="dropoffAddress" className={inputClass} />
          </Field>
        </div>

        <div className="sm:col-span-2">
          <Field
            label="Kişiler"
            hint="Satır başına bir kişi: Ad Soyad;Telefon;TC — telefon ve TC boş bırakılabilir"
          >
            <textarea
              name="rows"
              rows={8}
              required
              placeholder={"Ahmet Yılmaz;05321112233;12345678901\nAyşe Demir;05339998877\nMehmet Kaya"}
              className={`${inputClass} font-mono text-xs`}
            />
          </Field>
        </div>

        <div className="flex items-center gap-2 sm:col-span-2">
          <Button type="submit" disabled={pending}>
            {pending ? "Ekleniyor…" : "Hepsini Ekle"}
          </Button>
          <Button type="button" variant="ghost" onClick={() => setOpen(false)}>
            Vazgeç
          </Button>
          {state && "error" in state ? <span className="text-xs text-red-600">{state.error}</span> : null}
          {state && "ok" in state ? <span className="text-xs text-emerald-600">{state.ok}</span> : null}
        </div>
      </form>
    </Card>
  );
}
