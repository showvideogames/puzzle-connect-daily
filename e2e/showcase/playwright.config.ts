/**
 * Checks the BUILT showcase package (dist-showcase/) exactly as a static host
 * serves it. No database, no stack: run `npm run showcase:build` first.
 *
 *   npm run showcase:check
 */
import { defineConfig, devices } from "@playwright/test";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));

const ROOT = path.resolve(HERE, "..", "..");
export default defineConfig({
  testDir: HERE,
  testMatch: "*.spec.ts",
  outputDir: path.join(ROOT, "e2e", ".artifacts", "showcase-results"),
  timeout: 60_000,
  expect: { timeout: 15_000 },
  workers: 1,
  reporter: [["list"]],
  use: {
    ...devices["Pixel 5"],
    baseURL: "http://127.0.0.1:5190",
    viewport: { width: 390, height: 844 },
    trace: "retain-on-failure",
    launchOptions: { executablePath: process.env.COMMUNITY_CHROMIUM || undefined },
  },
  webServer: {
    command: "python3 -m http.server 5190 --bind 127.0.0.1 --directory " + (process.env.SHOWCASE_DIR ?? "dist-showcase"),
    cwd: ROOT,
    url: "http://127.0.0.1:5190/index.html",
    reuseExistingServer: false,
  },
});
