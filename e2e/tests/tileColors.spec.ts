/**
 * Hand-colouring tiles — the two interfaces, and the colours each board has.
 *
 * A board offers exactly one colour per category: a Full 4×4 has
 * Yellow/Green/Blue/Red, a Mini 3×3 has Green/Blue/Red and no Yellow at all.
 * Two separate interfaces let a player apply those colours — Color Palette
 * Mode's swatch row above the board, and Color-Code Tiles' per-tile
 * double-tap picker — and they used to disagree: the palette row read the
 * puzzle format, while the picker offered a hardcoded four colours, so a Mini
 * player double-tapping a tile was shown a Yellow their board has no category
 * for.
 *
 * These run in a real browser because the picker only exists after a genuine
 * double-tap, and the @responsive tests repeat it at 375px on a touch device,
 * where the gesture is two actual taps rather than two clicks.
 */

import { expect, gotoApp, test } from "../support/fixtures.ts";
import {
  colorPicker,
  doubleTapTile,
  expectNoHorizontalOverflow,
  offeredColors,
  tile,
  tiles,
} from "../support/game.ts";
import { FULL_RAINBOW, MINI_RAINBOW } from "../fixtures/catalog.ts";

const MINI_COLORS = ["Green", "Blue", "Red"];
const FULL_COLORS = ["Yellow", "Green", "Blue", "Red"];

const miniWord = MINI_RAINBOW.groups[0].words[0];
const fullWord = FULL_RAINBOW.groups[0].words[0];

test.describe("Color Palette Mode offers one colour per category", () => {
  test.use({ settings: { colorPaletteMode: true } });

  test("Mini's swatch row is Green, Blue, Red — no Yellow @responsive", async ({ page }) => {
    await gotoApp(page, "/mini");
    await expect(tiles(page)).toHaveCount(9);

    expect(await offeredColors(page, "paint")).toEqual(MINI_COLORS);
    await expect(page.getByRole("button", { name: "Yellow paint" })).toHaveCount(0);
    await expectNoHorizontalOverflow(page);
  });

  test("the regular game's swatch row is Yellow, Green, Blue, Red", async ({ page }) => {
    await gotoApp(page, "/");
    await expect(tiles(page)).toHaveCount(16);

    expect(await offeredColors(page, "paint")).toEqual(FULL_COLORS);
  });
});

test.describe("The double-tap picker offers the same colours as the palette", () => {
  test.use({ settings: { colorCodeTiles: true } });

  test("Mini's picker is Green, Blue, Red — no Yellow @responsive", async ({ page }) => {
    await gotoApp(page, "/mini");
    await expect(tiles(page)).toHaveCount(9);

    const picker = await doubleTapTile(page, miniWord);
    expect(await offeredColors(picker, "tile color")).toEqual(MINI_COLORS);
    await expect(picker.getByRole("button", { name: "Yellow tile color" })).toHaveCount(0);

    // Opening the picker must not push the compact Mini board sideways at
    // phone width — the popover flips at the board's own right edge.
    await expectNoHorizontalOverflow(page);
  });

  test("the regular game's picker is Yellow, Green, Blue, Red", async ({ page }) => {
    await gotoApp(page, "/");
    await expect(tiles(page)).toHaveCount(16);

    const picker = await doubleTapTile(page, fullWord);
    expect(await offeredColors(picker, "tile color")).toEqual(FULL_COLORS);
  });

  test("double-tapping a Mini tile applies a colour and clears it again @responsive", async ({ page }) => {
    await gotoApp(page, "/mini");
    await expect(tiles(page)).toHaveCount(9);

    const target = tile(page, miniWord);

    const picker = await doubleTapTile(page, miniWord);
    await picker.getByRole("button", { name: "Blue tile color" }).click();
    await expect(colorPicker(page, miniWord)).toHaveCount(0);
    // Blue's fill is the same CSS variable Blue's solved bar uses.
    await expect(target).toHaveClass(/bg-group-3/);
    // Colouring is selection-neutral: the gesture marks the tile, it does not
    // leave it selected.
    await expect(target).toHaveAttribute("aria-pressed", "false");

    const reopened = await doubleTapTile(page, miniWord);
    await reopened.getByRole("button", { name: "Remove tile color" }).click();
    await expect(target).not.toHaveClass(/bg-group-3/);
  });

  test("double-tapping a regular-game tile still applies Yellow and clears it", async ({ page }) => {
    await gotoApp(page, "/");
    await expect(tiles(page)).toHaveCount(16);

    const target = tile(page, fullWord);

    const picker = await doubleTapTile(page, fullWord);
    await picker.getByRole("button", { name: "Yellow tile color" }).click();
    await expect(target).toHaveClass(/bg-group-1/);

    const reopened = await doubleTapTile(page, fullWord);
    await reopened.getByRole("button", { name: "Remove tile color" }).click();
    await expect(target).not.toHaveClass(/bg-group-1/);
  });
});
