/**
 * A rainbow word on a fixed-height tile shrinks only as far as it must to
 * clear the color bar. The search is tested with fake layouts, and the bar's
 * reserve against the CSS's own tokens; real text heights are a browser check.
 */
import { describe, it, expect, vi } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { fitScaleToHeight, rainbowBarReserve } from "@/lib/rainbowWordFit";

// Text that wraps to fewer lines as it shrinks: 3 lines of 37.4px at full size,
// 2 lines from 0.8 down, like a phrase rewrapping on a 201px tile.
const wrapping = (scale: number) => (scale > 0.8 ? 3 : 2) * 37.4 * scale;

describe("fitScaleToHeight", () => {
  it("returns the start scale, measuring once, when the text already fits", () => {
    const heightAt = vi.fn((scale: number) => 74.8 * scale);
    expect(fitScaleToHeight(heightAt, 86, 1, 0.25)).toBe(1);
    expect(fitScaleToHeight(heightAt, 86, 0.9, 0.25)).toBe(0.9);
    expect(heightAt).toHaveBeenCalledTimes(2);
  });

  it("finds the largest scale that fits, within 0.001", () => {
    const scale = fitScaleToHeight((s) => 112.2 * s, 86, 1, 0.25);
    expect(112.2 * scale).toBeLessThanOrEqual(86);
    expect(112.2 * (scale + 0.002)).toBeGreaterThan(86);
  });

  it("follows a rewrap rather than assuming height scales with size", () => {
    const scale = fitScaleToHeight(wrapping, 86, 1, 0.25);
    expect(wrapping(scale)).toBeLessThanOrEqual(86);
    // Proportional shrinking would give 86 / 112.2, about 0.77; the rewrap fits
    // at 0.8 already.
    expect(scale).toBeCloseTo(0.8, 2);
  });

  it("never grows above the start scale", () => {
    for (const start of [1, 0.9, 0.6]) {
      expect(fitScaleToHeight((s) => 200 * s, 86, start, 0.25)).toBeLessThanOrEqual(start);
    }
  });

  it("stops at the floor when nothing fits", () => {
    expect(fitScaleToHeight((s) => 1000 * s, 86, 1, 0.25)).toBe(0.25);
  });

  it("does not shrink when the start is already at the floor", () => {
    expect(fitScaleToHeight((s) => 1000 * s, 86, 0.25, 0.25)).toBe(0.25);
  });
});

describe("rainbowBarReserve", () => {
  const css = fs.readFileSync(path.resolve(__dirname, "..", "index.css"), "utf8").replace(/\/\*[\s\S]*?\*\//g, "");
  const clampOf = (token: string) => {
    const [, min, share, max] = css.match(new RegExp(`${token}:\\s*clamp\\((\\d+)px,\\s*(\\d+)cqw,\\s*(\\d+)px\\)`)) ?? [];
    return (width: number) => Math.min(Number(max), Math.max(Number(min), (Number(share) * width) / 100));
  };
  const gap = Number(css.match(/minmax\(calc\(var\(--tile-bar-bottom\) \+ var\(--tile-bar-height\) \+ (\d+)px\), 1fr\)/)?.[1]);

  it.each([104.66, 183, 201])("matches the CSS's bar bottom, height and gap on a %spx tile", (width) => {
    const fromCss = clampOf("--tile-bar-bottom")(width) + clampOf("--tile-bar-height")(width) + gap;
    expect(fromCss).toBeGreaterThan(0);
    expect(rainbowBarReserve(width)).toBeCloseTo(fromCss, 6);
  });
});
