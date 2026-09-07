import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import * as schema from "./schema";

const connectionString = process.env.DATABASE_URL;
if (!connectionString) throw new Error("DATABASE_URL is not set");

const pool = new Pool({ connectionString, max: 10 });

/** Uygulama client'ı — agno_app rolü, RLS'e tabi. */
export const db = drizzle(pool, { schema });
export type DB = typeof db;
export { schema };
