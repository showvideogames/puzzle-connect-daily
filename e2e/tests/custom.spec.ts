/**
 * Community custom puzzles — a smoke path, not a second copy of the Full
 * suite. The gameplay engine is the same one full.spec.ts already covers;
 * what is specific here is the page around it: whose stats each control
 * opens, where the CTA leads, and the support link that must stay hidden
 * until it is configured.
 */

import { expect, test } from "../support/fixtures.ts";
import { expectNoHorizontalOverflow, tiles } from "../support/game.ts";
import { CUSTOM_PUBLIC } from "../fixtures/catalog.ts";

test.describe("A public custom puzzle", () => {
  test.beforeEach(async ({ page, seed }) => {
    const custom = seed.custom.customPublic;
    await page.goto(`/p/${custom.shortCode ?? custom.shareId}`);
    await expect(page.getByRole("heading", { name: CUSTOM_PUBLIC.title })).toBeVisible({
      timeout: 20_000,
    });
  });

  test("loads its board and its creator @smoke @responsive", async ({ page }) => {
    await expect(tiles(page)).toHaveCount(16);
    const onBoard = (await tiles(page).allInnerTexts()).map((t) => t.trim()).sort();
    expect(onBoard).toEqual(CUSTOM_PUBLIC.groups.flatMap((g) => g.words).sort());

    // An anonymous creator's name is plain text, never a link to a creator
    // page that does not exist.
    const meta = page.getByTestId("custom-meta-row");
    await expect(meta).toContainText(CUSTOM_PUBLIC.creatorName);
    await expect(meta.getByRole("link")).toHaveCount(0);

    await expectNoHorizontalOverflow(page);
  });

  test("the header's stats button opens the PLAYER's stats @smoke", async ({ page }) => {
    await page.getByRole("button", { name: "My stats" }).click();
    await expect(page.getByRole("dialog")).toContainText("My Stats");
    // Not this puzzle's stats — a different modal with a different question.
    await expect(page.getByText("This Puzzle's Stats")).toHaveCount(0);
  });

  test("Puzzle Stats opens THIS puzzle's statistics @smoke", async ({ page }) => {
    await page.getByRole("button", { name: "Puzzle Stats" }).click();
    await expect(page.getByText("This Puzzle's Stats")).toBeVisible();
    await expect(page.getByText("Statistics for this custom puzzle only.")).toBeVisible();
    await expect(page.getByText("My Stats", { exact: true })).toHaveCount(0);
  });

  test("Create Your Own routes to /create @smoke", async ({ page }) => {
    await page.getByRole("link", { name: "Create Your Own" }).click();
    await expect(page).toHaveURL(/\/create$/);
  });

  test("the support call to action stays hidden when VITE_SUPPORT_URL is unset", async ({ page }) => {
    // The CTA section itself is present; the support action inside it is not.
    await expect(page.getByTestId("custom-cta")).toBeVisible();
    await expect(page.getByRole("link", { name: /Keep the Puzzles Coming/ })).toHaveCount(0);
    await expect(
      page.getByText("Rainbow Categories is free to play.", { exact: false })
    ).toHaveCount(0);
  });

  test("a completed play is recorded in the local database and nowhere else", async ({
    page,
    seed,
    admin,
  }) => {
    const custom = seed.custom.customPublic;

    // Playing a custom puzzle writes a result row. The assertion that it
    // stays local is twofold: the row is found HERE, in the disposable
    // instance, and the fixture's request blocker fails this test if the
    // browser tried to reach anything outside 127.0.0.1 at any point.
    const before = await admin
      .from("custom_puzzle_results")
      .select("id", { count: "exact", head: true })
      .eq("custom_puzzle_id", custom.puzzleId);

    for (const group of CUSTOM_PUBLIC.groups) {
      for (const word of group.words) await page.locator(`[data-word="${word}"] button`).click();
      await page.getByRole("button", { name: "Submit", exact: true }).click();
      await expect(page.getByText(group.category)).toBeVisible({ timeout: 20_000 });
    }

    await expect(page.getByRole("button", { name: /Share Score|Copied!/ })).toBeVisible({
      timeout: 20_000,
    });

    await expect
      .poll(async () => {
        const after = await admin
          .from("custom_puzzle_results")
          .select("id", { count: "exact", head: true })
          .eq("custom_puzzle_id", custom.puzzleId);
        return (after.count ?? 0) - (before.count ?? 0);
      })
      .toBe(1);
  });
});
