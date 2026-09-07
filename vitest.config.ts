import { defineConfig } from "vitest/config";
import path from "node:path";

/**
 * Testler AYRI veritabanına bağlanır (agno_platform_test).
 * setup.ts her testte TRUNCATE çalıştırdığı için geliştirme verisi korunur.
 */
export default defineConfig({
  test: {
    environment: "node",
    fileParallelism: false,
    env: {
      DATABASE_URL: "postgresql://agno_app:app_dev@localhost:5432/agno_platform_test",
      DATABASE_ADMIN_URL: "postgresql://agno_owner:owner_dev@localhost:5432/agno_platform_test",
      REDIS_URL: "redis://localhost:6379",
    },
  },
  resolve: { alias: { "@": path.resolve(__dirname, "./src") } },
});
