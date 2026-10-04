import { sql } from "drizzle-orm";
import type { ExtractTablesWithRelations } from "drizzle-orm";
import type { NodePgQueryResultHKT } from "drizzle-orm/node-postgres";
import type { PgTransaction } from "drizzle-orm/pg-core";
import { db, schema } from "./index";

export type TenantTx = PgTransaction<
  NodePgQueryResultHKT,
  typeof schema,
  ExtractTablesWithRelations<typeof schema>
>;

/**
 * Kiracı kapsamlı iş birimi.
 *
 * `set_config(..., true)` = SET LOCAL: ayar SADECE bu transaction'da geçerli.
 * Bağlantı havuza döndüğünde context sıfırlanır — kiracı sızıntısı olmaz.
 * Düz `SET` kullanmak havuzda bir kiracının context'ini diğerine taşır.
 */
export async function withTenant<T>(
  tenantId: string,
  fn: (tx: TenantTx) => Promise<T>,
): Promise<T> {
  return db.transaction(async (tx) => {
    await tx.execute(sql`SELECT set_config('app.tenant_id', ${tenantId}, true)`);
    return fn(tx as TenantTx);
  });
}
