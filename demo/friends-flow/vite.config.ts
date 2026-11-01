/// <reference types="vitest/config" />
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { Plugin, UserConfig } from "vite";

/**
 * The Friends and Groups preview: localhost only, synthetic, and never built.
 * From the repository root:
 *   npx vite --config demo/friends-flow/vite.config.ts
 *   npx vitest run --config demo/friends-flow/vite.config.ts
 *
 * Only two outside things are swapped, for the dev server and for vitest alike:
 * the Rainbow Supabase client and the Supabase library. All other code is
 * Rainbow's real source. No env file or VITE_ value can get in, because this
 * config reads only its own prefix from its own folder.
 *
 * It takes vite's types only, so the test can load this file in jsdom. esbuild
 * compiles the JSX, so a change here means a full reload, which empties the
 * preview anyway.
 */

const here = path.dirname(fileURLToPath(import.meta.url));
const rainbow = path.resolve(here, "../..");
const onboarding = path.join(rainbow, "demo", "onboarding");
const sharedAssets = path.join(onboarding, "shared-assets");

const fakeFile = (name: string) => path.join(here, name);

/** The feature flag and a synthetic address that is never fetched. The kill switch stays unset. */
const SYNTHETIC_ENV = {
  VITE_SHARED_SOCIAL: "mock",
  VITE_PLATFORM_DISCOVERY_URL: "http://127.0.0.1:9/friends-flow-synthetic-discovery",
};

/** Where a relative or absolute import points, without its extension. Null for a package name. */
function targetOf(source: string, importer: string | undefined): string | null {
  const clean = source.split("?")[0];
  if (path.isAbsolute(clean)) return clean.replace(/\.ts$/, "");
  if (clean.startsWith(".") && importer) return path.resolve(path.dirname(importer.split("?")[0]), clean).replace(/\.ts$/, "");
  return null;
}

function refuseRealSettings(): Plugin {
  const realClient = path.join(rainbow, "src", "integrations", "supabase", "client");
  return {
    name: "friends-flow-preview-refuse-real-settings",
    enforce: "pre",
    resolveId(source, importer) {
      const target = targetOf(source, importer);
      if (target !== null && (target === realClient || /^\.env(\.|$)/.test(path.basename(target)))) {
        throw new Error(`The Friends and Groups preview refuses ${path.basename(target)}. It has no real settings or clients.`);
      }
      return null;
    },
  };
}

/** Runs for every command: it has no `apply`, so nothing can skip it. */
function refuseBuild(): Plugin {
  return {
    name: "friends-flow-preview-refuse-build",
    config(_config, { command, isPreview }) {
      if (command === "build" || isPreview) throw new Error("The Friends and Groups preview is localhost only. It has no build.");
    },
  };
}

/** The real screens ask for /shared-assets/, which the onboarding preview holds and this one only reads. */
function serveSharedAssets(): Plugin {
  return {
    name: "friends-flow-preview-shared-assets",
    configureServer(server) {
      server.middlewares.use((request, _response, next) => {
        if (request.url?.startsWith("/shared-assets/")) {
          request.url = `/@fs${encodeURI(sharedAssets)}${request.url.slice("/shared-assets".length)}`;
        }
        next();
      });
    },
  };
}

const config: UserConfig = {
  root: here,
  publicDir: false,
  envDir: here,
  envPrefix: "FRIENDS_FLOW_PREVIEW_",
  cacheDir: path.join(rainbow, "node_modules", ".vite-friends-flow"),
  plugins: [refuseBuild(), refuseRealSettings(), serveSharedAssets()],
  esbuild: { jsx: "automatic" },
  resolve: {
    alias: [
      { find: /^@\/integrations\/supabase\/client$/, replacement: fakeFile("fakeSupabase.ts") },
      { find: /^@supabase\/supabase-js$/, replacement: fakeFile("fakeSupabaseJs.ts") },
      { find: /^@\//, replacement: `${path.join(rainbow, "src")}/` },
    ],
  },
  define: {
    "import.meta.env.VITE_SHARED_SOCIAL": JSON.stringify(SYNTHETIC_ENV.VITE_SHARED_SOCIAL),
    "import.meta.env.VITE_PLATFORM_DISCOVERY_URL": JSON.stringify(SYNTHETIC_ENV.VITE_PLATFORM_DISCOVERY_URL),
  },
  server: {
    host: "127.0.0.1",
    port: 5202,
    strictPort: true,
    hmr: { overlay: false },
    fs: {
      allow: [here, path.join(rainbow, "src"), path.join(rainbow, "node_modules"), onboarding],
    },
  },
  test: {
    environment: "jsdom",
    globals: true,
    include: ["friendsFlow.test.tsx", "staticChecks.test.ts"],
    setupFiles: [path.join(rainbow, "src", "test", "setup.ts")],
    env: SYNTHETIC_ENV,
  },
};

export default config;
