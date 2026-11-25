/**
 * My Puzzles: Rename and Duplicate & Edit through the real app on the
 * disposable local stack (migrations 0001-0012), fictional fixtures only.
 *
 *   * Rename keeps the same link, results and listing; another account and
 *     guests are refused by the server.
 *   * Duplicate & Edit: an unrelated partial draft is saved and its tab
 *     closed; duplicating opens a copy in its own slot; an immediate reload
 *     with no edits recovers the copy, and the unrelated draft is still there.
 *     The source is unchanged, nothing is published until Create, and the
 *     created copy is a new, unlisted puzzle with its own link.
 *   * A Private source's copy stays Private. Nobody else can read the source.
 *
 *   npm run e2e:community -- my-puzzles-rename-copy.spec.ts
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
const SHOTS = path.resolve(E2E_DIR, "..", "evidence", "my-puzzles");
fs.mkdirSync(SHOTS, { recursive: true });
const shot = (page: Page, name: string, fullPage = false) => page.screenshot({ path: path.join(SHOTS, `${name}.png`), fullPage, animations: "disabled" });
const MAIN_KEY = "rainbow-creator-draft-v1";
const COPY_PREFIX = `${MAIN_KEY}:copy:`;

async function rpc(token: string, fn: string, body: unknown) {
  const r = await fetch(`${config.apiUrl}/rest/v1/rpc/${fn}`, {
    method: "POST",
    headers: { apikey: config.anonKey, Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  return { status: r.status, text: await r.text() };
}
const json = async <T>(p: Promise<{ text: string }>) => JSON.parse((await p).text) as T;
async function listedCodes(): Promise<string[]> {
  return (await json<{ items: { short_code: string }[] }>(rpc(config.anonKey, "list_community_puzzles", { _limit: 48 }))).items.map((i) => i.short_code).sort();
}
const row = (page: Page, title: string) => page.getByTestId("my-puzzles-list").getByTestId("my-puzzle").filter({ has: page.getByRole("heading", { name: title, exact: true }) });
async function openMine(page: Page) {
  await expect(page.getByTestId("my-puzzles")).toHaveAttribute("aria-busy", "false", { timeout: 30_000 });
}
type Draft = { title: string; visibility: string; builder: { style: string; groups: { category: string; answers: { id: string; text: string }[] }[]; wordOrderIds: string[]; rainbowWordOrderIds: string[] } };
async function drafts(page: Page): Promise<{ main: Draft | null; copies: Record<string, Draft> }> {
  const all = await page.evaluate(() => Object.fromEntries(Object.keys(localStorage).filter((k) => k.startsWith("rainbow-creator-draft-v1")).map((k) => [k, localStorage.getItem(k)!])));
  const copies: Record<string, Draft> = {};
  for (const [k, v] of Object.entries(all)) if (k.startsWith(COPY_PREFIX)) copies[k.slice(COPY_PREFIX.length)] = JSON.parse(v);
  return { main: all[MAIN_KEY] ? JSON.parse(all[MAIN_KEY]) : null, copies };
}
const textsOf = (d: Draft, ids: string[]) => ids.map((id) => d.builder.groups.flatMap((g) => g.answers).find((a) => a.id === id)?.text);

test.describe.configure({ mode: "serial" });

test("rename: same link, results and listing; guests and other accounts are refused", async ({ page }) => {
  const wren = (await sessionFromLocalGoTrue(creds("wren"))).access_token;
  const odie = (await sessionFromLocalGoTrue(creds("odie"))).access_token;
  const stats = () => json<{ completed_plays: number; wins: number }>(rpc(config.anonKey, "get_custom_puzzle_stats", { _share_id: P.offbeat.shareId }));
  const before = await stats();
  const listed = await listedCodes();
  expect(listed).toContain(P.offbeat.shortCode);

  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/my-puzzles");
  await signInAs(page, creds("wren"));
  await openMine(page);
  await row(page, "A Little Offbeat").getByRole("button", { name: "Rename A Little Offbeat" }).click();
  const form = page.getByTestId("my-puzzle-rename");
  await expect(form.getByLabel("New title")).toHaveValue("A Little Offbeat");
  await form.getByLabel("New title").fill("  A Little Offbeat, Remixed  ");
  await expectNoHorizontalOverflow(page);
  await shot(page, "rename-phone-390");
  await form.getByRole("button", { name: "Save title" }).click();
  const renamed = row(page, "A Little Offbeat, Remixed");
  await expect(renamed.getByTestId("my-puzzle-result")).toHaveText("Renamed. Its link, results and listing stay the same.");
  await expect(renamed).toHaveAttribute("data-short-code", P.offbeat.shortCode);
  await expect(renamed.getByTestId("my-puzzle-status")).toHaveText("In Community");
  await page.reload();
  await openMine(page);
  await expect(row(page, "A Little Offbeat, Remixed")).toHaveAttribute("data-short-code", P.offbeat.shortCode);

  // The same link plays it under the new name; results and listing unchanged.
  await row(page, "A Little Offbeat, Remixed").getByRole("link", { name: "Open A Little Offbeat, Remixed" }).click();
  await expect(page).toHaveURL(new RegExp(`/p/${P.offbeat.shortCode}$`));
  await expect(page.getByRole("heading", { name: "A Little Offbeat, Remixed" })).toBeVisible({ timeout: 30_000 });
  expect(await stats()).toEqual(before);
  expect(await listedCodes()).toEqual(listed);
  expect((await json<{ title: string }>(rpc(config.anonKey, "get_custom_puzzle", { _share_id: P.offbeat.shareId }))).title).toBe("A Little Offbeat, Remixed");

  // An empty title is refused with the create rule.
  await page.goBack();
  await openMine(page);
  await row(page, "A Little Offbeat, Remixed").getByRole("button", { name: "Rename A Little Offbeat, Remixed" }).click();
  await page.getByTestId("my-puzzle-rename").getByLabel("New title").fill("   ");
  await page.getByTestId("my-puzzle-rename").getByRole("button", { name: "Save title" }).click();
  await expect(row(page, "A Little Offbeat, Remixed").getByTestId("my-puzzle-result")).toHaveText("A puzzle needs a title.");
  expect((await rpc(wren, "rename_custom_puzzle", { _share_id: P.offbeat.shareId, _title: "x".repeat(101) })).status).toBe(400);

  // Nobody else can rename it.
  const odieTry = await rpc(odie, "rename_custom_puzzle", { _share_id: P.offbeat.shareId, _title: "Odie Was Here" });
  expect(odieTry.status).toBe(403);
  expect(odieTry.text).toContain("only the puzzle's creator can rename it");
  expect([401, 403]).toContain((await rpc(config.anonKey, "rename_custom_puzzle", { _share_id: P.offbeat.shareId, _title: "Guest Was Here" })).status);
  expect((await json<{ title: string }>(rpc(config.anonKey, "get_custom_puzzle", { _share_id: P.offbeat.shareId }))).title).toBe("A Little Offbeat, Remixed");
});

test("duplicate & edit: an unrelated draft survives, the copy survives an immediate reload, the source is untouched", async ({ page, context }) => {
  const wren = (await sessionFromLocalGoTrue(creds("wren"))).access_token;
  const listed = await listedCodes();
  const source = await json<{ title: string; content: { word_order: string[]; rainbow_herring: string[]; groups: { category: string }[] } }>(rpc(wren, "get_my_custom_puzzle_source", { _share_id: P.offbeat.shareId }));
  const totalBefore = (await json<{ total: number }>(rpc(wren, "list_my_custom_puzzles", {}))).total;

  // 1. An unrelated, partial draft in /create, saved, and its tab closed.
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/create");
  await signInAs(page, creds("wren"));
  await page.getByLabel("Puzzle Title").fill("Unrelated Partial Draft");
  await page.getByTestId("category-card-1").getByRole("textbox").nth(0).fill("Half-finished idea");
  await expect(page.getByRole("status", { name: "Draft recovery" })).toContainText("Draft saved in this browser");
  const unrelated = (await drafts(page)).main;
  expect(unrelated?.title).toBe("Unrelated Partial Draft");
  await page.close();

  // 2. In a new tab: Duplicate & Edit the Rainbow puzzle from My Puzzles.
  const tab = await context.newPage();
  await tab.setViewportSize({ width: 390, height: 844 });
  await tab.goto("/my-puzzles");
  await openMine(tab);
  await row(tab, "A Little Offbeat, Remixed").getByRole("button", { name: "Duplicate and edit A Little Offbeat, Remixed" }).click();
  await expect(tab).toHaveURL(/\/create\?draft=[a-z0-9]{8,32}$/);
  const slot = new URL(tab.url()).searchParams.get("draft")!;
  await expect(tab.getByTestId("copy-banner")).toContainText("You're editing a copy.");

  // 3. Reload at once, with no edits: the copy is recovered from its own slot.
  await tab.reload();
  await expect(tab.getByTestId("copy-banner")).toBeVisible({ timeout: 30_000 });
  await expect(tab.getByLabel("Puzzle Title")).toHaveValue("Copy of A Little Offbeat, Remixed");
  await expect(tab.getByTestId("category-card-1").getByRole("textbox").nth(0)).toHaveValue(source.content.groups[0].category);
  await expectNoHorizontalOverflow(tab);
  await shot(tab, "duplicate-copy-draft-phone-390");
  const after = await drafts(tab);
  expect(after.main).toEqual(unrelated); // the unrelated draft, byte for byte
  const copy = after.copies[slot];
  expect(copy.title).toBe("Copy of A Little Offbeat, Remixed");
  expect(copy.visibility).toBe("public");
  expect(copy.builder.style).toBe("rainbow");
  expect(textsOf(copy, copy.builder.wordOrderIds)).toEqual(source.content.word_order);
  expect(textsOf(copy, copy.builder.rainbowWordOrderIds)).toEqual(source.content.rainbow_herring);

  // Nothing was published or changed by copying.
  expect((await json<{ total: number }>(rpc(wren, "list_my_custom_puzzles", {}))).total).toBe(totalBefore);
  expect(await listedCodes()).toEqual(listed);

  // 4. The unrelated draft is still recoverable in /create, which also names the copy.
  await tab.goto("/create");
  await expect(tab.getByLabel("Puzzle Title")).toHaveValue("Unrelated Partial Draft", { timeout: 30_000 });
  await expect(tab.getByTestId("category-card-1").getByRole("textbox").nth(0)).toHaveValue("Half-finished idea");
  await expect(tab.getByTestId("other-copies")).toContainText("Copy of A Little Offbeat, Remixed");

  // 5. My Puzzles lists the unsaved copy; Resume, rename it, create it.
  await tab.goto("/my-puzzles");
  await openMine(tab);
  await expect(tab.getByTestId("unsaved-copies").getByTestId("unsaved-copy")).toHaveText([/Copy of A Little Offbeat, Remixed/]);
  await shot(tab, "unsaved-copies-phone-390", true);
  await tab.getByRole("link", { name: "Resume Copy of A Little Offbeat, Remixed" }).click();
  await expect(tab.getByLabel("Puzzle Title")).toHaveValue("Copy of A Little Offbeat, Remixed", { timeout: 30_000 });
  await tab.getByLabel("Puzzle Title").fill("Offbeat Encore");
  await expect(tab.getByRole("checkbox", { name: "List in Community" })).not.toBeChecked();
  await tab.getByRole("button", { name: "Create Game" }).click();
  await expect(tab.getByTestId("created-in-my-puzzles")).toBeVisible({ timeout: 30_000 });
  await expect(tab.getByTestId("community-listing-result")).toContainText("Not listed in Community");
  await tab.getByTestId("created-in-my-puzzles").getByRole("link", { name: "My Puzzles" }).click();
  await openMine(tab);
  const created = row(tab, "Offbeat Encore");
  await expect(tab.getByTestId("my-puzzles-list").getByRole("heading", { level: 2 }).first()).toHaveText("Offbeat Encore");
  await expect(created.getByTestId("my-puzzle-status")).toHaveText("Link only");
  const newCode = await created.getAttribute("data-short-code");
  expect(newCode).not.toBe(P.offbeat.shortCode);
  // The new puzzle has its own link and no results of its own yet; the source is untouched.
  const newShare = await json<string>(rpc(config.anonKey, "custom_puzzle_share_id", { _short_code: newCode }));
  expect((await json<{ completed_plays: number }>(rpc(config.anonKey, "get_custom_puzzle_stats", { _share_id: newShare }))).completed_plays).toBe(0);
  expect((await json<{ title: string }>(rpc(config.anonKey, "get_custom_puzzle", { _share_id: P.offbeat.shareId }))).title).toBe("A Little Offbeat, Remixed");
  expect(await listedCodes()).toEqual(listed);
  // Its slot is gone; the unrelated draft is still kept.
  await expect(tab.getByTestId("unsaved-copies")).toHaveCount(0);
  const end = await drafts(tab);
  expect(end.copies).toEqual({});
  expect(end.main).toEqual(unrelated);
});

test("a Private puzzle's copy stays Private; nobody else can read a puzzle's builder content", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/my-puzzles");
  await signInAs(page, creds("wren"));
  await openMine(page);
  await row(page, "Private Parlour Games").getByRole("button", { name: "Duplicate and edit Private Parlour Games" }).click();
  await expect(page).toHaveURL(/\/create\?draft=/);
  await page.reload();
  await expect(page.getByLabel("Puzzle Title")).toHaveValue("Copy of Private Parlour Games", { timeout: 30_000 });
  const slot = new URL(page.url()).searchParams.get("draft")!;
  expect((await drafts(page)).copies[slot].visibility).toBe("private");
  await expect(page.getByText("Private puzzles are never listed in Community.")).toBeVisible();
  await shot(page, "duplicate-private-phone-390");
  // Discard it from My Puzzles.
  await page.goto("/my-puzzles");
  await openMine(page);
  await page.getByRole("button", { name: "Discard Copy of Private Parlour Games" }).click();
  await page.getByTestId("unsaved-copies").getByRole("button", { name: "Discard", exact: true }).click();
  await expect(page.getByTestId("unsaved-copies")).toContainText("Copy discarded.");
  expect((await drafts(page)).copies).toEqual({});

  // The server never hands another account, or a guest, someone's builder content.
  const odie = (await sessionFromLocalGoTrue(creds("odie"))).access_token;
  for (const key of ["offbeat", "private"]) {
    const r = await rpc(odie, "get_my_custom_puzzle_source", { _share_id: P[key].shareId });
    expect(r.status).toBe(403);
    expect(r.text).not.toMatch(/groups|words|word_order/);
    expect([401, 403]).toContain((await rpc(config.anonKey, "get_my_custom_puzzle_source", { _share_id: P[key].shareId })).status);
  }
  // Odie's own library offers Duplicate only for Odie's puzzles.
  await page.goto("/my-puzzles");
  await signInAs(page, creds("odie"));
  await openMine(page);
  await expect(page.getByRole("button", { name: /^Duplicate and edit / })).toHaveCount(2);
  await expect(page.getByRole("button", { name: /Duplicate and edit (A Little Offbeat|Private Parlour)/ })).toHaveCount(0);
});
