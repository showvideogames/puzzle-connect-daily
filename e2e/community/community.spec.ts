/**
 * Community Puzzles (preview) through the real app, against the disposable
 * local stack seeded by `e2e:reset` + `e2e:seed:community`. Every account and
 * puzzle is fictional. Runs serially: later steps unlist and re-list.
 *
 * Screenshots for design review are written to evidence/community-preview/.
 */
import fs from "node:fs";
import path from "node:path";
import type { Page } from "@playwright/test";
import { test, expect } from "../support/fixtures.ts";
import { signInAs, sessionFromLocalGoTrue } from "../support/auth.ts";
import { expectNoHorizontalOverflow, solveCategory } from "../support/game.ts";
import { E2E_DIR, loadE2eConfig } from "../env.ts";

const config = loadE2eConfig();
const preview = JSON.parse(fs.readFileSync(path.join(E2E_DIR, ".artifacts", "community-preview.json"), "utf8")) as {
  password: string;
  accounts: Record<"wren" | "odie" | "pia" | "quin", { email: string; name: string }>;
  puzzles: Record<string, { title: string; shareId: string; shortCode: string; listed: boolean }>;
};
const P = preview.puzzles;
const creds = (k: "wren" | "odie" | "pia") => ({ email: preview.accounts[k].email, password: preview.password });
// Part 1/2 screenshots are committed under evidence/; re-runs since the Explore overhaul go to a git-ignored folder.
const SHOTS = path.resolve(E2E_DIR, ".artifacts", "legacy-shots");
fs.mkdirSync(SHOTS, { recursive: true });
const shot = (page: Page, name: string, fullPage = true) =>
  page.screenshot({ path: path.join(SHOTS, `${name}.png`), fullPage, animations: "disabled" });

const LISTED = ["A Little Offbeat", "The Usual Suspects", "Something In The Air", "Pantry Raid", "Turn Of The Tides"];
const NEVER = ["Link Only Lighthouse", "Private Parlour Games", "Anonymous Airship", "Quiet Quarry", "E2E Community Classic"];
// Words and group names from the seeded puzzles: none may reach the feed.
const SPOILERS = ["BONGO", "ALIBI", "BREEZE", "BASIL", "CORAL", "group 1", "Fictional first words"];

const grid = (page: Page) => page.getByTestId("community-grid");
const cardTitles = async (page: Page) => grid(page).getByTestId("card-title").allInnerTexts();

async function settled(page: Page) {
  await expect(page.getByTestId("community-panel")).toHaveAttribute("aria-busy", "false");
}
/** The puzzle list these checks drive is Explore's search view since the Explore overhaul (part 3). */
async function openCommunity(page: Page, qs = "") {
  await page.goto(`/community?view=search${qs ? `&${qs.slice(1)}` : ""}`);
  await expect(page.getByRole("heading", { level: 1 }).first()).toBeVisible({ timeout: 30_000 });
  await settled(page);
}
/** Runs an action and waits for the feed request it causes, then for the page to settle. */
async function feedAfter(page: Page, action: () => Promise<unknown>) {
  const response = page.waitForResponse((r) => r.url().includes("/rpc/list_community_puzzles"));
  await action();
  await response;
  await settled(page);
}
async function search(page: Page, q: string) {
  const box = page.getByRole("searchbox", { name: "Search puzzles" });
  if ((await box.inputValue()) === q) return;
  await feedAfter(page, () => box.fill(q));
}
async function sortBy(page: Page, label: "Newest" | "Most Played") {
  const b = page.getByRole("group", { name: "Sort puzzles" }).getByRole("button", { name: label });
  if ((await b.getAttribute("aria-pressed")) !== "true") await feedAfter(page, () => b.click());
  await expect(b).toHaveAttribute("aria-pressed", "true");
}
async function rpcAs(token: string, fn: string, body: unknown) {
  return fetch(`${config.apiUrl}/rest/v1/rpc/${fn}`, {
    method: "POST",
    headers: { apikey: config.anonKey, Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

test.describe.configure({ mode: "serial" });

test("design review screenshots: desktop, 390px, 320px, dark, menu and keyboard focus", async ({ page }) => {
  await openCommunity(page);
  await expect(grid(page).locator("li")).toHaveCount(LISTED.length);
  await shot(page, "community-desktop-1280-light");

  for (const width of [390, 320]) {
    await page.setViewportSize({ width, height: 844 });
    await openCommunity(page);
    await expectNoHorizontalOverflow(page);
    // Single column on a phone.
    const xs = await grid(page).locator("li").evaluateAll((els) => new Set(els.map((e) => Math.round(e.getBoundingClientRect().left))).size);
    expect(xs).toBe(width >= 360 ? 2 : 1); // two equal columns once they fit
    await shot(page, `community-phone-${width}-light`);
  }
  await search(page, "zzz no such puzzle");
  await shot(page, "community-phone-320-no-matches", false);

  // Menu row (preview flag on) next to the existing links, which stay intact.
  await page.setViewportSize({ width: 390, height: 844 });
  await page.getByRole("button", { name: "Menu", exact: true }).click();
  const menu = page.getByRole("navigation", { name: "Main menu" });
  for (const label of ["Today's puzzle", "Rainbow Mini", "Puzzle archive", "Mini archive", "Community Puzzles", "Create a puzzle", "How to play"]) {
    await expect(menu.getByRole("link", { name: label, exact: true })).toBeVisible();
  }
  await shot(page, "menu-phone-390-light", false);
  await page.keyboard.press("Escape");

  // Keyboard: Tab reaches search, then the sort buttons; Enter changes sort.
  await page.setViewportSize({ width: 1280, height: 800 });
  await openCommunity(page);
  await page.getByRole("searchbox", { name: "Search puzzles" }).focus();
  await page.keyboard.press("Tab");
  await expect(page.getByRole("button", { name: "Newest" })).toBeFocused();
  await page.keyboard.press("Tab");
  await expect(page.getByRole("button", { name: "Most Played" })).toBeFocused();
  await feedAfter(page, () => page.keyboard.press("Enter"));
  await expect(page.getByRole("button", { name: "Most Played" })).toHaveAttribute("aria-pressed", "true");
  await expect(page).toHaveURL(/sort=plays/);
  await page.keyboard.press("Tab");
  await expect(grid(page).getByRole("link", { name: "The Usual Suspects", exact: true })).toBeFocused();
  await shot(page, "community-desktop-keyboard-focus", false);
});

test.describe("dark mode", () => {
  test.use({ settings: { darkMode: true } });
  test("uses the dark tokens at desktop and phone widths", async ({ page }) => {
    await openCommunity(page);
    expect(await page.evaluate(() => document.documentElement.classList.contains("dark"))).toBe(true);
    const bg = await page.evaluate(() => getComputedStyle(document.body).backgroundColor);
    expect(bg).toBe("rgb(23, 23, 23)");
    await shot(page, "community-desktop-1280-dark");
    await page.setViewportSize({ width: 390, height: 844 });
    await openCommunity(page);
    await expectNoHorizontalOverflow(page);
    await shot(page, "community-phone-390-dark");
  });
});

test("guest: only explicitly listed puzzles, on every sort and search, with no answers", async ({ page }) => {
  await openCommunity(page);
  expect((await cardTitles(page)).sort()).toEqual([...LISTED].sort());
  await page.goto("/community");
  await expect(page.getByRole("link", { name: "Create A Puzzle" })).toHaveAttribute("href", "/create");
  await expect(page.getByText("Play puzzles made by other Rainbow players.")).toBeVisible();
  await openCommunity(page);

  // Newest = listing order (newest first); Most Played = real finished plays.
  expect(await cardTitles(page)).toEqual([...LISTED].reverse());
  await sortBy(page, "Most Played");
  expect(await cardTitles(page)).toEqual(["The Usual Suspects", "A Little Offbeat", "Pantry Raid", "Something In The Air", "Turn Of The Tides"]);
  const usualCard = grid(page).locator("li").filter({ hasText: "The Usual Suspects" });
  await expect(usualCard).toContainText("31 plays");
  await expect(usualCard.getByRole("link", { name: "Odie Marsh" })).toHaveAttribute("href", /^\/creator\/odie-marsh-/);

  // Link-only, private and anonymous puzzles have MORE plays than any listed
  // one, and still never appear, including under Most Played and search.
  const body = await page.locator("main").innerText();
  for (const t of NEVER) expect(body).not.toContain(t);
  for (const s of SPOILERS) expect(body).not.toContain(s);
  for (const q of ["Lighthouse", "Parlour", "Airship", "Quarry", "E2E Community"]) {
    for (const sort of ["Newest", "Most Played"] as const) {
      await sortBy(page, sort);
      await search(page, q);
      await expect(page.getByText(`No puzzles match “${q}”.`)).toBeVisible();
    }
  }
  await feedAfter(page, () => page.getByRole("button", { name: "Clear search" }).first().click());

  // Search by creator name and by title.
  await search(page, "wren");
  expect((await cardTitles(page)).sort()).toEqual(["A Little Offbeat", "Pantry Raid"]);
  await search(page, "suspects");
  expect(await cardTitles(page)).toEqual(["The Usual Suspects"]);

  // The feed payload itself: card fields only.
  const res = await page.request.post(`${config.apiUrl}/rest/v1/rpc/list_community_puzzles`, {
    headers: { apikey: config.anonKey, "Content-Type": "application/json" },
    data: { _sort: "plays" },
  });
  const payload = await res.json();
  expect(Object.keys(payload.items[0]).sort()).toEqual(["cover_background", "cover_emoji", "cover_emoji_2", "cover_emoji_3", "creator_name", "creator_slug", "favorite_count", "finished_plays", "listed_at", "mode", "short_code", "title"]);
  const raw = JSON.stringify(payload);
  for (const p of Object.values(P)) expect(raw).not.toContain(p.shareId);
  for (const s of SPOILERS) expect(raw).not.toContain(s);
  expect(raw).not.toMatch(/@rainbow\.test|email|created_by|"id"/);
});

test("guest: loading failure offers Retry, which recovers", async ({ page, pageProblems }) => {
  let fail = true;
  await page.route("**/rest/v1/rpc/list_community_puzzles", (route) => (fail ? route.fulfill({ status: 503, body: "{}" }) : route.continue()));
  await page.goto("/community?view=search");
  await expect(page.getByText("Couldn't load Community puzzles.")).toBeVisible({ timeout: 30_000 });
  await shot(page, "community-desktop-error", false);
  fail = false;
  await page.getByRole("button", { name: "Retry" }).click();
  await expect(grid(page).locator("li")).toHaveCount(LISTED.length);
  // The deliberate 503 above is the only failed request this test expects.
  pageProblems.failedRequests.splice(0, pageProblems.failedRequests.length, ...pageProblems.failedRequests.filter((r) => !/list_community_puzzles.*503/.test(r)));
  pageProblems.consoleErrors.splice(0, pageProblems.consoleErrors.length, ...pageProblems.consoleErrors.filter((e) => !/503/.test(e)));
});

test("guest: finds a puzzle, plays it to the end, and its play count goes up", async ({ page }) => {
  await openCommunity(page);
  await search(page, "Pantry");
  const card = grid(page).locator("li").filter({ hasText: "Pantry Raid" });
  await expect(card).toContainText("7 plays");
  await card.getByRole("link", { name: "Pantry Raid", exact: true }).click();
  await expect(page).toHaveURL(`/p/${P.pantry.shortCode}`);
  await expect(page.getByRole("heading", { name: "Pantry Raid" })).toBeVisible();
  const groups = [
    ["BASIL", "CUMIN", "NUTMEG", "THYME"], ["BARLEY", "OATS", "RICE", "RYE"],
    ["HONEY", "JAM", "MOLASSES", "SYRUP"], ["CAPER", "OLIVE", "PICKLE", "RELISH"],
  ];
  for (const [i, words] of groups.entries()) await solveCategory(page, { category: `Pantry Raid group ${i + 1}`, words });
  // Back to the feed: the real counter now includes this finished play.
  await expect.poll(async () => {
    await openCommunity(page, "?q=Pantry");
    return grid(page).locator("li").filter({ hasText: "Pantry Raid" }).innerText();
  }, { timeout: 20_000 }).toContain("8 plays");
});

test("creator unlists: gone from every sort and search; short and long links still play; can re-list", async ({ page, browser }) => {
  await page.goto(`/p/${P.usual.shortCode}`);
  await signInAs(page, creds("odie"));
  const control = page.getByTestId("community-listing-control");
  await expect(control).toContainText("Listed on Community Puzzles");
  await control.scrollIntoViewIfNeeded();
  await shot(page, "owner-control-listed-desktop", false);
  await control.getByRole("button", { name: "Unlist from Community" }).click();
  await expect(control).toContainText("Not listed. Only people with the link can find it.");

  await openCommunity(page);
  for (const sort of ["Newest", "Most Played"] as const) {
    await sortBy(page, sort);
    expect(await cardTitles(page)).not.toContain("The Usual Suspects");
    await search(page, "Usual");
    await expect(page.getByText("No puzzles match “Usual”.")).toBeVisible();
    await search(page, "");
  }

  // A guest with the old links can still play it.
  const guest = await browser.newContext({ baseURL: config.appUrl });
  const g = await guest.newPage();
  for (const url of [`/p/${P.usual.shortCode}`, `/custom/${P.usual.shareId}`]) {
    await g.goto(url);
    await expect(g.getByRole("heading", { name: "The Usual Suspects" })).toBeVisible({ timeout: 30_000 });
    await expect(g.getByRole("button", { name: /ALIBI/ })).toBeVisible();
    await expect(g.getByTestId("community-listing-control")).toHaveCount(0);
  }
  await guest.close();

  // Re-list (restores the fixture for later steps).
  await page.goto(`/p/${P.usual.shortCode}`);
  await page.getByTestId("community-listing-control").getByRole("button", { name: "List in Community" }).click();
  await expect(page.getByTestId("community-listing-control")).toContainText("Listed on Community Puzzles");
  await openCommunity(page);
  expect(await cardTitles(page)).toContain("The Usual Suspects");
});

test("another account cannot list or unlist someone else's puzzle", async ({ page }) => {
  await page.goto(`/p/${P.offbeat.shortCode}`);
  await signInAs(page, creds("pia"));
  await expect(page.getByRole("heading", { name: "A Little Offbeat" })).toBeVisible();
  await expect(page.getByTestId("community-listing-control")).toHaveCount(0);

  const pia = await sessionFromLocalGoTrue(creds("pia"));
  const unlist = await rpcAs(pia.access_token, "set_custom_puzzle_community_listing", { _share_id: P.offbeat.shareId, _listed: false });
  expect(unlist.status).toBe(403);
  expect(await unlist.text()).toContain("only the puzzle's creator");
  const listAnon = await rpcAs(pia.access_token, "set_custom_puzzle_community_listing", { _share_id: P.anon.shareId, _listed: true });
  expect(listAnon.status).toBe(403);
  const state = await rpcAs(pia.access_token, "get_my_custom_puzzle_listing", { _share_id: P.offbeat.shareId });
  expect(await state.json()).toEqual({ owned: false });
  // A guest (anon key, no session) is refused outright.
  const guest = await rpcAs(config.anonKey, "set_custom_puzzle_community_listing", { _share_id: P.offbeat.shareId, _listed: false });
  expect([401, 403]).toContain(guest.status);

  await openCommunity(page);
  expect(await cardTitles(page)).toContain("A Little Offbeat");
  // The owner of a PRIVATE puzzle sees why it can't be listed.
  await page.goto(`/p/${P.private.shortCode}`);
  await signInAs(page, creds("wren"));
  await expect(page.getByTestId("community-listing-control")).toContainText("Private puzzles can't be listed in Community.");
  await expect(page.getByTestId("community-listing-control").getByRole("button")).toHaveCount(0);
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

test("create flow: explicit List in Community control, off by default, never for private or guests", async ({ page }) => {
  // Guest: the control is there but disabled, and says why.
  await page.goto("/create");
  const box = page.getByRole("checkbox", { name: "List in Community" });
  await expect(box).toBeDisabled();
  await expect(page.getByText("Sign in to list your puzzle in Community Puzzles.", { exact: false })).toBeVisible();

  await signInAs(page, creds("wren"));
  await expect(box).toBeEnabled();
  await expect(box).not.toBeChecked();
  await page.getByRole("button", { name: "private", exact: true }).click();
  await expect(box).toBeDisabled();
  await expect(page.getByText("Private puzzles are never listed in Community.")).toBeVisible();
  await page.getByRole("button", { name: "public", exact: true }).click();
  await expect(box).not.toBeChecked(); // never inferred from Public

  // Public, not ticked: created with a link, not listed.
  await fillBuilder(page, "Fictional Quiet Link", [W("ACORN BIRCH CEDAR DOGWOOD"), W("ELM FIR HAZEL IRONWOOD"), W("JUNIPER KAPOK LARCH MAPLE"), W("NUTMEGTREE OAK PINE QUINCE")]);
  await page.getByRole("button", { name: "Create Game" }).click();
  await expect(page.getByRole("heading", { name: "Puzzle Created!" })).toBeVisible();
  await expect(page.getByTestId("community-listing-result")).toHaveText("Not listed in Community. Only people with the link can find it.");

  // Public, ticked: listed.
  await page.goto("/create");
  await expect(page.getByRole("checkbox", { name: "List in Community" })).toBeEnabled();
  await fillBuilder(page, "Fictional Fresh Listing", [W("ARCH BRIDGE COLUMN DOME"), W("EAVE FACADE GABLE HALL"), W("INN JETTY KEEP LODGE"), W("MANOR NAVE ORIEL PORCH")]);
  await page.getByRole("checkbox", { name: "List in Community" }).check();
  await page.getByRole("checkbox", { name: "List in Community" }).scrollIntoViewIfNeeded();
  await shot(page, "create-list-in-community-desktop", false);
  await page.getByRole("button", { name: "Create Game" }).click();
  await expect(page.getByTestId("community-listing-result")).toContainText("Listed in Community Puzzles.");
  await shot(page, "create-success-listed-desktop", false);

  await openCommunity(page);
  const titles = await cardTitles(page);
  expect(titles[0]).toBe("Fictional Fresh Listing");
  expect(titles).not.toContain("Fictional Quiet Link");
});

function W(s: string) { return s.split(" "); }
