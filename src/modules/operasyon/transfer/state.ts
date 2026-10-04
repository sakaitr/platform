export type TransferStatus = "istek" | "planlandi" | "yolda" | "tamamlandi" | "iptal";

/**
 * Transfer durum makinesi. Geçersiz sıçramalar (örn. istek → tamamlandı)
 * kabul edilmez; hakediş ve raporlar bu sıraya güvenir.
 * "use server" dosyaları yalnız async fonksiyon dışa aktarabildiği için burada durur.
 */
const NEXT: Record<TransferStatus, readonly TransferStatus[]> = {
  istek: ["planlandi", "iptal"],
  planlandi: ["yolda", "iptal"],
  yolda: ["tamamlandi", "iptal"],
  tamamlandi: [],
  iptal: [],
};

export const TRANSFER_STATUS_LABEL: Record<TransferStatus, string> = {
  istek: "İstek",
  planlandi: "Planlandı",
  yolda: "Yolda",
  tamamlandi: "Tamamlandı",
  iptal: "İptal",
};

export const TRANSFER_STATUS_TONE: Record<TransferStatus, string> = {
  istek: "warn",
  planlandi: "info",
  yolda: "info",
  tamamlandi: "ok",
  iptal: "mute",
};

export function canTransition(from: TransferStatus, to: TransferStatus): boolean {
  return NEXT[from].includes(to);
}

export function nextStatuses(from: TransferStatus): readonly TransferStatus[] {
  return NEXT[from];
}

export function isTransferStatus(value: string): value is TransferStatus {
  return value in NEXT;
}
