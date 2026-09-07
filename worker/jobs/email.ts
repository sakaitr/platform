import type { EmailJob } from "@/lib/queue";

/** Gerçek gönderim sağlayıcısı sonraki planda bağlanır. Şimdilik log. */
export async function sendEmail(job: EmailJob): Promise<void> {
  console.log(`[email] to=${job.to} subject="${job.subject}"`);
}
