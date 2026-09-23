/**
 * Layout rules that have to hold at every width this project supports.
 *
 * Tagged @responsive, so they run in BOTH the desktop (1280px) and mobile
 * (375px) projects. Nothing here compares screenshots: a pixel diff cannot
 * say why a page broke, and it fails for reasons that are not bugs. These
 * assert measurements and structure instead — the page must not scroll
 * sideways, tap targets must stay big enough to hit, and the board must keep
 * its shape.
 */

import { expect, gotoApp, test } from "../support/fixtures.ts";
import { boardColumnCount, expectNoHorizontalOverflow, tiles } from "../support/game.ts";

/** Apple's and Android's shared minimum, and the size this project's headers commit to. */
const MIN_TAP_TARGET = 44;

test.describe("No page scrolls sideways @responsive", () => {
  const pages: { name: string; path: string; ready: (page: import("@playwright/test").Page) => Promise<void> }[] = [
    {
      name: "the Full Daily",
      path: "/",
      ready: async (page) => void (await expect(tiles(page)).toHaveCount(16)),
    },
    {
      name: "the Mini Daily",
      path: "/mini",
      ready: async (page) => void (await expect(tiles(page)).toHaveCount(9)),
    },
    {
      name: "the Full archive",
      path: "/archive",
      ready: async (page) =>
        void (await expect(page.getByRole("heading", { name: "Archive" })).toBeVisible()),
    },
    {
      name: "the Mini archive",
      path: "/mini/archive",
      ready: async (page) =>
        void (await expect(page.getByRole("heading", { name: "Mini Archive" })).toBeVisible()),
    },
    {
      name: "How to Play",
      path: "/how-to-play",
      ready: async (page) => void (await expect(page.locator("main, h1").first()).toBeVisible()),
    },
  ];

  for (const target of pages) {
    test(`${target.name} fits its viewport`, async ({ page }) => {
      await gotoApp(page, target.path);
      await target.ready(page);
      await expectNoHorizontalOverflow(page);
    });
  }
});

test.describe("Board shape @responsive", () => {
  test("Full is four columns and Mini is three, at any width", async ({ page }) => {
    await gotoApp(page, "/");
    await expect(tiles(page)).toHaveCount(16);
    expect(await boardColumnCount(page)).toBe(4);

    await gotoApp(page, "/mini");
    await expect(tiles(page)).toHaveCount(9);
    expect(await boardColumnCount(page)).toBe(3);
  });
});

test.describe("Header controls stay tappable @responsive", () => {
  test("every header button keeps a 44px target on the Daily", async ({ page }) => {
    await gotoApp(page, "/");
    await expect(tiles(page)).toHaveCount(16);

    const header = page.locator("header").first();
    const controls = header.getByRole("button");
    const count = await controls.count();
    expect(count, "the Daily header should carry its utility icons").toBeGreaterThan(0);

    for (let i = 0; i < count; i++) {
      const control = controls.nth(i);
      if (!(await control.isVisible())) continue;
      const box = await control.boundingBox();
      expect(box, `header control ${i} has no box`).not.toBeNull();
      expect(
        Math.min(box!.width, box!.height),
        `header control ${i} ("${(await control.getAttribute("aria-label")) ?? ""}") is smaller than ${MIN_TAP_TARGET}px`
      ).toBeGreaterThanOrEqual(MIN_TAP_TARGET - 1);
    }
  });
});
