/**
 * Builds the Arcade Shelf showcase into two self-contained outputs:
 *
 *   dist-showcase/            a ready-to-host static folder (index.html with the
 *                             app inlined, plus the images it shows). Any static
 *                             host works; no server code, no database, no keys.
 *   dist-showcase.zip         the same folder, zipped.
 *   dist-showcase-artifact/   the same page as content only, for a claude.ai
 *                             Artifact (which adds its own document skeleton).
 *
 *   npm run showcase:build                      in-memory routing (any host)
 *   SHOWCASE_ROUTER=hash npm run showcase:build Back button and #/ deep links
 *
 * Fails if the output mentions a hosted Supabase address, a key format, or the
 * production site's analytics, so a mistake can't ship quietly. (Plain links
 * to rainbowcategories.com, such as share text, are ordinary page text.)
 */
import { execSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..");
const BUILD = path.join(ROOT, "dist-showcase-build");
const PKG = path.join(ROOT, "dist-showcase");
const ART = path.join(ROOT, "dist-showcase-artifact");

// Only the public images the Community, puzzle and creator pages show.
const PUBLIC_FILES = [
  "rainbow-categories-logo.webp",
  "rainbow-categories-logo-stacked.webp",
  "rainbow-categories-logo-stacked-480.webp",
  "hint-flashlight.png",
  "hint-lightbulb.png",
  "lucky-bot.png",
  "present-icon.png",
  "new-broom-icon.png",
];
const PUBLIC_DIRS = [["icons", () => true], ["game-icons", (f) => f.endsWith(".png")]];

execSync("npx vite build --config vite.showcase.config.ts", { cwd: ROOT, stdio: "inherit", env: { ...process.env } });

const html = fs.readFileSync(path.join(BUILD, "index.html"), "utf8");
const jsHref = html.match(/<script[^>]+src="\.\/([^"]+\.js)"/)?.[1];
const cssHref = html.match(/<link[^>]+rel="stylesheet"[^>]+href="\.\/([^"]+\.css)"/)?.[1];
if (!jsHref || !cssHref) throw new Error("showcase build: expected one script and one stylesheet");
const js = fs.readFileSync(path.join(BUILD, jsHref), "utf8").replace(/<\/script/gi, "<\\/script");
const css = fs.readFileSync(path.join(BUILD, cssHref), "utf8").replace(/<\/style/gi, "<\\/style");

for (const [label, text] of [["script", js], ["stylesheet", css]]) {
  for (const bad of [/supabase\.co/i, /googletagmanager|google-analytics|gtag\(/i, /sb_(?:secret|publishable)_/, /eyJ[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{20,}/]) {
    if (bad.test(text)) throw new Error(`showcase build: the ${label} matches ${bad}; refusing to package it`);
  }
}

const title = "Community Puzzles Preview";
const body = `<div id="root"></div>\n<script type="module">${js}</script>`;
const head = `<title>${title}</title>\n<meta name="robots" content="noindex, nofollow">\n<style>${css}</style>`;

for (const dir of [PKG, ART]) {
  fs.rmSync(dir, { recursive: true, force: true });
  fs.mkdirSync(dir, { recursive: true });
  for (const f of PUBLIC_FILES) fs.copyFileSync(path.join(ROOT, "public", f), path.join(dir, f));
  for (const [sub, keep] of PUBLIC_DIRS) {
    fs.mkdirSync(path.join(dir, sub), { recursive: true });
    for (const f of fs.readdirSync(path.join(ROOT, "public", sub)).filter(keep)) fs.copyFileSync(path.join(ROOT, "public", sub, f), path.join(dir, sub, f));
  }
}
fs.writeFileSync(path.join(PKG, "index.html"), `<!doctype html>\n<html lang="en">\n<head>\n<meta charset="UTF-8">\n<meta name="viewport" content="width=device-width, initial-scale=1.0">\n${head}\n</head>\n<body>\n${body}\n</body>\n</html>\n`);
fs.writeFileSync(path.join(ART, "index.html"), `${head}\n${body}\n`);
fs.writeFileSync(path.join(PKG, "README.txt"), [
  "Rainbow Categories: Community Puzzles preview (Arcade Shelf), fictional data only.",
  "",
  "Static files. No server code, no database, no keys, no analytics; nothing leaves the browser.",
  "Host this folder on any static host, or try it locally:",
  "  npx --yes serve .        (then open the printed address)",
  "  python3 -m http.server   (then open http://localhost:8000)",
  "Opening index.html straight from disk also works in most browsers.",
  "",
  "Built from showvideogames/puzzle-connect-daily by scripts/build-showcase.mjs.",
].join("\n") + "\n");
fs.rmSync(path.join(ROOT, "dist-showcase.zip"), { force: true });
execSync(`cd "${PKG}" && zip -qr "${path.join(ROOT, "dist-showcase.zip")}" .`);
fs.rmSync(BUILD, { recursive: true, force: true });

const size = (f) => `${(fs.statSync(f).size / 1024).toFixed(0)} KB`;
console.log(`\nShowcase ready:\n  ${path.relative(ROOT, PKG)}/index.html (${size(path.join(PKG, "index.html"))})\n  dist-showcase.zip (${size(path.join(ROOT, "dist-showcase.zip"))})\n  ${path.relative(ROOT, ART)}/index.html (${size(path.join(ART, "index.html"))})\n`);
