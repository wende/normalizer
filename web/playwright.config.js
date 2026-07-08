import { defineConfig } from "@playwright/test";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");

export default defineConfig({
  testDir: "./e2e",
  timeout: 30000,
  retries: 0,
  use: {
    baseURL: process.env.WEB_URL || "http://localhost:8765",
    headless: true,
    viewport: { width: 1440, height: 900 },
  },
  webServer: {
    command: "npx vite --port 8765 --strictPort",
    cwd: repoRoot,
    url: "http://localhost:8765",
    reuseExistingServer: true,
    timeout: 30000,
  },
});
