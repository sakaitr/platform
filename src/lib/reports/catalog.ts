export type ReportColumn = {
  key: string;
  label: string;
  align?: "left" | "right";
};

export type ReportResult = {
  columns: ReportColumn[];
  rows: Array<Record<string, string | number>>;
  /** Alt özet satırı — örn. { "Toplam": "12.500,00 ₺" } */
  summary?: Record<string, string>;
};

export type ReportContext = {
  tenantId: string;
  /** YYYY-MM-DD */
  from?: string;
  to?: string;
};

export type ReportDef = {
  key: string;
  name: string;
  category: string;
  description: string;
  /** Görüntülemek için gereken izin — örn. "raporlar:read" */
  permission: string;
  needsDateRange: boolean;
  run: (ctx: ReportContext) => Promise<ReportResult>;
};
