import "dotenv/config";
import { Worker } from "bullmq";
import IORedis from "ioredis";
import type { EmailJob } from "@/lib/queue";
import { sendEmail } from "./jobs/email";
import { runLicenseExpiryCheck } from "./jobs/license-expiry";

const connection = new IORedis(process.env.REDIS_URL ?? "redis://localhost:6379", {
  maxRetriesPerRequest: null,
});

new Worker<EmailJob>("email", async (job) => sendEmail(job.data), { connection, concurrency: 5 });

const ONE_HOUR_MS = 60 * 60 * 1000;

async function licenseLoop(): Promise<void> {
  try {
    const result = await runLicenseExpiryCheck();
    console.log(`[license] warned=${result.warned} expired=${result.expired}`);
  } catch (error: unknown) {
    console.error("[license] check failed:", error);
  }
  setTimeout(() => void licenseLoop(), ONE_HOUR_MS);
}

console.log("Agno Platform worker started");
void licenseLoop();
