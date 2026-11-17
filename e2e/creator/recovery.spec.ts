import { expect, test, type Page } from "@playwright/test";
const KEY = "rainbow-creator-draft-v1";
const title = (page: Page) => page.getByLabel("Puzzle Title");
const question = (page: Page) => page.getByRole("alertdialog", { name: "Leave without creating your puzzle?" });
const saved = (page: Page) => page.evaluate(key => localStorage.getItem(key), KEY);
// Disposable contexts only. No request can reach a hosted backend.
test.beforeEach(async ({ context }) => {
  await context.route("**/*", route => {
    const url = new URL(route.request().url());
    if (url.origin === "http://127.0.0.1:5187") return route.continue();
    if (url.origin === "http://127.0.0.1:54421") return route.fulfill({ json: null });
    return route.abort();
  });
});
async function start(page: Page) {
  await page.goto("/");
  await page.getByRole("button", { name: "Menu", exact: true }).click();
  await page.getByRole("link", { name: "Create a puzzle", exact: true }).click();
  await expect(title(page)).toBeVisible();
}
async function fill(page: Page) {
  await title(page).fill("Disposable draft");
  await page.getByLabel("Your Name (Designer)").fill("Fixture");
  await page.getByRole("button", { name: "private", exact: true }).click();
  await page.getByRole("button", { name: "Classic", exact: true }).click();
  for (let i = 0; i < 4; i++) {
    const fields = page.getByTestId(`category-card-${i + 1}`).getByRole("textbox");
    await fields.nth(0).fill(`Category ${i}`);
    await fields.nth(1).fill("🌈");
    await fields.nth(2).fill(`a${i}, b${i}, c${i}, d${i}`);
    await fields.nth(3).fill(`hint${i}`);
  }
}
test("Back Stay/Leave, Forward recovery, repeat navigation, reload and focus", async ({ page }) => {
  await start(page);
  await fill(page);
  const original = await saved(page);
  for (let i = 0; i < 3; i++) {
    await title(page).focus();
    await page.evaluate(() => history.back());
    await expect(question(page)).toBeVisible();
    await expect(question(page).getByRole("button", { name: "Keep editing" })).toBeFocused();
    await page.keyboard.press("Enter");
    await expect(question(page)).not.toBeVisible();
    await expect(title(page)).toBeFocused();
    expect(await saved(page)).toBe(original);
  }
  await page.evaluate(() => history.back());
  await question(page).getByRole("button", { name: "Leave", exact: true }).click();
  await expect(page).toHaveURL(/\/$/);
  await page.goForward();
  await expect(title(page)).toHaveValue("Disposable draft");
  expect(await saved(page)).toBe(original);
  page.on("dialog", dialog => dialog.accept());
  await page.reload();
  await expect(title(page)).toHaveValue("Disposable draft");
  expect(await saved(page)).toBe(original);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});
test("Start fresh clears all fields and only its recovery key", async ({ page }) => {
  await start(page); await fill(page);
  await page.evaluate(() => localStorage.setItem("unrelated", "keep"));
  await page.getByRole("button", { name: "Start fresh" }).click();
  await page.getByRole("button", { name: "Yes, start over" }).click();
  await expect(title(page)).toHaveValue("");
  await expect(page.getByLabel("Your Name (Designer)")).toHaveValue("");
  expect(await saved(page)).toBeNull();
  expect(await page.evaluate(() => localStorage.getItem("unrelated"))).toBe("keep");
  await page.reload();
  await expect(title(page)).toHaveValue("");
});
test("two tabs never silently clobber; retry restores after owner closes", async ({ page, context }) => {
  await start(page); await title(page).fill("First tab");
  const other = await context.newPage();
  await other.goto("/create");
  await expect(other.getByText("Draft open in another tab", { exact: true })).toBeVisible();
  await title(page).fill("Last first-tab edit");
  await page.close();
  await other.getByRole("button", { name: "Try again" }).click();
  await expect(title(other)).toHaveValue("Last first-tab edit");
  await title(other).fill("New owner edit");
  expect(JSON.parse((await saved(other))!).title).toBe("New owner edit");
});
test("pending creation blocks Back and edits; failure retains and success clears", async ({ page, context }) => {
  let finish: (() => void) | undefined;
  let success = false;
  await context.route("**/rest/v1/rpc/create_custom_puzzle", async route => {
    await new Promise<void>(resolve => { finish = resolve; });
    await route.fulfill(success ? { json: { puzzle_id: "fixture", share_id: "fixture", short_code: "fixture" } }
      : { status: 500, json: { message: "Fixture failure" } });
  });
  await start(page); await fill(page);
  const original = await saved(page);
  await page.getByRole("button", { name: "Create Game" }).click();
  await expect(title(page)).toBeDisabled();
  await page.evaluate(() => history.back());
  await expect(page.getByRole("alertdialog", { name: "Still creating your puzzle" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Leave", exact: true })).toHaveCount(0);
  await expect.poll(() => !!finish).toBe(true); finish!();
  await expect(question(page)).toBeVisible();
  await question(page).getByRole("button", { name: "Keep editing" }).click();
  await expect(page.getByRole("alert")).toContainText("Fixture failure");
  expect(await saved(page)).toBe(original);
  success = true; finish = undefined;
  await page.getByRole("button", { name: "Create Game" }).click();
  await expect.poll(() => !!finish).toBe(true); finish!();
  await expect(page.getByRole("heading", { name: "Puzzle Created!" })).toBeVisible();
  expect(await saved(page)).toBeNull();
});
test("Forward Stay/Leave and rapid repeated Back keep the creator mounted", async ({ page }) => {
  await start(page); await title(page).fill("History fixture");
  await page.getByRole("link", { name: "Home", exact: true }).click();
  await question(page).getByRole("button", { name: "Leave", exact: true }).click();
  await page.goBack();
  await expect(title(page)).toHaveValue("History fixture");
  await page.evaluate(() => history.forward());
  await question(page).getByRole("button", { name: "Keep editing" }).click();
  await expect(title(page)).toHaveValue("History fixture");
  await page.evaluate(() => { history.back(); history.back(); });
  await expect(question(page)).toBeVisible();
  await question(page).getByRole("button", { name: "Keep editing" }).click();
  await expect(page).toHaveURL(/\/create$/);
  await expect(title(page)).toHaveValue("History fixture");
  await page.evaluate(() => history.forward());
  await question(page).getByRole("button", { name: "Leave", exact: true }).click();
  await expect(page).toHaveURL(/\/$/);
});
test("malformed draft stays intact until explicit Start fresh", async ({ page }) => {
  await page.goto("/privacy");
  await page.evaluate(key => localStorage.setItem(key, '{"version":99}'), KEY);
  await page.goto("/create");
  await expect(page.getByRole("status", { name: "Draft recovery" })).toContainText("kept unchanged");
  await title(page).fill("Unstored edit");
  expect(await saved(page)).toBe('{"version":99}');
  await page.getByRole("button", { name: "Start fresh" }).click();
  await page.getByRole("button", { name: "Yes, start over" }).click();
  expect(await saved(page)).toBeNull();
  await title(page).fill("New draft");
  await expect(page.getByRole("status", { name: "Draft recovery" })).toContainText("Draft saved");
});
test("quota failure warns honestly and preserves the last saved copy", async ({ page }) => {
  await start(page); await title(page).fill("Saved version");
  const previous = await saved(page);
  await page.evaluate(() => {
    const original = Storage.prototype.setItem;
    Storage.prototype.setItem = function(key, value) {
      if (key === "rainbow-creator-draft-v1") throw new DOMException("Full", "QuotaExceededError");
      return original.call(this, key, value);
    };
  });
  await title(page).fill("Not saved");
  await expect(page.getByRole("status", { name: "Draft recovery" })).toContainText("could not be updated");
  expect(await saved(page)).toBe(previous);
  await page.evaluate(() => history.back());
  await expect(question(page)).toContainText("not safely saved");
});
test("partial draft restores automatically with IDs and order unchanged", async ({ page }) => {
  await start(page);
  await title(page).fill("Partial");
  await page.getByTestId("category-card-1").getByRole("textbox").nth(2).fill("one, two, ");
  await page.getByRole("button", { name: "Classic", exact: true }).click();
  const previous = await saved(page);
  page.on("dialog", dialog => dialog.accept());
  await page.reload();
  await expect(title(page)).toHaveValue("Partial");
  await expect(page.getByTestId("category-card-1").getByRole("textbox").nth(2)).toHaveValue("one, two, ");
  expect(await saved(page)).toBe(previous);
});
