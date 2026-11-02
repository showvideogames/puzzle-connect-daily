import path from "node:path";
import { fileURLToPath } from "node:url";
import react from "@vitejs/plugin-react-swc";
import { defineConfig, type Plugin } from "vite";

/**
 * The onboarding and game picker preview. Local only, and separate from the
 * real app on purpose:
 *
 *   - its own index.html, so the real page's Google tag is never loaded
 *   - no .env files are read, and the Supabase client is replaced by a stub
 *     that refuses every call, so it cannot reach any backend
 *   - loopback only, and it refuses to build, so it cannot be deployed
 *
 * The components it shows are the real ones from src/.
 */
const here = path.dirname(fileURLToPath(import.meta.url));

function refuseToBuild(): Plugin {
  return {
    name: "onboarding-preview-refuses-to-build",
    apply: "build",
    buildStart() {
      throw new Error("The onboarding preview is local only and must not be built.");
    },
  };
}

export default defineConfig({
  root: here,
  envDir: here,
  publicDir: path.resolve(here, "../../public"),
  cacheDir: path.resolve(here, "../../node_modules/.vite-onboarding"),
  server: {
    host: "127.0.0.1",
    port: 5201,
    strictPort: true,
    hmr: { overlay: false },
    fs: { allow: [path.resolve(here, "../..")] },
  },
  plugins: [react(), refuseToBuild()],
  resolve: {
    alias: [
      { find: "@/integrations/supabase/client", replacement: path.resolve(here, "noSupabase.ts") },
      { find: "@", replacement: path.resolve(here, "../../src") },
    ],
  },
});
