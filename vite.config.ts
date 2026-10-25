import { defineConfig, loadEnv, type Plugin } from "vite";
import react from "@vitejs/plugin-react-swc";
import fs from "fs";
import path from "path";
import { componentTagger } from "lovable-tagger";
import { MINI_ICONS, RAINBOW_ICONS, type AppIconKey } from "./src/lib/appIcons";

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

/**
 * Writes dist/mini.html: the built index.html with Mini's favicon, Apple touch
 * icon and manifest in place of Rainbow's. vercel.json serves it for /mini and
 * /mini/*, so a phone saving Mini to its home screen reads Mini's icons straight
 * from the HTML. Fails the build if index.html's icon tags drift from
 * src/lib/appIcons.ts rather than shipping a half-swapped page.
 */
function miniHtml(): Plugin {
  return {
    name: "mini-html",
    apply: "build",
    writeBundle(options) {
      const dir = options.dir ?? "dist";
      let html = fs.readFileSync(path.join(dir, "index.html"), "utf8");
      for (const key of Object.keys(RAINBOW_ICONS) as AppIconKey[]) {
        const from = `href="${RAINBOW_ICONS[key]}"`;
        if (!html.includes(from)) {
          throw new Error(`mini-html: index.html has no ${from} (icon "${key}"); update src/lib/appIcons.ts`);
        }
        html = html.replace(from, `href="${MINI_ICONS[key]}"`);
      }
      fs.writeFileSync(path.join(dir, "mini.html"), html);
    },
  };
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
    plugins: [react(), miniHtml(), mode === "development" && componentTagger()].filter(Boolean),
    resolve: {
      alias: {
        "@": path.resolve(__dirname, "./src"),
      },
    },
  };
});
