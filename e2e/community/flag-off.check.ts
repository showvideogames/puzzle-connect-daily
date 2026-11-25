/**
 * With VITE_COMMUNITY_PUZZLES unset (every deployed build), nothing from the
 * Community preview exists: no route, no admin curation page, no menu row, no
 * creator-page additions, and shared puzzles play as before.
 */
import fs from "node:fs";
import path from "node:path";
import { test, expect } from "../support/fixtures.ts";
import { E2E_DIR } from "../env.ts";

const preview = JSON.parse(fs.readFileSync(path.join(E2E_DIR, ".artifacts", "community-preview.json"), "utf8")) as {
  puzzles: Record<string, { title: string; shortCode: string; shareId: string }>;
};

// NotFound logs each unknown route it renders; that is exactly what is expected here.
test.use({ allowedConsoleErrors: [/non-existent route: \/(admin\/)?community/] });

test("flag off: no Community route, curation page, menu row or creator-page change; links still play", async ({ page }) => {
  for (const url of ["/community", "/community?view=newest", "/admin/community"]) {
    await page.goto(url);
    await expect(page.getByRole("heading", { name: "404" })).toBeVisible({ timeout: 30_000 });
  }
  await page.goto("/");
  await page.getByRole("button", { name: "Menu", exact: true }).click();
  const menu = page.getByRole("navigation", { name: "Main menu" });
  await expect(menu.getByRole("link", { name: "Create a puzzle" })).toBeVisible();
  await expect(menu.getByRole("link", { name: "Community Puzzles" })).toHaveCount(0);
  await page.keyboard.press("Escape");

  const pantry = preview.puzzles.pantry;
  for (const url of [`/p/${pantry.shortCode}`, `/custom/${pantry.shareId}`]) {
    await page.goto(url);
    await expect(page.getByRole("heading", { name: "Pantry Raid" })).toBeVisible({ timeout: 30_000 });
    await expect(page.getByTestId("community-listing-control")).toHaveCount(0);
  }
  // The creator page is the historical one: totals, no Follow, no Community view.
  const slug = await page.getByRole("link", { name: "Wren Halloway" }).first().getAttribute("href");
  await page.goto(slug!);
  await expect(page.getByTestId("creator-totals")).toBeVisible({ timeout: 30_000 });
  await expect(page.getByRole("button", { name: /^Follow/ })).toHaveCount(0);
  await expect(page.getByRole("link", { name: /^In Community/ })).toHaveCount(0);
  await expect(page.getByTestId("creator-avatar")).toHaveCount(0);
  // The builder has no List in Community control.
  await page.goto("/create");
  await expect(page.getByLabel("Puzzle Title")).toBeVisible({ timeout: 30_000 });
  await expect(page.getByRole("checkbox", { name: "List in Community" })).toHaveCount(0);
});
