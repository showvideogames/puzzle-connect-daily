/**
 * The showcase, shelf to play: the real Arcade Shelf with fictional Featured,
 * Editor's Picks and Newest, opening a puzzle and playing it to the end, with
 * nothing leaving the browser.
 */
import path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
import { expect, test } from "@playwright/test";

const SHOTS = path.resolve(HERE, "..", "..", "evidence", "community-showcase");

test("shelf to play: Featured, Picks and Newest, then a fictional puzzle played to the end, all offline", async ({ page }) => {
  const outside: string[] = [];
  const problems: string[] = [];
  await page.route("**/*", (route) => {
    const u = new URL(route.request().url());
    if (u.hostname === "127.0.0.1" || u.protocol === "data:" || u.protocol === "blob:") return route.continue();
    outside.push(route.request().url());
    return route.abort();
  });
  page.on("pageerror", (e) => problems.push(`page error: ${e.message}`));
  page.on("console", (m) => { if (m.type() === "error" && !/Failed to load resource/.test(m.text())) problems.push(`console: ${m.text()}`); });
  page.on("response", (r) => { if (r.status() >= 400) problems.push(`HTTP ${r.status()} ${r.url()}`); });

  await page.goto("/index.html");
  const panel = page.getByTestId("community-panel");
  await expect(panel).toHaveAttribute("aria-busy", "false");
  await expect(page.getByTestId("showcase-note")).toContainText("fictional puzzles");
  await expect(page.getByTestId("community-wordmark")).toBeVisible();
  expect(await page.getByTestId("community-wordmark").evaluate((img: HTMLImageElement) => img.naturalWidth)).toBeGreaterThan(0);
  await expect(page.getByTestId("featured-puzzle").getByTestId("card-title")).toHaveText("Pantry Raid");
  expect(await page.getByTestId("picks-grid").getByTestId("card-title").allInnerTexts()).toEqual(["Turn Of The Tides", "Something In The Air", "A Little Offbeat", "The Usual Suspects"]);
  // Newest is by listing time and includes puzzles that were never curated.
  expect(await page.getByTestId("newest-list").getByTestId("card-title").allInnerTexts()).toEqual(["Night Owls", "Garden Party", "Turn Of The Tides", "Pantry Raid", "Something In The Air", "A Little Offbeat"]);
  expect(await page.locator("main svg[data-cover]").count()).toBeGreaterThan(8);
  await page.screenshot({ path: path.join(SHOTS, "showcase-phone-390-shelf.png"), fullPage: true, animations: "disabled" });

  // Save a pick (this browser only), then play the Featured Puzzle.
  const save = page.getByTestId("picks-grid").getByRole("button", { name: "Save Turn Of The Tides to Favorites" });
  await save.click();
  await expect(save).toHaveAttribute("aria-pressed", "true");
  await page.getByRole("link", { name: "Play Puzzle Pantry Raid" }).click();
  await expect(page.getByRole("heading", { name: "Pantry Raid" })).toBeVisible();
  const groups = [
    ["Herbs & Spices", ["BASIL", "CUMIN", "NUTMEG", "THYME"]],
    ["Grains", ["BARLEY", "OATS", "RICE", "RYE"]],
    ["Baking Staples", ["FLOUR", "SALT", "SUGAR", "YEAST"]],
    ["Often Pickled", ["BEET", "CAPER", "GHERKIN", "OLIVE"]],
  ] as const;
  await page.screenshot({ path: path.join(SHOTS, "showcase-phone-390-puzzle.png"), fullPage: false, animations: "disabled" });
  for (const [category, words] of groups) {
    for (const w of words) await page.getByRole("button", { name: new RegExp(`^${w}\\b`) }).first().click();
    await page.getByRole("button", { name: "Submit" }).click();
    await expect(page.getByText(category, { exact: false }).first()).toBeVisible({ timeout: 15_000 });
  }
  // Finished: the results appear.
  await expect(page.getByRole("dialog")).toBeVisible({ timeout: 20_000 });
  await page.screenshot({ path: path.join(SHOTS, "showcase-phone-390-solved.png"), fullPage: false, animations: "disabled" });

  // Back to the shelf through the app's own menu; the saved pick is in Favorites.
  await page.keyboard.press("Escape");
  await page.getByRole("button", { name: "Menu", exact: true }).click();
  await page.getByRole("navigation", { name: "Main menu" }).getByRole("link", { name: "Community Puzzles" }).click();
  await expect(panel).toHaveAttribute("aria-busy", "false");
  await page.getByRole("navigation", { name: "Community sections" }).getByRole("link", { name: "Favorites" }).click();
  await expect(page.getByTestId("favorites-grid").getByTestId("card-title")).toHaveText(["Turn Of The Tides"]);

  // Desktop width too.
  await page.setViewportSize({ width: 1280, height: 860 });
  await page.getByRole("navigation", { name: "Community sections" }).getByRole("link", { name: "Explore" }).click();
  await expect(panel).toHaveAttribute("aria-busy", "false");
  await page.screenshot({ path: path.join(SHOTS, "showcase-desktop-1280-shelf.png"), fullPage: true, animations: "disabled" });

  expect(outside, "nothing may leave the browser").toEqual([]);
  expect(problems).toEqual([]);
});
