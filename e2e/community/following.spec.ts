/**
 * Community part 2 through the real app: creator discovery, one-way Follow,
 * Following, and Favorites as bookmarks (the existing account and guest saves).
 * Fictional fixtures only (e2e:reset + e2e:seed:community). Runs after
 * community.spec.ts in the same serial worker; screenshots go to
 * evidence/community-preview/.
 */
import fs from "node:fs";
import path from "node:path";
import type { Browser, Page } from "@playwright/test";
import { test, expect } from "../support/fixtures.ts";
import { signInAs } from "../support/auth.ts";
import { expectNoHorizontalOverflow } from "../support/game.ts";
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
// Part 2 screenshots are committed under evidence/; re-runs since the Explore overhaul go to a git-ignored folder.
const SHOTS = path.resolve(E2E_DIR, ".artifacts", "legacy-shots");
fs.mkdirSync(SHOTS, { recursive: true });
const shot = (page: Page, name: string, fullPage = true) =>
  page.screenshot({ path: path.join(SHOTS, `${name}.png`), fullPage, animations: "disabled" });

const panel = (page: Page) => page.getByTestId("community-panel");
async function settled(page: Page) {
  await expect(panel(page)).toHaveAttribute("aria-busy", "false");
}
async function go(page: Page, url: string) {
  await page.goto(url);
  await expect(page.getByRole("heading", { level: 1 }).first()).toBeVisible({ timeout: 30_000 });
  if (url.startsWith("/community")) await settled(page);
}
async function feedAfter(page: Page, action: () => Promise<unknown>, rpc = "/rpc/") {
  const response = page.waitForResponse((r) => r.url().includes(rpc));
  await action();
  await response;
  await settled(page);
}
async function searchCreators(page: Page, q: string) {
  const box = page.getByRole("searchbox", { name: "Search creators" });
  if ((await box.inputValue()) === q) return;
  await feedAfter(page, () => box.fill(q), "/rpc/search_community_creators");
}
const titlesIn = (page: Page, testId: string) => page.getByTestId(testId).getByTestId("card-title").allInnerTexts();
const creatorNames = (page: Page) => page.getByTestId("creator-grid").getByRole("link").allInnerTexts();
const card = (page: Page, testId: string, title: string) => page.getByTestId(testId).getByTestId("community-card").filter({ has: page.getByRole("link", { name: title, exact: true }) });
const bookmark = (page: Page, testId: string, title: string) => card(page, testId, title).getByRole("button", { name: `Save ${title} to Favorites` });
async function signedInPage(browser: Browser, who: Who, url = "/community") {
  const context = await browser.newContext({ baseURL: config.appUrl, viewport: { width: 1280, height: 800 } });
  const page = await context.newPage();
  await page.goto(url);
  await signInAs(page, creds(who));
  return { page, context };
}

test.describe.configure({ mode: "serial" });

test("guest: Explore / Following / Favorites tabs, Puzzles and Creators search, creator page", async ({ page }) => {
  await go(page, "/community?view=search");
  const tabs = page.getByRole("navigation", { name: "Community sections" });
  for (const t of ["Explore", "Following", "Favorites"]) await expect(tabs.getByRole("link", { name: t })).toBeVisible();
  await expect(tabs.getByRole("link", { name: "Explore" })).toHaveAttribute("aria-current", "page");
  await expect(page.getByRole("button", { name: "Newest" })).toHaveAttribute("aria-pressed", "true"); // default sort
  // Violet linked bylines to the shareable creator page, bookmark top right.
  const offbeat = card(page, "community-grid", "A Little Offbeat");
  const byline = offbeat.getByRole("link", { name: "Wren Halloway" });
  await expect(byline).toHaveAttribute("href", /^\/creator\/wren-halloway-[a-z0-9]+\?view=community$/);
  expect(await byline.evaluate((el) => getComputedStyle(el).color)).toBe("rgb(109, 40, 217)"); // violet-700
  const bm = bookmark(page, "community-grid", "A Little Offbeat");
  const [cardBox, bmBox] = [await offbeat.boundingBox(), await bm.boundingBox()];
  expect(bmBox!.x + bmBox!.width).toBeGreaterThan(cardBox!.x + cardBox!.width - 24);
  // Since the Explore overhaul the bookmark tops the text under the cover, level with the title.
  const titleBox = await offbeat.getByTestId("card-title").boundingBox();
  expect(Math.abs(bmBox!.y - titleBox!.y)).toBeLessThan(16);
  expect(bmBox!.width).toBeGreaterThanOrEqual(44);
  await shot(page, "p2-explore-desktop-1280-light");

  // Creators mode: only creators with a puzzle in Community; name or slug; no special syntax.
  await feedAfter(page, () => page.getByRole("group", { name: "Search for" }).getByRole("button", { name: "Creators" }).click(), "/rpc/search_community_creators");
  await expect(page).toHaveURL(/mode=creators/);
  expect((await creatorNames(page)).sort()).toEqual(["Odie Marsh", "Pia Lindqvist", "Wren Halloway"]);
  await expect(page.getByTestId("creator-card").filter({ hasText: "Odie Marsh" })).toContainText("2 puzzles in Community · 0 followers");
  await shot(page, "p2-creators-desktop-1280-light");
  await searchCreators(page, "Quin");
  await expect(page.getByText("No creators match “Quin”.")).toBeVisible(); // only an unlisted Public puzzle
  await searchCreators(page, "Offbeat");
  await expect(page.getByText("No creators match “Offbeat”.")).toBeVisible(); // creators match names, not titles
  const odieSlug = (await page.request.post(`${config.apiUrl}/rest/v1/rpc/search_community_creators`, {
    headers: { apikey: config.anonKey, "Content-Type": "application/json" }, data: { _query: "Odie" },
  }).then((r) => r.json())).items[0].public_slug as string;
  await searchCreators(page, odieSlug.slice(-5)); // the random slug suffix alone
  expect(await creatorNames(page)).toEqual(["Odie Marsh"]);
  await searchCreators(page, "pia");
  expect(await creatorNames(page)).toEqual(["Pia Lindqvist"]);

  // Guest Follow explains instead of failing.
  await page.getByRole("button", { name: "Follow Pia Lindqvist" }).click();
  await expect(page.getByText("Sign in to follow creators.")).toBeVisible();

  // Creator page, Community view: avatar, name, follower count, Follow, only opted-in puzzles.
  await page.getByTestId("creator-grid").getByRole("link", { name: "Pia Lindqvist" }).click();
  await expect(page).toHaveURL(/\/creator\/pia-lindqvist-[a-z0-9]+\?view=community$/);
  await expect(page.getByRole("heading", { level: 1, name: "Pia Lindqvist" })).toBeVisible();
  await expect(page.getByTestId("creator-avatar")).toHaveText("PL");
  await expect(page.getByTestId("creator-community-counts")).toHaveText("Puzzle creator · 0 followers");
  await expect(page.getByRole("button", { name: "Follow Pia Lindqvist" })).toBeVisible();
  await expect(page.getByTestId("creator-community-grid")).toBeVisible();
  expect(await titlesIn(page, "creator-community-grid")).toEqual(["Something In The Air"]);
  await shot(page, "p2-creator-community-desktop-1280-light");
  // The historical landing (no ?view) still lists every Public puzzle, with totals.
  await page.getByRole("link", { name: /^All puzzles/ }).click();
  await expect(page).toHaveURL(/\/creator\/pia-lindqvist-[a-z0-9]+$/);
  await expect(page.getByTestId("creator-totals")).toBeVisible();
  await expect(page.getByRole("link", { name: "Link Only Lighthouse" })).toBeVisible();
  await expect(page.getByRole("link", { name: "Something In The Air" })).toBeVisible();
  await shot(page, "p2-creator-all-desktop-1280-light");

  // Following, as a guest: a prompt, never an error.
  await go(page, "/community?tab=following");
  await expect(page.getByText("Follow creators to see their newest puzzles here.")).toBeVisible();
  await expect(page.getByText("Explore, search and play stay open to everyone.", { exact: false })).toBeVisible();
});

test("guest: legacy share link + save, card bookmark, both in Favorites on this device only", async ({ page, browser }) => {
  // The permanent legacy link of a puzzle that is NOT in Community, saved with the existing Favorite button.
  await page.goto(`/custom/${P.linkOnly.shareId}`);
  await expect(page.getByRole("heading", { name: "Link Only Lighthouse" })).toBeVisible({ timeout: 30_000 });
  await page.getByRole("button", { name: /^Favorite/ }).first().click();
  await expect(page.getByRole("button", { name: /^Favorited/ }).first()).toBeVisible();

  // Bookmark a card in Explore: the same device store.
  await go(page, "/community?view=search");
  await bookmark(page, "community-grid", "Turn Of The Tides").click();
  await expect(bookmark(page, "community-grid", "Turn Of The Tides")).toHaveAttribute("aria-pressed", "true");
  await expect(page.getByRole("status").filter({ hasText: "Saved on this device" })).toBeVisible();

  await go(page, "/community?tab=favorites");
  await expect(page.getByText("Saved on this device only, and only you can see them.", { exact: false })).toBeVisible();
  expect((await titlesIn(page, "favorites-grid")).sort()).toEqual(["Link Only Lighthouse", "Turn Of The Tides"]);
  for (const t of ["Link Only Lighthouse", "Turn Of The Tides"]) await expect(bookmark(page, "favorites-grid", t)).toHaveAttribute("aria-pressed", "true");
  await page.setViewportSize({ width: 390, height: 844 });
  await go(page, "/community?tab=favorites");
  await expectNoHorizontalOverflow(page);
  await shot(page, "p2-favorites-guest-phone-390-light");
  await page.setViewportSize({ width: 1280, height: 800 });

  // The puzzle page agrees (one store), and the saved legacy link still plays.
  await page.goto(`/p/${P.tides.shortCode}`);
  await expect(page.getByRole("button", { name: /^Favorited/ }).first()).toBeVisible({ timeout: 30_000 });
  await go(page, "/community?tab=favorites");
  await card(page, "favorites-grid", "Link Only Lighthouse").getByRole("link", { name: "Link Only Lighthouse", exact: true }).click();
  await expect(page).toHaveURL(`/p/${P.linkOnly.shortCode}`);
  await expect(page.getByRole("button", { name: /BEACON/ })).toBeVisible();

  // Unsave from Favorites.
  await go(page, "/community?tab=favorites");
  await bookmark(page, "favorites-grid", "Turn Of The Tides").click();
  await expect(card(page, "favorites-grid", "Turn Of The Tides")).toHaveCount(0);
  await page.reload();
  await settled(page);
  expect(await titlesIn(page, "favorites-grid")).toEqual(["Link Only Lighthouse"]);

  // Private: another browser has none of them.
  const other = await browser.newContext({ baseURL: config.appUrl });
  const o = await other.newPage();
  await o.goto("/community?tab=favorites");
  await expect(o.getByText("No favorites yet.")).toBeVisible({ timeout: 30_000 });
  await other.close();
});

async function fillBuilder(page: Page, title: string, words: string[][]) {
  await page.getByLabel("Puzzle Title").fill(title);
  await page.getByLabel("Your Name (Designer)").fill("Wren Halloway");
  await page.getByRole("button", { name: "Classic", exact: true }).click();
  for (let i = 0; i < 4; i++) {
    const fields = page.getByTestId(`category-card-${i + 1}`).getByRole("textbox");
    await fields.nth(0).fill(`${title} set ${i + 1}`);
    await fields.nth(2).fill(words[i].join(", "));
  }
}

test("signed in: creator search → Follow, Following newest-first, opt-in listing appears, unlist removes it but link and save survive", async ({ browser }) => {
  const { page: pia, context: piaCtx } = await signedInPage(browser, "pia", "/community?mode=creators");
  await settled(pia);
  await searchCreators(pia, "wren");
  const follow = pia.getByRole("button", { name: "Follow Wren Halloway" });
  await expect(follow).toHaveAttribute("aria-pressed", "false");
  await follow.click();
  await expect(follow).toHaveAttribute("aria-pressed", "true");
  await expect(follow).toHaveText("Following");
  await expect(pia.getByTestId("creator-card").filter({ hasText: "Wren Halloway" })).toContainText("1 follower");

  // Following: who I follow (private) and their puzzles in Community, newest first.
  await go(pia, "/community?tab=following");
  await expect(pia.getByTestId("following-creators").getByRole("link", { name: "Wren Halloway" })).toBeVisible();
  const wrenNewest = (await pia.request.post(`${config.apiUrl}/rest/v1/rpc/list_community_puzzles`, {
    headers: { apikey: config.anonKey, "Content-Type": "application/json" }, data: { _query: "Wren Halloway", _sort: "newest" },
  }).then((r) => r.json())).items.map((i: { title: string }) => i.title);
  expect(await titlesIn(pia, "following-grid")).toEqual(wrenNewest);
  expect(wrenNewest).toEqual(expect.arrayContaining(["Pantry Raid", "A Little Offbeat"]));
  expect(await titlesIn(pia, "following-grid")).not.toContain("Private Parlour Games"); // never listed
  // Save Pantry Raid from Following: the account's existing Favorites.
  await bookmark(pia, "following-grid", "Pantry Raid").click();
  await expect(bookmark(pia, "following-grid", "Pantry Raid")).toHaveAttribute("aria-pressed", "true");
  await expect(pia.getByRole("status").filter({ hasText: "Saved to Favorites" })).toBeVisible();
  await shot(pia, "p2-following-desktop-1280-light");

  // Wren lists a brand-new puzzle (explicit opt-in in /create): it tops Pia's Following.
  const { page: wren, context: wrenCtx } = await signedInPage(browser, "wren", "/create");
  await fillBuilder(wren, "Fictional Follow Fresh", [["AMULET", "BANGLE", "BROOCH", "CAMEO"], ["DIADEM", "EARRING", "FOB", "GORGET"], ["HATPIN", "INTAGLIO", "JABOT", "LOCKET"], ["MEDALLION", "NECKLACE", "PENDANT", "TIARA"]]);
  await wren.getByRole("checkbox", { name: "List in Community" }).check();
  await wren.getByRole("button", { name: "Create Game" }).click();
  await expect(wren.getByTestId("community-listing-result")).toContainText("Listed in Community Puzzles.");
  // And one created WITHOUT the opt-in never reaches followers.
  await wren.goto("/create");
  await fillBuilder(wren, "Fictional Follow Quiet", [["ABBEY", "BASTION", "CASTLE", "DUNGEON"], ["EYRIE", "FORT", "GATEHOUSE", "HOLD"], ["KEEP", "LODGE", "MOTTE", "OUTPOST"], ["PALACE", "REDOUBT", "STOCKADE", "TOWER"]]);
  await wren.getByRole("button", { name: "Create Game" }).click();
  await expect(wren.getByTestId("community-listing-result")).toHaveText("Not listed in Community. Only people with the link can find it.");
  await go(pia, "/community?tab=following");
  const following = await titlesIn(pia, "following-grid");
  expect(following[0]).toBe("Fictional Follow Fresh");
  expect(following).not.toContain("Fictional Follow Quiet");

  // Wren unlists Pantry Raid from its page.
  await wren.goto(`/p/${P.pantry.shortCode}`);
  await wren.getByTestId("community-listing-control").getByRole("button", { name: "Unlist from Community" }).click();
  await expect(wren.getByTestId("community-listing-control")).toContainText("Not listed.");

  // Gone from Following, Explore and Wren's Community view and count…
  await go(pia, "/community?tab=following");
  expect(await titlesIn(pia, "following-grid")).not.toContain("Pantry Raid");
  await go(pia, "/community?q=Pantry");
  await expect(pia.getByText("No puzzles match “Pantry”.")).toBeVisible();
  await go(pia, "/community?mode=creators&q=wren");
  const countAfter = wrenNewest.length + 1 - 1; // +Fresh, −Pantry
  await expect(pia.getByTestId("creator-card").filter({ hasText: "Wren Halloway" })).toContainText(`${countAfter} puzzles in Community`);
  // …but Pia's saved copy and the direct link survive.
  await go(pia, "/community?tab=favorites");
  await expect(pia.getByText("Only you can see your Favorites.")).toBeVisible();
  expect(await titlesIn(pia, "favorites-grid")).toContain("Pantry Raid");
  await card(pia, "favorites-grid", "Pantry Raid").getByRole("link", { name: "Pantry Raid", exact: true }).click();
  await expect(pia.getByRole("heading", { name: "Pantry Raid" })).toBeVisible({ timeout: 30_000 });
  await expect(pia.getByRole("button", { name: /^Favorited/ }).first()).toBeVisible();

  // Others see an aggregate count, never who follows.
  const wrenSlug = (await pia.request.post(`${config.apiUrl}/rest/v1/rpc/search_community_creators`, {
    headers: { apikey: config.anonKey, "Content-Type": "application/json" }, data: { _query: "Wren" },
  }).then((r) => r.json())).items[0].public_slug as string;
  const wrenPage = `/creator/${wrenSlug}?view=community`;
  const { page: odie, context: odieCtx } = await signedInPage(browser, "odie", wrenPage);
  await expect(odie.getByTestId("creator-community-counts")).toHaveText("Puzzle creator · 1 follower");
  expect(await odie.locator("main").innerText()).not.toContain("Pia");
  await go(odie, "/community?tab=following");
  await expect(odie.getByText("You're not following anyone yet.")).toBeVisible();
  // The creator sees their own page without a Follow button.
  await wren.goto(wrenPage);
  await expect(wren.getByRole("heading", { level: 1, name: "Wren Halloway" })).toBeVisible();
  await expect(wren.getByRole("button", { name: /^Follow/ })).toHaveCount(0);

  // Phone screenshots of the signed-in views.
  await pia.setViewportSize({ width: 390, height: 844 });
  await go(pia, "/community?tab=following");
  await expectNoHorizontalOverflow(pia);
  await shot(pia, "p2-following-phone-390-light");
  await go(pia, "/community?mode=creators");
  await expectNoHorizontalOverflow(pia);
  await shot(pia, "p2-creators-phone-390-light");
  await pia.setViewportSize({ width: 320, height: 720 });
  await go(pia, "/community?view=search");
  await expectNoHorizontalOverflow(pia);
  const xs = await pia.getByTestId("community-grid").locator("li").evaluateAll((els) => new Set(els.map((e) => Math.round(e.getBoundingClientRect().left))).size);
  expect(xs).toBe(1);
  await shot(pia, "p2-explore-phone-320-light");
  await pia.goto(wrenPage);
  await expect(pia.getByRole("heading", { level: 1, name: "Wren Halloway" })).toBeVisible();
  await expectNoHorizontalOverflow(pia);
  await shot(pia, "p2-creator-community-phone-320-light");

  // Unfollow from the creator page; Following empties.
  await pia.setViewportSize({ width: 1280, height: 800 });
  await pia.goto(wrenPage);
  await pia.getByRole("button", { name: "Follow Wren Halloway" }).click();
  await expect(pia.getByRole("button", { name: "Follow Wren Halloway" })).toHaveAttribute("aria-pressed", "false");
  await expect(pia.getByTestId("creator-community-counts")).toHaveText("Puzzle creator · 0 followers");
  await go(pia, "/community?tab=following");
  await expect(pia.getByText("You're not following anyone yet.")).toBeVisible();

  await Promise.all([piaCtx.close(), wrenCtx.close(), odieCtx.close()]);
});

test.describe("dark mode", () => {
  test.use({ settings: { darkMode: true } });
  test("Explore and creators in dark mode, keyboard reaches the bookmark", async ({ page }) => {
    await go(page, "/community?view=search");
    const byline = card(page, "community-grid", "A Little Offbeat").getByRole("link", { name: "Wren Halloway" });
    expect(await byline.evaluate((el) => getComputedStyle(el).color)).toBe("rgb(196, 181, 253)"); // violet-300
    // Keyboard: card title, then its bookmark.
    await card(page, "community-grid", "A Little Offbeat").getByRole("link", { name: "A Little Offbeat", exact: true }).focus();
    await page.keyboard.press("Tab");
    await expect(bookmark(page, "community-grid", "A Little Offbeat")).toBeFocused();
    await shot(page, "p2-explore-desktop-1280-dark-bookmark-focus", false);
    await page.setViewportSize({ width: 390, height: 844 });
    await go(page, "/community?mode=creators");
    await expectNoHorizontalOverflow(page);
    await shot(page, "p2-creators-phone-390-dark");
  });
});
