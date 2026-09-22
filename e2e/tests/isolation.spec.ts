/**
 * Proof that a test run stays on this machine.
 *
 * Every other spec relies on the harness blocking off-machine traffic; this
 * one asserts the blocking is real and that the list of things the app even
 * TRIES to reach is the list we think it is.
 *
 * Why it matters concretely: `index.html` loads Google's analytics tag on
 * every page. Without the block, running this suite would send real events
 * to the live property — completed games, archive visits, share clicks —
 * from a database full of fake puzzles. Blocking it is not tidiness.
 */

import { expect, gotoApp, test } from "../support/fixtures.ts";
import { tiles } from "../support/game.ts";

/** The only hosts outside this machine the app is expected to reach for. */
const EXPECTED_EXTERNAL_HOSTS = ["www.googletagmanager.com", "www.google-analytics.com"];

test.describe("Test-run isolation", () => {
  test("nothing reaches the internet, and the analytics tag is blocked @smoke", async ({
    page,
    pageProblems,
  }) => {
    await gotoApp(page, "/");
    await expect(tiles(page)).toHaveCount(16);

    // The app DID try — otherwise this assertion would be vacuous, and a
    // future change that moved analytics somewhere unblocked would pass.
    expect(
      pageProblems.blockedExternal.length,
      "the analytics tag in index.html should have been attempted and blocked"
    ).toBeGreaterThan(0);

    const hosts = [...new Set(pageProblems.blockedExternal.map((entry) => new URL(entry.split(" ")[1]).hostname))];
    expect(
      hosts.filter((host) => !EXPECTED_EXTERNAL_HOSTS.includes(host)),
      "the app tried to reach a host this harness does not know about"
    ).toEqual([]);
  });

  test("the app is talking to the local Supabase instance, not a hosted one", async ({ page }) => {
    const supabaseOrigins = new Set<string>();
    page.on("request", (request) => {
      const url = request.url();
      if (url.includes("/rest/v1/") || url.includes("/auth/v1/")) {
        supabaseOrigins.add(new URL(url).origin);
      }
    });

    await gotoApp(page, "/");
    await expect(tiles(page)).toHaveCount(16);

    expect([...supabaseOrigins].length, "the page should have called the Supabase API").toBeGreaterThan(0);
    for (const origin of supabaseOrigins) {
      expect(new URL(origin).hostname).toMatch(/^(127\.0\.0\.1|localhost|\[::1\])$/);
    }
  });
});
