/**
 * Dark mode, on one representative Full path and one Mini path.
 *
 * Dark mode in this app is a SETTING, not a media query: `SettingsModal`
 * writes `connections-settings.darkMode` and the app toggles a `dark` class
 * on <html>. Emulating `prefers-color-scheme` alone would therefore prove
 * nothing, so the setting is seeded and the class is what gets asserted.
 *
 * Tagged @theme, which is what the desktop-dark project runs and what the
 * light projects skip.
 */

import { expect, gotoApp, test } from "../support/fixtures.ts";
import { expectNoHorizontalOverflow, solveCategory, solvedBar, tiles } from "../support/game.ts";
import { FULL_RAINBOW, MINI_RAINBOW } from "../fixtures/catalog.ts";

test.use({ settings: { darkMode: true } });

/** Perceived lightness of a CSS colour, 0 (black) to 1 (white). */
async function backgroundLightness(page: import("@playwright/test").Page): Promise<number> {
  return page.evaluate(() => {
    const colour = getComputedStyle(document.body).backgroundColor;
    const [r, g, b] = (colour.match(/\d+(\.\d+)?/g) ?? ["255", "255", "255"]).map(Number);
    // Rec. 709 luma, normalised.
    return (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255;
  });
}

test.describe("Dark mode @theme", () => {
  test("the Full Daily plays in dark mode", async ({ page }) => {
    await gotoApp(page, "/");
    await expect(tiles(page)).toHaveCount(16);

    await expect(page.locator("html")).toHaveClass(/dark/);
    expect(
      await backgroundLightness(page),
      "the page background should be dark in dark mode"
    ).toBeLessThan(0.4);

    // The game still works, not just the colours.
    await solveCategory(page, FULL_RAINBOW.groups[0]);
    await expect(solvedBar(page, FULL_RAINBOW.groups[0].category)).toBeVisible();
    await expectNoHorizontalOverflow(page);
  });

  test("the Mini Daily plays in dark mode", async ({ page }) => {
    await gotoApp(page, "/mini");
    await expect(tiles(page)).toHaveCount(9);

    await expect(page.locator("html")).toHaveClass(/dark/);
    expect(await backgroundLightness(page)).toBeLessThan(0.4);

    await solveCategory(page, MINI_RAINBOW.groups[0]);
    await expect(solvedBar(page, MINI_RAINBOW.groups[0].category)).toBeVisible();
    await expectNoHorizontalOverflow(page);
  });

  test("solved category bars keep readable contrast in dark mode", async ({ page }) => {
    await gotoApp(page, "/");
    await expect(tiles(page)).toHaveCount(16);
    await solveCategory(page, FULL_RAINBOW.groups[0]);

    // The solved bar is a category colour with Ink text in both themes. A
    // measured contrast ratio is the assertion, not a screenshot — a colour
    // token regression would drop this below the readable threshold.
    const contrast = await solvedBar(page, FULL_RAINBOW.groups[0].category).evaluate((el) => {
      const parse = (value: string) =>
        (value.match(/\d+(\.\d+)?/g) ?? ["0", "0", "0"]).slice(0, 3).map(Number);
      const luminance = ([r, g, b]: number[]) => {
        const channel = (c: number) => {
          const s = c / 255;
          return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
        };
        return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);
      };

      // The title line paints no background of its own — the category colour
      // is on the bar around it. Reading the title's own background gives
      // rgba(0, 0, 0, 0), and comparing Ink against transparent reports a
      // meaningless ~1.4. Walk out to the first ancestor that actually
      // paints, which is the bar.
      const isTransparent = (colour: string) =>
        colour === "transparent" || /rgba\(\s*0,\s*0,\s*0,\s*0\s*\)/.test(colour);
      let painted = el as HTMLElement;
      while (painted.parentElement && isTransparent(getComputedStyle(painted).backgroundColor)) {
        painted = painted.parentElement;
      }

      const bg = luminance(parse(getComputedStyle(painted).backgroundColor));
      // Colour inherits, so the foreground is read from the element that
      // actually holds the text, not from the painted ancestor.
      const fg = luminance(parse(getComputedStyle(el as HTMLElement).color));
      const [light, dark] = bg > fg ? [bg, fg] : [fg, bg];
      return (light + 0.05) / (dark + 0.05);
    });
    // WCAG AA for large/bold text.
    expect(contrast).toBeGreaterThanOrEqual(3);
  });
});
