/**
 * The end-of-game results popup and View Results.
 *
 * The rules that matter most are the ones a person can't see: opening,
 * closing, reopening and reloading the results must never save another
 * completion or move the streak again. Those are read straight from the
 * local database, for this test's own guest device.
 */

import type { Page } from "@playwright/test";
import type { SupabaseClient } from "@supabase/supabase-js";
import { expect, gotoApp, test } from "../support/fixtures.ts";
import {
  closeResults,
  copiedShareText,
  discoverRainbow,
  expectNoHorizontalOverflow,
  resultsDialog,
  solveAllCategories,
  submitButton,
  tile,
  viewResultsButton,
} from "../support/game.ts";
import { FULL_RAINBOW } from "../fixtures/catalog.ts";

async function deviceId(page: Page): Promise<string> {
  const id = await page.evaluate(() => window.localStorage.getItem("rc-device-id"));
  if (!id) throw new Error("no guest device id");
  return id;
}

/** This device's completed games and Full streak, from the local database. */
async function savedRecord(admin: SupabaseClient, device: string) {
  const sessions = await admin.from("game_sessions").select("status, is_official").eq("device_id", device);
  const streaks = await admin
    .from("user_streaks")
    .select("current_streak, format")
    .eq("device_id", device)
    .eq("format", "full");
  if (sessions.error) throw sessions.error;
  if (streaks.error) throw streaks.error;
  return {
    completed: (sessions.data ?? []).filter((s) => s.status === "won" || s.status === "lost").length,
    streaks: (streaks.data ?? []).map((s) => s.current_streak as number),
  };
}

const flame = (page: Page) => resultsDialog(page).getByTestId("streak-flame");
const spotPrompt = (page: Page) => page.getByTestId("spot-rainbow-prompt");

/** Four wrong guesses, each one word from every category: never one away. */
async function loseTheGame(page: Page) {
  const [a, b, c, d] = FULL_RAINBOW.groups.map((g) => g.words);
  const guesses = [
    [a[0], b[1], c[2], d[3]],
    [a[1], b[2], c[3], d[0]],
    [a[2], b[3], c[0], d[1]],
    [a[3], b[0], c[1], d[2]],
  ];
  for (const [i, guess] of guesses.entries()) {
    // Never the Rainbow itself.
    if ([...guess].sort().join() === [...FULL_RAINBOW.rainbowHerring!].sort().join()) throw new Error("bad fixture guess");
    for (const w of guess) await tile(page, w).click();
    await submitButton(page).click();
    if (i === guesses.length - 1) break;
    // A wrong guess leaves its tiles selected; clear them for the next one.
    const deselect = page.getByRole("button", { name: "Deselect All" });
    await expect(deselect).toBeEnabled({ timeout: 10_000 });
    await deselect.click();
  }
}

test.describe("Results popup", () => {
  test.beforeEach(async ({ page }) => {
    await gotoApp(page, "/");
    await expect(tile(page, FULL_RAINBOW.groups[0].words[0])).toBeVisible();
  });

  test("a Daily win opens it once; reopening and reloading never save again or replay the streak", async ({
    page,
    admin,
  }) => {
    await solveAllCategories(page, FULL_RAINBOW);

    await expect(resultsDialog(page)).toBeVisible({ timeout: 20_000 });
    await expect(resultsDialog(page).getByRole("heading")).toHaveText("Perfect!");
    await expect(flame(page)).toHaveAttribute("data-earned", "true");
    await expect(flame(page)).toContainText("1 day streak");

    const device = await deviceId(page);
    await expect.poll(() => savedRecord(admin, device)).toEqual({ completed: 1, streaks: [1] });

    // The popup fits the screen and keeps its close button reachable.
    const box = await resultsDialog(page).boundingBox();
    const viewport = page.viewportSize()!;
    expect(box!.y).toBeGreaterThanOrEqual(0);
    expect(box!.y + box!.height).toBeLessThanOrEqual(viewport.height + 1);
    await expect(page.getByRole("button", { name: "Close results" })).toBeInViewport();
    await expectNoHorizontalOverflow(page);

    // Escape closes it.
    await page.keyboard.press("Escape");
    await expect(resultsDialog(page)).toHaveCount(0);

    // Reopen: the same results, the flame shown still.
    await viewResultsButton(page).click();
    await expect(resultsDialog(page).getByRole("heading")).toHaveText("Perfect!");
    await expect(flame(page)).toHaveAttribute("data-earned", "false");
    await closeResults(page);

    // Reload: no popup by itself; View Results still works.
    await page.reload();
    await expect(viewResultsButton(page)).toBeVisible({ timeout: 20_000 });
    await expect(resultsDialog(page)).toHaveCount(0);
    await viewResultsButton(page).click();
    await expect(flame(page)).toHaveAttribute("data-earned", "false");
    await expect(flame(page)).toContainText("1 day streak");

    expect(await savedRecord(admin, device)).toEqual({ completed: 1, streaks: [1] });
  });

  test("without the Rainbow, its top space folds away and a later find lands below the categories", async ({
    page,
    admin,
  }) => {
    await solveAllCategories(page, FULL_RAINBOW);
    await expect(resultsDialog(page)).toBeVisible({ timeout: 20_000 });

    // The empty Rainbow/instruction space has gone; the categories moved up.
    await expect(page.getByTestId("rainbow-slot")).toHaveCount(0);
    const before = await copiedShareText(page);
    expect(before).not.toContain("🌈");

    // Spot the Rainbow from the popup: it closes and the real challenge opens.
    // force: the card breathes (scales) forever, so it is never "still" in
    // Playwright's sense; a person can tap it any time.
    await resultsDialog(page).getByTestId("spot-rainbow-prompt").click({ force: true });
    await expect(resultsDialog(page)).toHaveCount(0);
    const challenge = page.getByRole("dialog");
    for (const w of FULL_RAINBOW.rainbowHerring!) await challenge.getByRole("button", { name: w, exact: true }).click();
    await challenge.getByRole("button", { name: "Submit", exact: true }).click();

    // Found: below the solved categories, never back in the top slot.
    const late = page.getByTestId("late-rainbow");
    await expect(late.getByText(FULL_RAINBOW.rainbowCategoryName!)).toBeVisible({ timeout: 10_000 });
    await expect(page.getByTestId("rainbow-slot")).toHaveCount(0);
    const bars = await page.getByTestId("solved-bars").boundingBox();
    const lateBox = await late.boundingBox();
    expect(lateBox!.y).toBeGreaterThanOrEqual(bars!.y + bars!.height - 1);

    // View Results carries the Rainbow now; the outcome and streak don't change.
    await viewResultsButton(page).click();
    await expect(resultsDialog(page).getByRole("heading")).toHaveText("Perfect!");
    await expect(spotPrompt(page)).toHaveCount(0);
    expect(await copiedShareText(page)).toContain("🌈");
    const device = await deviceId(page);
    expect(await savedRecord(admin, device)).toEqual({ completed: 1, streaks: [1] });
  });

  test("a Rainbow found during play keeps its place at the top", async ({ page }) => {
    await discoverRainbow(page, FULL_RAINBOW.rainbowHerring!);
    await solveAllCategories(page, FULL_RAINBOW);
    await expect(resultsDialog(page)).toBeVisible({ timeout: 20_000 });
    await closeResults(page);
    await expect(page.getByTestId("rainbow-slot").getByText(FULL_RAINBOW.rainbowCategoryName!)).toBeVisible();
    await expect(page.getByTestId("late-rainbow")).toHaveCount(0);
  });

  test("a loss opens its results after the reveal, with no flame and the Rainbow still on offer", async ({
    page,
  }) => {
    await loseTheGame(page);
    await expect(resultsDialog(page)).toBeVisible({ timeout: 20_000 });
    await expect(resultsDialog(page).getByRole("heading")).toHaveText("Onward!");
    await expect(resultsDialog(page).getByTestId("results-stats")).toContainText("Played");
    await expect(flame(page)).toHaveCount(0);
    await expect(resultsDialog(page).getByTestId("spot-rainbow-prompt")).toBeVisible();
    await closeResults(page);
    // Every category is on the board, in solve-then-reveal order, with the
    // Rainbow's invitation below them and View Results below the board.
    await expect(page.getByTestId("rainbow-slot")).toHaveCount(0);
    await expect(page.getByTestId("late-rainbow").getByTestId("spot-rainbow-prompt")).toBeVisible();
    await expect(viewResultsButton(page)).toBeVisible();
  });
});
