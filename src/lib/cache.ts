/**
 * Kiracıya kapsanmış cache etiketi.
 * Çıplak revalidatePath() TÜM kiracıların cache'ini düşürür ve
 * kiracı anahtarı içermeyen cache girdileri çapraz veri sızdırır.
 */
export function tenantTag(tenantId: string, resource: string): string {
  return `t:${tenantId}:${resource}`;
}
