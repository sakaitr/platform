import { execFileSync } from "node:child_process";

/** E2E kiracılarını sıfırdan kurar — koşular birbirinden bağımsız kalsın. */
export default function globalSetup(): void {
  execFileSync("npx", ["tsx", "scripts/seed-e2e.ts"], { stdio: "inherit" });
}
