import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";

const css = fs.readFileSync(path.resolve(__dirname, "../index.css"), "utf8");
const theme = (selector: string) => css.match(new RegExp(`${selector} \\{([^}]+)\\}`))?.[1] ?? "";
const token = (block: string, name: string) => block.match(new RegExp(`${name}:\\s*([^;]+);`))?.[1];

describe("selected tile colors", () => {
  it("uses #292929 and pure white in light mode", () => {
    const light = theme(":root");
    const background = token(light, "--tile-selected") ?? "";
    const [hue, saturation, lightness] = background.split(" ").map(parseFloat);
    expect(hue).toBe(0);
    expect(saturation).toBe(0);
    expect(Math.round((lightness / 100) * 255)).toBe(0x29);
    expect(token(light, "--tile-selected-fg")).toBe("0 0% 100%");
  });

  it("preserves dark-mode selected tiles and shared action colors", () => {
    const dark = theme("\\.dark");
    expect(token(dark, "--tile-selected")).toBe("0 0% 30%");
    expect(token(dark, "--tile-selected-fg")).toBe("var(--foreground)");
    expect(token(theme(":root"), "--action-primary-fg")).toBe("40 100% 99%");
  });
});
