/**
 * Rainbow Community follow-up, through the real app on the disposable local
 * stack (migrations 0001-0015), fictional fixtures only:
 *   1. per-emoji cover sizes: three independent sizes set by keyboard and
 *      pointer in My Puzzles and two in Create, the same after a reload on
 *      My Puzzles, Community (Featured and Newest) and the puzzle page, clipped
 *      to the art; an older cover keeps its exact standard look;
 *   2. the public name: an immediate first rename that starts the 30-day wait,
 *      a no-op that doesn't, earlier bylines unchanged, the creator URL stable;
 *   3. a listed legacy puzzle reassigned to an account with no creator page:
 *      a plain byline until its owner visits My Puzzles, then a link to that
 *      owner's public shelf showing only their listed puzzles.
 *
 *   npm run e2e:community -- rainbow-followup.spec.ts
 */
import fs from "node:fs";
import path from "node:path";
import { createClient } from "@supabase/supabase-js";
import type { Locator, Page } from "@playwright/test";
import { test, expect } from "../support/fixtures.ts";
import { signInAs, sessionFromLocalGoTrue } from "../support/auth.ts";
import { expectNoHorizontalOverflow } from "../support/game.ts";
import { E2E_DIR, loadE2eConfig } from "../env.ts";
import { createSupabaseSeedBackend } from "../scripts/lib/seed-supabase.ts";
import { fixtureGlobalUserId } from "../scripts/lib/seed-core.ts";

const config = loadE2eConfig();
const preview = JSON.parse(fs.readFileSync(path.join(E2E_DIR, ".artifacts", "community-preview.json"), "utf8")) as {
  password: string;
  accounts: Record<string, { email: string }>;
  puzzles: Record<string, { title: string; shareId: string; shortCode: string }>;
};
const P = preview.puzzles;
const creds = (k: string) => ({ email: preview.accounts[k].email, password: preview.password });
const HAL = { email: "e2e-hal@rainbow.test", password: preview.password };
const SHOTS = path.resolve(E2E_DIR, "..", "evidence", "rainbow-followup");
fs.mkdirSync(SHOTS, { recursive: true });
const shot = (page: Page, name: string, fullPage = false) => page.screenshot({ path: path.join(SHOTS, `${name}.png`), fullPage, animations: "disabled" });

async function rpc(token: string, fn: string, body: unknown) {
  const r = await fetch(`${config.apiUrl}/rest/v1/rpc/${fn}`, {
    method: "POST",
    headers: { apikey: config.anonKey, Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  return { status: r.status, json: (await r.json().catch(() => null)) as Record<string, unknown> | null };
}
const row = (page: Page, title: string) => page.getByTestId("my-puzzles-list").getByTestId("my-puzzle").filter({ has: page.getByRole("heading", { name: title, exact: true }) });
async function openMine(page: Page) {
  await expect(page.getByTestId("my-puzzles")).toHaveAttribute("aria-busy", "false", { timeout: 30_000 });
}
async function openCommunity(page: Page) {
  await page.goto("/community");
  await expect(page.getByTestId("community-panel")).toHaveAttribute("aria-busy", "false", { timeout: 30_000 });
}
/** The art crops its own emoji: overflow hidden, and the title next to it is never covered. */
async function clippedBeside(art: Locator, title: Locator) {
  await title.scrollIntoViewIfNeeded();
  expect(await art.evaluate((e) => getComputedStyle(e).overflow)).toBe("hidden");
  const a = (await art.boundingBox())!;
  const t = (await title.boundingBox())!;
  const overlap = !(t.x >= a.x + a.width || t.x + t.width <= a.x || t.y >= a.y + a.height || t.y + t.height <= a.y);
  expect(overlap).toBe(false);
  const topmost = await title.evaluate((el) => {
    const r = el.getBoundingClientRect();
    const hit = document.elementFromPoint(r.left + Math.min(8, r.width / 2), r.top + r.height / 2);
    return !!hit && (hit === el || el.contains(hit));
  });
  expect(topmost).toBe(true);
}

test.describe.configure({ mode: "serial" });

test("cover sizes: independent per emoji, saved, the same everywhere after a reload; older covers unchanged", async ({ page }) => {
  // An older cover, saved with the pre-size setter: standard sizes exactly.
  const wren = (await sessionFromLocalGoTrue(creds("wren"))).access_token;
  expect((await rpc(wren, "set_custom_puzzle_cover_emojis", { _share_id: P.offbeat.shareId, _emojis: ["1F3B8"], _background: "lilac" })).status).toBe(200);

  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/my-puzzles");
  await signInAs(page, creds("wren"));
  await openMine(page);
  await row(page, "Pantry Raid").getByRole("button", { name: "Add a cover for Pantry Raid" }).click();
  const picker = page.getByTestId("cover-picker");
  for (const name of ["frog", "tulip", "star"]) {
    await picker.getByRole("searchbox", { name: "Search emojis" }).fill(name);
    await picker.getByRole("option", { name, exact: true }).click();
  }
  const preview = picker.getByTestId("cover-preview").locator("[data-cover-kind=creator]");
  await expect(preview).toHaveAttribute("data-cover-sizes", "100 100 100");
  // Keyboard: Home and End; pointer/touch-style value set; each independent.
  const frog = picker.getByRole("slider", { name: "Frog size" });
  await frog.focus();
  await page.keyboard.press("Home");
  await expect(preview).toHaveAttribute("data-cover-sizes", "50 100 100");
  const tulip = picker.getByRole("slider", { name: "Tulip size" });
  await tulip.focus();
  await page.keyboard.press("End");
  await expect(preview).toHaveAttribute("data-cover-sizes", "50 250 100");
  await picker.getByRole("slider", { name: "Star size" }).fill("150");
  await expect(preview).toHaveAttribute("data-cover-sizes", "50 250 150");
  await expect(tulip).toHaveAttribute("aria-valuetext", "250 percent");
  // Moving an emoji takes its size with it; the background is untouched.
  await picker.getByRole("button", { name: "Move tulip left" }).click();
  await expect(preview).toHaveAttribute("data-cover-emoji", "1F337 1F438 2B50-FE0F");
  await expect(preview).toHaveAttribute("data-cover-sizes", "250 50 150");
  await expectNoHorizontalOverflow(page);
  await picker.getByTestId("cover-chosen").scrollIntoViewIfNeeded();
  await shot(page, "sizes-picker-phone-390");
  await picker.getByRole("button", { name: "Save Cover" }).click();
  await expect(row(page, "Pantry Raid").getByTestId("my-puzzle-result")).toHaveText("Cover saved.");

  // After a reload: My Puzzles, then Community (Featured + Newest), then the puzzle page.
  await page.reload();
  await openMine(page);
  const libArt = row(page, "Pantry Raid").locator("[data-cover-kind]");
  await expect(libArt).toHaveAttribute("data-cover-sizes", "250 50 150");
  await clippedBeside(libArt, row(page, "Pantry Raid").getByRole("heading", { name: "Pantry Raid" }));
  await openCommunity(page);
  const newest = page.getByTestId("newest-list").getByTestId("community-card").filter({ hasText: "Pantry Raid" });
  await expect(newest.locator("[data-cover-kind]")).toHaveAttribute("data-cover-sizes", "250 50 150");
  await clippedBeside(newest.locator("[data-cover-kind]"), newest.getByTestId("card-title"));
  await newest.screenshot({ path: path.join(SHOTS, "sizes-newest-row-phone-390.png"), animations: "disabled" });
  // The older cover: one emoji, standard size, exactly as before.
  const older = page.getByTestId("newest-list").getByTestId("community-card").filter({ hasText: "A Little Offbeat" }).locator("[data-cover-kind]");
  await expect(older).toHaveAttribute("data-cover-sizes", "100");
  // Puzzle search (shared cover cards) too.
  await page.goto("/community?view=search&q=Pantry");
  await expect(page.getByTestId("community-panel")).toHaveAttribute("aria-busy", "false", { timeout: 30_000 });
  await expect(page.getByTestId("community-card").filter({ hasText: "Pantry Raid" }).locator("[data-cover-kind]")).toHaveAttribute("data-cover-sizes", "250 50 150");
  await page.goto(`/p/${P.pantry.shortCode}`);
  await expect(page.getByTestId("puzzle-cover").locator("[data-cover-kind]")).toHaveAttribute("data-cover-sizes", "250 50 150", { timeout: 30_000 });
  // The server keeps them per slot and refuses out-of-bounds sizes.
  expect((await rpc(wren, "set_custom_puzzle_cover_sized", { _share_id: P.pantry.shareId, _emojis: ["1F438"], _background: "lilac", _sizes: [300] })).status).toBe(400);
  const odie = (await sessionFromLocalGoTrue(creds("odie"))).access_token;
  expect((await rpc(odie, "set_custom_puzzle_cover_sized", { _share_id: P.pantry.shareId, _emojis: ["1F438"], _background: "lilac", _sizes: [120] })).status).toBe(403);
  await page.setViewportSize({ width: 1280, height: 860 });
  await openCommunity(page);
  await page.getByTestId("newest-section").screenshot({ path: path.join(SHOTS, "sizes-newest-desktop-1280.png"), animations: "disabled" });
});

test("cover sizes through Create: two sizes saved with a new puzzle", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/create");
  await signInAs(page, creds("odie"));
  await page.getByLabel("Puzzle Title").fill("Sized Sea Shanty");
  await page.getByRole("button", { name: "Classic", exact: true }).click();
  const words = [["CHANTEY", "DIRGE", "HYMN", "JIG"], ["ANCHOR", "BOW", "HULL", "STERN"], ["CORAL", "KELP", "PEARL", "SHELL"], ["GALE", "SQUALL", "STORM", "TIDE"]];
  for (let i = 0; i < 4; i++) {
    const fields = page.getByTestId(`category-card-${i + 1}`).getByRole("textbox");
    await fields.nth(0).fill(`Sea set ${i + 1}`);
    await fields.nth(2).fill(words[i].join(", "));
  }
  await page.getByRole("checkbox", { name: "List in Community" }).check();
  const picker = page.getByTestId("cover-picker");
  for (const name of ["anchor", "spiral shell"]) {
    await picker.getByRole("searchbox", { name: "Search emojis" }).fill(name);
    await picker.getByRole("option", { name, exact: true }).click();
  }
  await picker.getByRole("slider", { name: "Anchor size" }).fill("200");
  await picker.getByRole("slider", { name: "Spiral shell size" }).fill("60");
  await expect(picker.getByTestId("cover-preview").locator("[data-cover-kind=creator]")).toHaveAttribute("data-cover-sizes", "200 60");
  await page.getByRole("button", { name: "Create Game" }).click();
  await expect(page.getByTestId("cover-result")).toHaveText("Cover saved.", { timeout: 30_000 });
  await openCommunity(page);
  await page.reload();
  await expect(page.getByTestId("community-panel")).toHaveAttribute("aria-busy", "false", { timeout: 30_000 });
  const first = page.getByTestId("newest-list").getByTestId("community-card").first();
  await expect(first.getByTestId("card-title")).toHaveText("Sized Sea Shanty");
  await expect(first.locator("[data-cover-kind]")).toHaveAttribute("data-cover-sizes", "200 60");
});

test("public name: immediate first rename starts the 30-day wait; no-ops don't; bylines and URL stay", async ({ page }) => {
  const pia = (await sessionFromLocalGoTrue(creds("pia"))).access_token;
  const slugBefore = ((await rpc(config.anonKey, "get_custom_puzzle_by_short_code", { _short_code: P.air.shortCode })).json as { creator_slug: string }).creator_slug;
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/my-puzzles#public-name");
  await signInAs(page, creds("pia"));
  const name = page.getByRole("textbox", { name: "Public name" });
  await expect(name).toHaveValue("Pia Lindqvist", { timeout: 30_000 });
  await expect(page.getByRole("button", { name: "Save name" })).toBeDisabled(); // nothing to save
  await name.fill("Pia L.");
  await page.getByRole("button", { name: "Save name" }).click();
  await expect(page.getByText("Public name saved.")).toBeVisible();
  await expect(page.locator("#public-name-limit")).toContainText("You can change it again on");
  await expect(name).toHaveAttribute("readonly", "");
  await shot(page, "public-name-cooldown-phone-390");
  const saved = (await rpc(pia, "get_my_creator_name", {})).json as { next_change_at: string };
  // A no-op save doesn't move the wait; a second rename is refused by the server.
  expect(((await rpc(pia, "set_my_creator_name", { _name: "  Pia   L. " })).json as { outcome: string; next_change_at: string })).toMatchObject({ outcome: "unchanged", next_change_at: saved.next_change_at });
  expect(((await rpc(pia, "set_my_creator_name", { _name: "Pia Again" })).json as { outcome: string }).outcome).toBe("cooldown");
  const days = (Date.parse(saved.next_change_at) - Date.now()) / 86_400_000;
  expect(days).toBeGreaterThan(29.9);
  expect(days).toBeLessThanOrEqual(30);
  // Earlier bylines stay as saved; the creator page shows the new name at the same URL.
  const air = (await rpc(config.anonKey, "get_custom_puzzle_by_short_code", { _short_code: P.air.shortCode })).json as { creator_name: string; creator_slug: string };
  expect(air).toMatchObject({ creator_name: "Pia Lindqvist", creator_slug: slugBefore });
  await page.goto(`/creator/${slugBefore}?view=community`);
  await expect(page.getByRole("heading", { level: 1, name: "Pia L." })).toBeVisible({ timeout: 30_000 });
});

test("legacy byline: plain until the reassigned owner has a page, then a link to only their listed puzzles", async ({ page, context }) => {
  // Fictional legacy puzzles made as a guest, then assigned by hand to Hal,
  // an account with no creator page; one was already listed.
  const backend = createSupabaseSeedBackend(config);
  const halId = await backend.createAccount(HAL.email, HAL.password, fixtureGlobalUserId("communityhal"));
  const anon = createClient(config.apiUrl, config.anonKey, { auth: { persistSession: false } });
  const service = createClient(config.apiUrl, config.serviceRoleKey, { auth: { persistSession: false } });
  const W = ["BEACON", "BUOY", "DOCK", "PIER", "GULL", "TERN", "PUFFIN", "HERON", "KELP", "REEF", "SHOAL", "SAND", "FOG", "MIST", "HAZE", "DRIZZLE"];
  const make = async (title: string, visibility: string) => {
    const { data, error } = await anon.rpc("create_custom_puzzle", { _creator_name: "Harbor Hal", _title: title, _visibility: visibility, _content: { mode: "classic", groups: [0, 1, 2, 3].map((g) => ({ category: `${title} ${g + 1}`, words: W.slice(g * 4, g * 4 + 4) })), word_order: W, rainbow_herring: null } });
    if (error) throw error;
    return data as { share_id: string; short_code: string };
  };
  const harbor = await make("Harbor Lights", "public");
  const cove = await make("Quiet Cove", "public");
  const secret = await make("Secret Cove", "private");
  for (const p of [harbor, cove, secret]) {
    const { error } = await service.from("custom_puzzles").update({ created_by: halId }).eq("share_id", p.share_id);
    if (error) throw error;
  }
  await service.from("custom_puzzles").update({ community_listed: true, community_listed_at: new Date().toISOString() }).eq("share_id", harbor.share_id);

  // The reported symptom: listed, owned, but no page, so the byline is plain text.
  await page.setViewportSize({ width: 390, height: 844 });
  await openCommunity(page);
  const card = page.getByTestId("newest-list").getByTestId("community-card").filter({ hasText: "Harbor Lights" });
  await expect(card).toContainText("by Harbor Hal");
  await expect(card.getByRole("link", { name: "Harbor Hal" })).toHaveCount(0);
  await card.screenshot({ path: path.join(SHOTS, "legacy-byline-plain-before-phone-390.png"), animations: "disabled" });

  // Hal signs in and opens My Puzzles (another tab): their page is created.
  const halTab = await context.browser()!.newContext().then((c) => c.newPage());
  await halTab.goto(`${new URL(page.url()).origin}/my-puzzles`);
  await signInAs(halTab, HAL);
  await expect(halTab.getByTestId("my-puzzles")).toHaveAttribute("aria-busy", "false", { timeout: 30_000 });
  await expect(halTab.getByTestId("my-puzzles-list").getByRole("heading", { level: 2 })).toHaveText(["Secret Cove", "Quiet Cove", "Harbor Lights"]);
  await halTab.context().close();

  // Now the visible original byline links to the actual owner's shelf.
  await openCommunity(page);
  const link = page.getByTestId("newest-list").getByTestId("community-card").filter({ hasText: "Harbor Lights" }).getByRole("link", { name: "Harbor Hal" });
  await expect(link).toHaveAttribute("href", /^\/creator\/harbor-hal-[a-z0-9]{4}\?view=community$/);
  const href = (await link.getAttribute("href"))!;
  await page.getByTestId("newest-list").getByTestId("community-card").filter({ hasText: "Harbor Lights" }).screenshot({ path: path.join(SHOTS, "legacy-byline-linked-phone-390.png"), animations: "disabled" });
  await link.click();
  await expect(page.getByRole("heading", { level: 1, name: "Harbor Hal" })).toBeVisible({ timeout: 30_000 });
  expect(await page.getByTestId("creator-community-grid").getByTestId("card-title").allInnerTexts()).toEqual(["Harbor Lights"]);
  await expect(page.getByTestId("creator-community-grid")).not.toContainText("Quiet Cove");
  await expect(page.getByTestId("creator-community-grid")).not.toContainText("Secret Cove");
  await shot(page, "legacy-creator-shelf-phone-390", true);
  // The puzzle header's byline goes to the same shelf; a guest puzzle's stays plain.
  await page.goto(`/p/${harbor.short_code}`);
  await expect(page.getByTestId("custom-meta-row").getByRole("link", { name: "Harbor Hal" })).toHaveAttribute("href", href);
  await page.goto(`/p/${P.anon.shortCode}`);
  await expect(page.getByTestId("custom-meta-row")).toContainText("Guest Puzzler", { timeout: 30_000 });
  await expect(page.getByTestId("custom-meta-row").getByRole("link")).toHaveCount(0);
  // Nothing about the puzzles changed but their owner's new page.
  const after = await service.from("custom_puzzles").select("title, creator_name, created_by, visibility, community_listed").in("share_id", [harbor.share_id, cove.share_id, secret.share_id]).order("title");
  expect(after.data).toEqual([
    { title: "Harbor Lights", creator_name: "Harbor Hal", created_by: halId, visibility: "public", community_listed: true },
    { title: "Quiet Cove", creator_name: "Harbor Hal", created_by: halId, visibility: "public", community_listed: false },
    { title: "Secret Cove", creator_name: "Harbor Hal", created_by: halId, visibility: "private", community_listed: false },
  ]);
});
