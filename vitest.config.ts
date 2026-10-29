import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react-swc";
import path from "path";

export default defineConfig({
  plugins: [react()],
  test: {
    environment: "jsdom",
    globals: true,
    // Explicit non-secret fixtures: a clean checkout must not need a live
    // project's environment just to import the client or test sign-in glue.
    env: {
      VITE_SUPABASE_URL: "http://127.0.0.1:54321",
      VITE_SUPABASE_PUBLISHABLE_KEY: "test-only-key",
      VITE_PLATFORM_DISCOVERY_URL: "https://identity.example.test/.well-known/openid-configuration",
      VITE_ACCOUNTS_ENABLED: "true",
    },
    setupFiles: ["./src/test/setup.ts"],
    include: ["src/**/*.{test,spec}.{ts,tsx}"],
  },
  resolve: {
    alias: { "@": path.resolve(__dirname, "./src") },
  },
});
