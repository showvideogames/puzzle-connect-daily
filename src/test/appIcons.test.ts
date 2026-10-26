/**
 * Per-game icons: Mini routes get Mini's favicon / touch icon / manifest,
 * everything else keeps Rainbow's, and index.html's tags match the Rainbow set
 * the mini.html build step swaps out.
 */
import { describe, expect, it } from "vitest";
import crypto from "crypto";
import fs from "fs";
import path from "path";
import {
  MINI_HOME_TITLE,
  MINI_ICONS,
  RAINBOW_HOME_TITLE,
  RAINBOW_ICONS,
  applyAppIcons,
  applyHomeTitle,
  homeTitleForPath,
  iconsForPath,
  isMiniPath,
} from "@/lib/appIcons";

describe("app icons", () => {
  it("treats /mini and its sub-pages as Mini, and nothing else", () => {
    for (const p of ["/mini", "/mini/", "/mini/archive", "/mini/archive/abc"]) expect(isMiniPath(p)).toBe(true);
    for (const p of ["/", "/archive", "/minimal", "/how-to-play", "/__fixtures/mini"]) expect(isMiniPath(p)).toBe(false);
    expect(iconsForPath("/mini/archive")).toBe(MINI_ICONS);
    expect(iconsForPath("/archive/123")).toBe(RAINBOW_ICONS);
    expect(homeTitleForPath("/mini")).toBe("🌈 Mini");
    expect(homeTitleForPath("/")).toBe("🌈 Categories");
  });

  it("each manifest carries its game's home-screen name", () => {
    const read = (f: string) => JSON.parse(fs.readFileSync(path.resolve(__dirname, "../../public", f), "utf8"));
    for (const [file, title] of [["site.webmanifest", RAINBOW_HOME_TITLE], ["mini.webmanifest", MINI_HOME_TITLE]]) {
      expect(read(file).name).toBe(title);
      expect(read(file).short_name).toBe(title);
    }
  });

  it("swaps the home-screen name tag both ways", () => {
    document.head.innerHTML = `<meta name="apple-mobile-web-app-title" content="${RAINBOW_HOME_TITLE}" data-app-title>`;
    const content = () => document.querySelector("meta[data-app-title]")!.getAttribute("content");
    applyHomeTitle(MINI_HOME_TITLE);
    expect(content()).toBe("🌈 Mini");
    applyHomeTitle(RAINBOW_HOME_TITLE);
    expect(content()).toBe("🌈 Categories");
  });

  it("index.html ships the Rainbow set on tagged links", () => {
    const html = fs.readFileSync(path.resolve(__dirname, "../../index.html"), "utf8");
    for (const [key, href] of Object.entries(RAINBOW_ICONS)) {
      expect(html).toMatch(new RegExp(`href="${href.replace(/[.?]/g, "\\$&")}"[^>]*data-app-icon="${key}"`));
    }
  });

  it("swaps every tagged link both ways", () => {
    document.head.innerHTML = Object.entries(RAINBOW_ICONS)
      .map(([key, href]) => `<link rel="x" href="${href}" data-app-icon="${key}">`)
      .join("");
    const hrefs = () => [...document.querySelectorAll("link[data-app-icon]")].map((l) => l.getAttribute("href"));
    applyAppIcons(MINI_ICONS);
    expect(hrefs()).toEqual(Object.values(MINI_ICONS));
    applyAppIcons(RAINBOW_ICONS);
    expect(hrefs()).toEqual(Object.values(RAINBOW_ICONS));
  });

  const publicDir = path.resolve(__dirname, "../../public");
  const iconPath = (href: string) => path.join(publicDir, href.split("?")[0]);
  const manifestIcons = (file: string): string[] =>
    JSON.parse(fs.readFileSync(path.join(publicDir, file), "utf8")).icons.map((i: { src: string }) => i.src);

  it("every icon file is named after its own content hash, with no ?v= needed", () => {
    const hrefs = [
      ...[RAINBOW_ICONS, MINI_ICONS].flatMap((set) => [set.icon32, set.ico, set.apple]),
      ...manifestIcons("site.webmanifest"),
      ...manifestIcons("mini.webmanifest"),
    ];
    for (const href of hrefs) {
      const m = href.match(/^\/icons\/[a-z0-9-]+-([0-9a-f]{8})\.(png|ico)$/);
      expect(m, href).not.toBeNull();
      const hash = crypto.createHash("sha256").update(fs.readFileSync(iconPath(href))).digest("hex").slice(0, 8);
      expect(hash, href).toBe(m![1]);
    }
  });

  it("Rainbow and Mini never share an icon file", () => {
    const rainbow = [RAINBOW_ICONS.icon32, RAINBOW_ICONS.ico, RAINBOW_ICONS.apple, ...manifestIcons("site.webmanifest")];
    const mini = [MINI_ICONS.icon32, MINI_ICONS.ico, MINI_ICONS.apple, ...manifestIcons("mini.webmanifest")];
    for (const href of rainbow) expect(href).toContain("/icons/rainbow-");
    for (const href of mini) expect(href).toContain("/icons/mini-");
  });

  it("root fallbacks are Rainbow's art, and legacy icon URLs redirect to real current files", () => {
    const bytes = (p: string) => fs.readFileSync(p);
    expect(bytes(path.join(publicDir, "favicon.ico")).equals(bytes(iconPath(RAINBOW_ICONS.ico)))).toBe(true);
    expect(bytes(path.join(publicDir, "apple-touch-icon.png")).equals(bytes(iconPath(RAINBOW_ICONS.apple)))).toBe(true);

    const vercel = JSON.parse(fs.readFileSync(path.resolve(__dirname, "../../vercel.json"), "utf8"));
    const redirects: { source: string; destination: string }[] = vercel.redirects;
    for (const legacy of ["/favicon.svg", "/favicon-32x32.png", "/apple-touch-icon-precomposed.png", "/mini-favicon.ico"]) {
      expect(redirects.some((r) => r.source === legacy), legacy).toBe(true);
    }
    for (const r of redirects) {
      expect(fs.existsSync(iconPath(r.destination)), `${r.source} -> ${r.destination}`).toBe(true);
      expect(fs.existsSync(path.join(publicDir, r.source)), `${r.source} still exists, so the redirect hides it`).toBe(false);
      expect(r.destination.includes("/icons/mini-")).toBe(r.source.startsWith("/mini-"));
    }
  });
});
