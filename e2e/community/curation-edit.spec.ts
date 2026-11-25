/**
 * The curator edit case (0007): a saved Editor's Pick that its creator later
 * unlists stays hidden on Explore, but doesn't stop the admin saving other
 * edits; it can still be removed or replaced explicitly, and new additions must
 * be listed. Fictional fixtures (e2e:reset + e2e:seed:community).
 *
 *   npm run e2e:community -- curation-edit.spec.ts
 */
import fs from "node:fs";
import path from "node:path";
import type { Page } from "@playwright/test";
import { test, expect } from "../support/fixtures.ts";
import { signInAs, sessionFromLocalGoTrue } from "../support/auth.ts";
import { ACCOUNTS } from "../fixtures/catalog.ts";
import { E2E_DIR, loadE2eConfig } from "../env.ts";

const config = loadE2eConfig();
const preview = JSON.parse(fs.readFileSync(path.join(E2E_DIR, ".artifacts", "community-preview.json"), "utf8")) as {
  password: string;
  accounts: Record<string, { email: string }>;
  puzzles: Record<string, { title: string; shareId: string; shortCode: string }>;
};
const P = preview.puzzles;
const SHOTS = path.resolve(E2E_DIR, "..", "evidence", "community-preview-3");

async function explorePicks(page: Page) {
  await page.goto("/community");
  await expect(page.getByTestId("community-panel")).toHaveAttribute("aria-busy", "false", { timeout: 30_000 });
  return page.getByTestId("picks-grid").getByTestId("card-title").allInnerTexts();
}
async function setListed(who: string, shareId: string, listed: boolean) {
  const { access_token } = await sessionFromLocalGoTrue({ email: preview.accounts[who].email, password: preview.password });
  const r = await fetch(`${config.apiUrl}/rest/v1/rpc/set_custom_puzzle_community_listing`, {
    method: "POST",
    headers: { apikey: config.anonKey, Authorization: `Bearer ${access_token}`, "Content-Type": "application/json" },
    body: JSON.stringify({ _share_id: shareId, _listed: listed }),
  });
  expect(r.status).toBe(200);
}

test("a saved pick that gets unlisted stays hidden but doesn't block saving other edits; it can still be removed", async ({ page, browser }) => {
  // Seeded: Featured Pantry Raid; Picks Tides, Air, Offbeat, Usual. Odie unlists Tides.
  await setListed("odie", P.tides.shareId, false);
  expect(await explorePicks(page)).toEqual(["Something In The Air", "A Little Offbeat", "The Usual Suspects"]);

  const ctx = await browser.newContext({ baseURL: config.appUrl, viewport: { width: 390, height: 844 } });
  const adm = await ctx.newPage();
  await adm.goto("/admin/community");
  await signInAs(adm, { email: ACCOUNTS.admin.email, password: ACCOUNTS.admin.password });
  await expect(adm.getByRole("heading", { level: 1, name: "Community curation" })).toBeVisible({ timeout: 30_000 });
  const tidesRow = adm.getByTestId("curation-picks").getByTestId("curation-row").filter({ hasText: "Turn Of The Tides" });
  await expect(tidesRow).toContainText("Not shown on Explore: unlisted by its creator. It can stay saved");

  // Edit OTHER slots only: move The Usual Suspects up and make Something In The Air the Featured Puzzle
  // (it leaves the Picks; Pantry Raid is replaced as Featured).
  await adm.getByRole("button", { name: "Move The Usual Suspects up" }).click();
  await adm.getByRole("searchbox", { name: "Search listed puzzles" }).fill("Something");
  await adm.getByTestId("curation-results").getByRole("button", { name: "Feature Something In The Air" }).click();
  await adm.getByRole("button", { name: "Save curation" }).click();
  await expect(adm.getByRole("status").filter({ hasText: "Saved. Explore shows this now." })).toBeVisible();
  await expect(adm.getByRole("alert")).toHaveCount(0);
  // Tides is still saved, still flagged; Explore follows the edits and keeps it hidden.
  await expect(tidesRow).toContainText("Pick 1");
  await expect(tidesRow).toContainText("Not shown on Explore");
  await tidesRow.scrollIntoViewIfNeeded();
  await adm.screenshot({ path: path.join(SHOTS, "admin-curation-hidden-pick-kept-390.png"), fullPage: true, animations: "disabled" });
  expect(await explorePicks(page)).toEqual(["The Usual Suspects", "A Little Offbeat"]);
  await expect(page.getByTestId("featured-puzzle").getByTestId("card-title")).toHaveText("Something In The Air");

  // Listed again, it returns where the admin left it.
  await setListed("odie", P.tides.shareId, true);
  expect(await explorePicks(page)).toEqual(["Turn Of The Tides", "The Usual Suspects", "A Little Offbeat"]);
  await setListed("odie", P.tides.shareId, false);

  // Explicit removal still works, and the shelf is unchanged for players.
  await adm.reload();
  await expect(adm.getByRole("heading", { level: 1, name: "Community curation" })).toBeVisible({ timeout: 30_000 });
  await adm.getByRole("button", { name: "Remove Turn Of The Tides from Picks" }).click();
  await adm.getByRole("button", { name: "Save curation" }).click();
  await expect(adm.getByRole("status").filter({ hasText: "Saved. Explore shows this now." })).toBeVisible();
  await expect(adm.getByTestId("curation-picks").getByText("Turn Of The Tides")).toHaveCount(0);
  expect(await explorePicks(page)).toEqual(["The Usual Suspects", "A Little Offbeat"]);

  // A NEW addition that isn't listed is still refused by the server.
  const { access_token } = await sessionFromLocalGoTrue({ email: ACCOUNTS.admin.email, password: ACCOUNTS.admin.password });
  const refused = await fetch(`${config.apiUrl}/rest/v1/rpc/admin_set_community_curation`, {
    method: "POST",
    headers: { apikey: config.anonKey, Authorization: `Bearer ${access_token}`, "Content-Type": "application/json" },
    body: JSON.stringify({ _featured: P.air.shortCode, _picks: [P.tides.shortCode] }),
  });
  expect(refused.status).toBe(400);
  expect(await refused.text()).toContain("only puzzles listed in Community can be added");
  await ctx.close();
});
