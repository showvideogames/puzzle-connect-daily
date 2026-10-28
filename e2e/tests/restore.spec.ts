/**
 * A finished game follows its player, and nobody else's board ever shows.
 *
 * Runs the real app against the disposable local stack, signed in with
 * throwaway accounts so each test owns its history outright.
 */

import type { Page } from "@playwright/test";
import type { SupabaseClient } from "@supabase/supabase-js";
import { expect, gotoApp, test } from "../support/fixtures.ts";
import { loadE2eConfig } from "../env.ts";
import { attachPlatformIdentity } from "../scripts/lib/seed-supabase.ts";
import { signInAs } from "../support/auth.ts";
import { solveCategory, solvedBar, tiles } from "../support/game.ts";
import { FULL_RAINBOW } from "../fixtures/catalog.ts";

interface Throwaway {
  id: string;
  email: string;
  password: string;
}

/** A Rainbow account of the test's own, linked to a shared identity. */
async function throwawayAccount(admin: SupabaseClient, tag: string, worker: number): Promise<Throwaway> {
  const stamp = `${worker}-${Date.now()}-${Math.floor(Math.random() * 1e6)}`;
  const email = `e2e-${tag}-${stamp}@rainbow.test`;
  const password = `e2e-${tag}-password`;
  const created = await admin.auth.admin.createUser({ email, password, email_confirm: true });
  expect(created.error, created.error?.message).toBeNull();
  const id = created.data!.user!.id;
  await attachPlatformIdentity(loadE2eConfig().dbUrl, id, email, `user_E2E${tag.toUpperCase()}${stamp.replace(/\D/g, "")}`);
  return { id, email, password };
}

/**
 * Everything this browser holds about games, as if it were a new device.
 * Waits for the finished board to settle first (its results popup opens by
 * itself once the last animation is over), so nothing on the old page saves
 * the board again after it has been removed.
 */
async function forgetGamesInThisBrowser(page: Page): Promise<void> {
  await expect(page.getByTestId("results-dialog")).toBeVisible({ timeout: 20_000 });
  await page.keyboard.press("Escape");
  await expect(page.getByTestId("results-dialog")).toHaveCount(0);
  await page.evaluate(() => {
    for (const key of Object.keys(window.localStorage)) {
      if (key.startsWith("connections-progress-") || key.startsWith("connections-prompt-answer-")) {
        window.localStorage.removeItem(key);
      }
    }
  });
  expect(
    await page.evaluate(() => Object.keys(window.localStorage).filter((k) => k.startsWith("connections-progress-")))
  ).toEqual([]);
}

const progressKeysFor = (page: Page, userId: string) =>
  page.evaluate(
    (id) => Object.keys(window.localStorage).filter((k) => k.startsWith(`connections-progress-acct:${id}/`)),
    userId
  );

async function signOutInTheApp(page: Page): Promise<void> {
  await page.getByRole("button", { name: "Settings and menu" }).click();
  await page.getByRole("button", { name: "Account", exact: true }).last().click();
  await page.getByRole("button", { name: "Sign Out" }).click();
}

test.describe("A finished game on another device", () => {
  test("a signed-in player sees their finished board and results, and nothing is submitted again @smoke", async ({
    page,
    admin,
  }, testInfo) => {
    const player = await throwawayAccount(admin, "restore", testInfo.workerIndex);
    await gotoApp(page, "/");
    await signInAs(page, player);
    await expect(tiles(page)).toHaveCount(16);
    for (const group of FULL_RAINBOW.groups) await solveCategory(page, group);
    await expect
      .poll(async () => (await admin.from("game_sessions").select("status").eq("user_id", player.id)).data)
      .toEqual([{ status: "won" }]);

    // "Another device": nothing about the game left in this browser.
    await forgetGamesInThisBrowser(page);
    await page.reload();

    await expect(page.getByRole("button", { name: "View Results" })).toBeVisible({ timeout: 20_000 });
    await expect(tiles(page)).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Submit", exact: true })).toHaveCount(0);
    await expect(page.getByTestId("already-finished")).toHaveCount(0);
    for (const group of FULL_RAINBOW.groups) await expect(solvedBar(page, group.category)).toBeVisible();
    await expect(page.getByTestId("lucky-bot-card")).toBeVisible();

    // Reopening does not open the results by itself; View Results does, with
    // the real rows and Share.
    await expect(page.getByTestId("results-dialog")).toHaveCount(0);
    await page.getByRole("button", { name: "View Results" }).click();
    const dialog = page.getByTestId("results-dialog");
    await expect(dialog.getByRole("button", { name: /Share Score/ })).toBeVisible();
    await expect(dialog.getByTestId("results-summary")).toHaveCount(0);

    // Still exactly the one official game, unchanged, and nothing written here.
    const after = await admin.from("game_sessions").select("status, is_official").eq("user_id", player.id);
    expect(after.data).toEqual([{ status: "won", is_official: true }]);
    expect(await progressKeysFor(page, player.id)).toEqual([]);

    await admin.auth.admin.deleteUser(player.id);
  });
});

test.describe("When the result cannot be loaded", () => {
  test("a neutral Retry, never a playable board, then the result once it loads", async ({ page, admin }, testInfo) => {
    const player = await throwawayAccount(admin, "retry", testInfo.workerIndex);
    await gotoApp(page, "/");
    await signInAs(page, player);
    for (const group of FULL_RAINBOW.groups) await solveCategory(page, group);
    await expect
      .poll(async () => (await admin.from("game_sessions").select("status").eq("user_id", player.id)).data)
      .toEqual([{ status: "won" }]);

    await forgetGamesInThisBrowser(page);
    // A dropped connection. "aborted" is the harness's own term for a
    // request cut off mid-flight (see support/fixtures.ts), so the app's
    // "Failed to fetch" is read as that, not as a defect.
    await page.route("**/rest/v1/game_sessions*", (route) => route.abort("aborted"));
    await page.reload();

    const failed = page.getByTestId("finished-check-failed");
    await expect(failed).toBeVisible({ timeout: 20_000 });
    await expect(failed).toContainText("We couldn't load your result for this puzzle.");
    await expect(tiles(page)).toHaveCount(0);

    await page.unroute("**/rest/v1/game_sessions*");
    await failed.getByRole("button", { name: "Retry" }).click();
    await expect(page.getByRole("button", { name: "View Results" })).toBeVisible({ timeout: 20_000 });

    await admin.auth.admin.deleteUser(player.id);
  });
});

test.describe("Each player's own board", () => {
  test("signing out takes the board away, another account never sees it, and it comes back for its owner", async ({
    page,
    admin,
  }, testInfo) => {
    const alice = await throwawayAccount(admin, "alice", testInfo.workerIndex);
    const bob = await throwawayAccount(admin, "bob", testInfo.workerIndex);
    const first = FULL_RAINBOW.groups[0];

    await gotoApp(page, "/");
    await signInAs(page, alice);
    await expect(tiles(page)).toHaveCount(16);
    await solveCategory(page, first);
    await expect(tiles(page)).toHaveCount(12);

    // Signing out in the app: Alice's board goes at once, without a reload.
    await signOutInTheApp(page);
    await expect(tiles(page)).toHaveCount(16, { timeout: 20_000 });
    await expect(solvedBar(page, first.category)).toHaveCount(0);

    // Bob on the same browser: a fresh board, never Alice's.
    await signInAs(page, bob);
    await expect(tiles(page)).toHaveCount(16, { timeout: 20_000 });
    await expect(solvedBar(page, first.category)).toHaveCount(0);

    // Alice again: her own board, exactly as she left it.
    await signInAs(page, alice);
    await expect(tiles(page)).toHaveCount(12, { timeout: 20_000 });
    await expect(solvedBar(page, first.category)).toBeVisible();

    await admin.auth.admin.deleteUser(alice.id);
    await admin.auth.admin.deleteUser(bob.id);
  });
});
