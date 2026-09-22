/**
 * The public Full 4×4 game: today's puzzle, the real Rainbow discovery path,
 * the completed state, and the archive.
 */

import { expect, gotoApp, test } from "../support/fixtures.ts";
import {
  boardColumnCount,
  discoverRainbow,
  expectNoHorizontalOverflow,
  mistakesRemaining,
  shareButton,
  solveAllCategories,
  solveCategory,
  solvedBar,
  submitButton,
  tile,
  tiles,
} from "../support/game.ts";
import { FIXTURE_ARCHIVE_DATE, FULL_CLASSIC, FULL_RAINBOW, MINI_RAINBOW } from "../fixtures/catalog.ts";

test.describe("Public Full — the way a first-time visitor arrives", () => {
  // The only place the landing screen is not skipped. Every other test goes
  // straight to the board, because re-crossing the same one-button gate adds
  // nothing but a click.
  test.use({ skipLanding: false });

  test("the landing screen names today's puzzle and leads into it @smoke", async ({ page }) => {
    await page.goto("/");
    await expect(page.getByRole("heading", { name: "Rainbow Categories" })).toBeVisible();
    await expect(page.getByText(`Puzzle ${FULL_RAINBOW.title}`)).toBeVisible();
    await page.getByRole("button", { name: "Play", exact: true }).click();
    await expect(tiles(page)).toHaveCount(16);
  });
});

test.describe("Public Full — today's puzzle", () => {
  test.describe("on the board", () => {
    test.beforeEach(async ({ page }) => {
      await gotoApp(page, "/");
      await expect(tiles(page)).toHaveCount(16);
    });

    test("is sixteen tiles in four columns @smoke @responsive", async ({ page }) => {
      expect(await boardColumnCount(page)).toBe(4);
      // The board holds exactly this puzzle's sixteen answers.
      const onBoard = await tiles(page).allInnerTexts();
      expect(onBoard.map((t) => t.trim()).sort()).toEqual(
        FULL_RAINBOW.groups.flatMap((g) => g.words).sort()
      );
      await expectNoHorizontalOverflow(page);
    });

    test("states the Full instruction and the four-mistake allowance @smoke", async ({ page }) => {
      await expect(
        page.getByText("Select four words that share a connection!")
      ).toBeVisible();
      // The dots are decorative (aria-hidden); the status line is the real
      // announcement of how many mistakes remain.
      await expect(mistakesRemaining(page)).toHaveText("4 of 4 mistakes remaining");
    });

    test("a category can be selected and submitted @smoke", async ({ page }) => {
      const group = FULL_RAINBOW.groups[0];

      // Submit is disabled until a full selection exists — the rule that
      // stops a partial guess costing a mistake.
      await expect(submitButton(page)).toBeDisabled();
      await solveCategory(page, group);

      await expect(solvedBar(page, group.category)).toBeVisible();
      // The solved answers leave the grid.
      await expect(tiles(page)).toHaveCount(12);
      // No mistake was spent.
      await expect(mistakesRemaining(page)).toHaveText("4 of 4 mistakes remaining");
    });

    test("the Rainbow is found by selecting its answers on the board", async ({ page }) => {
      // The genuine path: the Rainbow's four answers are ordinary tiles, one
      // from each category, and submitting exactly those is the discovery.
      // (The "Spot the Rainbow" prompt is the consolation offered only after
      // every category is already solved — a different branch entirely.)
      await discoverRainbow(page, FULL_RAINBOW.rainbowHerring!);
      await expect(page.getByText(FULL_RAINBOW.rainbowCategoryName!)).toBeVisible();
      // The Rainbow answers stay on the board: they still belong to their
      // own categories and still have to be solved.
      for (const word of FULL_RAINBOW.rainbowHerring!) {
        await expect(tile(page, word)).toBeVisible();
      }
      await expect(mistakesRemaining(page)).toHaveText("4 of 4 mistakes remaining");
    });

    test("a finished game shows results, freezes, and offers sharing", async ({ page }) => {
      await discoverRainbow(page, FULL_RAINBOW.rainbowHerring!);
      await solveAllCategories(page, FULL_RAINBOW);

      // Results.
      await expect(shareButton(page)).toBeVisible({ timeout: 20_000 });
      await expect(page.getByRole("button", { name: /Global Stats/ })).toBeVisible();
      // Full deliberately never shows a solve time (PuzzleFormat.showsTimer).
      await expect(page.getByText(/^⏳/)).toHaveCount(0);
      // Play controls are gone: a finished board cannot be guessed at again.
      await expect(submitButton(page)).toHaveCount(0);

      // Frozen: a reload restores the completed board, not a fresh one.
      await page.reload();
      await expect(shareButton(page)).toBeVisible({ timeout: 20_000 });
      await expect(submitButton(page)).toHaveCount(0);
      for (const group of FULL_RAINBOW.groups) {
        await expect(solvedBar(page, group.category)).toBeVisible();
      }
    });
  });
});

test.describe("Public Full — archive", () => {
  test("the archive calendar opens the intended Full puzzle @smoke", async ({ page, seed }) => {
    await gotoApp(page, "/archive");
    await expect(page.getByRole("heading", { name: "Archive", exact: true })).toBeVisible();

    // The day cell's accessible name is the full date, so this cannot pick
    // up a "12" from somewhere else on the page.
    await page.getByRole("button", { name: new RegExp(`^${FIXTURE_ARCHIVE_DATE}`) }).click();

    await expect(page).toHaveURL(new RegExp(`/archive/${seed.official.fullClassic.id}$`));
    await expect(tiles(page)).toHaveCount(16);
    const onBoard = (await tiles(page).allInnerTexts()).map((t) => t.trim()).sort();
    expect(onBoard).toEqual(FULL_CLASSIC.groups.flatMap((g) => g.words).sort());
  });
});

test.describe("Full pages never show Mini content", () => {
  test("neither the Daily nor the Full archive leaks the Mini fixtures @smoke", async ({ page }) => {
    const miniWords = MINI_RAINBOW.groups.flatMap((g) => g.words);

    await gotoApp(page, "/");
    await expect(tiles(page)).toHaveCount(16);
    for (const word of miniWords) {
      await expect(page.locator(`[data-word="${word}"]`)).toHaveCount(0);
    }
    await expect(page.getByText(MINI_RAINBOW.title)).toHaveCount(0);

    await gotoApp(page, "/archive");
    await expect(page.getByText(MINI_RAINBOW.title)).toHaveCount(0);
    await expect(page.getByText("Mini #11")).toHaveCount(0);
  });
});
