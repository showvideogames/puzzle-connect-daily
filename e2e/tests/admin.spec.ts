/**
 * The Admin builder, driven through the real local authentication flow.
 *
 * No token is injected and no session is faked: the tests type the fixture
 * admin's email and password into the real form, GoTrue issues a real JWT,
 * and `admin_save_puzzle` checks `has_role(auth.uid(), 'admin')` server-side
 * exactly as it does in production. A broken admin gate fails these tests.
 *
 * Authored puzzles are dated outside the fixture window and left as Drafts,
 * so nothing these tests create can appear on a public page or in either
 * archive — which is what keeps them independent of the Full/Mini specs.
 */

import { expect, test } from "../support/fixtures.ts";
import { signInAsAdmin } from "../support/game.ts";
import { ADMIN_AUTHORING, FULL_VERSION_SANDBOX } from "../fixtures/catalog.ts";
import type { Page } from "@playwright/test";

/** The builder card for one category, addressed by its colour slot. */
function categoryCard(page: Page, colorIndex: number) {
  return page.getByTestId(`category-card-${colorIndex}`);
}

async function fillCategory(
  page: Page,
  colorIndex: number,
  values: { name: string; emoji: string; answers: string; hint: string }
): Promise<void> {
  const card = categoryCard(page, colorIndex);
  await card.getByLabel("Category Name").fill(values.name);
  await card.getByLabel("Category Emoji (optional)").fill(values.emoji);
  await card.getByLabel(/answers, separated by commas$/).fill(values.answers);
  await card.getByLabel("Small Hint word (optional)").fill(values.hint);
}

const puzzleRow = (page: Page, title: string) =>
  page.getByTestId("puzzle-row").filter({ hasText: title });

/** Opens one puzzle from the All Puzzles list for editing. */
async function editRow(page: Page, title: string): Promise<void> {
  await puzzleRow(page, title).first().getByTitle("Edit puzzle").click();
  await expect(page.getByRole("heading", { name: "Edit Puzzle" })).toBeVisible();
}

const sizeSelector = (page: Page) => page.getByRole("group", { name: "Puzzle size" });
const styleSelector = (page: Page) => page.getByRole("group", { name: "Puzzle style" });

test.describe("Admin", () => {
  test("an admin can sign in through the real login form @smoke", async ({ page, seed }) => {
    await signInAsAdmin(page, seed.accounts.admin);
    await expect(page.getByRole("heading", { name: "Create a Puzzle" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Sign out" })).toBeVisible();
  });

  test("a non-admin account is refused", async ({ page, seed }) => {
    await page.goto("/admin");
    await page.getByLabel("Email", { exact: true }).fill(seed.accounts.player.email);
    await page.getByLabel("Password", { exact: true }).fill(seed.accounts.player.password);
    await page.getByRole("button", { name: "Sign In", exact: true }).click();
    await expect(page.getByText("You don't have admin access.")).toBeVisible({ timeout: 20_000 });
  });

  test("authoring a Full puzzle: Rainbow is enforced, answers are uppercased, fields round-trip", async ({
    page,
    seed,
    admin,
  }) => {
    const fixture = ADMIN_AUTHORING.full;

    // Start from a clean slate so the test is rerunnable and order-independent.
    await admin.from("puzzles").delete().eq("date", fixture.date);

    await signInAsAdmin(page, seed.accounts.admin);

    await page.getByLabel("Date").fill(fixture.date);
    await page.getByLabel("Title (optional)").fill(fixture.title);

    // A new Full starts on Rainbow (PuzzleFormat.defaultBuilderStyle).
    await expect(sizeSelector(page).getByRole("button", { name: "Full 4×4" })).toHaveAttribute(
      "aria-pressed",
      "true"
    );
    await expect(styleSelector(page).getByRole("button", { name: "Rainbow" })).toHaveAttribute(
      "aria-pressed",
      "true"
    );

    for (const [index, category] of fixture.categories.entries()) {
      await fillCategory(page, index + 1, category);
    }

    // ── An incomplete Rainbow is refused, not quietly downgraded ──
    // Every category is filled but no Rainbow answers are picked. Saving
    // must fail with a message about the Rainbow — NOT succeed as a Classic
    // puzzle, which would silently throw away the author's intent.
    await page.getByRole("button", { name: "Create Puzzle" }).click();
    await expect(
      page.getByText(/needs one Rainbow answer from each of its 4 categories/)
    ).toBeVisible();

    const afterRejection = await admin.from("puzzles").select("id").eq("date", fixture.date);
    expect(afterRejection.data ?? [], "the rejected save must not have created a puzzle").toHaveLength(0);

    // ── Switching to Classic makes the same content valid ──
    await styleSelector(page).getByRole("button", { name: "Classic" }).click();
    await page.getByRole("button", { name: "Create Puzzle" }).click();
    await expect(page.getByText(/Puzzle created — saved as Version 1\./)).toBeVisible({
      timeout: 20_000,
    });

    // ── What actually reached the database ──
    const saved = await admin
      .from("puzzles")
      .select("id, title, date, format, is_published, rainbow_herring, puzzle_groups(category, words, difficulty, hint_word, category_emoji, sort_order)")
      .eq("date", fixture.date)
      .single();
    expect(saved.error, saved.error?.message).toBeNull();
    const row = saved.data as unknown as {
      id: string;
      title: string;
      format: string;
      is_published: boolean;
      rainbow_herring: string[] | null;
      puzzle_groups: {
        category: string;
        words: string[];
        difficulty: number;
        hint_word: string | null;
        category_emoji: string | null;
        sort_order: number;
      }[];
    };

    expect(row.format).toBe("full");
    expect(row.is_published).toBe(false); // Draft by default — never public.
    expect(row.rainbow_herring).toBeNull(); // saved as Classic, deliberately

    const groups = [...row.puzzle_groups].sort((a, b) => a.sort_order - b.sort_order);
    expect(groups).toHaveLength(4);
    groups.forEach((group, index) => {
      expect(group.category).toBe(fixture.categories[index].name);
      expect(group.category_emoji).toBe(fixture.categories[index].emoji);
      // Hint words are stored AS TYPED. Only board answers go through
      // normalizeWord — a Small Hint is prose shown to the player, not a
      // canonical answer that has to compare equal to anything.
      expect(group.hint_word).toBe(fixture.categories[index].hint);
    });

    // Answers are uppercased at save time — including the hyphenated one,
    // which is the shape a naive normaliser splits or mangles.
    expect(groups[0].words).toEqual(fixture.expectedFirstCategoryWords);
    const everyWord = groups.flatMap((g) => g.words);
    expect(everyWord.filter((w) => w !== w.toUpperCase())).toEqual([]);

    // ── Reopening restores every field ──
    await editRow(page, fixture.title);

    await expect(page.getByRole("heading", { name: "Edit Puzzle" })).toBeVisible();
    await expect(page.getByLabel("Date")).toHaveValue(fixture.date);
    await expect(page.getByLabel("Title (optional)")).toHaveValue(fixture.title);
    await expect(styleSelector(page).getByRole("button", { name: "Classic" })).toHaveAttribute(
      "aria-pressed",
      "true"
    );
    for (const [index, category] of fixture.categories.entries()) {
      const card = categoryCard(page, index + 1);
      await expect(card.getByLabel("Category Name")).toHaveValue(category.name);
      await expect(card.getByLabel("Category Emoji (optional)")).toHaveValue(category.emoji);
      await expect(card.getByLabel("Small Hint word (optional)")).toHaveValue(category.hint);
      // Answers come back as the stored (uppercase) list.
      await expect(card.getByLabel(/answers, separated by commas$/)).toHaveValue(
        new RegExp(category.answers.split(",")[0].trim().toUpperCase().replace(/[.*+?^${}()|[\]\\]/g, "\\$&"))
      );
    }

    // ── Start Over clears the visible date but keeps the editing identity ──
    await page.getByRole("button", { name: "Start Over" }).click();
    await page.getByRole("button", { name: "Yes, start over" }).click();
    await expect(page.getByLabel("Date")).toHaveValue("");
    // Still editing: the action is Update, not Create, and Cancel Edit is
    // still offered — the stored puzzle has not been touched.
    await expect(page.getByRole("button", { name: "Update Puzzle" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Cancel Edit" })).toBeVisible();

    const untouched = await admin.from("puzzles").select("id").eq("date", fixture.date).single();
    expect(untouched.data?.id).toBe(row.id);
  });

  test("a Mini defaults to Classic, can be switched to Rainbow, and round-trips its Rainbow fields", async ({
    page,
    seed,
    admin,
  }) => {
    const fixture = ADMIN_AUTHORING.mini;
    await admin.from("puzzles").delete().eq("date", fixture.date);

    await signInAsAdmin(page, seed.accounts.admin);

    await sizeSelector(page).getByRole("button", { name: "Mini 3×3" }).click();
    // The product rule: a new Mini is Classic unless its author opts in.
    await expect(styleSelector(page).getByRole("button", { name: "Classic" })).toHaveAttribute(
      "aria-pressed",
      "true"
    );
    // A Classic board shows no Rainbow panel at all.
    await expect(page.getByText("🌈 Rainbow Category")).toHaveCount(0);

    await page.getByLabel("Date").fill(fixture.date);
    await page.getByLabel("Title (optional)").fill(fixture.title);

    // Mini uses difficulties 2, 3, 4 — Green, Blue, Red — so the cards are
    // addressed by those colour slots, not by 1-3.
    for (const [index, category] of fixture.categories.entries()) {
      await fillCategory(page, index + 2, category);
    }

    await styleSelector(page).getByRole("button", { name: "Rainbow" }).click();
    await expect(page.getByText("🌈 Rainbow Category")).toBeVisible();

    // One Rainbow answer per category — three of them, because Mini has
    // three categories.
    for (const [index, word] of fixture.rainbow.picks.entries()) {
      await page.getByLabel(fixture.categories[index].name).selectOption({ label: word });
    }
    const rainbowPanel = page.getByRole("region", { name: /Rainbow Category/ });
    await rainbowPanel.getByLabel("Category Name").fill(fixture.rainbow.name);
    await rainbowPanel.getByLabel("Category Emoji (optional)").fill(fixture.rainbow.emoji);
    await rainbowPanel.getByLabel("Small Hint word (optional)").fill(fixture.rainbow.hint);

    await page.getByRole("button", { name: "Create Puzzle" }).click();
    await expect(page.getByText(/Puzzle created — saved as Version 1\./)).toBeVisible({
      timeout: 20_000,
    });

    const saved = await admin
      .from("puzzles")
      .select("id, format, rainbow_herring, rainbow_category_name, rainbow_category_emoji, rainbow_hint_word, puzzle_groups(words)")
      .eq("date", fixture.date)
      .single();
    expect(saved.error, saved.error?.message).toBeNull();
    const row = saved.data as unknown as {
      format: string;
      rainbow_herring: string[];
      rainbow_category_name: string;
      rainbow_category_emoji: string;
      rainbow_hint_word: string;
      puzzle_groups: { words: string[] }[];
    };

    expect(row.format).toBe("mini");
    expect(row.puzzle_groups).toHaveLength(3);
    expect(row.puzzle_groups.every((g) => g.words.length === 3)).toBe(true);
    // Three Rainbow answers, one per category — not four.
    // Picked in the casing the author typed; STORED uppercase, like every
    // other board answer.
    expect([...row.rainbow_herring].sort()).toEqual(
      fixture.rainbow.picks.map((w) => w.toUpperCase()).sort()
    );
    expect(row.rainbow_category_name).toBe(fixture.rainbow.name);
    expect(row.rainbow_category_emoji).toBe(fixture.rainbow.emoji);
    expect(row.rainbow_hint_word).toBe(fixture.rainbow.hint);
  });

  test("an unchanged re-save mints no version; a gameplay change does", async ({ page, seed }) => {
    await signInAsAdmin(page, seed.accounts.admin);

    // The version sandbox exists for exactly this: a Draft puzzle no other
    // test reads, so editing it here cannot ripple anywhere.
    await editRow(page, FULL_VERSION_SANDBOX.title);
    await expect(page.getByRole("heading", { name: "Edit Puzzle" })).toBeVisible();

    // ── Re-save, nothing touched ──
    await page.getByRole("button", { name: "Update Puzzle" }).click();
    const unchanged = page.getByText(/no gameplay changes, still Version \d+\./);
    await expect(unchanged).toBeVisible({ timeout: 20_000 });
    // The version number is read from the toast rather than assumed, so a
    // retry (which re-runs the whole test against an already-edited sandbox)
    // still asserts the real relationship instead of a fixed number.
    const current = Number(/still Version (\d+)/.exec(await unchanged.innerText())![1]);

    // ── Change the gameplay content ──
    await editRow(page, FULL_VERSION_SANDBOX.title);
    await expect(page.getByRole("heading", { name: "Edit Puzzle" })).toBeVisible();

    const card = categoryCard(page, 1);
    await card
      .getByLabel("Category Name")
      .fill(`${FULL_VERSION_SANDBOX.groups[0].category} ${Date.now()}`);
    await page.getByRole("button", { name: "Update Puzzle" }).click();
    await expect(
      page.getByText(new RegExp(`Puzzle updated — saved as Version ${current + 1}\\.`))
    ).toBeVisible({ timeout: 20_000 });
  });
});
