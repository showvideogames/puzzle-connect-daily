/**
 * Build of the Arcade Shelf SHOWCASE: the real Community Explore and custom
 * puzzle pages, running entirely in the browser on fictional fixtures.
 *
 *   npm run showcase:build   (see scripts/build-showcase.mjs and src/showcase/README.md)
 *
 * Safety, by construction rather than by care:
 *   * the Supabase client module is aliased to src/showcase/fixtureClient.ts,
 *     so the bundle has no database URL, key or network client at all;
 *   * envDir points at an empty folder, so no .env file (and no real
 *     configuration) is ever read; the few values the app checks are fixed here;
 *   * the page is its own showcase/index.html, without the site's analytics tag.
 * The production vite.config.ts and build are untouched.
 */
import { defineConfig, type Plugin } from "vite";
import react from "@vitejs/plugin-react-swc";
import path from "path";

const SRC = path.resolve(__dirname, "src");

/** Absolute public paths ("/icons/…", "/logo.webp") become relative, so the bundle works under any host path. */
function relativePublicPaths(): Plugin {
  return {
    name: "showcase-relative-public-paths",
    enforce: "pre",
    transform(code, id) {
      if (!id.startsWith(SRC) || !/\.(tsx?|jsx?)$/.test(id)) return null;
      const out = code
        .replace(/(["'`])\/((?:icons|game-icons|shared-assets)\/)/g, "$1./$2")
        .replace(/(["'`])\/([A-Za-z0-9_.-]+\.(?:webp|png|svg|jpe?g|ico|gif))(?=["'`?])/g, "$1./$2");
      return out === code ? null : { code: out, map: null };
    },
  };
}

const ENV: Record<string, string> = {
  VITE_COMMUNITY_PUZZLES: "preview",
  VITE_SUPABASE_URL: "",
  VITE_SUPABASE_PUBLISHABLE_KEY: "",
  VITE_PLATFORM_DISCOVERY_URL: "",
  VITE_ACCOUNTS_ENABLED: "false",
  VITE_SUPPORT_URL: "",
  VITE_SHARED_SOCIAL: "",
  VITE_SHOWCASE_ROUTER: process.env.SHOWCASE_ROUTER === "hash" ? "hash" : "memory",
};

export default defineConfig({
  root: path.resolve(__dirname, "showcase"),
  envDir: path.resolve(__dirname, "showcase", "no-env"),
  base: "./",
  publicDir: false,
  plugins: [relativePublicPaths(), react()],
  define: Object.fromEntries(Object.entries(ENV).map(([k, v]) => [`import.meta.env.${k}`, JSON.stringify(v)])),
  resolve: {
    alias: [
      { find: /^@\/integrations\/supabase\/client$/, replacement: path.resolve(SRC, "showcase/fixtureClient.ts") },
      { find: /^@\/components\/SEO$/, replacement: path.resolve(SRC, "showcase/NoSEO.tsx") },
      { find: /^canvas-confetti$/, replacement: path.resolve(SRC, "showcase/confetti.ts") },
      { find: "@", replacement: SRC },
    ],
  },
  build: {
    outDir: path.resolve(__dirname, "dist-showcase-build"),
    emptyOutDir: true,
    assetsInlineLimit: 100_000_000,
    cssCodeSplit: false,
    modulePreload: false,
    rollupOptions: { output: { inlineDynamicImports: true } },
  },
});
