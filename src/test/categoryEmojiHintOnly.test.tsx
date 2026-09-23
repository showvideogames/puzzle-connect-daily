/**
 * "Hint Only" for a Category Emoji.
 *
 * A Category Emoji shows in two places: the Full Hint, and appended to the
 * category name on the solved colour bar. Hint Only keeps it in the hint and
 * off the solved bar — for a visual that reads as a clue ("___ 💬" pointing
 * at a "High ___" category) but as noise on the answer.
 *
 * The rule under test everywhere below: the checkbox only ever withholds the
 * EXPLICIT Category Emoji. It never edits, strips from, or otherwise touches
 * the Category Name — an emoji typed into the name is part of the name.
 */
import { describe, it, expect, beforeEach, vi } from "vitest";
import { act, fireEvent, render, renderHook, screen, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { HelmetProvider } from "react-helmet-async";
import { FakeSupabase } from "./fakeSupabase";
import type { Puzzle, PuzzleGroup } from "@/lib/types";

const db = new FakeSupabase();

vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    from: (t: string) => db.from(t),
    rpc: (n: string, a: Record<string, unknown>) => db.rpc(n, a),
    auth: {
      getUser: () => db.auth.getUser(),
      getSession: async () => ({ data: { session: null } }),
      onAuthStateChange: () => ({ data: { subscription: { unsubscribe: () => {} } } }),
    },
  },
}));
vi.mock("canvas-confetti", () => ({ default: () => {} }));
vi.mock("@/lib/sounds", () => ({ playRainbowSound: () => {}, playGiftOpenSound: () => {} }));
vi.mock("@/lib/haptics", () => ({ vibrateSuccess: () => {}, vibrateError: () => {}, vibrateCelebration: () => {} }));
vi.mock("@/lib/analytics", () => ({ trackEvent: () => {} }));

import { useBuilderForm } from "@/hooks/useBuilderForm";
import { useDraftPersistence, type DraftData } from "@/hooks/useDraftPersistence";
import { buildContentPayload, builderContentInput } from "@/lib/builder/contentPayload";
import { applyPinnedContent, pinnedContentFrom } from "@/lib/puzzleVersion";
import { createCustomPuzzle, getCustomPuzzleByShareId } from "@/lib/customPuzzles";
import { GameBoard } from "@/components/GameBoard";
import CreatePuzzle from "@/pages/CreatePuzzle";
import { SolvedGroup } from "@/components/SolvedGroup";
import { RainbowRevealBar } from "@/components/RainbowRevealBar";
import { CategoryEditor } from "@/components/builder/CategoryEditor";
import { RainbowPanel } from "@/components/builder/RainbowPanel";
import { resolveTheme } from "@/lib/themes";

const HINT_ONLY = "Hint Only";

const WORDS = [
  ["Blue", "Green", "Red", "Yellow"],
  ["Battery", "Hood", "Tire", "Trunk"],
  ["Houston", "Mars", "Mercury", "Swift"],
  ["Bird", "Dog", "Tree", "White"],
];

const MINI_WORDS = [
  ["Battery", "Hood", "Tire"],
  ["Houston", "Mars", "Mercury"],
  ["Bird", "Dog", "Tree"],
];

// ───────────────────────────────────────────────────────────────────────────
// The two solved bars
// ───────────────────────────────────────────────────────────────────────────

describe("Solved bar: the visual disappears when Hint Only is checked", () => {
  // The example from the request: a "High ___" category whose visual is a
  // speech bubble standing in for the missing word.
  const group = (over: Partial<PuzzleGroup> = {}): PuzzleGroup => ({
    category: "High ___",
    words: ["SCHOOL", "NOON", "SEAS", "ROLLER"],
    difficulty: 1,
    categoryEmoji: "___ 💬",
    ...over,
  });

  it("checked: the bar shows the Category Name alone", () => {
    const { container } = render(<SolvedGroup group={group({ categoryEmojiHintOnly: true })} />);
    expect(container.textContent).toContain("High ___");
    expect(container.textContent).not.toContain("💬");
  });

  it("unchecked: the bar shows name + visual, exactly as before this feature", () => {
    const { container } = render(<SolvedGroup group={group({ categoryEmojiHintOnly: false })} />);
    expect(container.textContent).toContain("High ___");
    expect(container.textContent!.match(/💬/g)).toHaveLength(1);
  });

  it("absent (every puzzle saved before Hint Only existed) displays exactly as unchecked", () => {
    const missing = render(<SolvedGroup group={group()} />);
    expect(missing.container.textContent!.match(/💬/g)).toHaveLength(1);
    const nulled = render(<SolvedGroup group={group({ categoryEmojiHintOnly: null })} />);
    expect(nulled.container.textContent!.match(/💬/g)).toHaveLength(1);
  });

  it("never touches the Category Name — an emoji typed INTO the name still shows", () => {
    const { container } = render(
      <SolvedGroup group={group({ category: "Parts of a Car 🚘", categoryEmoji: "___ 💬", categoryEmojiHintOnly: true })} />
    );
    expect(container.textContent).toContain("Parts of a Car 🚘");
    expect(container.textContent).not.toContain("💬");
  });

  it("a legacy puzzle (no explicit emoji, emoji in the title) is unaffected by the flag", () => {
    // Nothing explicit to withhold: the title's own emoji is the name.
    const { container } = render(
      <SolvedGroup group={group({ category: "Parts of a Car 🚘", categoryEmoji: null, categoryEmojiHintOnly: true })} />
    );
    expect(container.textContent!.match(/🚘/g)).toHaveLength(1);
  });

  it("withholds a custom emoji code too — no image, no literal text", () => {
    render(<SolvedGroup group={group({ categoryEmoji: ":caveman:", categoryEmojiHintOnly: true })} />);
    expect(screen.queryByRole("img")).toBeNull();
    expect(screen.queryByText(/:caveman:/)).toBeNull();
    expect(screen.getByText("High ___")).toBeTruthy();
  });
});

describe("Rainbow solved bar: same rule", () => {
  const theme = resolveTheme(null);
  const bar = (props: Partial<Parameters<typeof RainbowRevealBar>[0]> = {}) =>
    render(
      <RainbowRevealBar
        categoryName="Mixed Bag"
        categoryEmoji="___ 💬"
        theme={theme}
        words={["A", "B", "C", "D"]}
        textClass="text-white"
        background="linear-gradient(to right, red, blue)"
        curtain
        {...props}
      />
    );

  it("checked: the Rainbow bar shows its name alone", () => {
    const { container } = bar({ categoryEmojiHintOnly: true });
    expect(container.textContent).toContain("Mixed Bag");
    expect(container.textContent).not.toContain("💬");
  });

  it("unchecked / absent: the Rainbow bar shows name + visual", () => {
    expect(bar({ categoryEmojiHintOnly: false }).container.textContent!.match(/💬/g)).toHaveLength(1);
    expect(bar().container.textContent!.match(/💬/g)).toHaveLength(1);
  });

  it("checked with no custom name does not fall back to the theme's own emoji", () => {
    // The theme default ("Rainbow 🌈") would otherwise put an emoji straight
    // back onto a bar the creator asked to keep clean.
    const { container } = bar({ categoryName: null, categoryEmojiHintOnly: true });
    expect(container.textContent).toContain(theme.label);
    expect(container.textContent).not.toContain("💬");
    expect(container.textContent).not.toContain(theme.emoji);
  });

  it("the flag alone, with nothing authored, changes nothing (theme default still shows)", () => {
    const { container } = bar({ categoryName: null, categoryEmoji: null, categoryEmojiHintOnly: true });
    expect(container.textContent!.match(new RegExp(theme.emoji, "g"))).toHaveLength(1);
  });
});

// ───────────────────────────────────────────────────────────────────────────
// The hint keeps the visual
// ───────────────────────────────────────────────────────────────────────────

describe("Full Hint: the visual stays put whatever the checkbox says", () => {
  const puzzle = (overrides: Partial<PuzzleGroup>[]): Puzzle => ({
    id: "fx",
    date: "",
    designerName: "d",
    alphabetizeCompleted: true,
    groups: WORDS.map((w, i) => ({
      category: `Cat ${"ABCD"[i]}`,
      words: w.map((x) => x.toUpperCase()),
      difficulty: (i + 1) as 1 | 2 | 3 | 4,
      ...(overrides[i] ?? {}),
    })),
    rainbowHerring: null,
  });

  const visuals = () => screen.getAllByTestId("hint-visual").map((n) => n.textContent);

  function board(p: Puzzle) {
    localStorage.clear();
    render(
      <MemoryRouter>
        <GameBoard puzzle={p} settings={{} as never} customMode showModeBadge={false} fullHintUsed />
      </MemoryRouter>
    );
  }

  it("a Hint Only category still shows its visual in the hint, literally", async () => {
    board(
      puzzle([
        { categoryEmoji: "___ 💬", categoryEmojiHintOnly: true },
        { categoryEmoji: "🎵", categoryEmojiHintOnly: false },
        { categoryEmoji: "🚘" },
        {},
      ])
    );
    await screen.findAllByTestId("hint-visual");
    expect(visuals()).toEqual(["___ 💬", "🎵", "🚘", ""]);
  });

  it("checked and unchecked are indistinguishable in the hint", async () => {
    const withFlag = puzzle([{ categoryEmoji: "___ 💬", categoryEmojiHintOnly: true }, {}, {}, {}]);
    board(withFlag);
    await screen.findAllByTestId("hint-visual");
    const flagged = visuals();
    screen.getAllByTestId("hint-visual").forEach((n) => n.remove());
    board(puzzle([{ categoryEmoji: "___ 💬", categoryEmojiHintOnly: false }, {}, {}, {}]));
    await screen.findAllByTestId("hint-visual");
    expect(visuals()).toEqual(flagged);
  });
});

// ───────────────────────────────────────────────────────────────────────────
// Builder state and the saved payload
// ───────────────────────────────────────────────────────────────────────────

function filled(format: "full" | "mini" = "full") {
  const words = format === "mini" ? MINI_WORDS : WORDS;
  const view = renderHook(() => useBuilderForm(format));
  act(() => {
    words.forEach((w, i) => {
      view.result.current.updateCategoryName(i, `Cat ${i}`);
      view.result.current.updateAnswersRaw(i, w.join(", "));
    });
  });
  return view;
}

describe("builder state", () => {
  it("defaults to unchecked on a blank form, for every category and the Rainbow", () => {
    const { result } = renderHook(() => useBuilderForm());
    expect(result.current.groups.map((g) => g.categoryEmojiHintOnly)).toEqual([false, false, false, false]);
    expect(result.current.rainbowCategoryEmojiHintOnly).toBe(false);
  });

  it("toggles per category without disturbing the name, emoji or hint", () => {
    const { result } = filled();
    act(() => {
      result.current.updateCategoryEmoji(1, "___ 💬");
      result.current.updateHintWord(1, "hint1");
      result.current.updateCategoryEmojiHintOnly(1, true);
    });
    const g = result.current.groups[1];
    expect(g.categoryEmojiHintOnly).toBe(true);
    expect(g.category).toBe("Cat 1");
    expect(g.categoryEmoji).toBe("___ 💬");
    expect(g.hintWord).toBe("hint1");
    // The other cards are untouched.
    expect(result.current.groups.map((x) => x.categoryEmojiHintOnly)).toEqual([false, true, false, false]);
    act(() => result.current.updateCategoryEmojiHintOnly(1, false));
    expect(result.current.groups[1].categoryEmojiHintOnly).toBe(false);
    expect(result.current.groups[1].categoryEmoji).toBe("___ 💬");
  });

  it("moves with its category when categories are reordered", () => {
    const { result } = filled();
    act(() => {
      result.current.updateCategoryEmoji(0, "🟡");
      result.current.updateCategoryEmojiHintOnly(0, true);
    });
    act(() => result.current.moveGroup(0, 3));
    expect(result.current.groups.map((g) => g.categoryEmojiHintOnly)).toEqual([false, false, false, true]);
    expect(result.current.groups[3].categoryEmoji).toBe("🟡");
  });

  it("Start Over clears every checkbox, including the Rainbow's", () => {
    const { result } = filled();
    act(() => {
      result.current.groups.forEach((_, i) => result.current.updateCategoryEmojiHintOnly(i, true));
      result.current.setRainbowCategoryEmojiHintOnly(true);
    });
    act(() => result.current.reset());
    expect(result.current.groups.every((g) => !g.categoryEmojiHintOnly)).toBe(true);
    expect(result.current.rainbowCategoryEmojiHintOnly).toBe(false);
  });

  it("load reads the saved flag; an older source with no field loads unchecked", () => {
    const { result } = renderHook(() => useBuilderForm());
    act(() =>
      result.current.load({
        groups: WORDS.map((w, i) => ({
          category: `C${i}`,
          words: w,
          difficulty: (i + 1) as 1 | 2 | 3 | 4,
          hintWord: null,
          categoryEmoji: "💬",
          ...(i === 2 ? { categoryEmojiHintOnly: true } : {}),
        })),
        wordOrder: null,
        rainbowHerring: null,
        rainbowCategoryName: "",
        rainbowHintWord: "",
        rainbowCategoryEmoji: "🌈",
        theme: "",
        alphabetizeCompleted: true,
      })
    );
    expect(result.current.groups.map((g) => g.categoryEmojiHintOnly)).toEqual([false, false, true, false]);
    expect(result.current.rainbowCategoryEmojiHintOnly).toBe(false);
  });
});

describe("saved payload", () => {
  const base = {
    wordOrder: null,
    rainbowHerring: null,
    rainbowCategoryName: "Mixed",
    rainbowHintWord: null,
    theme: null,
    isEmojiPuzzle: false,
    alphabetizeCompleted: true,
  };

  it("emits the key only where the box is checked", () => {
    const payload = buildContentPayload({
      ...base,
      groups: [
        { category: "High ___", words: ["A", "B", "C", "D"], difficulty: 1, hintWord: null, categoryEmoji: "___ 💬", categoryEmojiHintOnly: true },
        { category: "Cars", words: ["E", "F", "G", "H"], difficulty: 2, hintWord: null, categoryEmoji: "🚘", categoryEmojiHintOnly: false },
        { category: "Plain", words: ["I", "J", "K", "L"], difficulty: 3, hintWord: null },
        { category: "Custom", words: ["M", "N", "O", "P"], difficulty: 4, hintWord: null, categoryEmoji: ":caveman:", categoryEmojiHintOnly: true },
      ],
      rainbowCategoryEmoji: "🌈",
      rainbowCategoryEmojiHintOnly: true,
    });
    expect(payload.groups.map((g) => g.category_emoji_hint_only)).toEqual([true, undefined, undefined, true]);
    expect(payload.rainbow_category_emoji_hint_only).toBe(true);
    // The names and the emoji themselves are untouched by the flag.
    expect(payload.groups[0].category).toBe("High ___");
    expect(payload.groups[0].category_emoji).toBe("___ 💬");
  });

  it("drops a checked box that has no emoji to withhold", () => {
    const payload = buildContentPayload({
      ...base,
      groups: WORDS.map((w, i) => ({
        category: `C${i}`,
        words: w,
        difficulty: (i + 1) as 1 | 2 | 3 | 4,
        hintWord: null,
        categoryEmoji: i === 0 ? "   " : null,
        categoryEmojiHintOnly: true,
      })),
      rainbowCategoryEmoji: "  ",
      rainbowCategoryEmojiHintOnly: true,
    });
    expect(payload.groups.every((g) => g.category_emoji_hint_only === undefined)).toBe(true);
    expect(payload.rainbow_category_emoji_hint_only).toBeUndefined();
  });

  it("a puzzle with no flags anywhere serialises exactly as it did before Hint Only", () => {
    const groups = WORDS.map((w, i) => ({
      category: `C${i}`,
      words: w,
      difficulty: (i + 1) as 1 | 2 | 3 | 4,
      hintWord: null,
      categoryEmoji: "💬",
    }));
    const before = JSON.stringify(buildContentPayload({ ...base, groups, rainbowCategoryEmoji: "🌈" }));
    expect(before).not.toContain("hint_only");
  });

  it("a Mini carries the flags the same way (shared builder, no Mini-specific path)", () => {
    const { result } = filled("mini");
    act(() => {
      result.current.updateCategoryEmoji(0, "___ 💬");
      result.current.updateCategoryEmojiHintOnly(0, true);
      result.current.setRainbowCategoryEmoji("🌈");
      result.current.setRainbowCategoryEmojiHintOnly(true);
    });
    const payload = buildContentPayload(builderContentInput(result.current, false));
    expect(payload.format).toBe("mini");
    expect(payload.groups.map((g) => g.category_emoji_hint_only)).toEqual([true, undefined, undefined]);
    expect(payload.rainbow_category_emoji_hint_only).toBe(true);
  });
});

// ───────────────────────────────────────────────────────────────────────────
// Persistence: draft, official save/reopen, custom puzzles, pinned snapshot
// ───────────────────────────────────────────────────────────────────────────

describe("draft persistence", () => {
  beforeEach(() => localStorage.clear());

  const draft = (over: Partial<DraftData> = {}): DraftData => ({
    puzzleDate: "2026-10-01",
    puzzleTitle: "Draft",
    designerName: "Sam West",
    groups: WORDS.map((w, i) => ({
      category: `C${i}`,
      words: w.join(", "),
      difficulty: (i + 1) as 1 | 2 | 3 | 4,
      hintWord: "",
      categoryEmoji: "💬",
      categoryEmojiHintOnly: i === 1,
    })),
    isPublished: false,
    isBeta: false,
    wordOrder: [],
    rainbowHerring: [null, null, null, null],
    rainbowCategoryName: "",
    rainbowHintWord: "",
    rainbowCategoryEmoji: "🌈",
    rainbowCategoryEmojiHintOnly: true,
    rainbowWordOrder: [],
    theme: "",
    isEmojiPuzzle: false,
    emojiPuzzleIcon: "",
    isFreePuzzle: false,
    freePuzzleOrder: null,
    alphabetizeCompleted: true,
    editingId: null,
    ...over,
  });

  it("round-trips the checkboxes through a saved draft", () => {
    // Save, unmount, re-mount: exactly how Admin restores a draft.
    const d = draft();
    const view = renderHook(() =>
      useDraftPersistence({ enabled: true, editingId: null, values: d, applyDraft: () => {} })
    );
    act(() => view.result.current.handleBlurSave());
    view.unmount();
    const restored: DraftData[] = [];
    renderHook(() =>
      useDraftPersistence({ enabled: true, editingId: null, values: d, applyDraft: (x) => restored.push(x) })
    );
    expect(restored).toHaveLength(1);
    expect(restored[0].groups.map((g) => g.categoryEmojiHintOnly)).toEqual([false, true, false, false]);
    expect(restored[0].rainbowCategoryEmojiHintOnly).toBe(true);

    // And the restored draft drives the form, as Admin's applyDraft does.
    const { result } = renderHook(() => useBuilderForm());
    act(() =>
      result.current.load({
        groups: restored[0].groups.map((g) => ({
          category: g.category,
          words: g.words.split(", "),
          difficulty: g.difficulty,
          hintWord: g.hintWord,
          categoryEmoji: g.categoryEmoji ?? "",
          categoryEmojiHintOnly: g.categoryEmojiHintOnly ?? false,
        })),
        wordOrder: [],
        rainbowHerring: null,
        rainbowCategoryName: "",
        rainbowHintWord: "",
        rainbowCategoryEmoji: restored[0].rainbowCategoryEmoji ?? "",
        rainbowCategoryEmojiHintOnly: restored[0].rainbowCategoryEmojiHintOnly ?? false,
        theme: "",
        alphabetizeCompleted: true,
      })
    );
    expect(result.current.groups.map((g) => g.categoryEmojiHintOnly)).toEqual([false, true, false, false]);
    expect(result.current.rainbowCategoryEmojiHintOnly).toBe(true);
  });

  it("a draft saved before the field existed restores with every box unchecked", () => {
    const legacy = draft();
    legacy.groups.forEach((g) => delete (g as unknown as Record<string, unknown>).categoryEmojiHintOnly);
    delete (legacy as unknown as Record<string, unknown>).rainbowCategoryEmojiHintOnly;
    const { result } = renderHook(() => useBuilderForm());
    act(() =>
      result.current.load({
        groups: legacy.groups.map((g) => ({
          category: g.category,
          words: g.words.split(",").map((w) => w.trim()),
          difficulty: g.difficulty,
          hintWord: g.hintWord,
          categoryEmoji: g.categoryEmoji ?? "",
          categoryEmojiHintOnly: g.categoryEmojiHintOnly ?? false,
        })),
        wordOrder: null,
        rainbowHerring: null,
        rainbowCategoryName: "",
        rainbowHintWord: "",
        rainbowCategoryEmoji: legacy.rainbowCategoryEmoji ?? "",
        rainbowCategoryEmojiHintOnly: legacy.rainbowCategoryEmojiHintOnly ?? false,
        theme: "",
        alphabetizeCompleted: true,
      })
    );
    expect(result.current.groups.every((g) => !g.categoryEmojiHintOnly)).toBe(true);
    expect(result.current.rainbowCategoryEmojiHintOnly).toBe(false);
  });
});

describe("official puzzles: save, store, reopen (Admin path)", () => {
  const meta = { date: "2026-10-02", title: "Hint Only Test", is_published: false };
  const content = (flags: Record<number, boolean> = {}, rainbowFlag = false) => ({
    groups: WORDS.map((w, i) => ({
      category: `Cat ${i}`,
      words: w.map((x) => x.toUpperCase()),
      difficulty: i + 1,
      hint_word: null,
      sort_order: i,
      category_emoji: "___ 💬",
      ...(flags[i] ? { category_emoji_hint_only: true } : {}),
    })),
    word_order: null,
    rainbow_herring: null,
    rainbow_category_name: "Mixed",
    rainbow_hint_word: null,
    rainbow_category_emoji: "🌈",
    ...(rainbowFlag ? { rainbow_category_emoji_hint_only: true } : {}),
    theme: null,
    is_emoji_puzzle: false,
    alphabetize_completed: true,
  });

  beforeEach(() => {
    for (const t of ["puzzles", "puzzle_groups", "puzzle_versions"]) db.tables[t] = [];
    db.signIn("admin-1", { admin: true });
  });

  it("stores the flag on the group rows and the puzzle, and reloads it", async () => {
    const saved = await db.rpc("admin_save_puzzle", { _puzzle_id: null, _metadata: meta, _content: content({ 0: true, 2: true }, true) });
    expect(saved.error).toBeNull();
    const id = (saved.data as { puzzle_id: string }).puzzle_id;
    const rows = db.tables.puzzle_groups
      .filter((g) => g.puzzle_id === id)
      .sort((a, b) => Number(a.sort_order) - Number(b.sort_order));
    expect(rows.map((r) => r.category_emoji_hint_only)).toEqual([true, false, true, false]);
    // The emoji and the name are stored whole, untouched by the flag.
    expect(rows.map((r) => r.category_emoji)).toEqual(["___ 💬", "___ 💬", "___ 💬", "___ 💬"]);
    expect(rows[0].category).toBe("Cat 0");
    expect(db.tables.puzzles[0].rainbow_category_emoji_hint_only).toBe(true);

    // Reopening, exactly as Admin's editPuzzle does.
    const reopened = renderHook(() => useBuilderForm());
    act(() =>
      reopened.result.current.load({
        groups: rows.map((r, i) => ({
          category: r.category as string,
          words: r.words as string[],
          difficulty: (i + 1) as 1 | 2 | 3 | 4,
          hintWord: (r.hint_word ?? null) as string | null,
          categoryEmoji: (r.category_emoji ?? null) as string | null,
          categoryEmojiHintOnly: (r.category_emoji_hint_only ?? false) as boolean,
        })),
        wordOrder: null,
        rainbowHerring: null,
        rainbowCategoryName: "Mixed",
        rainbowHintWord: "",
        rainbowCategoryEmoji: "🌈",
        rainbowCategoryEmojiHintOnly: db.tables.puzzles[0].rainbow_category_emoji_hint_only as boolean,
        theme: "",
        alphabetizeCompleted: true,
      })
    );
    expect(reopened.result.current.groups.map((g) => g.categoryEmojiHintOnly)).toEqual([true, false, true, false]);
    expect(reopened.result.current.rainbowCategoryEmojiHintOnly).toBe(true);

    // Re-saving what was just reopened mints no new version.
    const again = await db.rpc("admin_save_puzzle", { _puzzle_id: id, _metadata: meta, _content: content({ 0: true, 2: true }, true) });
    expect((again.data as { created_version: boolean }).created_version).toBe(false);
  });

  it("ticking the box IS a gameplay change: it mints a version", async () => {
    const first = await db.rpc("admin_save_puzzle", { _puzzle_id: null, _metadata: meta, _content: content() });
    const id = (first.data as { puzzle_id: string }).puzzle_id;
    const changed = await db.rpc("admin_save_puzzle", { _puzzle_id: id, _metadata: meta, _content: content({ 1: true }) });
    expect((changed.data as { created_version: boolean }).created_version).toBe(true);
  });

  it("an existing puzzle canonicalises unchanged: the key is absent and re-saving mints nothing", async () => {
    const first = await db.rpc("admin_save_puzzle", { _puzzle_id: null, _metadata: meta, _content: content() });
    const id = (first.data as { puzzle_id: string }).puzzle_id;
    expect(JSON.stringify(db.tables.puzzle_versions[0].content)).not.toContain("hint_only");
    // A client that sends the flag as false is identical to one that omits it.
    const resave = await db.rpc("admin_save_puzzle", {
      _puzzle_id: id,
      _metadata: meta,
      _content: {
        ...content(),
        rainbow_category_emoji_hint_only: false,
        groups: content().groups.map((g) => ({ ...g, category_emoji_hint_only: false })),
      },
    });
    expect((resave.data as { created_version: boolean }).created_version).toBe(false);
  });

  it("a checked box with no emoji is never stored", async () => {
    const noEmoji = content({ 0: true });
    noEmoji.groups.forEach((g) => { g.category_emoji = null as unknown as string; });
    noEmoji.rainbow_category_emoji = null as unknown as string;
    noEmoji.rainbow_category_emoji_hint_only = true;
    const saved = await db.rpc("admin_save_puzzle", { _puzzle_id: null, _metadata: meta, _content: noEmoji });
    expect(saved.error).toBeNull();
    expect(JSON.stringify(db.tables.puzzle_versions[0].content)).not.toContain("hint_only");
    const id = (saved.data as { puzzle_id: string }).puzzle_id;
    expect(db.tables.puzzle_groups.filter((g) => g.puzzle_id === id).every((g) => g.category_emoji_hint_only === false)).toBe(true);
  });
});

describe("custom puzzles (the public /create path)", () => {
  beforeEach(() => {
    db.tables.custom_puzzles = [];
    db.signIn(null);
  });

  it("stores and returns the flag per category and for the Rainbow", async () => {
    const { shareId } = await createCustomPuzzle({
      creatorName: "Sam",
      title: "Hint Only",
      visibility: "public",
      content: {
        mode: "rainbow",
        groups: WORDS.map((w, i) => ({
          category: `Cat ${i}`,
          words: w.map((x) => x.toUpperCase()),
          hintWord: null,
          categoryEmoji: "___ 💬",
          categoryEmojiHintOnly: i === 1,
        })),
        wordOrder: WORDS.flat().map((x) => x.toUpperCase()),
        rainbowHerring: ["BLUE", "TIRE", "SWIFT", "TREE"],
        rainbowCategoryName: "Mixed",
        rainbowHintWord: null,
        rainbowCategoryEmoji: "🌈",
        rainbowCategoryEmojiHintOnly: true,
        alphabetizeCompleted: true,
      },
    });
    const { puzzle } = (await getCustomPuzzleByShareId(shareId))!;
    expect(puzzle.groups.map((g) => g.categoryEmojiHintOnly)).toEqual([false, true, false, false]);
    expect(puzzle.groups.map((g) => g.categoryEmoji)).toEqual(["___ 💬", "___ 💬", "___ 💬", "___ 💬"]);
    expect(puzzle.rainbowCategoryEmojiHintOnly).toBe(true);
    // And the flag reaches the bar the player actually sees.
    const { container } = render(<SolvedGroup group={puzzle.groups[1]} />);
    expect(container.textContent).not.toContain("💬");
  });

  it("a custom puzzle stored before Hint Only existed reads back unchecked", async () => {
    const { shareId } = await createCustomPuzzle({
      creatorName: "Sam",
      title: "Legacy",
      visibility: "public",
      content: {
        mode: "classic",
        groups: WORDS.map((w, i) => ({ category: `Cat ${i}`, words: w.map((x) => x.toUpperCase()), hintWord: null, categoryEmoji: "💬" })),
        wordOrder: WORDS.flat().map((x) => x.toUpperCase()),
        rainbowHerring: null,
        rainbowCategoryName: null,
        rainbowHintWord: null,
        alphabetizeCompleted: true,
      },
    });
    const { puzzle } = (await getCustomPuzzleByShareId(shareId))!;
    expect(puzzle.groups.every((g) => g.categoryEmojiHintOnly === false)).toBe(true);
    expect(render(<SolvedGroup group={puzzle.groups[0]} />).container.textContent!.match(/💬/g)).toHaveLength(1);
  });
});

describe("pinned snapshot (a game already in progress)", () => {
  it("keeps each category's flag and the Rainbow's across a version pin", () => {
    const puzzle: Puzzle = {
      id: "p",
      date: "",
      designerName: "d",
      versionId: "v1",
      alphabetizeCompleted: true,
      groups: WORDS.map((w, i) => ({
        category: `C${i}`,
        words: w,
        difficulty: (i + 1) as 1 | 2 | 3 | 4,
        categoryEmoji: "___ 💬",
        categoryEmojiHintOnly: i === 0,
      })),
      rainbowHerring: ["Blue", "Battery", "Houston", "Bird"],
      rainbowCategoryName: "R",
      rainbowCategoryEmoji: "🌈",
      rainbowCategoryEmojiHintOnly: true,
    };
    const pinned = pinnedContentFrom(puzzle)!;
    const rebuilt = applyPinnedContent({ ...puzzle, versionId: "v2" }, pinned);
    expect(rebuilt.groups.map((g) => g.categoryEmojiHintOnly)).toEqual([true, false, false, false]);
    expect(rebuilt.rainbowCategoryEmojiHintOnly).toBe(true);

    // A snapshot written before the field existed still rebuilds, unchecked.
    const old = JSON.parse(JSON.stringify(pinned));
    delete old.rainbowCategoryEmojiHintOnly;
    old.groups.forEach((g: Record<string, unknown>) => delete g.categoryEmojiHintOnly);
    const fromOld = applyPinnedContent(puzzle, old);
    expect(fromOld.groups[0].categoryEmojiHintOnly).toBeUndefined();
    expect(fromOld.rainbowCategoryEmojiHintOnly).toBe(false);
    expect(render(<SolvedGroup group={fromOld.groups[0]} />).container.textContent!.match(/💬/g)).toHaveLength(1);
  });
});

// ───────────────────────────────────────────────────────────────────────────
// The editor UI itself
// ───────────────────────────────────────────────────────────────────────────

describe("Category editor card", () => {
  const editor = (props: Partial<Parameters<typeof CategoryEditor>[0]> = {}) => {
    const onHintOnly = vi.fn();
    const view = render(
      <CategoryEditor
        colorIndex={1}
        label="Yellow"
        difficultyLabel="Easiest"
        category="High ___"
        onCategoryChange={() => {}}
        categoryEmoji="___ 💬"
        onCategoryEmojiChange={() => {}}
        categoryEmojiHintOnly={false}
        onCategoryEmojiHintOnlyChange={onHintOnly}
        categoryPlaceholder="name"
        answersRaw=""
        onAnswersRawChange={() => {}}
        answersPlaceholder="answers"
        answersLabel="Answers"
        hintWord=""
        onHintWordChange={() => {}}
        hintPlaceholder="hint"
        {...props}
      />
    );
    return { ...view, onHintOnly };
  };

  it("offers a Hint Only checkbox beside the Category Emoji field", () => {
    editor();
    const box = screen.getByLabelText(HINT_ONLY) as HTMLInputElement;
    expect(box.type).toBe("checkbox");
    expect(box.checked).toBe(false);
    // Same block as the Emoji field's helper, not off with the answers/hint.
    const emojiInput = screen.getByDisplayValue("___ 💬");
    expect(emojiInput.closest("div")!.parentElement!.parentElement!.contains(box)).toBe(true);
  });

  it("reports a tick to the shell and reflects the state it is given", () => {
    const { onHintOnly } = editor();
    fireEvent.click(screen.getByLabelText(HINT_ONLY));
    expect(onHintOnly).toHaveBeenCalledWith(true);
    editor({ categoryEmojiHintOnly: true });
    expect((screen.getAllByLabelText(HINT_ONLY)[1] as HTMLInputElement).checked).toBe(true);
  });

  it("explains what a ticked box does", () => {
    editor({ categoryEmojiHintOnly: true });
    expect(screen.getByText(/solved box will show the Category Name on its own/i)).toBeTruthy();
  });
});

describe("Rainbow panel", () => {
  it("offers the same checkbox for the Rainbow category", () => {
    const onHintOnly = vi.fn();
    render(
      <RainbowPanel
        groups={[]}
        onSelect={() => {}}
        categoryName="Mixed Bag"
        onCategoryNameChange={() => {}}
        categoryEmoji="🌈"
        onCategoryEmojiChange={() => {}}
        categoryEmojiHintOnly={false}
        onCategoryEmojiHintOnlyChange={onHintOnly}
        hintWord=""
        onHintWordChange={() => {}}
        theme=""
        onThemeChange={() => {}}
        displayOrderTiles={[]}
        onReorderDisplay={() => {}}
      />
    );
    const box = screen.getByLabelText(HINT_ONLY) as HTMLInputElement;
    expect(box.checked).toBe(false);
    fireEvent.click(box);
    expect(onHintOnly).toHaveBeenCalledWith(true);
  });
});

describe("/create page", () => {
  const renderCreate = () =>
    render(
      <HelmetProvider>
        <MemoryRouter>
          <CreatePuzzle />
        </MemoryRouter>
      </HelmetProvider>
    );

  const cards = () => screen.getAllByTestId(/^category-card-/);

  function fill() {
    cards().forEach((card, i) => {
      const [name, emoji, answers] = within(card).getAllByRole("textbox") as HTMLInputElement[];
      fireEvent.change(name, { target: { value: `Cat ${i}` } });
      fireEvent.change(emoji, { target: { value: "___ 💬" } });
      fireEvent.change(answers, { target: { value: WORDS[i].join(", ") } });
    });
  }

  it("shows one Hint Only box per category and one for the Rainbow", () => {
    renderCreate();
    fill();
    for (const card of cards()) {
      expect(within(card).getByLabelText(HINT_ONLY)).toBeTruthy();
    }
    // The Rainbow panel appears once every answer exists.
    expect(screen.getAllByLabelText(HINT_ONLY)).toHaveLength(5);
  });

  it("ticking a box leaves the Category Name and Emoji exactly as typed", () => {
    renderCreate();
    const card = cards()[0];
    const [name, emoji] = within(card).getAllByRole("textbox") as HTMLInputElement[];
    fireEvent.change(name, { target: { value: "High ___" } });
    fireEvent.change(emoji, { target: { value: "___ 💬" } });
    fireEvent.click(within(card).getByLabelText(HINT_ONLY));
    expect((within(card).getByLabelText(HINT_ONLY) as HTMLInputElement).checked).toBe(true);
    expect(name.value).toBe("High ___");
    expect(emoji.value).toBe("___ 💬");
  });

  it("Start Over clears the boxes along with everything else", async () => {
    renderCreate();
    fill();
    cards().forEach((card) => fireEvent.click(within(card).getByLabelText(HINT_ONLY)));
    expect(screen.getAllByLabelText(HINT_ONLY).filter((b) => (b as HTMLInputElement).checked)).toHaveLength(4);
    fireEvent.click(screen.getByRole("button", { name: "Start Over" }));
    fireEvent.click(await screen.findByRole("button", { name: "Yes, start over" }));
    expect(screen.getAllByLabelText(HINT_ONLY).every((b) => !(b as HTMLInputElement).checked)).toBe(true);
  });
});
