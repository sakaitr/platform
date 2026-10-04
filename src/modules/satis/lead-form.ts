import type { FieldSpec } from "@/components/ui/entity-form";
import { TEMPERATURE_OPTIONS } from "./labels";

/** Aday formu alanları. Sahip alanı yalnız tüm adayları görebilenlere gösterilir. */
export function leadFormFields(
  owners: { id: string; name: string }[],
  withOwner: boolean,
): readonly FieldSpec[] {
  return [
    { name: "name", label: "Ad / firma", type: "text", required: true },
    { name: "contactName", label: "Yetkili kişi", type: "text" },
    { name: "phone", label: "Telefon", type: "tel" },
    { name: "email", label: "E-posta", type: "email" },
    { name: "website", label: "Web sitesi", type: "text" },
    { name: "city", label: "Şehir", type: "text" },
    { name: "sector", label: "Sektör", type: "text" },
    { name: "service", label: "İlgilendiği hizmet", type: "text" },
    { name: "estimatedValue", label: "Tahmini değer (TL)", type: "text", placeholder: "15.000" },
    { name: "temperature", label: "Sıcaklık", type: "select", options: TEMPERATURE_OPTIONS },
    ...(withOwner
      ? [{ name: "ownerUserId", label: "Sahip", type: "select" as const, options: owners.map((o) => ({ value: o.id, label: o.name })) }]
      : []),
    { name: "followUpDate", label: "Takip tarihi", type: "date" },
    { name: "eventName", label: "Fuar / etkinlik", type: "text" },
    { name: "message", label: "Adayın mesajı", type: "textarea", wide: true },
    { name: "note", label: "Not", type: "textarea", wide: true },
  ];
}
