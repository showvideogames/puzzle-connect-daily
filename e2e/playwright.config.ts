/**
 * Playwright configuration for the end-to-end suite.
 *
 * Separate from the repository root's `playwright.config.ts`, which belongs
 * to Lovable's agent tooling (it imports `lovable-agent-playwright-config`,
 * a package this project does not install). Everything here is addressed
 * explicitly with `--config e2e/playwright.config.ts`, so the two never
 * interfere.
 *
 * THE PROJECT MATRIX
 * ------------------
 * Small and deliberate, not a cross-product:
 *
 *   desktop-light   1280×800, light   the whole functional suite, once
 *   mobile-light     375×812, light   only @responsive — the layout rules
 *                                     and a Full + Mini smoke path
 *   desktop-dark    1280×800, dark    only @theme — a representative Full
 *                                     and Mini path in dark mode
 *
 * Re-running every functional assertion at every width would triple the
 * runtime to re-prove logic that has nothing to do with viewport size. What
 * genuinely varies by width and theme is layout and colour, so that is what
 * the extra projects run.
 *
 * Dark mode is a localStorage SETTING in this app (`connections-settings`),
 * not `prefers-color-scheme` — so the dark project seeds the setting rather
 * than emulating a media query, which would do nothing.
 */

import { defineConfig, devices } from "@playwright/test";
import path from "node:path";
import { E2E_DIR, loadE2eConfig } from "./env.ts";

const config = loadE2eConfig();
const ARTIFACTS = path.join(E2E_DIR, ".artifacts");

export default defineConfig({
  testDir: path.join(E2E_DIR, "tests"),
  outputDir: path.join(ARTIFACTS, "test-results"),
  globalSetup: path.join(E2E_DIR, "support", "global-setup.ts"),

  // The whole point of a critical-path suite is that it stays quick enough to
  // run before every push. These budgets are the guard rail, not a target.
  timeout: 60_000,
  expect: { timeout: 10_000 },

  fullyParallel: true,
  // A test that only passes when it runs first is a broken test. Forbidding
  // .only in CI is the same rule applied to a different kind of accident.
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  workers: process.env.CI ? 2 : undefined,

  reporter: [
    ["list"],
    ["html", { outputFolder: path.join(ARTIFACTS, "report"), open: "never" }],
    ...(process.env.CI ? ([["github"]] as const) : []),
  ],

  use: {
    baseURL: config.appUrl,
    actionTimeout: config.actionTimeoutMs,
    navigationTimeout: 30_000,
    // Everything needed to diagnose a failure, and nothing on success — a
    // green run should not leave hundreds of megabytes behind.
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
    video: "retain-on-failure",
    // Fixed so a date rendered by the app is the same string on every
    // machine; the fixtures' own dates are chosen to match (see
    // e2e/fixtures/catalog.ts).
    timezoneId: "UTC",
    locale: "en-US",
    // Share Score copies to the clipboard; the Mini share test reads it back.
    permissions: ["clipboard-read", "clipboard-write"],
  },

  projects: [
    {
      name: "desktop-light",
      // Everything except the dark-mode spec, which the dark project owns —
      // running it here too would assert the same things twice in the
      // theme it is not about.
      grepInvert: /@theme/,
      use: { ...devices["Desktop Chrome"], viewport: { width: 1280, height: 800 } },
    },
    {
      name: "mobile-light",
      grep: /@responsive/,
      use: { ...devices["Pixel 5"], viewport: { width: 375, height: 812 } },
    },
    {
      name: "desktop-dark",
      grep: /@theme/,
      use: {
        ...devices["Desktop Chrome"],
        viewport: { width: 1280, height: 800 },
        colorScheme: "dark",
      },
    },
  ],

  webServer: {
    // Builds with `--mode e2e`, which is where vite.config.ts refuses to
    // proceed unless VITE_SUPABASE_URL is a loopback address, and serves the
    // result from dist-e2e so the production `dist/` is never overwritten.
    command: "npm run e2e:app",
    url: config.appUrl,
    reuseExistingServer: !process.env.CI,
    timeout: 180_000,
    stdout: "pipe",
    stderr: "pipe",
  },
});
