/**
 * The public Mini 3×3 game.
 *
 * Mini is the same engine configured with a different format, so these tests
 * concentrate on the places where "configured differently" could silently
 * fall back to Full behaviour: the board shape, the three-answer group, a
 * three-answer Rainbow, the timer, and the share text.
 */

import { expect, gotoApp, test } from "../support/fixtures.ts";
import {
  boardColumnCount,
  copiedShareText,
  discoverRainbow,
  expectNoHorizontalOverflow,
  shareButton,
  solveAllCategories,
  solveCategory,
  solvedBar,
  submitButton,
  tile,
  tiles,
} from "../support/game.ts";
import {
  FIXTURE_ARCHIVE_DATE,
  FULL_RAINBOW,
  MINI_CLASSIC,
  MINI_RAINBOW,
} from "../fixtures/catalog.ts";

test.describe("Public Mini — today's puzzle", () => {
  test.beforeEach(async ({ page }) => {
    await gotoApp(page, "/mini");
    await expect(tiles(page)).toHaveCount(9);
  });

  test("is nine square tiles in three columns @smoke @responsive", async ({ page }) => {
    expect(await boardColumnCount(page)).toBe(3);

    const onBoard = (await tiles(page).allInnerTexts()).map((t) => t.trim()).sort();
    expect(onBoard).toEqual(MINI_RAINBOW.groups.flatMap((g) => g.words).sort());

    // Square, not the Full board's wider tile. Measured, not screenshotted:
    // the aspect ratio is the actual product rule ("nine square tiles").
    const box = await tile(page, MINI_RAINBOW.wordOrder[0]).boundingBox();
    expect(box).not.toBeNull();
    expect(Math.abs(box!.width - box!.height)).toBeLessThanOrEqual(2);

    await expectNoHorizontalOverflow(page);
  });

  test("groups are three answers, and say so @smoke", async ({ page }) => {
    await expect(page.getByText("Select three words that share a connection!")).toBeVisible();

    const group = MINI_RAINBOW.groups[0];
    await solveCategory(page, group);
    await expect(solvedBar(page, group.category)).toBeVisible();
    await expect(tiles(page)).toHaveCount(6);
  });

  test("the Rainbow is three genuine answers, one per category", async ({ page }) => {
    const herring = MINI_RAINBOW.rainbowHerring!;
    expect(herring).toHaveLength(3);
    // Each Rainbow answer belongs to a different category — the size rule
    // that makes a Mini Rainbow a Mini Rainbow.
    const owners = herring.map((word) =>
      MINI_RAINBOW.groups.findIndex((g) => g.words.includes(word))
    );
    expect(new Set(owners).size).toBe(3);

    await discoverRainbow(page, herring);
    await expect(page.getByText(MINI_RAINBOW.rainbowCategoryName!)).toBeVisible();
  });

  test("the running time is hidden during play and frozen once the game ends", async ({ page }) => {
    // Nothing clock-shaped while the game is live.
    await expect(page.getByText(/^⏳/)).toHaveCount(0);

    await discoverRainbow(page, MINI_RAINBOW.rainbowHerring!);
    await solveAllCategories(page, MINI_RAINBOW);

    const timer = page.getByText(/^⏳/);
    await expect(timer).toBeVisible({ timeout: 20_000 });
    const frozen = await timer.innerText();

    // Frozen means frozen: it still reads the same after the page has been
    // sitting there, and after a reload.
    await expect(submitButton(page)).toHaveCount(0);
    await page.reload();
    await expect(page.getByText(/^⏳/)).toHaveText(frozen, { timeout: 20_000 });
  });

  test("sharing a Mini result says Mini, three squares wide, with the time", async ({ page }) => {
    await discoverRainbow(page, MINI_RAINBOW.rainbowHerring!);
    await solveAllCategories(page, MINI_RAINBOW);
    await expect(shareButton(page)).toBeVisible({ timeout: 20_000 });

    const text = await copiedShareText(page);
    // Split on /\r?\n/, not "\n": reading back from the SYSTEM clipboard on
    // Windows returns CRLF even though the app joined the lines with "\n".
    // A bare "\n" split leaves a stray carriage return on the end of every
    // line, and the heading then compares unequal for a reason that is not
    // a bug in the app — the same test would pass on Linux and fail here.
    const lines = text.trim().split(/\r?\n/);

    // Heading: the format's name plus the puzzle's own number. A bare "#12"
    // over a 3-wide grid would read as a broken Full result.
    expect(lines[0]).toBe(MINI_RAINBOW.title);

    // Every grid row is three symbols wide. Emoji are surrogate pairs, so
    // count code points, not UTF-16 units.
    const gridRows = lines.filter((line) => /^[🟨🟩🟦🟥🌈]+$/u.test(line));
    expect(gridRows.length).toBeGreaterThanOrEqual(4); // rainbow + three categories
    for (const row of gridRows) {
      expect([...row]).toHaveLength(3);
    }

    // The solve time sits between the grid and the address.
    expect(text).toMatch(/\n⏳ /);
    expect(lines[lines.length - 1]).toMatch(/\/mini$/);
  });
});

test.describe("Public Mini — the Rainbow tile can also be colour-marked", () => {
  // Painting is off by default; this is the setting that turns the palette on.
  test.use({ settings: { colorPaletteMode: true } });

  test("a revealed Rainbow tile accepts a regular category colour", async ({ page }) => {
    await gotoApp(page, "/mini");
    await expect(tiles(page)).toHaveCount(9);

    const herring = MINI_RAINBOW.rainbowHerring!;
    await discoverRainbow(page, herring);

    // Paint one of the revealed Rainbow tiles with an ordinary category
    // colour — the player recording which normal group they think it is in.
    await page.getByRole("button", { name: "Green paint" }).click();
    await tile(page, herring[0]).click();

    // The annotation is a dedicated inset ring drawn inside the tile, kept
    // separate from the tile's own selection border on purpose.
    const ring = page.locator(`[data-word="${herring[0]}"] span[aria-hidden="true"]`);
    await expect(ring).toHaveCount(1);
    await expect(ring).toHaveClass(/border-/);
  });
});

test.describe("Public Mini — archive", () => {
  test("contains only Mini puzzles, and opens the intended one @smoke", async ({ page, seed }) => {
    await gotoApp(page, "/mini/archive");
    await expect(page.getByRole("heading", { name: "Mini Archive" })).toBeVisible();

    await page.getByRole("button", { name: new RegExp(`^${FIXTURE_ARCHIVE_DATE}`) }).click();
    await expect(page).toHaveURL(new RegExp(`/mini/archive/${seed.official.miniClassic.id}$`));

    await expect(tiles(page)).toHaveCount(9);
    const onBoard = (await tiles(page).allInnerTexts()).map((t) => t.trim()).sort();
    expect(onBoard).toEqual(MINI_CLASSIC.groups.flatMap((g) => g.words).sort());
  });

  test("a Mini archive day that only a Full puzzle occupies is not offered", async ({ page }) => {
    // Both formats publish on the same two dates in the fixtures, so this
    // checks the stronger property: the Mini archive opens a MINI puzzle for
    // a shared date, never the Full one that also lives there.
    await gotoApp(page, "/mini/archive");
    await page.getByRole("button", { name: new RegExp(`^${FIXTURE_ARCHIVE_DATE}`) }).click();
    await expect(page).not.toHaveURL(/\/mini\/archive\/undefined/);
    const onBoard = (await tiles(page).allInnerTexts()).map((t) => t.trim());
    expect(onBoard).not.toContain(FULL_RAINBOW.groups[0].words[0]);
  });
});

test.describe("Mini pages never show Full content", () => {
  test("the Mini Daily holds none of the Full fixture's answers @smoke", async ({ page }) => {
    await gotoApp(page, "/mini");
    await expect(tiles(page)).toHaveCount(9);
    for (const word of FULL_RAINBOW.groups.flatMap((g) => g.words)) {
      await expect(page.locator(`[data-word="${word}"]`)).toHaveCount(0);
    }
    await expect(page.getByText(FULL_RAINBOW.title)).toHaveCount(0);
  });
});
