/**
 * The kill switch: the same app built with VITE_COMMUNITY_PUZZLES=off is
 * exactly the pre-Community app, served on 127.0.0.1:5184, against the same
 * disposable stack. Run after e2e:seed:community.
 *
 *   npm run e2e:community:flagoff
 */
import { defineConfig, devices } from "@playwright/test";
import path from "node:path";
import { E2E_DIR } from "../env.ts";

export default defineConfig({
  testDir: path.join(E2E_DIR, "community"),
  testMatch: "flag-off.check.ts",
  outputDir: path.join(E2E_DIR, ".artifacts", "community-flagoff-results"),
  timeout: 60_000,
  expect: { timeout: 15_000 },
  workers: 1,
  reporter: [["list"]],
  use: {
    ...devices["Desktop Chrome"],
    baseURL: "http://127.0.0.1:5184",
    viewport: { width: 390, height: 844 },
    trace: "retain-on-failure",
    timezoneId: "UTC",
    locale: "en-US",
    launchOptions: { executablePath: process.env.COMMUNITY_CHROMIUM || undefined },
  },
  webServer: {
    command:
      "VITE_COMMUNITY_PUZZLES=off npx vite build --mode e2e --outDir dist-e2e-flagoff && " +
      "npx vite preview --outDir dist-e2e-flagoff --host 127.0.0.1 --port 5184 --strictPort",
    cwd: path.resolve(E2E_DIR, ".."),
    url: "http://127.0.0.1:5184",
    reuseExistingServer: false,
    timeout: 240_000,
  },
});
