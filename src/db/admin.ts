import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import * as schema from "./schema";

const connectionString = process.env.DATABASE_ADMIN_URL;
if (!connectionString) throw new Error("DATABASE_ADMIN_URL is not set");

const pool = new Pool({ connectionString, max: 4 });

/**
 * Platform operatörü client'ı — owner rolü, RLS'i baypas eder.
 * SADECE kiracılar-üstü işlemler: provizyon, lisans yönetimi, çapraz raporlama.
 * Kiracı iş verisi için ASLA kullanılmaz.
 */
export const dbAdmin = drizzle(pool, { schema });
