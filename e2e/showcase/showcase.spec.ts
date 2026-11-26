/**
 * The showcase, shelf to play: the real Arcade Shelf with fictional Featured,
 * Editor's Picks and Newest, opening a puzzle and playing it to the end, with
 * nothing leaving the browser.
 */
import path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
import { expect, test, type Locator, type Page } from "@playwright/test";

const SHOTS = path.resolve(HERE, "..", "..", "evidence", "community-showcase");

/** Every emoji glyph of a cover sits inside its art and no two overlap. */
async function glyphsFit(art: Locator) {
  const box = (await art.boundingBox())!;
  const glyphs = await art.locator("[data-cover-glyph]").evaluateAll((els) => els.map((e) => {
    const r = document.createRange();
    r.selectNodeContents(e);
    const b = r.getBoundingClientRect();
    return { x: b.x, y: b.y, w: b.width, h: b.height };
  }));
  for (const g of glyphs) {
    expect(g.w).toBeGreaterThan(8);
    expect(g.x).toBeGreaterThanOrEqual(box.x - 0.5);
    expect(g.x + g.w).toBeLessThanOrEqual(box.x + box.width + 0.5);
  }
  for (let i = 1; i < glyphs.length; i++) expect(glyphs[i].x).toBeGreaterThanOrEqual(glyphs[i - 1].x + glyphs[i - 1].w - 0.5);
  return glyphs.length;
}

async function solve(page: Page, groups: readonly (readonly [string, readonly string[]])[]) {
  for (const [category, words] of groups) {
    for (const w of words) await page.getByRole("button", { name: new RegExp(`^${w}\\b`) }).first().click();
    await page.getByRole("button", { name: "Submit" }).click();
    await expect(page.getByText(category, { exact: false }).first()).toBeVisible({ timeout: 15_000 });
  }
  await expect(page.getByRole("dialog")).toBeVisible({ timeout: 20_000 });
}

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
  expect(await page.getByTestId("newest-list").getByTestId("card-title").allInnerTexts()).toEqual(["Night Owls", "Garden Party", "Pantry Raid", "Out of Orbit", "Turn Of The Tides", "Something In The Air"]);
  // Newest shows each puzzle's stored creator cover (one to three emoji, one background); Editor's Picks keep the illustrations.
  const newestArt = page.getByTestId("newest-list").locator("[data-cover-kind]");
  const covers = await newestArt.evaluateAll((els) => els.map((e) => [e.getAttribute("data-cover-kind"), e.getAttribute("data-cover-emoji"), e.getAttribute("data-cover-background")]));
  expect(covers.slice(0, 4)).toEqual([["creator", "1F989", "indigo-stars"], ["creator", "1F438 1F337", "lime-checks"], ["creator", "1F37F", "apricot-stripes"], ["creator", "1FA90 1F680 2B50-FE0F", "lilac-dots"]]);
  expect(covers[4][0]).toBe("default");
  // The small Newest thumbnails at phone width: 1, 2 and 3 emoji all fit without overlapping.
  expect(await glyphsFit(newestArt.nth(0))).toBe(1);
  expect(await glyphsFit(newestArt.nth(1))).toBe(2);
  expect(await glyphsFit(newestArt.nth(3))).toBe(3);
  await page.getByTestId("newest-list").getByTestId("community-card").nth(3).screenshot({ path: path.join(SHOTS, "showcase-phone-390-newest-three-emoji.png"), animations: "disabled" });

  // Sort: Newest is the default; Most Played and Most Liked rank the whole pool differently.
  const sort = page.getByRole("group", { name: "Sort puzzles" });
  await expect(sort.getByRole("button", { name: "Newest" })).toHaveAttribute("aria-pressed", "true");
  await sort.getByRole("button", { name: "Most Played" }).click();
  await expect(page.locator("#newest-heading")).toHaveText("Most Played");
  await expect(page.getByTestId("newest-list").getByTestId("card-title")).toHaveText(["A Little Offbeat", "Something In The Air", "The Usual Suspects", "Pantry Raid", "Turn Of The Tides", "Out of Orbit"]);
  await sort.getByRole("button", { name: "Most Liked" }).click();
  await expect(page.locator("#newest-heading")).toHaveText("Most Liked");
  await expect(page.getByTestId("newest-list").getByTestId("card-title")).toHaveText(["Pantry Raid", "A Little Offbeat", "Something In The Air", "The Usual Suspects", "Turn Of The Tides", "Out of Orbit"]);
  await page.screenshot({ path: path.join(SHOTS, "showcase-phone-390-sort-most-liked.png"), fullPage: false, animations: "disabled" });
  // Featured and Editor's Picks keep their editorial order whatever the sort.
  await expect(page.getByTestId("featured-puzzle").getByTestId("card-title")).toHaveText("Pantry Raid");
  expect(await page.getByTestId("picks-grid").getByTestId("card-title").allInnerTexts()).toEqual(["Turn Of The Tides", "Something In The Air", "A Little Offbeat", "The Usual Suspects"]);
  // See all keeps the sort.
  await page.getByRole("link", { name: "See all most liked puzzles" }).click();
  await expect(page.getByRole("group", { name: "Sort puzzles" }).getByRole("button", { name: "Most Liked" })).toHaveAttribute("aria-pressed", "true");
  await expect(page.getByTestId("newest-all-list").getByTestId("card-title").first()).toHaveText("Pantry Raid");
  await page.getByRole("navigation", { name: "Community sections" }).getByRole("link", { name: "Explore" }).click();
  await expect(panel).toHaveAttribute("aria-busy", "false");
  await expect(page.getByRole("group", { name: "Sort puzzles" }).getByRole("button", { name: "Newest" })).toHaveAttribute("aria-pressed", "true");
  expect(await page.getByTestId("picks-grid").locator("svg[data-cover]").count()).toBe(4);
  expect(await page.getByTestId("picks-grid").locator("[data-cover-kind]").count()).toBe(0);
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
  // Finished: the results appear. A guest plays normally and is offered no rating.
  await solve(page, groups);
  await expect(page.getByRole("dialog").getByTestId("custom-rating")).toHaveCount(0);
  await page.screenshot({ path: path.join(SHOTS, "showcase-phone-390-solved.png"), fullPage: false, animations: "disabled" });

  // Back to the shelf through the app's own menu; the saved pick is in Favorites.
  await page.keyboard.press("Escape");
  await page.getByRole("button", { name: "Menu", exact: true }).click();
  await page.getByRole("navigation", { name: "Main menu" }).getByRole("link", { name: "Community Puzzles" }).click();
  await expect(panel).toHaveAttribute("aria-busy", "false");
  await page.getByRole("navigation", { name: "Community sections" }).getByRole("link", { name: "Favorites" }).click();
  await expect(page.getByTestId("favorites-grid").getByTestId("card-title")).toHaveText(["Turn Of The Tides"]);

  // Create → pick a cover → publish (demo) → see the card.
  await page.getByRole("navigation", { name: "Community sections" }).getByRole("link", { name: "Explore" }).click();
  await expect(panel).toHaveAttribute("aria-busy", "false");
  await page.getByRole("link", { name: "Create A Puzzle" }).click();
  await expect(page.getByRole("heading", { name: "Make A Cover" })).toBeVisible();
  await page.getByLabel("Puzzle title").fill("Frog Friends");
  await expect(page.getByTestId("cover-emoji-grid").getByRole("option")).not.toHaveCount(0);
  await page.getByRole("searchbox", { name: "Search emojis" }).fill("frog");
  const frog = page.getByRole("option", { name: "frog", exact: true });
  await frog.click();
  await expect(frog).toHaveAttribute("aria-selected", "true");
  await page.keyboard.press("ArrowRight"); // keyboard moves within the grid
  await expect(page.getByTestId("cover-emoji-grid").locator(":focus")).toHaveCount(1);
  // Rainbow comes first among the backgrounds.
  await expect(page.getByTestId("cover-backgrounds").getByRole("radio").first()).toHaveAccessibleName("Rainbow");
  await page.getByRole("radio", { name: "Lime checks" }).click();
  await expect(page.getByTestId("cover-selection")).toHaveText("Frog on Lime checks");
  const preview = page.getByTestId("cover-preview").locator("[data-cover-kind=creator]");
  await expect(preview).toHaveAttribute("data-cover-emoji", "1F438");
  await expect(preview).toHaveAttribute("data-cover-background", "lime-checks");
  // A second and a third emoji, shown in the tray in order.
  await page.getByRole("searchbox", { name: "Search emojis" }).fill("tulip");
  await page.getByRole("option", { name: "tulip", exact: true }).click();
  await expect(preview).toHaveAttribute("data-cover-emoji", "1F438 1F337");
  await page.getByRole("searchbox", { name: "Search emojis" }).fill("star");
  await page.getByRole("option", { name: "star", exact: true }).click();
  await expect(preview).toHaveAttribute("data-cover-count", "3");
  await expect(page.getByTestId("cover-chosen")).toContainText("3 of 3");
  await expect(page.getByTestId("cover-selection")).toHaveText("Frog, tulip, star on Lime checks");
  // A fourth is refused with a note; reorder and remove work from the tray.
  await page.getByRole("searchbox", { name: "Search emojis" }).fill("owl");
  await page.getByRole("option", { name: "owl", exact: true }).click();
  await expect(page.getByText("Up to three emoji. Remove one to add another.")).toBeVisible();
  await expect(preview).toHaveAttribute("data-cover-emoji", "1F438 1F337 2B50-FE0F");
  await page.getByRole("button", { name: "Move star left" }).click();
  await expect(preview).toHaveAttribute("data-cover-emoji", "1F438 2B50-FE0F 1F337");
  await page.getByRole("button", { name: "Remove tulip" }).click();
  await expect(preview).toHaveAttribute("data-cover-emoji", "1F438 2B50-FE0F");
  await page.getByRole("searchbox", { name: "Search emojis" }).fill("tulip");
  await page.getByRole("option", { name: "tulip", exact: true }).click();
  await expect(preview).toHaveAttribute("data-cover-emoji", "1F438 2B50-FE0F 1F337");
  expect(await glyphsFit(preview)).toBe(3);
  // Each emoji has its own Size slider; neighbours keep theirs.
  await expect(preview).toHaveAttribute("data-cover-sizes", "100 100 100");
  await page.getByRole("slider", { name: "Frog size" }).fill("200");
  await page.getByRole("slider", { name: "Tulip size" }).fill("60");
  await expect(preview).toHaveAttribute("data-cover-sizes", "200 100 60");
  await page.getByTestId("cover-picker").scrollIntoViewIfNeeded();
  await page.screenshot({ path: path.join(SHOTS, "showcase-phone-390-make-a-cover.png"), fullPage: true, animations: "disabled" });
  await page.getByRole("button", { name: "Publish demo" }).click();
  await expect(panel).toHaveAttribute("aria-busy", "false");
  expect((await page.getByTestId("newest-list").getByTestId("card-title").allInnerTexts())[0]).toBe("Frog Friends");
  // The Newest thumbnail is the same art as the preview.
  const card = page.getByTestId("newest-list").getByTestId("community-card").first().locator("[data-cover-kind]");
  await expect(card).toHaveAttribute("data-cover-emoji", "1F438 2B50-FE0F 1F337");
  await expect(card).toHaveAttribute("data-cover-background", "lime-checks");
  await expect(card).toHaveAttribute("data-cover-sizes", "200 100 60");
  expect(await card.evaluate((e) => getComputedStyle(e).overflow)).toBe("hidden");
  await page.screenshot({ path: path.join(SHOTS, "showcase-phone-390-published.png"), fullPage: true, animations: "disabled" });
  // The same stored cover on the puzzle's own page.
  await page.getByTestId("newest-list").getByRole("link", { name: "Play Frog Friends" }).click();
  await expect(page.getByRole("heading", { name: "Frog Friends" })).toBeVisible();
  await expect(page.getByTestId("puzzle-cover").locator("[data-cover-kind]")).toHaveAttribute("data-cover-emoji", "1F438 2B50-FE0F 1F337");
  await expect(page.getByTestId("puzzle-cover").locator("[data-cover-kind]")).toHaveAttribute("data-cover-background", "lime-checks");
  await expect(page.getByTestId("puzzle-cover").locator("[data-cover-kind]")).toHaveAttribute("data-cover-sizes", "200 100 60");

  // Signed in (the fictional Demo Player): finish a puzzle, rate it, then change the rating.
  await page.getByTestId("showcase-account").click();
  await expect(page.getByTestId("showcase-note")).toContainText("Demo Player");
  await page.getByRole("button", { name: "Menu", exact: true }).click();
  await page.getByRole("navigation", { name: "Main menu" }).getByRole("link", { name: "Community Puzzles" }).click();
  await expect(panel).toHaveAttribute("aria-busy", "false");
  await page.getByTestId("picks-grid").getByRole("link", { name: "Play Turn Of The Tides" }).click();
  await expect(page.getByRole("heading", { name: "Turn Of The Tides" })).toBeVisible();
  await solve(page, [
    ["Sea Creatures", ["CLAM", "CRAB", "EEL", "SQUID"]],
    ["Parts Of A Boat", ["DECK", "HULL", "KEEL", "MAST"]],
    ["Beach Bag", ["BUCKET", "SPADE", "SUNHAT", "TOWEL"]],
    ["Moving Water", ["RIPPLE", "SURGE", "SWELL", "WAVE"]],
  ]);
  const rating = page.getByRole("dialog").getByTestId("custom-rating");
  await expect(rating).toBeVisible();
  await expect(rating.getByRole("group", { name: "Rate this puzzle" }).getByRole("button")).toHaveCount(5);
  await rating.getByRole("button", { name: "4 stars" }).click();
  await expect(rating.getByTestId("custom-rating-note")).toHaveText("Saved: 4 of 5");
  await expect(rating.getByRole("button", { name: "4 stars" })).toHaveAttribute("aria-pressed", "true");
  await rating.scrollIntoViewIfNeeded();
  await page.screenshot({ path: path.join(SHOTS, "showcase-phone-390-rated.png"), fullPage: false, animations: "disabled" });
  await rating.getByRole("button", { name: "2 stars" }).click();
  await expect(rating.getByTestId("custom-rating-note")).toHaveText("Updated: 2 of 5");
  await expect(rating.getByRole("button", { name: "2 stars" })).toHaveAttribute("aria-pressed", "true");
  await expect(rating.getByRole("button", { name: "4 stars" })).toHaveAttribute("aria-pressed", "false");
  await page.keyboard.press("Escape");

  // My Puzzles, from the account area of Settings: the Demo Player's own puzzles, newest first.
  await page.getByRole("button", { name: "Settings and menu" }).click();
  await page.getByRole("button", { name: "My Puzzles" }).click();
  const library = page.getByTestId("my-puzzles");
  await expect(library).toHaveAttribute("aria-busy", "false");
  await expect(page.getByTestId("my-puzzles-list").getByRole("heading", { level: 2 })).toHaveText(["Frog Friends", "Secret Santa Swap", "Lantern Festival", "Mixtape Memories"]);
  const mine = (title: string) => page.getByTestId("my-puzzle").filter({ has: page.getByRole("heading", { name: title, exact: true }) });
  await expect(mine("Secret Santa Swap").getByTestId("my-puzzle-status")).toHaveText("Private");
  await expect(mine("Secret Santa Swap").getByRole("button", { name: /^List / })).toHaveCount(0);
  await expect(mine("Lantern Festival").getByTestId("my-puzzle-status")).toHaveText("In Community");
  await expect(mine("Mixtape Memories").getByTestId("my-puzzle-status")).toHaveText("Link only");
  await expect(library).not.toContainText("Pantry Raid");
  await page.screenshot({ path: path.join(SHOTS, "showcase-phone-390-my-puzzles.png"), fullPage: true, animations: "disabled" });
  // Public name: the first rename is immediate and starts the 30-day wait.
  const publicName = page.getByRole("textbox", { name: "Public name" });
  await expect(publicName).toHaveValue("Demo Player");
  await publicName.fill("Demo Pal");
  await page.getByRole("button", { name: "Save name" }).click();
  await expect(page.getByText("Public name saved.")).toBeVisible();
  await expect(page.locator("#public-name-limit")).toContainText("You can change it again on");
  await expect(publicName).toHaveAttribute("readonly", "");
  // The older music puzzle gets a cover and goes into Community, then back out.
  await mine("Mixtape Memories").getByRole("button", { name: "Add a cover for Mixtape Memories" }).click();
  await page.getByTestId("cover-picker").getByRole("searchbox", { name: "Search emojis" }).fill("headphone");
  await page.getByTestId("cover-picker").getByRole("option", { name: "headphone", exact: true }).click();
  await page.getByTestId("cover-picker").getByRole("radio", { name: "Rainbow", exact: true }).click();
  await page.getByTestId("cover-picker").getByRole("button", { name: "Save Cover" }).click();
  await expect(mine("Mixtape Memories").getByTestId("my-puzzle-result")).toHaveText("Cover saved.");
  await mine("Mixtape Memories").getByRole("button", { name: "List Mixtape Memories in Community" }).click();
  await expect(mine("Mixtape Memories").getByTestId("my-puzzle-status")).toHaveText("In Community");
  await page.screenshot({ path: path.join(SHOTS, "showcase-phone-390-my-puzzles-listed.png"), fullPage: false, animations: "disabled" });
  // Now first in Community's Newest, with its new cover.
  await page.getByRole("link", { name: "Rainbow Categories home" }).click();
  await expect(panel).toHaveAttribute("aria-busy", "false");
  const first = page.getByTestId("newest-list").getByTestId("community-card").first();
  await expect(first.getByTestId("card-title")).toHaveText("Mixtape Memories");
  await expect(first.locator("[data-cover-kind]")).toHaveAttribute("data-cover-emoji", "1F3A7-FE0F");
  // Unlist it again from My Puzzles (the preview note links there for the Demo Player).
  await page.getByTestId("showcase-my-puzzles").click();
  await expect(library).toHaveAttribute("aria-busy", "false");
  await mine("Mixtape Memories").getByRole("button", { name: "Unlist Mixtape Memories from Community" }).click();
  await expect(mine("Mixtape Memories").getByTestId("my-puzzle-status")).toHaveText("Link only");

  // Rename keeps the same link.
  await mine("Mixtape Memories").getByRole("button", { name: "Rename Mixtape Memories" }).click();
  await page.getByTestId("my-puzzle-rename").getByLabel("New title").fill("Mixtape Memories, Side B");
  await page.getByTestId("my-puzzle-rename").getByRole("button", { name: "Save title" }).click();
  await expect(mine("Mixtape Memories, Side B").getByTestId("my-puzzle-result")).toHaveText("Renamed. Its link, results and listing stay the same.");
  await expect(mine("Mixtape Memories, Side B")).toHaveAttribute("data-short-code", "MixtapeM3m");
  await page.screenshot({ path: path.join(SHOTS, "showcase-phone-390-renamed.png"), fullPage: false, animations: "disabled" });

  // Duplicate & Edit the Rainbow puzzle: a copy in its own draft, in the real builder.
  await mine("Lantern Festival").getByRole("button", { name: "Duplicate and edit Lantern Festival" }).click();
  await expect(page.getByTestId("copy-banner")).toContainText("You're editing a copy.");
  await expect(page.getByLabel("Puzzle Title")).toHaveValue("Copy of Lantern Festival");
  await expect(page.getByTestId("category-card-1").getByRole("textbox").nth(0)).toHaveValue("Light Sources");
  await page.screenshot({ path: path.join(SHOTS, "showcase-phone-390-duplicate-copy.png"), fullPage: false, animations: "disabled" });
  // A reload starts the demo over, but the copy is still in this browser: resume it from My Puzzles.
  await page.reload();
  await expect(panel).toHaveAttribute("aria-busy", "false");
  await page.getByTestId("showcase-account").click();
  await page.getByTestId("showcase-my-puzzles").click();
  await expect(library).toHaveAttribute("aria-busy", "false");
  await expect(page.getByTestId("unsaved-copies")).toContainText("Copy of Lantern Festival");
  await page.getByRole("link", { name: "Resume Copy of Lantern Festival" }).click();
  await expect(page.getByLabel("Puzzle Title")).toHaveValue("Copy of Lantern Festival");
  await page.getByLabel("Puzzle Title").fill("Lantern Encore");
  await expect(page.getByRole("checkbox", { name: "List in Community" })).not.toBeChecked();
  await page.getByRole("button", { name: "Create Game" }).click();
  await expect(page.getByTestId("created-in-my-puzzles")).toBeVisible();
  await page.getByTestId("created-in-my-puzzles").getByRole("link", { name: "My Puzzles" }).click();
  await expect(library).toHaveAttribute("aria-busy", "false");
  await expect(page.getByTestId("my-puzzles-list").getByRole("heading", { level: 2 }).first()).toHaveText("Lantern Encore");
  await expect(mine("Lantern Encore").getByTestId("my-puzzle-status")).toHaveText("Link only");
  await expect(mine("Lantern Festival").getByTestId("my-puzzle-status")).toHaveText("In Community");
  await expect(page.getByTestId("unsaved-copies")).toHaveCount(0);
  await page.screenshot({ path: path.join(SHOTS, "showcase-phone-390-copy-created.png"), fullPage: true, animations: "disabled" });

  await page.getByTestId("showcase-account").click();
  // A guest gets the sign-in prompt, never the Demo Player's list.
  await expect(page.getByTestId("my-puzzles-guest")).toBeVisible();
  await expect(page.getByTestId("my-puzzles-list")).toHaveCount(0);
  await page.getByRole("link", { name: "Rainbow Categories home" }).click();
  await expect(panel).toHaveAttribute("aria-busy", "false");
  await expect(page.getByTestId("newest-list").getByTestId("card-title").first()).not.toHaveText("Mixtape Memories");

  // Desktop width too.
  await page.setViewportSize({ width: 1280, height: 860 });
  await page.getByRole("button", { name: "Menu", exact: true }).click();
  await page.getByRole("navigation", { name: "Main menu" }).getByRole("link", { name: "Community Puzzles" }).click();
  await expect(panel).toHaveAttribute("aria-busy", "false");
  await page.screenshot({ path: path.join(SHOTS, "showcase-desktop-1280-shelf.png"), fullPage: true, animations: "disabled" });
  await page.getByRole("link", { name: "Create A Puzzle" }).click();
  await page.getByRole("searchbox", { name: "Search emojis" }).fill("owl");
  await page.getByRole("option", { name: "owl", exact: true }).click();
  await page.getByRole("radio", { name: "Indigo stars" }).click();
  await page.screenshot({ path: path.join(SHOTS, "showcase-desktop-1280-make-a-cover.png"), fullPage: false, animations: "disabled" });

  expect(outside, "nothing may leave the browser").toEqual([]);
  expect(problems).toEqual([]);
});
