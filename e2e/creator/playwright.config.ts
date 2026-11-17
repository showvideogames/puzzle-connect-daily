import { defineConfig } from "@playwright/test";
export default defineConfig({
  testDir: ".",
  testMatch: "*.spec.ts",
  outputDir: "../.artifacts/creator",
  timeout: 30000,
  use: {
    baseURL: "http://127.0.0.1:5187",
    launchOptions: { executablePath: process.env.CREATOR_CHROMIUM || undefined },
    trace: "retain-on-failure",
  },
  projects: [
    { name: "desktop", use: { viewport: { width: 1280, height: 800 } } },
    { name: "mobile", use: { viewport: { width: 375, height: 812 } } },
  ],
  webServer: {
    command: "VITE_SUPABASE_URL=http://127.0.0.1:54421 VITE_SUPABASE_PUBLISHABLE_KEY=fixture VITE_ACCOUNTS_ENABLED=false npm run dev -- --host 127.0.0.1 --port 5187 --strictPort",
    url: "http://127.0.0.1:5187", reuseExistingServer: false,
  },
});
