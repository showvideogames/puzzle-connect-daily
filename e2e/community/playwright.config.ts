/**
 * Community Puzzles preview checks: a separate, opt-in suite, because it needs
 * a build with VITE_COMMUNITY_PUZZLES=preview and the extra fictional data from
 * `npm run e2e:seed:community`. Same disposable stack and safety fixture as the
 * main suite (e2e/support/fixtures.ts blocks every non-loopback request).
 *
 *   npm run e2e:up && npm run e2e:reset && npm run e2e:seed:community
 *   npm run e2e:community
 */
import { defineConfig, devices } from "@playwright/test";
import path from "node:path";
import { E2E_DIR, loadE2eConfig } from "../env.ts";

const config = loadE2eConfig();

export default defineConfig({
  testDir: path.join(E2E_DIR, "community"),
  testMatch: "*.spec.ts",
  outputDir: path.join(E2E_DIR, ".artifacts", "community-results"),
  timeout: 90_000,
  expect: { timeout: 15_000 },
  fullyParallel: false,
  workers: 1,
  reporter: [["list"]],
  use: {
    ...devices["Desktop Chrome"],
    baseURL: config.appUrl,
    viewport: { width: 1280, height: 800 },
    trace: "retain-on-failure",
    timezoneId: "UTC",
    locale: "en-US",
    // Optional: a preinstalled Chromium when this Playwright's own build is absent.
    launchOptions: { executablePath: process.env.COMMUNITY_CHROMIUM || undefined },
  },
  webServer: {
    command:
      "VITE_COMMUNITY_PUZZLES=preview npx vite build --mode e2e --outDir dist-e2e-community && " +
      "npx vite preview --outDir dist-e2e-community --host 127.0.0.1 --port 5183 --strictPort",
    url: config.appUrl,
    cwd: path.resolve(E2E_DIR, ".."),
    reuseExistingServer: true,
    timeout: 240_000,
  },
});
