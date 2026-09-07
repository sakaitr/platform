import { Queue } from "bullmq";
import IORedis from "ioredis";

export type EmailJob = { to: string; subject: string; body: string };

const connection = new IORedis(process.env.REDIS_URL ?? "redis://localhost:6379", {
  maxRetriesPerRequest: null,
});

export const emailQueue = new Queue<EmailJob>("email", { connection });

export async function enqueueEmail(job: EmailJob): Promise<void> {
  await emailQueue.add("send", job, {
    attempts: 3,
    backoff: { type: "exponential", delay: 5000 },
    removeOnComplete: 1000,
    removeOnFail: 5000,
  });
}
