/**
 * What survives a refresh, and whose history is whose.
 *
 * These are the behaviours that are invisible until they break: a board that
 * comes back wrong after a reload, a solve time that restarts at zero or
 * counts hours spent in another tab, and — the serious one — an account
 * silently adopting a stranger's games.
 */

import { expect, gotoApp, test } from "../support/fixtures.ts";
import { loadE2eConfig } from "../env.ts";
import { attachPlatformIdentity } from "../scripts/lib/seed-supabase.ts";
import { signInAs, storedSession } from "../support/auth.ts";
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

  // The import decision is asked once per DEVICE, and every test context is
  // a fresh browser with a fresh device, so the shared player fixture can be
  // reused by every one of these tests — no throwaway accounts needed.

  test("signing in and choosing Start Fresh leaves the guest's games unclaimed", async ({
    page,
    seed,
    admin,
  }) => {
    await gotoApp(page, "/");
    await expect(tiles(page)).toHaveCount(16);
    await solveCategory(page, FULL_RAINBOW.groups[0]);

    const deviceId = await page.evaluate(() => window.localStorage.getItem("rc-device-id"));
    await expect
      .poll(async () => (await admin.from("game_sessions").select("id").eq("device_id", deviceId!)).data?.length)
      .toBe(1);

    // A session from the local GoTrue, handed to the app as the callback
    // would. The server owns the decision and asks on every authenticated
    // load — see useAccountOnboarding. It must ASK, not assume.
    await signInAs(page, seed.accounts.player);
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

    // The device is retired with the decision recorded against the account,
    // and the browser continues on a fresh one.
    const device = await admin.from("device_identities").select("retired_reason, claimed_by").eq("device_id", deviceId!).single();
    expect(device.data).toMatchObject({ retired_reason: "started_fresh", claimed_by: seed.accounts.player.id });
    const nextDevice = await page.evaluate(() => window.localStorage.getItem("rc-device-id"));
    expect(nextDevice).not.toBe(deviceId);
  });

  test("Add My Progress moves the guest's games onto the account, in place", async ({
    page,
    seed,
    admin,
  }) => {
    await gotoApp(page, "/");
    await expect(tiles(page)).toHaveCount(16);
    await solveCategory(page, FULL_RAINBOW.groups[0]);

    const deviceId = await page.evaluate(() => window.localStorage.getItem("rc-device-id"));
    await expect
      .poll(async () => (await admin.from("game_sessions").select("id").eq("device_id", deviceId!)).data?.length)
      .toBe(1);
    const before = await admin.from("game_sessions").select("id").eq("device_id", deviceId!);
    const sessionId = before.data![0].id;

    await signInAs(page, seed.accounts.player);
    await expect(page.getByText("Bring your progress with you?")).toBeVisible({ timeout: 20_000 });
    await page.getByRole("button", { name: "Add My Progress" }).click();
    await expect(tiles(page)).toHaveCount(12, { timeout: 20_000 });

    // Same row, same id, now owned by the account; the device is retired as
    // imported and names the account that took it.
    const after = await admin.from("game_sessions").select("id, user_id, device_id").eq("id", sessionId).single();
    expect(after.data).toMatchObject({ id: sessionId, user_id: seed.accounts.player.id, device_id: deviceId });
    const device = await admin.from("device_identities").select("retired_reason, claimed_by").eq("device_id", deviceId!).single();
    expect(device.data).toMatchObject({ retired_reason: "imported", claimed_by: seed.accounts.player.id });

    // And the account is a Rainbow account, linked to its shared identity.
    const account = await admin.from("accounts").select("global_user_id").eq("user_id", seed.accounts.player.id).single();
    expect(account.data?.global_user_id).toMatch(/^user_/);
  });

  test("an auth user that did not come through the shared sign-in is not a Rainbow account", async ({
    page,
    admin,
  }, testInfo) => {
    // The shared-project case: an auth user exists (another game's admin, a
    // stray signup) with no custom:platform identity. Rainbow must sign it
    // out locally and carry on as a guest — never create an account for it.
    const email = `e2e-foreign-${testInfo.workerIndex}-${Date.now()}@rainbow.test`;
    const password = "e2e-foreign-password";
    const created = await admin.auth.admin.createUser({ email, password, email_confirm: true });
    expect(created.error, created.error?.message).toBeNull();

    await gotoApp(page, "/");
    await signInAs(page, { email, password });

    // Still a guest: no account menu, the board plays, and the session the
    // test injected is gone again.
    await expect(tiles(page)).toHaveCount(16);
    await expect(page.getByRole("button", { name: "Account" })).toHaveCount(0);
    await expect.poll(() => storedSession(page)).toBeNull();
    const account = await admin.from("accounts").select("user_id").eq("user_id", created.data!.user!.id);
    expect(account.data ?? []).toHaveLength(0);

    await admin.auth.admin.deleteUser(created.data!.user!.id);
  });

  test("Delete account anonymises the account's games and keeps the site-wide count", async ({
    page,
    admin,
  }, testInfo) => {
    // A throwaway RAINBOW account for this run (deletion is destructive):
    // an auth user plus the custom:platform identity a real shared sign-in
    // would have left, attached the same way the seeder does it.
    const email = `e2e-delete-${testInfo.workerIndex}-${Date.now()}@rainbow.test`;
    const password = "e2e-delete-password";
    const created = await admin.auth.admin.createUser({ email, password, email_confirm: true });
    expect(created.error, created.error?.message).toBeNull();
    const userId = created.data!.user!.id;
    await attachPlatformIdentity(loadE2eConfig().dbUrl, userId, email, `user_E2EDELETE${testInfo.workerIndex}${Date.now()}`);

    await gotoApp(page, "/");
    await signInAs(page, { email, password });
    await expect(tiles(page)).toHaveCount(16);
    await solveCategory(page, FULL_RAINBOW.groups[0]);
    await expect
      .poll(async () => (await admin.from("game_sessions").select("id").eq("user_id", userId)).data?.length)
      .toBe(1);
    const sessionId = (await admin.from("game_sessions").select("id").eq("user_id", userId)).data![0].id;

    // The account menu lives in Settings → Menu (the text button opens the
    // same dropdown as the person icon).
    await page.getByRole("button", { name: "Settings and menu" }).click();
    // Two controls answer to "Account" there: the person icon and the text
    // button beside it. Either opens the same dropdown; take the text one.
    await page.getByRole("button", { name: "Account", exact: true }).last().click();
    await page.getByRole("button", { name: "Delete account…" }).click();
    await page.getByRole("button", { name: "Delete", exact: true }).click();
    await expect(page.getByText("Your Rainbow Categories account was deleted.")).toBeVisible({ timeout: 20_000 });

    // The row stays for site-wide counting, but belongs to nobody now.
    const row = await admin.from("game_sessions").select("user_id, device_id").eq("id", sessionId).single();
    expect(row.data).toEqual({ user_id: null, device_id: null });
    expect((await admin.from("accounts").select("user_id").eq("user_id", userId)).data).toHaveLength(0);
    const users = await admin.auth.admin.getUserById(userId);
    expect(users.data.user, "the auth user must be gone").toBeNull();
    await expect.poll(() => storedSession(page)).toBeNull();
  });
});
