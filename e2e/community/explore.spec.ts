/**
 * Community part 3, the Explore overhaul (Arcade Shelf with a compact Featured
 * Puzzle), through the real app against the disposable local stack. Focused:
 * phone visuals and keyboard, guest play and save, Newest's independent order,
 * and curated eligibility / unlist with the admin-only curation page.
 * Fictional fixtures only (e2e:reset + e2e:seed:community).
 *
 *   npm run e2e:community -- explore.spec.ts
 *
 * Screenshots for design review: evidence/community-preview-3/.
 */
import fs from "node:fs";
import path from "node:path";
import type { Browser, Page } from "@playwright/test";
import { test, expect } from "../support/fixtures.ts";
import { signInAs, sessionFromLocalGoTrue } from "../support/auth.ts";
import { expectNoHorizontalOverflow, solveCategory } from "../support/game.ts";
import { ACCOUNTS } from "../fixtures/catalog.ts";
import { E2E_DIR, loadE2eConfig } from "../env.ts";

const config = loadE2eConfig();
type Who = "wren" | "odie" | "pia" | "quin";
const preview = JSON.parse(fs.readFileSync(path.join(E2E_DIR, ".artifacts", "community-preview.json"), "utf8")) as {
  password: string;
  accounts: Record<Who, { email: string; name: string }>;
  puzzles: Record<string, { title: string; shareId: string; shortCode: string }>;
};
const P = preview.puzzles;
const creds = (k: Who) => ({ email: preview.accounts[k].email, password: preview.password });
const admin = { email: ACCOUNTS.admin.email, password: ACCOUNTS.admin.password };
const SHOTS = path.resolve(E2E_DIR, "..", "evidence", "community-preview-3");
fs.mkdirSync(SHOTS, { recursive: true });
const shot = (page: Page, name: string, fullPage = true) =>
  page.screenshot({ path: path.join(SHOTS, `${name}.png`), fullPage, animations: "disabled" });

const LISTED = ["A Little Offbeat", "The Usual Suspects", "Something In The Air", "Pantry Raid", "Turn Of The Tides"];

async function explore(page: Page, url = "/community") {
  await page.goto(url);
  await expect(page.getByRole("heading", { level: 1 }).first()).toBeVisible({ timeout: 30_000 });
  await expect(page.getByTestId("community-panel")).toHaveAttribute("aria-busy", "false");
}
const titles = (page: Page, testId: string) => page.getByTestId(testId).getByTestId("card-title").allInnerTexts();
const featured = (page: Page) => page.getByTestId("featured-puzzle");
async function rpc(token: string, fn: string, body: unknown) {
  const r = await fetch(`${config.apiUrl}/rest/v1/rpc/${fn}`, {
    method: "POST",
    headers: { apikey: config.anonKey, Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  return { status: r.status, body: await r.json().catch(() => null) };
}
const token = async (who: { email: string; password: string }) => (await sessionFromLocalGoTrue(who)).access_token;
const newestFromServer = async () => (await rpc(config.anonKey, "list_community_newest", { _limit: 48 })).body.items.map((i: { title: string }) => i.title) as string[];
async function signedIn(browser: Browser, who: { email: string; password: string }, url: string) {
  const context = await browser.newContext({ baseURL: config.appUrl, viewport: { width: 1280, height: 860 } });
  const page = await context.newPage();
  await page.goto(url);
  await signInAs(page, who);
  return { page, context };
}

test.describe.configure({ mode: "serial" });

test("phone first: real wordmark, white page, Featured, two-column Picks, Newest, small Create; keyboard and 320px", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await explore(page);
  await expect(page.getByTestId("community-wordmark")).toHaveAttribute("src", "/rainbow-categories-logo-stacked-480.webp");
  expect(await page.evaluate(() => getComputedStyle(document.body).backgroundColor)).toBe("rgb(255, 255, 255)");
  await expect(page.getByRole("link", { name: "Search Community puzzles and creators" })).toBeVisible();
  for (const t of ["Explore", "Following", "Favorites"]) await expect(page.getByRole("navigation", { name: "Community sections" }).getByRole("link", { name: t })).toBeVisible();

  // One compact Featured Puzzle, with Play and credit.
  await expect(featured(page)).toHaveCount(1);
  await expect(featured(page).getByTestId("card-title")).toHaveText("Pantry Raid");
  await expect(featured(page).getByRole("link", { name: "Play Puzzle Pantry Raid" })).toBeVisible();
  await expect(featured(page).getByRole("link", { name: "Wren Halloway" })).toHaveAttribute("href", /^\/creator\/wren-halloway-[a-z0-9]+\?view=community$/);
  expect((await featured(page).boundingBox())!.height).toBeLessThan(200);

  // Editor's Picks: in the admin's order, two equal columns on a 390px phone, never the Featured Puzzle.
  expect(await titles(page, "picks-grid")).toEqual(["Turn Of The Tides", "Something In The Air", "A Little Offbeat", "The Usual Suspects"]);
  const picks = page.getByTestId("picks-grid").locator("li");
  const boxes = await picks.evaluateAll((els) => els.map((e) => { const r = e.getBoundingClientRect(); return [Math.round(r.left), Math.round(r.width)]; }));
  expect(new Set(boxes.map((b) => b[0])).size).toBe(2);
  expect(new Set(boxes.map((b) => b[1])).size).toBe(1);
  // Every card: credit, accessible bookmark, a visible Play; no empty counts.
  for (const t of await titles(page, "picks-grid")) {
    await expect(page.getByRole("button", { name: `Save ${t} to Favorites` }).first()).toBeVisible();
    await expect(page.getByRole("link", { name: `Play ${t}` }).first()).toBeVisible();
  }
  await expect(page.locator("main")).not.toContainText(/(^|\D)0 plays/);
  await expect(page.locator("main")).not.toContainText(/☆|★/);
  // Editorial art (Featured + Editor's Picks) comes from the small illustrated set and carries no text;
  // since creator covers (0008), every other card shows the puzzle's own cover or the standard one.
  const covers = await page.locator("main svg[data-cover]").evaluateAll((els) => els.map((e) => ({ id: e.getAttribute("data-cover"), text: e.textContent?.trim() ?? "" })));
  expect(covers.length).toBe(5);
  expect(covers.every((c) => c.text === "")).toBe(true);
  expect(await page.getByTestId("newest-list").locator("[data-cover-kind]").count()).toBeGreaterThan(0);
  // Newest and a reachable See all; Create is a small secondary link.
  await expect(page.getByTestId("newest-section").getByRole("link", { name: "See all newest puzzles" })).toHaveAttribute("href", "/community?view=newest");
  const create = page.getByRole("link", { name: "Create A Puzzle" });
  await expect(create).toHaveAttribute("href", "/create");
  expect((await create.boundingBox())!.height).toBeLessThanOrEqual(48);
  await expectNoHorizontalOverflow(page);
  await shot(page, "explore-phone-390-light");

  // Keyboard: from the Explore tab, Tab reaches the Featured Play with a visible ring.
  await page.getByRole("navigation", { name: "Community sections" }).getByRole("link", { name: "Explore" }).focus();
  const order: string[] = [];
  for (let i = 0; i < 6; i++) {
    await page.keyboard.press("Tab");
    order.push(await page.evaluate(() => (document.activeElement as HTMLElement).getAttribute("aria-label") ?? (document.activeElement as HTMLElement).innerText));
  }
  expect(order).toEqual(["Following", "Favorites", "Pantry Raid", "Wren Halloway", "Play Puzzle Pantry Raid", "Save Pantry Raid to Favorites"]);
  await page.keyboard.press("Shift+Tab");
  const ring = await page.evaluate(() => getComputedStyle(document.activeElement as HTMLElement).boxShadow);
  expect(ring).not.toBe("none");
  await featured(page).scrollIntoViewIfNeeded();
  await shot(page, "explore-phone-390-keyboard-focus", false);

  // Narrow phone: usable, single column, nothing sideways.
  await page.setViewportSize({ width: 320, height: 720 });
  await explore(page);
  await expectNoHorizontalOverflow(page);
  expect(new Set(await page.getByTestId("picks-grid").locator("li").evaluateAll((els) => els.map((e) => Math.round(e.getBoundingClientRect().left)))).size).toBe(1);
  await shot(page, "explore-phone-320-light");

  // Desktop.
  await page.setViewportSize({ width: 1280, height: 860 });
  await explore(page);
  await expectNoHorizontalOverflow(page);
  await shot(page, "explore-desktop-1280-light");
});

test.describe("dark mode", () => {
  test.use({ settings: { darkMode: true } });
  test("Explore keeps dark mode at phone and desktop widths", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await explore(page);
    expect(await page.evaluate(() => document.documentElement.classList.contains("dark"))).toBe(true);
    expect(await page.evaluate(() => getComputedStyle(document.body).backgroundColor)).toBe("rgb(23, 23, 23)");
    await expectNoHorizontalOverflow(page);
    await shot(page, "explore-phone-390-dark");
    await page.setViewportSize({ width: 1280, height: 860 });
    await explore(page);
    await shot(page, "explore-desktop-1280-dark");
  });
});

test("guest: Play from Featured, then save a pick to Favorites (the existing device save)", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await explore(page);
  await featured(page).getByRole("link", { name: "Play Puzzle Pantry Raid" }).click();
  await expect(page).toHaveURL(`/p/${P.pantry.shortCode}`);
  await expect(page.getByRole("heading", { name: "Pantry Raid" })).toBeVisible({ timeout: 30_000 });
  await solveCategory(page, { category: "Pantry Raid group 1", words: ["BASIL", "CUMIN", "NUTMEG", "THYME"] });

  await explore(page);
  const save = page.getByTestId("picks-grid").getByRole("button", { name: "Save Turn Of The Tides to Favorites" });
  await save.click();
  await expect(save).toHaveAttribute("aria-pressed", "true");
  await expect(page.getByRole("status").filter({ hasText: "Saved on this device" })).toBeVisible();
  // The same puzzle's bookmark in Newest agrees.
  await expect(page.getByTestId("newest-list").getByRole("button", { name: "Save Turn Of The Tides to Favorites" })).toHaveAttribute("aria-pressed", "true");
  await page.getByRole("navigation", { name: "Community sections" }).getByRole("link", { name: "Favorites" }).click();
  await expect(page.getByTestId("community-panel")).toHaveAttribute("aria-busy", "false");
  expect(await titles(page, "favorites-grid")).toEqual(["Turn Of The Tides"]);
  await shot(page, "favorites-phone-390-light");
  await page.goto(`/p/${P.tides.shortCode}`);
  await expect(page.getByRole("button", { name: /^Favorited/ }).first()).toBeVisible({ timeout: 30_000 });
});

test("Newest: every listed puzzle by first listing time, independent of curation; new listings appear; re-listing doesn't bump", async ({ page }) => {
  await explore(page);
  const server = await newestFromServer();
  expect([...server].sort()).toEqual([...LISTED].sort());
  expect(await titles(page, "newest-list")).toEqual(server.slice(0, 6));
  expect(server).toContain("Pantry Raid"); // the Featured Puzzle is still in Newest

  // A newly listed puzzle that was never curated comes first.
  const wren = await token(creds("wren"));
  const words = ["ANVIL", "BELLOWS", "CHISEL", "DRILL", "EASEL", "FILE", "GOUGE", "HAMMER", "INKWELL", "JIGSAW", "KILN", "LATHE", "MALLET", "NEEDLE", "PLIERS", "RASP"];
  const made = (await rpc(wren, "create_custom_puzzle", {
    _creator_name: "Wren Halloway", _title: "Fictional Workshop", _visibility: "public",
    _content: { mode: "classic", groups: [0, 1, 2, 3].map((g) => ({ category: `Workshop ${g + 1}`, words: words.slice(g * 4, g * 4 + 4), hint_word: null, category_emoji: null })), word_order: words, rainbow_herring: null, rainbow_category_name: null, rainbow_hint_word: null, rainbow_category_emoji: null, alphabetize_completed: true },
  })).body as { share_id: string };
  expect((await rpc(wren, "set_custom_puzzle_community_listing", { _share_id: made.share_id, _listed: true })).status).toBe(200);
  await explore(page);
  expect((await titles(page, "newest-list"))[0]).toBe("Fictional Workshop");
  expect(await titles(page, "picks-grid")).not.toContain("Fictional Workshop");
  await expect(featured(page).getByTestId("card-title")).toHaveText("Pantry Raid");

  // Re-listing an older puzzle keeps its first listing time.
  const before = await newestFromServer();
  for (const listed of [false, true]) await rpc(wren, "set_custom_puzzle_community_listing", { _share_id: P.offbeat.shareId, _listed: listed });
  expect(await newestFromServer()).toEqual(before);

  // See all: the same order, every listed puzzle, from the Newest heading.
  await page.getByRole("link", { name: "See all newest puzzles" }).click();
  await expect(page).toHaveURL("/community?view=newest");
  await expect(page.getByTestId("community-panel")).toHaveAttribute("aria-busy", "false");
  await expect(page.getByRole("heading", { level: 1, name: "Newest" })).toBeVisible();
  expect(await titles(page, "newest-all-list")).toEqual(before);
  await page.setViewportSize({ width: 390, height: 844 });
  await expectNoHorizontalOverflow(page);
  await shot(page, "newest-all-phone-390-light");
});

test("curation: admin only; unlisted curated puzzles vanish; admin replaces and removes; links keep working", async ({ page, browser }) => {
  // Not an admin: the page and the server both refuse.
  await page.goto("/admin/community");
  await expect(page.getByRole("heading", { name: "Admin Login" })).toBeVisible({ timeout: 30_000 });
  const wrenToken = await token(creds("wren"));
  expect((await rpc(wrenToken, "admin_set_community_curation", { _featured: null, _picks: [] })).status).toBe(403);
  expect((await rpc(config.anonKey, "admin_get_community_curation", {})).status).toBeGreaterThanOrEqual(401);
  const { page: wren, context: wrenCtx } = await signedIn(browser, creds("wren"), "/admin/community");
  await expect(wren.getByText("You don't have admin access.")).toBeVisible();

  // Creators unlist a Featured and a Picked puzzle: both vanish from Explore, no empty shell.
  await wren.goto(`/p/${P.pantry.shortCode}`);
  await wren.getByTestId("community-listing-control").getByRole("button", { name: "Unlist from Community" }).click();
  await expect(wren.getByTestId("community-listing-control")).toContainText("Not listed.");
  const odie = await token(creds("odie"));
  await rpc(odie, "set_custom_puzzle_community_listing", { _share_id: P.tides.shareId, _listed: false });
  await explore(page);
  await expect(featured(page)).toHaveCount(0);
  await expect(page.getByText("Featured Puzzle")).toHaveCount(0);
  expect(await titles(page, "picks-grid")).toEqual(["Something In The Air", "A Little Offbeat", "The Usual Suspects"]);
  expect(await titles(page, "newest-list")).not.toContain("Pantry Raid");
  // The unlisted puzzle's link still plays.
  await page.goto(`/p/${P.pantry.shortCode}`);
  await expect(page.getByRole("heading", { name: "Pantry Raid" })).toBeVisible({ timeout: 30_000 });

  // The admin sees why, then replaces and removes.
  const { page: adm, context: admCtx } = await signedIn(browser, admin, "/admin/community");
  await expect(adm.getByRole("heading", { level: 1, name: "Community curation" })).toBeVisible({ timeout: 30_000 });
  const rows = adm.getByTestId("curation-row");
  await expect(rows.filter({ hasText: "Pantry Raid" })).toContainText("Not shown on Explore: unlisted by its creator");
  await expect(rows.filter({ hasText: "Turn Of The Tides" }).first()).toContainText("Not shown on Explore: unlisted by its creator");
  await adm.getByRole("button", { name: "Remove Pantry Raid from Featured" }).click();
  await adm.getByRole("button", { name: "Remove Turn Of The Tides from Picks" }).click();
  await adm.getByRole("searchbox", { name: "Search listed puzzles" }).fill("Something");
  await adm.getByTestId("curation-results").getByRole("button", { name: "Feature Something In The Air" }).click();
  await adm.getByRole("button", { name: "Move The Usual Suspects up" }).click();
  await adm.getByRole("button", { name: "Save curation" }).click();
  await expect(adm.getByRole("status").filter({ hasText: "Saved. Explore shows this now." })).toBeVisible();
  await adm.setViewportSize({ width: 1280, height: 860 });
  await shot(adm, "admin-curation-desktop-1280");

  await explore(page);
  await expect(featured(page).getByTestId("card-title")).toHaveText("Something In The Air");
  expect(await titles(page, "picks-grid")).toEqual(["The Usual Suspects", "A Little Offbeat"]); // no duplicate of the Featured Puzzle
  // Re-listing doesn't bring back a removed curation; it returns to Newest at its own time.
  await wren.goto(`/p/${P.pantry.shortCode}`);
  await wren.getByTestId("community-listing-control").getByRole("button", { name: "List in Community" }).click();
  await expect(wren.getByTestId("community-listing-control")).toContainText("Listed on");
  await explore(page);
  await expect(featured(page).getByTestId("card-title")).toHaveText("Something In The Air");
  expect(await titles(page, "picks-grid")).not.toContain("Pantry Raid");
  expect(await newestFromServer()).toContain("Pantry Raid");

  // Removing everything leaves no editorial shells: Newest leads.
  await adm.getByRole("button", { name: "Remove Something In The Air from Featured" }).click();
  for (const t of ["The Usual Suspects", "A Little Offbeat"]) await adm.getByRole("button", { name: `Remove ${t} from Picks` }).click();
  await adm.getByRole("button", { name: "Save curation" }).click();
  await expect(adm.getByText("None. Explore shows no Featured Puzzle.")).toBeVisible();
  await explore(page);
  await expect(featured(page)).toHaveCount(0);
  await expect(page.getByTestId("editors-picks")).toHaveCount(0);
  await expect(page.getByTestId("newest-list")).toBeVisible();
  await page.setViewportSize({ width: 390, height: 844 });
  await shot(page, "explore-phone-390-no-curation");
  await Promise.all([wrenCtx.close(), admCtx.close()]);
});
