/**
 * What survives a refresh, and whose history is whose.
 *
 * These are the behaviours that are invisible until they break: a board that
 * comes back wrong after a reload, a solve time that restarts at zero or
 * counts hours spent in another tab, and — the serious one — an account
 * silently adopting a stranger's games.
 */

import { expect, gotoApp, test } from "../support/fixtures.ts";
import {
  discoverRainbow,
  mistakesRemaining,
  readProgress,
  solveCategory,
  solvedBar,
  tile,
  tiles,
} from "../support/game.ts";
import { FULL_RAINBOW, MINI_RAINBOW } from "../fixtures/catalog.ts";

test.describe("Refresh restores an unfinished game", () => {
  test("solved categories, mistakes and the Rainbow come back @smoke", async ({ page, seed }) => {
    await gotoApp(page, "/");
    await expect(tiles(page)).toHaveCount(16);

    // The Rainbow FIRST: its answers are ordinary tiles, and solving a
    // category would take one of them off the board before it could be found.
    await discoverRainbow(page, FULL_RAINBOW.rainbowHerring!);
    await solveCategory(page, FULL_RAINBOW.groups[0]);

    // A deliberate wrong guess, so the restored state has a mistake in it.
    const wrong = [
      FULL_RAINBOW.groups[1].words[0],
      FULL_RAINBOW.groups[2].words[0],
      FULL_RAINBOW.groups[3].words[0],
      FULL_RAINBOW.groups[1].words[1],
    ];
    for (const word of wrong) await tile(page, word).click();
    await page.getByRole("button", { name: "Submit", exact: true }).click();
    await expect(mistakesRemaining(page)).toHaveText("3 of 4 mistakes remaining");

    await page.reload();

    await expect(solvedBar(page, FULL_RAINBOW.groups[0].category)).toBeVisible({ timeout: 20_000 });
    await expect(page.getByText(FULL_RAINBOW.rainbowCategoryName!)).toBeVisible();
    await expect(mistakesRemaining(page)).toHaveText("3 of 4 mistakes remaining");
    await expect(tiles(page)).toHaveCount(12);

    // The progress blob is keyed by the puzzle's own id for a Full official
    // game — unprefixed, which is the compatibility contract in
    // progressStorageId().
    const progress = await readProgress(page, seed.official.fullRainbow.id);
    expect(progress).not.toBeNull();
    expect(progress!.mistakes).toBe(1);
    expect(progress!.gotRainbow).toBe(true);
  });
});

test.describe("Palette markings restore", () => {
  test.use({ settings: { colorPaletteMode: true } });

  test("a painted tile keeps its colour across a reload", async ({ page, seed }) => {
    await gotoApp(page, "/");
    await expect(tiles(page)).toHaveCount(16);

    const word = FULL_RAINBOW.groups[2].words[0];
    await page.getByRole("button", { name: "Blue paint" }).click();
    await tile(page, word).click();

    // Painting is what makes this attempt "in progress" at all — the blob is
    // written on the colour change.
    await expect
      .poll(async () => (await readProgress(page, seed.official.fullRainbow.id))?.tileColors)
      .toMatchObject({ [word]: "blue" });

    await page.reload();
    await expect(tiles(page)).toHaveCount(16);
    const restored = await readProgress(page, seed.official.fullRainbow.id);
    expect(restored!.tileColors).toMatchObject({ [word]: "blue" });
  });
});

test.describe("The Mini solve timer", () => {
  test("survives a refresh and keeps accumulating from the banked total", async ({ page, seed }) => {
    const storageId = `mini:${seed.official.miniRainbow.id}`;

    await gotoApp(page, "/mini");
    await expect(tiles(page)).toHaveCount(9);

    // A real move, so a progress blob exists for the timer to checkpoint into.
    await solveCategory(page, MINI_RAINBOW.groups[0]);
    await expect.poll(async () => (await readProgress(page, storageId))?.activeTimeSeconds).toBeGreaterThan(0);

    // ── A refresh resumes from the banked total, not from zero ──
    //
    // Reloading also forces the bank: unmounting pauses the timer and
    // checkpoints it, so the reading below is the exact accumulated total
    // rather than whatever the periodic checkpoint last happened to write.
    await page.reload();
    await expect(solvedBar(page, MINI_RAINBOW.groups[0].category)).toBeVisible({ timeout: 20_000 });
    const afterFirstRefresh = (await readProgress(page, storageId))!.activeTimeSeconds as number;
    expect(afterFirstRefresh, "the banked time was lost across a refresh").toBeGreaterThan(0);

    // Playing on continues to add to that total rather than starting again.
    await solveCategory(page, MINI_RAINBOW.groups[1]);
    await page.reload();
    await expect(solvedBar(page, MINI_RAINBOW.groups[1].category)).toBeVisible({ timeout: 20_000 });
    await expect
      .poll(async () => (await readProgress(page, storageId))?.activeTimeSeconds)
      .toBeGreaterThanOrEqual(afterFirstRefresh);

    // ── Why hidden-tab time is NOT asserted here ──
    //
    // It is real behaviour and it is tested — in src/test/miniTimer.test.tsx
    // ("pauses while the document is hidden and resumes when visible", and
    // "does not start counting in a tab that is already hidden"), which drive
    // document.hidden and the visibilitychange event directly.
    //
    // It cannot be asserted from here, and the attempt was worse than the
    // gap: a headless Chromium page stays `document.visibilityState ===
    // "visible"` even with another page brought to the front, and CDP's
    // Emulation.setPageVisibilityState has been removed from the protocol.
    // So a browser test of it measures nothing while LOOKING like it passes —
    // which is how an earlier version of this test went green by accident.
    // The assertion belongs where the state can actually be produced.
  });
});

test.describe("Guest identity", () => {
  test("a guest gets a device credential, and their games stay anonymous @smoke", async ({
    page,
    seed,
    admin,
  }) => {
    await gotoApp(page, "/");
    await expect(tiles(page)).toHaveCount(16);
    await solveCategory(page, FULL_RAINBOW.groups[0]);

    // The credential lives in localStorage only — see lib/gameStats.ts.
    const identity = await page.evaluate(() => ({
      id: window.localStorage.getItem("rc-device-id"),
      token: window.localStorage.getItem("rc-device-token"),
    }));
    expect(identity.id, "a guest must be issued a device id").toBeTruthy();
    expect(identity.token, "a guest must be issued a device token").toBeTruthy();

    // The server knows the credential, and the game it recorded belongs to
    // no account.
    const registered = await admin
      .from("device_identities")
      .select("device_id")
      .eq("device_id", identity.id!);
    expect(registered.data ?? []).toHaveLength(1);

    await expect
      .poll(async () => {
        const sessions = await admin
          .from("game_sessions")
          .select("id, user_id, device_id, puzzle_id")
          .eq("device_id", identity.id!);
        return sessions.data ?? [];
      })
      .toHaveLength(1);

    const sessions = await admin
      .from("game_sessions")
      .select("user_id, puzzle_id")
      .eq("device_id", identity.id!);
    expect(sessions.data![0].user_id).toBeNull();
    expect(sessions.data![0].puzzle_id).toBe(seed.official.fullRainbow.id);
  });

  test("signing in and choosing Start Fresh leaves the guest's games unclaimed", async ({
    page,
    admin,
  }, testInfo) => {
    // A BRAND-NEW account, created for this run.
    //
    // The import decision is a server-owned one-shot: once an account has
    // answered it, `resolve_onboarding` never asks again. Reusing the shared
    // player fixture would make this test pass exactly once per seed and
    // fail on every retry — so it brings its own account and removes it
    // afterwards.
    const email = `e2e-import-${testInfo.workerIndex}-${Date.now()}@rainbow.test`;
    const password = "e2e-import-password";
    const created = await admin.auth.admin.createUser({ email, password, email_confirm: true });
    expect(created.error, created.error?.message).toBeNull();

    await gotoApp(page, "/");
    await expect(tiles(page)).toHaveCount(16);
    await solveCategory(page, FULL_RAINBOW.groups[0]);

    const deviceId = await page.evaluate(() => window.localStorage.getItem("rc-device-id"));
    await expect
      .poll(async () => (await admin.from("game_sessions").select("id").eq("device_id", deviceId!)).data?.length)
      .toBe(1);

    // Sign in through the real UI: Settings → Menu → Sign In.
    await page.getByRole("button", { name: "Settings and menu" }).click();
    await page.getByRole("button", { name: "Sign In", exact: true }).click();
    const signInDialog = page.getByRole("dialog", { name: "Sign In" });
    await signInDialog.getByLabel("Email", { exact: true }).fill(email);
    await signInDialog.getByLabel("Password", { exact: true }).fill(password);
    await signInDialog.getByRole("button", { name: "Sign In", exact: true }).click();

    // The server owns this decision and asks on every authenticated load —
    // see useAccountOnboarding. It must ASK, not assume.
    await expect(page.getByText("Bring your progress with you?")).toBeVisible({ timeout: 20_000 });
    await page.getByRole("button", { name: "Start Fresh" }).click();

    // Declining must leave the anonymous rows exactly as they were. This is
    // the assertion that would catch an account quietly adopting history it
    // was never given.
    await expect(tiles(page)).toHaveCount(12, { timeout: 20_000 });
    const after = await admin
      .from("game_sessions")
      .select("user_id")
      .eq("device_id", deviceId!);
    expect(after.data ?? []).toHaveLength(1);
    expect(after.data![0].user_id, "declining the import must not claim the guest's session").toBeNull();

    // Leave the disposable database as this test found it.
    await admin.auth.admin.deleteUser(created.data!.user!.id);
  });
});
