import { defineConfig, loadEnv } from "vite";
import react from "@vitejs/plugin-react-swc";
import path from "path";
import { componentTagger } from "lovable-tagger";

/**
 * The end-to-end build mode ("e2e") must never be able to reach production.
 *
 * Vite layers `.env.e2e` on top of `.env`, and `.env` holds this project's
 * REAL Supabase URL. So a missing or half-written `.env.e2e` would not fail —
 * it would quietly inherit production and the browser tests would start
 * writing game sessions to the live database.
 *
 * This check closes that: in `--mode e2e` the resolved Supabase URL has to be
 * a loopback address, or the dev server/build refuses to start. It is the
 * bundler-level half of the same rule e2e/safety.ts enforces for the
 * database and seeding side.
 */
function assertLocalSupabase(mode: string, env: Record<string, string>) {
  if (mode !== "e2e") return;
  const url = (env.VITE_SUPABASE_URL ?? "").trim();
  let host = "";
  try {
    host = new URL(url).hostname.toLowerCase();
  } catch {
    host = "";
  }
  const isLoopback =
    host === "localhost" ||
    host === "127.0.0.1" ||
    host === "0.0.0.0" ||
    host === "::1" ||
    host.endsWith(".localhost");
  if (!isLoopback) {
    throw new Error(
      "Refusing to build in e2e mode: VITE_SUPABASE_URL is " +
        (url ? `"${url}"` : "unset") +
        ", which is not a local test instance.\n" +
        "Run `npm run e2e:up` to start the disposable local Supabase stack " +
        "and write .env.e2e. See e2e/README.md."
    );
  }
}

// https://vitejs.dev/config/
export default defineConfig(({ mode }) => {
  assertLocalSupabase(mode, loadEnv(mode, process.cwd(), "VITE_"));

  return {
    server: {
      host: "::",
      port: 8080,
      hmr: {
        overlay: false,
      },
    },
    plugins: [react(), mode === "development" && componentTagger()].filter(Boolean),
    resolve: {
      alias: {
        "@": path.resolve(__dirname, "./src"),
      },
    },
  };
});
