/**
 * Per-game icons: Mini routes get Mini's favicon / touch icon / manifest,
 * everything else keeps Rainbow's, and index.html's tags match the Rainbow set
 * the mini.html build step swaps out.
 */
import { describe, expect, it } from "vitest";
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
});
