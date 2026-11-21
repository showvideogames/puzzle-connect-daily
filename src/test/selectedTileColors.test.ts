import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";

const css = fs.readFileSync(path.resolve(__dirname, "../index.css"), "utf8");
const theme = (selector: string) => css.match(new RegExp(`${selector} \\{([^}]+)\\}`))?.[1] ?? "";
const token = (block: string, name: string) => block.match(new RegExp(`${name}:\\s*([^;]+);`))?.[1];

describe("selected tile colors", () => {
  it("uses the exact neutral graphite #363636 and pure white in light mode", () => {
    const light = theme(":root");
    const background = token(light, "--tile-selected") ?? "";
    const [hue, saturation, lightness] = background.split(" ").map(parseFloat);
    const l = lightness / 100;
    const a = saturation / 100 * Math.min(l, 1 - l);
    const channel = (n: number) => {
      const k = (n + hue / 30) % 12;
      return Math.round(255 * (l - a * Math.max(-1, Math.min(k - 3, 9 - k, 1))));
    };
    expect([channel(0), channel(8), channel(4)]).toEqual([0x36, 0x36, 0x36]);
    expect(token(light, "--tile-selected-fg")).toBe("0 0% 100%");
  });

  it("preserves dark-mode selected tiles and shared action colors", () => {
    const dark = theme("\\.dark");
    expect(token(dark, "--tile-selected")).toBe("0 0% 30%");
    expect(token(dark, "--tile-selected-fg")).toBe("var(--foreground)");
    expect(token(theme(":root"), "--action-primary-fg")).toBe("40 100% 99%");
  });
});
