/**
 * Playing the game from a test.
 *
 * Selectors here follow one rule: prefer what a person can see or hear.
 * Controls are addressed by their accessible role and name ("Submit",
 * "Get a hint", "My stats"); board tiles are the one exception and use the
 * `data-word` attribute the board already carried, because a tile's visible
 * name is the answer itself and the same word also appears in the guess
 * history, the Spot-the-Rainbow picker and the solved bars — `data-word`
 * addresses the tile specifically, and nothing else.
 *
 * There are no fixed sleeps. Every wait is for a state the application
 * actually reaches: a solved bar appearing, a tile leaving the grid, a
 * toast, a storage key.
 */

import { expect, type Locator, type Page } from "@playwright/test";
import type { OfficialPuzzleFixture } from "../fixtures/catalog.ts";

/** The tile for one answer, while it is still on the board. */
export function tile(page: Page, word: string): Locator {
  return page.locator(`[data-word="${word}"] button`);
}

/** Every tile currently on the board. */
export function tiles(page: Page): Locator {
  return page.locator("[data-word] button");
}

/**
 * The grid the tiles live in. Each tile's wrapper carries `data-word`, and
 * its direct parent IS the grid, so this reads the real laid-out container
 * rather than guessing at a class name.
 */
export function board(page: Page): Locator {
  return page.locator("[data-word]").first().locator("xpath=..");
}

export function submitButton(page: Page): Locator {
  return page.getByRole("button", { name: "Submit", exact: true });
}

/**
 * The mistake counter's spoken form — "4 of 4 mistakes remaining".
 *
 * MistakeDots renders the dots themselves `aria-hidden` and puts the real
 * announcement in a `role="status"` line, so this reads the same thing a
 * screen reader would. Filtered rather than taken bare, because toast
 * regions are also status live-regions.
 */
export function mistakesRemaining(page: Page): Locator {
  return page.locator('[role="status"]').filter({ hasText: /mistakes remaining/ });
}

/**
 * The solved bar for a category, addressed by the category's own name.
 *
 * Substring, not exact: the title line holds the category name AND its
 * Category Emoji, so no element's text is ever exactly the name. Playwright's
 * text engine matches the SMALLEST element containing it, which is that title
 * line and nothing above it.
 */
export function solvedBar(page: Page, categoryName: string): Locator {
  return page.getByText(categoryName);
}

/** How many columns the tile grid is actually laid out in. */
export async function boardColumnCount(page: Page): Promise<number> {
  const grid = board(page);
  const template = await grid.evaluate((el) => getComputedStyle(el).gridTemplateColumns);
  return template.trim().split(/\s+/).length;
}

/** Selects a set of answers, asserting each one really became selected. */
export async function selectWords(page: Page, words: string[]): Promise<void> {
  for (const word of words) {
    const target = tile(page, word);
    await target.click();
    await expect(target).toHaveAttribute("aria-pressed", "true");
  }
}

/**
 * Plays one category: select its answers, submit, and wait for its solved
 * bar. Waiting on the bar (not a timeout) is what makes this safe despite
 * the board's reveal animation.
 */
export async function solveCategory(
  page: Page,
  group: { category: string; words: string[] }
): Promise<void> {
  await selectWords(page, group.words);
  await submitButton(page).click();
  await expect(solvedBar(page, group.category)).toBeVisible({ timeout: 20_000 });
}

/**
 * Finds the Rainbow the way a player does: select exactly the Rainbow
 * answers on the board and submit. This is the real path — not the bonus
 * "Spot the Rainbow" prompt that appears after every category is already
 * solved — so it exercises the same branch in useGame that a genuine
 * discovery takes.
 */
export async function discoverRainbow(page: Page, herring: string[]): Promise<void> {
  await selectWords(page, herring);
  await submitButton(page).click();
  // Waits on the tiles' PERMANENT state, not the "🌈 Rainbow Spotted!" popup,
  // which hides itself after three seconds — a check that raced the popup
  // would pass on a fast machine and fail on a loaded CI runner.
  for (const word of herring) {
    await expect(tile(page, word)).toHaveClass(/rainbow-tile/, { timeout: 20_000 });
  }
}

/** Solves every ordinary category, in the fixture's own order. */
export async function solveAllCategories(page: Page, fixture: OfficialPuzzleFixture): Promise<void> {
  for (const group of fixture.groups) {
    // A category whose answers were consumed by an earlier solve is already
    // gone; solveCategory would fail on a missing tile, so skip it.
    if (await solvedBar(page, group.category).isVisible().catch(() => false)) continue;
    await solveCategory(page, group);
  }
}

/** The end-of-game results block: headline, share row and stats controls. */
export function shareButton(page: Page): Locator {
  return page.getByRole("button", { name: /Share Score|Copied!/ });
}

/** Reads the text the Share Score button copied to the clipboard. */
export async function copiedShareText(page: Page): Promise<string> {
  await shareButton(page).click();
  await expect(page.getByRole("button", { name: "Copied!" })).toBeVisible();
  return page.evaluate(() => navigator.clipboard.readText());
}

/**
 * Asserts the document does not scroll sideways.
 *
 * Compared on the documentElement rather than by screenshot: a one-pixel
 * antialiasing difference is not a bug, an element pushing the page wider
 * than the viewport is. The 1px tolerance covers sub-pixel layout rounding,
 * which browsers do produce legitimately.
 */
export async function expectNoHorizontalOverflow(page: Page): Promise<void> {
  const overflow = await page.evaluate(() => {
    const doc = document.documentElement;
    return {
      scrollWidth: doc.scrollWidth,
      clientWidth: doc.clientWidth,
      widest: Array.from(document.querySelectorAll<HTMLElement>("body *"))
        .filter((el) => el.getBoundingClientRect().right > doc.clientWidth + 1)
        .slice(0, 3)
        .map((el) => `${el.tagName.toLowerCase()}.${el.className?.toString().slice(0, 60)}`),
    };
  });
  expect(
    overflow.scrollWidth,
    `the page scrolls sideways (${overflow.scrollWidth}px > ${overflow.clientWidth}px). ` +
      `Widest offenders: ${overflow.widest.join(" | ") || "none identified"}`
  ).toBeLessThanOrEqual(overflow.clientWidth + 1);
}

/** Signs in through the real Admin login form. */
export async function signInAsAdmin(
  page: Page,
  credentials: { email: string; password: string }
): Promise<void> {
  await page.goto("/admin");
  await expect(page.getByRole("heading", { name: "Admin Login" })).toBeVisible();
  await page.getByLabel("Email", { exact: true }).fill(credentials.email);
  await page.getByLabel("Password", { exact: true }).fill(credentials.password);
  await page.getByRole("button", { name: "Sign In", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Puzzle Admin" })).toBeVisible({ timeout: 20_000 });
}

/** The localStorage progress blob for one attempt, or null. */
export async function readProgress(page: Page, storageId: string): Promise<Record<string, unknown> | null> {
  return page.evaluate((key) => {
    const raw = window.localStorage.getItem(`connections-progress-${key}`);
    return raw ? (JSON.parse(raw) as Record<string, unknown>) : null;
  }, storageId);
}
