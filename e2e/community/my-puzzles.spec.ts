/**
 * My Puzzles through the real app on the disposable local stack (GoTrue +
 * PostgREST + migrations 0001-0011), fictional fixtures only: the owner reaches
 * it from their account menu, sees every puzzle they made (an older music
 * puzzle with no cover, listed ones, a Private one) newest first and nobody
 * else's; adds a cover, lists and unlists, copies the link and opens it; a new
 * puzzle from Create shows up at the top; a second account sees only its own
 * and can't change Wren's; guests get a sign-in prompt and the server refuses
 * them; opening the page lists nothing by itself. Phone and desktop.
 *
 *   npm run e2e:community -- my-puzzles.spec.ts
 */
import fs from "node:fs";
import path from "node:path";
import type { Page } from "@playwright/test";
import { test, expect } from "../support/fixtures.ts";
import { signInAs, sessionFromLocalGoTrue } from "../support/auth.ts";
import { expectNoHorizontalOverflow } from "../support/game.ts";
import { E2E_DIR, loadE2eConfig } from "../env.ts";
import { ACCOUNTS } from "../fixtures/catalog.ts";

const config = loadE2eConfig();
const preview = JSON.parse(fs.readFileSync(path.join(E2E_DIR, ".artifacts", "community-preview.json"), "utf8")) as {
  password: string;
  accounts: Record<string, { email: string }>;
  puzzles: Record<string, { title: string; shareId: string; shortCode: string }>;
};
const P = preview.puzzles;
const creds = (k: string) => ({ email: preview.accounts[k].email, password: preview.password });
const SHOTS = path.resolve(E2E_DIR, "..", "evidence", "my-puzzles");
fs.mkdirSync(SHOTS, { recursive: true });
const shot = (page: Page, name: string, fullPage = true) => page.screenshot({ path: path.join(SHOTS, `${name}.png`), fullPage, animations: "disabled" });

async function rpc(token: string, fn: string, body: unknown) {
  const r = await fetch(`${config.apiUrl}/rest/v1/rpc/${fn}`, {
    method: "POST",
    headers: { apikey: config.anonKey, Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  return { status: r.status, text: await r.text() };
}
/** Every listed puzzle's short code, as the public Community feed returns it. */
async function listedCodes(): Promise<string[]> {
  const r = await rpc(config.anonKey, "list_community_puzzles", { _limit: 48 });
  return (JSON.parse(r.text) as { items: { short_code: string }[] }).items.map((i) => i.short_code).sort();
}
const list = (page: Page) => page.getByTestId("my-puzzles-list");
const row = (page: Page, title: string) => list(page).getByTestId("my-puzzle").filter({ has: page.getByRole("heading", { name: title, exact: true }) });
async function openMine(page: Page) {
  await expect(page.getByTestId("my-puzzles")).toHaveAttribute("aria-busy", "false", { timeout: 30_000 });
}

test.describe.configure({ mode: "serial" });
test.use({ permissions: ["clipboard-read", "clipboard-write"] });

test("guest: a sign-in prompt, no list, and the server refuses the read", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/my-puzzles");
  await expect(page.getByTestId("my-puzzles-guest")).toContainText("Sign in to see your puzzles.");
  await expect(page.getByRole("button", { name: "Sign in" })).toBeVisible();
  await expect(page.getByTestId("my-puzzles-list")).toHaveCount(0);
  await expectNoHorizontalOverflow(page);
  await shot(page, "guest-phone-390", false);
  const anon = await rpc(config.anonKey, "list_my_custom_puzzles", {});
  expect([401, 403]).toContain(anon.status);
  expect(anon.text).not.toContain("Mixtape");
});

test("owner: from the account menu to every own puzzle, newest first, and nobody else's", async ({ page }) => {
  const before = await listedCodes();
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/");
  await signInAs(page, creds("wren"));
  // The account's own menu (Settings and menu), beside the profile and Account rows.
  await page.getByRole("button", { name: "Settings and menu" }).click();
  await expect(page.getByRole("button", { name: "My Puzzles" })).toBeVisible();
  await shot(page, "settings-menu-my-puzzles-phone-390", false);
  // The Account dropdown offers it too.
  await page.getByRole("button", { name: "Account", exact: true }).first().click();
  await expect(page.getByTestId("account-menu").getByRole("link", { name: "My puzzles" })).toHaveAttribute("href", "/my-puzzles");
  await page.getByTestId("account-menu").getByRole("link", { name: "My puzzles" }).click();
  await expect(page).toHaveURL(/\/my-puzzles$/);
  await openMine(page);
  await expect(page.getByRole("heading", { level: 1, name: "My Puzzles" })).toBeVisible();
  await expect(list(page).getByRole("heading", { level: 2 })).toHaveText(["Private Parlour Games", "Pantry Raid", "A Little Offbeat", "Mixtape Memories"]);
  await expect(page.getByText("4 puzzles you've made. Only you can see this list.")).toBeVisible();
  for (const other of ["The Usual Suspects", "Turn Of The Tides", "Something In The Air", "Link Only Lighthouse", "Quiet Quarry", "Anonymous Airship"]) {
    await expect(page.getByTestId("my-puzzles")).not.toContainText(other);
  }
  // Concise status for each kind.
  await expect(row(page, "Private Parlour Games").getByTestId("my-puzzle-status")).toHaveText("Private");
  await expect(row(page, "Private Parlour Games").getByTestId("my-puzzle-note")).toContainText("Private puzzles can't be listed in Community.");
  await expect(row(page, "Private Parlour Games").getByRole("button", { name: /List .* in Community/ })).toHaveCount(0);
  await expect(row(page, "Pantry Raid").getByTestId("my-puzzle-status")).toHaveText("In Community");
  const music = row(page, "Mixtape Memories");
  await expect(music.getByTestId("my-puzzle-status")).toHaveText("Link only");
  await expect(music.locator("[data-cover-kind]")).toHaveAttribute("data-cover-kind", "default");
  await expect(music).toContainText(/Made .*2025/);
  await expectNoHorizontalOverflow(page);
  await shot(page, "owner-phone-390");
  // Opening the page listed, published or covered nothing.
  expect(await listedCodes()).toEqual(before);

  // Copy Link gives the existing short share link; Open plays it.
  await music.getByRole("button", { name: "Copy link to Mixtape Memories" }).click();
  await expect(music.getByRole("button", { name: "Copy link to Mixtape Memories" })).toHaveText("Link copied");
  expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(`${new URL(page.url()).origin}/p/${P.music.shortCode}`);
  await music.getByRole("link", { name: "Open Mixtape Memories" }).click();
  await expect(page).toHaveURL(new RegExp(`/p/${P.music.shortCode}$`));
  await expect(page.getByRole("heading", { name: "Mixtape Memories" })).toBeVisible({ timeout: 30_000 });
  await page.goBack();
  await openMine(page);

  // Add a cover with the existing picker.
  await row(page, "Mixtape Memories").getByRole("button", { name: "Add a cover for Mixtape Memories" }).click();
  const picker = page.getByTestId("cover-picker");
  await picker.getByRole("searchbox", { name: "Search emojis" }).fill("headphone");
  await picker.getByRole("option", { name: "headphone", exact: true }).click();
  await picker.getByRole("radio", { name: "Rainbow", exact: true }).click();
  await picker.scrollIntoViewIfNeeded();
  await shot(page, "owner-add-cover-phone-390", false);
  await picker.getByRole("button", { name: "Save Cover" }).click();
  await expect(row(page, "Mixtape Memories").getByTestId("my-puzzle-result")).toHaveText("Cover saved.");
  await expect(row(page, "Mixtape Memories").locator("[data-cover-kind]")).toHaveAttribute("data-cover-emoji", "1F3A7-FE0F");
  await expect(row(page, "Mixtape Memories").locator("[data-cover-kind]")).toHaveAttribute("data-cover-background", "rainbow-bands");
  // Saving a cover didn't list it.
  expect(await listedCodes()).toEqual(before);

  // List it, see it in Community, then unlist it; its link keeps working.
  await row(page, "Mixtape Memories").getByRole("button", { name: "List Mixtape Memories in Community" }).click();
  await expect(row(page, "Mixtape Memories").getByTestId("my-puzzle-status")).toHaveText("In Community");
  expect(await listedCodes()).toEqual([...before, P.music.shortCode].sort());
  await page.reload();
  await openMine(page);
  await expect(row(page, "Mixtape Memories").getByTestId("my-puzzle-status")).toHaveText("In Community");
  await row(page, "Mixtape Memories").getByRole("button", { name: "Unlist Mixtape Memories from Community" }).click();
  await expect(row(page, "Mixtape Memories").getByTestId("my-puzzle-result")).toHaveText("Unlisted. Its link still works.");
  await expect(row(page, "Mixtape Memories").getByTestId("my-puzzle-status")).toHaveText("Link only");
  expect(await listedCodes()).toEqual(before);
  expect(JSON.parse((await rpc(config.anonKey, "get_custom_puzzle_by_short_code", { _short_code: P.music.shortCode })).text).title).toBe("Mixtape Memories");

  // Favorites stay separate.
  await expect(page.getByRole("link", { name: "Favorites" })).toHaveAttribute("href", "/community?tab=favorites");

  await page.setViewportSize({ width: 1280, height: 860 });
  await page.reload();
  await openMine(page);
  await expectNoHorizontalOverflow(page);
  await shot(page, "owner-desktop-1280");
});

test("second account: only its own puzzles, and it can't change Wren's", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/");
  await signInAs(page, creds("odie"));
  await page.getByRole("button", { name: "Settings and menu" }).click();
  await page.getByRole("button", { name: "My Puzzles" }).click();
  await expect(page).toHaveURL(/\/my-puzzles$/);
  await openMine(page);
  await expect(list(page).getByRole("heading", { level: 2 })).toHaveText(["Turn Of The Tides", "The Usual Suspects"]);
  await expect(page.getByTestId("my-puzzles")).not.toContainText("Mixtape Memories");
  await expect(page.getByTestId("my-puzzles")).not.toContainText("Private Parlour Games");
  const odie = (await sessionFromLocalGoTrue(creds("odie"))).access_token;
  const mine = JSON.parse((await rpc(odie, "list_my_custom_puzzles", { _limit: 48 })).text) as { items: { title: string }[]; total: number };
  expect(mine.total).toBe(2);
  expect(JSON.stringify(mine)).not.toMatch(/Mixtape|Parlour|content|created_by|words/);
  expect((await rpc(odie, "set_custom_puzzle_community_listing", { _share_id: P.music.shareId, _listed: true })).status).toBe(403);
  expect((await rpc(odie, "set_custom_puzzle_cover_emojis", { _share_id: P.music.shareId, _emojis: ["1F438"], _background: "lilac" })).status).toBe(403);
});

test("an account with no puzzles gets the empty state, which points to Create", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/my-puzzles");
  await signInAs(page, { email: ACCOUNTS.player.email, password: ACCOUNTS.player.password });
  await openMine(page);
  await expect(page.getByTestId("my-puzzles-empty")).toContainText("You haven't made a puzzle yet.");
  await shot(page, "empty-phone-390", false);
  await page.getByTestId("my-puzzles-empty").getByRole("link", { name: "Create A Puzzle" }).click();
  await expect(page).toHaveURL(/\/create$/);
});

test("created from Create A Puzzle: saved to My Puzzles, not listed", async ({ page }) => {
  const before = await listedCodes();
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/create");
  await signInAs(page, creds("pia"));
  await expect(page.getByTestId("create-my-puzzles")).toBeVisible();
  await page.getByLabel("Puzzle Title").fill("Pocket Orchestra");
  const designer = page.getByLabel("Your Name (Designer)");
  if (await designer.isEditable()) await designer.fill("Pia Lindqvist");
  else await expect(designer).toHaveValue("Pia Lindqvist");
  await page.getByRole("button", { name: "Classic", exact: true }).click();
  const words = [["CELLO", "HARP", "OBOE", "TUBA"], ["ADAGIO", "LARGO", "PRESTO", "VIVACE"], ["BATON", "PODIUM", "SCORE", "STAND"], ["DUET", "OCTET", "SOLO", "TRIO"]];
  for (let i = 0; i < 4; i++) {
    const fields = page.getByTestId(`category-card-${i + 1}`).getByRole("textbox");
    await fields.nth(0).fill(`Pocket set ${i + 1}`);
    await fields.nth(2).fill(words[i].join(", "));
  }
  await page.getByRole("button", { name: "Create Game" }).click();
  await expect(page.getByTestId("created-in-my-puzzles")).toBeVisible({ timeout: 30_000 });
  await page.getByTestId("created-in-my-puzzles").getByRole("link", { name: "My Puzzles" }).click();
  await openMine(page);
  await expect(list(page).getByRole("heading", { level: 2 }).first()).toHaveText("Pocket Orchestra");
  await expect(row(page, "Pocket Orchestra").getByTestId("my-puzzle-status")).toHaveText("Link only");
  expect(await listedCodes()).toEqual(before);
});
