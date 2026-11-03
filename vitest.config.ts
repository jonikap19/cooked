import { cloudflareTest, readD1Migrations } from "@cloudflare/vitest-plugin";
import { defineConfig } from "vitest/config";

export default defineConfig({
  plugins: [
    cloudflareTest(async () => ({
      wrangler: { configPath: "./wrangler.jsonc" },
      // The AI binding only exists remotely; tests never call it.
      remoteBindings: false,
      miniflare: {
        // Applied in test/apply-migrations.ts; empty until migrations exist.
        bindings: { TEST_MIGRATIONS: await readD1Migrations("./migrations") },
      },
    })),
  ],
  test: { setupFiles: ["./test/apply-migrations.ts"] },
});
