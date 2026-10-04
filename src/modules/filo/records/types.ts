import type { z } from "zod";
import type { FieldSpec } from "@/components/ui/entity-form";

export type ColumnFormat = "text" | "date" | "money" | "number" | "bool" | "badge" | "expiry";

export type RecordColumn = {
  key: string;
  label: string;
  format?: ColumnFormat;
  /** badge biçiminde: değer → ton */
  tone?: Record<string, string>;
  /** badge/enum biçiminde: değer → görünen etiket */
  labels?: Record<string, string>;
  /** expiry biçiminde: kaç gün kala kırmızı */
  warnDays?: number;
};

/** Alan tanımını doldurmak için sayfadan gelen seçenekler. */
export type RecordOptions = {
  vehicles: readonly { value: string; label: string }[];
  drivers: readonly { value: string; label: string }[];
  companies: readonly { value: string; label: string }[];
  terms: (key: string) => string;
};

/**
 * Araç alt kaydı tanımı. Bakım, ceza, kaza, sigorta… hepsi aynı iskeleti
 * kullanır; yeni bir kayıt tipi eklemek = buraya bir giriş.
 */
export type FiloRecordDef = {
  key: string;
  label: string;
  plural: string;
  description: string;
  /** İzin öneki — "bakim" → bakim:read / bakim:create … */
  permission: string;
  /** Sıralama ve tarih süzgeci için kullanılan sütun adı. */
  dateField: string;
  /** Kaydın tüm alanları buradan okunur — form listesi yalnız görünümü belirler. */
  schema: z.ZodObject<z.ZodRawShape>;
  fields: (options: RecordOptions) => readonly FieldSpec[];
  columns: readonly RecordColumn[];
  /** Formda önceden dolu gelecek varsayılanlar. */
  defaults?: Record<string, unknown>;
};
