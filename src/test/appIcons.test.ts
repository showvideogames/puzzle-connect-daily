/**
 * Per-game icons: Mini routes get Mini's favicon / touch icon / manifest,
 * everything else keeps Rainbow's, and index.html's tags match the Rainbow set
 * the mini.html build step swaps out.
 */
import { describe, expect, it } from "vitest";
import fs from "fs";
import path from "path";
import { MINI_ICONS, RAINBOW_ICONS, applyAppIcons, iconsForPath, isMiniPath } from "@/lib/appIcons";

describe("app icons", () => {
  it("treats /mini and its sub-pages as Mini, and nothing else", () => {
    for (const p of ["/mini", "/mini/", "/mini/archive", "/mini/archive/abc"]) expect(isMiniPath(p)).toBe(true);
    for (const p of ["/", "/archive", "/minimal", "/how-to-play", "/__fixtures/mini"]) expect(isMiniPath(p)).toBe(false);
    expect(iconsForPath("/mini/archive")).toBe(MINI_ICONS);
    expect(iconsForPath("/archive/123")).toBe(RAINBOW_ICONS);
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
