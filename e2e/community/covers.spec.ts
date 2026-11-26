/**
 * Creator covers and the post-game rating through the real app on the
 * disposable local stack (GoTrue + PostgREST + migrations 0001-0010),
 * fictional fixtures only. Focused smoke: signed-in create → pick cover →
 * save → the same cover on its Newest card and its page; the owner goes from
 * one emoji to two and three with Save Cover (Newest thumbnail fits at phone
 * width); a signed-in non-author finishes it, rates it and edits the rating;
 * the author and guests get no rating row; another account and junk keys are
 * refused; guests can browse but not set covers; older, unlisted and private
 * puzzles keep the standard cover and their links; Editor's Picks keep their
 * illustrations. Phone and desktop.
 *
 *   npm run e2e:community -- covers.spec.ts
 */
import fs from "node:fs";
import path from "node:path";
import type { Page } from "@playwright/test";
import { test, expect } from "../support/fixtures.ts";
import { signInAs, sessionFromLocalGoTrue } from "../support/auth.ts";
import { expectNoHorizontalOverflow } from "../support/game.ts";
import { E2E_DIR, loadE2eConfig } from "../env.ts";

const config = loadE2eConfig();
const preview = JSON.parse(fs.readFileSync(path.join(E2E_DIR, ".artifacts", "community-preview.json"), "utf8")) as {
  password: string;
  accounts: Record<string, { email: string }>;
  puzzles: Record<string, { title: string; shareId: string; shortCode: string }>;
};
const P = preview.puzzles;
const creds = (k: string) => ({ email: preview.accounts[k].email, password: preview.password });
const SHOTS = path.resolve(E2E_DIR, "..", "evidence", "community-covers");
fs.mkdirSync(SHOTS, { recursive: true });
const shot = (page: Page, name: string, fullPage = true) => page.screenshot({ path: path.join(SHOTS, `${name}.png`), fullPage, animations: "disabled" });
const coverOf = (loc: ReturnType<Page["locator"]>) => loc.locator("[data-cover-kind]").first();
const FROG_WORDS = [["CROAK", "HOP", "LEAP", "RIBBIT"], ["LILY", "LOTUS", "REED", "RUSH"], ["NEWT", "TOAD", "SALAMANDER", "AXOLOTL"], ["MARSH", "BOG", "FEN", "SWAMP"]];
/** Every glyph of a cover sits inside its art, left to right, none overlapping. */
async function glyphsFit(art: ReturnType<Page["locator"]>) {
  const box = (await art.boundingBox())!;
  const glyphs = await art.locator("[data-cover-glyph]").evaluateAll((els) => els.map((e) => {
    const r = document.createRange();
    r.selectNodeContents(e);
    const b = r.getBoundingClientRect();
    return { x: b.x, w: b.width };
  }));
  for (const g of glyphs) {
    expect(g.w).toBeGreaterThan(8);
    expect(g.x).toBeGreaterThanOrEqual(box.x - 0.5);
    expect(g.x + g.w).toBeLessThanOrEqual(box.x + box.width + 0.5);
  }
  for (let i = 1; i < glyphs.length; i++) expect(glyphs[i].x).toBeGreaterThanOrEqual(glyphs[i - 1].x + glyphs[i - 1].w - 0.5);
  return glyphs.length;
}
async function rpc(token: string, fn: string, body: unknown) {
  const r = await fetch(`${config.apiUrl}/rest/v1/rpc/${fn}`, {
    method: "POST",
    headers: { apikey: config.anonKey, Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  return { status: r.status, text: await r.text() };
}
async function fillBuilder(page: Page, title: string, words: string[][]) {
  await page.getByLabel("Puzzle Title").fill(title);
  const designer = page.getByLabel("Your Name (Designer)");
  if (await designer.isEditable()) await designer.fill("Pia Lindqvist");
  else await expect(designer).toHaveValue("Pia Lindqvist");
  await page.getByRole("button", { name: "Classic", exact: true }).click();
  for (let i = 0; i < 4; i++) {
    const fields = page.getByTestId(`category-card-${i + 1}`).getByRole("textbox");
    await fields.nth(0).fill(`${title} set ${i + 1}`);
    await fields.nth(2).fill(words[i].join(", "));
  }
}

test.describe.configure({ mode: "serial" });

test("signed in: create with a cover, see it on Newest and the puzzle page, edit it with Save Cover", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/create");
  await signInAs(page, creds("pia"));
  await fillBuilder(page, "Garden Frogs", FROG_WORDS);
  await page.getByRole("checkbox", { name: "List in Community" }).check();
  const picker = page.getByTestId("cover-picker");
  await expect(picker.getByRole("heading", { name: "Make A Cover" })).toBeVisible();
  await picker.getByRole("searchbox", { name: "Search emojis" }).fill("frog");
  await picker.getByRole("option", { name: "frog", exact: true }).click();
  await picker.getByRole("radio", { name: "Lime checks" }).click();
  await expect(picker.getByTestId("cover-selection")).toHaveText("Frog on Lime checks");
  await picker.scrollIntoViewIfNeeded();
  await expectNoHorizontalOverflow(page);
  await shot(page, "create-make-a-cover-phone-390", false);
  await page.getByRole("button", { name: "Create Game" }).click();
  await expect(page.getByTestId("cover-result")).toHaveText("Cover saved.");
  await expect(page.getByTestId("community-listing-result")).toContainText("Listed in Community Puzzles.");

  // Public: top of Newest with the same stored cover, and on its own page.
  await page.goto("/community");
  await expect(page.getByTestId("community-panel")).toHaveAttribute("aria-busy", "false", { timeout: 30_000 });
  const row = page.getByTestId("newest-list").getByTestId("community-card").first();
  await expect(row.getByTestId("card-title")).toHaveText("Garden Frogs");
  await expect(coverOf(row)).toHaveAttribute("data-cover-emoji", "1F438");
  await expect(coverOf(row)).toHaveAttribute("data-cover-background", "lime-checks");
  // Editor's Picks are unchanged: hand-illustrated scenes, never a creator cover.
  await expect(page.getByTestId("picks-grid").locator("svg[data-cover]")).not.toHaveCount(0);
  await expect(page.getByTestId("picks-grid").locator("[data-cover-kind]")).toHaveCount(0);
  await expectNoHorizontalOverflow(page);
  await shot(page, "explore-phone-390-with-covers");
  await row.getByRole("link", { name: "Play Garden Frogs" }).click();
  await expect(page.getByRole("heading", { name: "Garden Frogs" })).toBeVisible({ timeout: 30_000 });
  await expect(coverOf(page.getByTestId("puzzle-cover"))).toHaveAttribute("data-cover-emoji", "1F438");

  // The owner changes it with Save Cover.
  await page.getByRole("button", { name: "Edit cover" }).click();
  const edit = page.getByTestId("cover-picker");
  await edit.getByRole("searchbox", { name: "Search emojis" }).fill("popcorn");
  await edit.getByRole("option", { name: "popcorn", exact: true }).click();
  await edit.getByRole("radio", { name: "Apricot stripes" }).click();
  await edit.getByRole("button", { name: "Save Cover" }).click();
  await expect(page.getByText("Cover saved. It shows on your puzzle's card and page.")).toBeVisible();
  // Adding popcorn keeps the frog: two emoji now.
  await expect(coverOf(page.getByTestId("puzzle-cover"))).toHaveAttribute("data-cover-emoji", "1F438 1F37F");
  await page.reload();
  await expect(coverOf(page.getByTestId("puzzle-cover"))).toHaveAttribute("data-cover-background", "apricot-stripes", { timeout: 30_000 });

  // A third, saved and read back from the server.
  for (const [name, expected] of [["star", "1F438 1F37F 2B50-FE0F"]] as const) {
    await page.getByRole("button", { name: "Edit cover" }).click();
    const more = page.getByTestId("cover-picker");
    await more.getByRole("searchbox", { name: "Search emojis" }).fill(name);
    await more.getByRole("option", { name, exact: true }).click();
    await expect(coverOf(more.getByTestId("cover-preview"))).toHaveAttribute("data-cover-emoji", expected);
    await more.getByRole("button", { name: "Save Cover" }).click();
    await expect(page.getByText("Cover saved. It shows on your puzzle's card and page.")).toBeVisible();
    await page.reload();
    await expect(coverOf(page.getByTestId("puzzle-cover"))).toHaveAttribute("data-cover-emoji", expected, { timeout: 30_000 });
  }
  await page.goto("/community");
  await expect(page.getByTestId("community-panel")).toHaveAttribute("aria-busy", "false", { timeout: 30_000 });
  const thumb = coverOf(page.getByTestId("newest-list").getByTestId("community-card").first());
  await expect(thumb).toHaveAttribute("data-cover-count", "3");
  expect(await glyphsFit(thumb)).toBe(3);
  await expectNoHorizontalOverflow(page);
  await page.getByTestId("newest-list").getByTestId("community-card").first().screenshot({ path: path.join(SHOTS, "newest-thumbnail-three-emoji-phone-390.png"), animations: "disabled" });

  await page.setViewportSize({ width: 1280, height: 860 });
  await page.goto("/community");
  await expect(page.getByTestId("community-panel")).toHaveAttribute("aria-busy", "false", { timeout: 30_000 });
  await expect(coverOf(page.getByTestId("newest-list").getByTestId("community-card").first())).toHaveAttribute("data-cover-emoji", "1F438 1F37F 2B50-FE0F");
  await shot(page, "explore-desktop-1280-with-covers");
});

async function playToTheEnd(page: Page) {
  for (const [i, words] of FROG_WORDS.entries()) {
    for (const w of words) await page.getByRole("button", { name: new RegExp(`^${w}\\b`) }).first().click();
    await page.getByRole("button", { name: "Submit" }).click();
    await expect(page.getByText(`Garden Frogs set ${i + 1}`, { exact: false }).first()).toBeVisible({ timeout: 15_000 });
  }
  await expect(page.getByRole("dialog")).toBeVisible({ timeout: 20_000 });
}

test("rating: a signed-in player rates after finishing and changes it; the author and guests get no row", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/community?view=newest");
  await expect(page.getByTestId("community-panel")).toHaveAttribute("aria-busy", "false", { timeout: 30_000 });
  const link = page.getByTestId("newest-all-list").getByRole("link", { name: "Play Garden Frogs" });
  const url = new URL((await link.getAttribute("href"))!, "http://x").pathname;

  // A guest plays normally: no rating row, no sign-in prompt for one.
  await page.goto(url);
  await expect(page.getByRole("heading", { name: "Garden Frogs" })).toBeVisible({ timeout: 30_000 });
  await playToTheEnd(page);
  await expect(page.getByRole("dialog").getByTestId("custom-rating")).toHaveCount(0);
  await expect(page.getByRole("dialog")).not.toContainText("Rate this puzzle");

  // A signed-in non-author who finished: rate, then edit.
  const odie = (await sessionFromLocalGoTrue(creds("odie"))).access_token;
  await page.context().clearCookies();
  await page.evaluate(() => localStorage.clear());
  await page.goto(url);
  await signInAs(page, creds("odie"));
  await page.goto(url);
  await expect(page.getByRole("heading", { name: "Garden Frogs" })).toBeVisible({ timeout: 30_000 });
  await playToTheEnd(page);
  const rating = page.getByRole("dialog").getByTestId("custom-rating");
  await expect(rating).toBeVisible({ timeout: 15_000 });
  await rating.getByRole("button", { name: "4 stars" }).click();
  await expect(rating.getByTestId("custom-rating-note")).toHaveText("Saved: 4 of 5");
  await rating.scrollIntoViewIfNeeded();
  await shot(page, "results-rated-phone-390", false);
  await rating.getByRole("button", { name: "2 stars" }).click();
  await expect(rating.getByTestId("custom-rating-note")).toHaveText("Updated: 2 of 5");
  await expect(rating.getByRole("button", { name: "2 stars" })).toHaveAttribute("aria-pressed", "true");
  const shareId = JSON.parse((await rpc(odie, "custom_puzzle_share_id", { _short_code: url.split("/").pop() })).text) as string;
  expect(JSON.parse((await rpc(odie, "get_my_custom_puzzle_rating", { _share_id: shareId })).text)).toEqual({ rating: 2, can_rate: true });

  // The author never sees it (and the server refuses it).
  await page.keyboard.press("Escape");
  await page.evaluate(() => localStorage.clear());
  await page.goto(url);
  await signInAs(page, creds("pia"));
  await page.goto(url);
  await expect(page.getByRole("heading", { name: "Garden Frogs" })).toBeVisible({ timeout: 30_000 });
  await playToTheEnd(page);
  await page.waitForTimeout(1500);
  await expect(page.getByRole("dialog").getByTestId("custom-rating")).toHaveCount(0);
});

test("refused: another account, junk keys, guests; older, unlisted and private puzzles unchanged", async ({ page }) => {
  // The server: owner only, allowlisted keys only.
  const pia = (await sessionFromLocalGoTrue(creds("pia"))).access_token;
  const odie = (await sessionFromLocalGoTrue(creds("odie"))).access_token;
  expect((await rpc(odie, "set_custom_puzzle_cover", { _share_id: P.air.shareId, _emoji: "1F438", _background: "lilac" })).status).toBe(403);
  for (const [emoji, bg] of [["🐸", "lilac"], ["<b>x</b>", "lilac"], ["1F438 1F989", "lilac"], ["1F438", "https://example.com/x.png"], ["1F438", null]]) {
    const r = await rpc(pia, "set_custom_puzzle_cover", { _share_id: P.air.shareId, _emoji: emoji, _background: bg });
    expect(r.status, `${emoji} / ${bg}`).toBe(400);
  }
  expect((await rpc(config.anonKey, "set_custom_puzzle_cover", { _share_id: P.air.shareId, _emoji: "1F438", _background: "lilac" })).status).toBeGreaterThanOrEqual(401);

  // Guests browse and play; the cover step is visible but needs an account.
  await page.goto("/create");
  await expect(page.getByTestId("cover-picker")).toContainText("Sign in to give your puzzle a cover.");
  await expect(page.getByTestId("cover-picker").getByRole("radio", { name: "Lilac", exact: true })).toBeDisabled();

  // Older puzzles: no cover stored, standard cover on cards, no banner on their pages, links intact.
  await page.goto("/community?view=newest");
  await expect(page.getByTestId("community-panel")).toHaveAttribute("aria-busy", "false", { timeout: 30_000 });
  const tides = page.getByTestId("newest-all-list").getByTestId("community-card").filter({ hasText: "Turn Of The Tides" });
  await expect(coverOf(tides)).toHaveAttribute("data-cover-kind", "default");
  for (const url of [`/p/${P.linkOnly.shortCode}`, `/custom/${P.linkOnly.shareId}`, `/p/${P.private.shortCode}`]) {
    await page.goto(url);
    await expect(page.getByRole("heading", { level: 1 }).first()).toBeVisible({ timeout: 30_000 });
    await expect(page.getByTestId("puzzle-cover")).toHaveCount(0);
  }
  // Unlisted puzzles still never reach Explore.
  await page.goto("/community?view=newest");
  await expect(page.getByTestId("community-panel")).toHaveAttribute("aria-busy", "false", { timeout: 30_000 });
  await expect(page.getByTestId("newest-all-list")).not.toContainText("Link Only Lighthouse");
  await expect(page.getByTestId("newest-all-list")).not.toContainText("Private Parlour Games");
});
