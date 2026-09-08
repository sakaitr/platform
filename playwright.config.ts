import { defineConfig } from "@playwright/test";

/**
 * E2E production build üzerinde çalışır — dev server'ın ilk-istek derleme
 * gecikmesi testleri yanıltıyordu ve prod davranışı gerçek dağıtıma daha yakın.
 */
export default defineConfig({
  testDir: "./tests/e2e",
  expect: { timeout: 15_000 },
  use: { baseURL: "http://localhost:3100" },
  webServer: {
    command: "npm run build && npx next start -p 3100",
    url: "http://localhost:3100/login",
    reuseExistingServer: false,
    timeout: 180_000,
  },
});
