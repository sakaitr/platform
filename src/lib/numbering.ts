import { and, eq, sql } from "drizzle-orm";
import { numberingSequences } from "@/db/schema";
import type { TenantTx } from "@/db/tenant";
import { istanbulPeriodKey } from "./time";

/**
 * Boşluksuz belge numarası üretir.
 * Satır `FOR UPDATE` ile kilitlenir — eşzamanlı çağrılarda numara atlamaz/çakışmaz.
 * DAİMA çağıranın transaction'ı içinde çalışır.
 */
export async function nextNumber(
  tx: TenantTx,
  tenantId: string,
  sequenceKey: string,
): Promise<string> {
  const locked = await tx.execute(sql`
    SELECT id, prefix, next_value, padding, period_reset, period_key
    FROM numbering_sequences
    WHERE tenant_id = ${tenantId} AND sequence_key = ${sequenceKey}
    FOR UPDATE
  `);

  const row = locked.rows[0] as
    | {
        id: string;
        prefix: string;
        next_value: number;
        padding: number;
        period_reset: "none" | "yearly" | "monthly";
        period_key: string;
      }
    | undefined;
  if (!row) throw new Error(`Numbering sequence not found: ${sequenceKey}`);

  const currentPeriod = istanbulPeriodKey(row.period_reset);
  const periodChanged = currentPeriod !== row.period_key;
  const value = periodChanged ? 1 : row.next_value;

  await tx
    .update(numberingSequences)
    .set({ nextValue: value + 1, periodKey: currentPeriod })
    .where(
      and(
        eq(numberingSequences.tenantId, tenantId),
        eq(numberingSequences.sequenceKey, sequenceKey),
      ),
    );

  const padded = String(value).padStart(row.padding, "0");
  return `${row.prefix}${currentPeriod}${currentPeriod ? "-" : ""}${padded}`;
}
