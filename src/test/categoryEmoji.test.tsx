/**
 * Category Emoji: an explicit, optional, literal visual per category (and for
 * the Rainbow), independent of the category name and the Small Hint.
 */
import { describe, it, expect, beforeEach, vi } from "vitest";
import { act, fireEvent, render, renderHook, screen, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { HelmetProvider } from "react-helmet-async";
import { FakeSupabase } from "./fakeSupabase";
import type { Puzzle } from "@/lib/types";

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
import { buildContentPayload } from "@/lib/builder/contentPayload";
import { resolveCategoryVisual, splitCategoryVisual } from "@/lib/categoryVisual";
import { applyPinnedContent, pinnedContentFrom } from "@/lib/puzzleVersion";
import { createCustomPuzzle, getCustomPuzzleByShareId } from "@/lib/customPuzzles";
import { GameBoard } from "@/components/GameBoard";
import CreatePuzzle from "@/pages/CreatePuzzle";

const LABEL = "Category Emoji (optional)";
const HELPER = "Add an emoji or short visual, such as 🎵 or ___ 💬.";

const WORDS = [
  ["Blue", "Green", "Red", "Yellow"],
  ["Battery", "Hood", "Tire", "Trunk"],
  ["Houston", "Mars", "Mercury", "Swift"],
  ["Bird", "Dog", "Tree", "White"],
];

function filled() {
  const view = renderHook(() => useBuilderForm());
  act(() => {
    WORDS.forEach((w, i) => {
      view.result.current.updateCategoryName(i, `Cat ${i} 🚘`);
      view.result.current.updateAnswersRaw(i, w.join(", "));
      view.result.current.updateHintWord(i, `hint${i}`);
    });
  });
  return view;
}

describe("visual resolution", () => {
  it("keeps the whole explicit value literally", () => {
    expect(resolveCategoryVisual("___ 💬", "Anything")).toBe("___ 💬");
    expect(resolveCategoryVisual("  🎵  ", "Songs")).toBe("🎵");
    expect(resolveCategoryVisual("Q&A", "Songs")).toBe("Q&A");
    expect(resolveCategoryVisual(":caveman:", "Songs")).toBe(":caveman:");
  });

  it("is NOT derived from the category name once an explicit value exists", () => {
    expect(resolveCategoryVisual("🎵", "Parts of a Car 🚘")).toBe("🎵");
  });

  it("falls back to the title's trailing emoji only when there is no explicit value", () => {
    expect(resolveCategoryVisual(null, "Parts of a Car 🚘")).toBe("🚘");
    expect(resolveCategoryVisual(undefined, "Parts of a Car 🚘")).toBe("🚘");
    expect(resolveCategoryVisual("", "Parts of a Car 🚘")).toBe("🚘");
    expect(resolveCategoryVisual("   ", "Parts of a Car 🚘")).toBe("🚘");
    expect(resolveCategoryVisual(null, "No emoji here")).toBe("");
  });

  it("splits custom emoji codes from literal text without touching either", () => {
    expect(splitCategoryVisual("___ 💬")).toEqual([{ type: "text", value: "___ 💬" }]);
    expect(splitCategoryVisual(":caveman:")).toEqual([{ type: "emoji", name: "caveman" }]);
    expect(splitCategoryVisual("___ :caveman:!")).toEqual([
      { type: "text", value: "___ " },
      { type: "emoji", name: "caveman" },
      { type: "text", value: "!" },
    ]);
    // A time is not an emoji code.
    expect(splitCategoryVisual("at 10:30:45")).toEqual([{ type: "text", value: "at 10:30:45" }]);
  });
});

describe("builder state and payload", () => {
  it("name, emoji and hint are three independent values", () => {
    const { result } = filled();
    act(() => result.current.updateCategoryEmoji(1, "___ 💬"));
    const g = result.current.groups[1];
    expect(g.category).toBe("Cat 1 🚘");
    expect(g.categoryEmoji).toBe("___ 💬");
    expect(g.hintWord).toBe("hint1");
    act(() => result.current.updateCategoryName(1, "Renamed"));
    expect(result.current.groups[1].categoryEmoji).toBe("___ 💬");
    act(() => result.current.updateHintWord(1, "other"));
    expect(result.current.groups[1].categoryEmoji).toBe("___ 💬");
    act(() => result.current.updateCategoryEmoji(1, "🎵"));
    expect(result.current.groups[1].category).toBe("Renamed");
    expect(result.current.groups[1].hintWord).toBe("other");
  });

  it("the saved payload carries the literal value and never derives it from the name", () => {
    const payload = buildContentPayload({
      groups: [
        { category: "Songs 🎵", words: ["A", "B", "C", "D"], difficulty: 1, hintWord: null, categoryEmoji: "___ 💬" },
        { category: "Cars 🚘", words: ["E", "F", "G", "H"], difficulty: 2, hintWord: null },
        { category: "Plain", words: ["I", "J", "K", "L"], difficulty: 3, hintWord: null, categoryEmoji: "   " },
        { category: "Custom", words: ["M", "N", "O", "P"], difficulty: 4, hintWord: null, categoryEmoji: ":caveman:" },
      ],
      wordOrder: null,
      rainbowHerring: null,
      rainbowCategoryName: "Mixed",
      rainbowHintWord: null,
      rainbowCategoryEmoji: " 🌈 ",
      theme: null,
      isEmojiPuzzle: false,
      alphabetizeCompleted: true,
    });
    expect(payload.groups.map((g) => g.category_emoji)).toEqual(["___ 💬", null, null, ":caveman:"]);
    expect(payload.groups[0].category).toBe("Songs 🎵"); // the title is left alone
    expect(payload.rainbow_category_emoji).toBe("🌈");
  });

  it("moves with its category when categories are reordered", () => {
    const { result } = filled();
    act(() => {
      result.current.updateCategoryEmoji(0, "🟡");
      result.current.updateCategoryEmoji(3, "🔴");
    });
    act(() => result.current.moveGroup(0, 3));
    expect(result.current.groups.map((g) => g.categoryEmoji)).toEqual(["", "", "🔴", "🟡"]);
    expect(result.current.groups.map((g) => g.difficulty)).toEqual([1, 2, 3, 4]);
  });

  it("Start Over (reset) clears every category emoji and the Rainbow one", () => {
    const { result } = filled();
    act(() => {
      result.current.groups.forEach((_, i) => result.current.updateCategoryEmoji(i, `e${i}`));
      result.current.setRainbowCategoryEmoji("🌈");
    });
    expect(result.current.rainbowCategoryEmoji).toBe("🌈");
    act(() => result.current.reset());
    expect(result.current.groups.every((g) => g.categoryEmoji === "")).toBe(true);
    expect(result.current.rainbowCategoryEmoji).toBe("");
  });

  it("load reads saved emoji, and older sources (no field) load as empty", () => {
    const { result } = renderHook(() => useBuilderForm());
    const groups = WORDS.map((w, i) => ({ category: `C${i}`, words: w, difficulty: (i + 1) as 1 | 2 | 3 | 4, hintWord: null }));
    act(() =>
      result.current.load({
        groups: groups.map((g, i) => ({ ...g, categoryEmoji: i === 0 ? "___ 💬" : null })),
        wordOrder: null, rainbowHerring: null, rainbowCategoryName: "", rainbowHintWord: "",
        rainbowCategoryEmoji: "🌈", theme: "", alphabetizeCompleted: true,
      })
    );
    expect(result.current.groups.map((g) => g.categoryEmoji)).toEqual(["___ 💬", "", "", ""]);
    expect(result.current.rainbowCategoryEmoji).toBe("🌈");
    act(() =>
      result.current.load({
        groups, wordOrder: null, rainbowHerring: null, rainbowCategoryName: "", rainbowHintWord: "",
        theme: "", alphabetizeCompleted: true,
      })
    );
    expect(result.current.groups.every((g) => g.categoryEmoji === "")).toBe(true);
    expect(result.current.rainbowCategoryEmoji).toBe("");
  });
});

describe("draft persistence", () => {
  beforeEach(() => localStorage.clear());

  const draft = (over: Partial<DraftData> = {}): DraftData => ({
    puzzleDate: "2026-10-01", puzzleTitle: "T", designerName: "D",
    groups: WORDS.map((w, i) => ({ category: `C${i}`, words: w.join(", "), difficulty: (i + 1) as 1 | 2 | 3 | 4, hintWord: "", categoryEmoji: i === 2 ? "___ 💬" : "" })),
    isPublished: false, isBeta: false, wordOrder: [], rainbowHerring: [], rainbowCategoryName: "", rainbowHintWord: "",
    rainbowCategoryEmoji: "🌈", rainbowWordOrder: [], theme: "", isEmojiPuzzle: false, emojiPuzzleIcon: "",
    isFreePuzzle: false, freePuzzleOrder: null, alphabetizeCompleted: true, editingId: null, ...over,
  });

  it("round-trips the literal values through the saved draft", () => {
    const d = draft();
    const applied: DraftData[] = [];
    const view = renderHook(() =>
      useDraftPersistence({ enabled: true, editingId: null, values: d, applyDraft: (x) => applied.push(x) })
    );
    act(() => view.result.current.handleBlurSave());
    view.unmount();
    const restored: DraftData[] = [];
    renderHook(() => useDraftPersistence({ enabled: true, editingId: null, values: d, applyDraft: (x) => restored.push(x) }));
    expect(restored).toHaveLength(1);
    expect(restored[0].groups[2].categoryEmoji).toBe("___ 💬");
    expect(restored[0].rainbowCategoryEmoji).toBe("🌈");
  });

  it("a draft saved before the field existed still loads (empty emoji, nothing derived)", () => {
    const old = draft() as unknown as Record<string, unknown>;
    delete old.rainbowCategoryEmoji;
    (old.groups as Record<string, unknown>[]).forEach((g) => delete g.categoryEmoji);
    localStorage.setItem("admin-puzzle-draft", JSON.stringify(old));
    const restored: DraftData[] = [];
    renderHook(() => useDraftPersistence({ enabled: true, editingId: null, values: draft(), applyDraft: (x) => restored.push(x) }));
    const { result } = renderHook(() => useBuilderForm());
    act(() =>
      result.current.load({
        groups: restored[0].groups.map((g) => ({
          category: g.category, words: g.words.split(", "), difficulty: g.difficulty, hintWord: g.hintWord, categoryEmoji: g.categoryEmoji ?? "",
        })),
        wordOrder: [], rainbowHerring: null, rainbowCategoryName: "", rainbowHintWord: "",
        rainbowCategoryEmoji: restored[0].rainbowCategoryEmoji ?? "", theme: "", alphabetizeCompleted: true,
      })
    );
    expect(result.current.groups.every((g) => g.categoryEmoji === "")).toBe(true);
    expect(result.current.rainbowCategoryEmoji).toBe("");
  });
});

describe("saved and versioned puzzle content (Admin path)", () => {
  const meta = { date: "2026-10-01", title: "Emoji Test", is_published: false };
  const content = (over: Record<string, unknown> = {}, emoji: Record<number, string> = {}, rainbow?: string) => ({
    groups: WORDS.map((w, i) => ({
      category: `Cat ${i} 🚘`, words: w.map((x) => x.toUpperCase()), difficulty: i + 1, hint_word: null, sort_order: i,
      category_emoji: emoji[i] ?? null,
    })),
    word_order: null, rainbow_herring: null, rainbow_category_name: null, rainbow_hint_word: null,
    rainbow_category_emoji: rainbow ?? null, theme: null, is_emoji_puzzle: false, alphabetize_completed: true,
    ...over,
  });

  beforeEach(() => {
    for (const t of ["puzzles", "puzzle_groups", "puzzle_versions"]) db.tables[t] = [];
    db.signIn("admin-1", { admin: true });
  });

  it("stores literal values on the group rows and the Rainbow, and versions on change", async () => {
    const first = await db.rpc("admin_save_puzzle", {
      _puzzle_id: null, _metadata: meta, _content: content({}, { 0: "___ 💬", 2: ":caveman:" }, "🌈"),
    });
    const id = (first.data as { puzzle_id: string }).puzzle_id;
    const rows = db.tables.puzzle_groups.filter((g) => g.puzzle_id === id).sort((a, b) => Number(a.sort_order) - Number(b.sort_order));
    expect(rows.map((r) => r.category_emoji)).toEqual(["___ 💬", null, ":caveman:", null]);
    expect(rows[0].category).toBe("Cat 0 🚘"); // title kept whole, separate from the emoji
    expect(db.tables.puzzles[0].rainbow_category_emoji).toBe("🌈");

    // Unchanged re-save: no new version.
    const same = await db.rpc("admin_save_puzzle", { _puzzle_id: id, _metadata: meta, _content: content({}, { 0: "___ 💬", 2: ":caveman:" }, "🌈") });
    expect((same.data as { created_version: boolean }).created_version).toBe(false);
    // Changing only an emoji is a gameplay change: a new version.
    const changed = await db.rpc("admin_save_puzzle", { _puzzle_id: id, _metadata: meta, _content: content({}, { 0: "🎵", 2: ":caveman:" }, "🌈") });
    expect((changed.data as { created_version: boolean }).created_version).toBe(true);
  });

  it("an older puzzle (no emoji) canonicalises unchanged: re-saving it does not create a version", async () => {
    const legacy = content();
    for (const g of legacy.groups as Record<string, unknown>[]) delete g.category_emoji;
    delete (legacy as Record<string, unknown>).rainbow_category_emoji;
    const first = await db.rpc("admin_save_puzzle", { _puzzle_id: null, _metadata: meta, _content: legacy });
    const id = (first.data as { puzzle_id: string }).puzzle_id;
    // The builder always sends explicit nulls; that must still equal the old canonical form.
    const resave = await db.rpc("admin_save_puzzle", { _puzzle_id: id, _metadata: meta, _content: content() });
    expect((resave.data as { created_version: boolean }).created_version).toBe(false);
    expect(JSON.stringify(db.tables.puzzle_versions[0].content)).not.toContain("category_emoji");
  });

  it("rejects an over-long Category Emoji", async () => {
    const res = await db.rpc("admin_save_puzzle", { _puzzle_id: null, _metadata: meta, _content: content({}, { 1: "x".repeat(41) }) });
    expect(res.error).toBeTruthy();
  });

  it("the pinned snapshot keeps each category's explicit emoji", () => {
    const puzzle: Puzzle = {
      id: "p", date: "", designerName: "d", versionId: "v1", alphabetizeCompleted: true,
      groups: [{ category: "A 🚘", words: ["a", "b", "c", "d"], difficulty: 1, categoryEmoji: "___ 💬" }, ...WORDS.slice(1).map((w, i) => ({ category: `C${i}`, words: w, difficulty: (i + 2) as 2 | 3 | 4 }))],
      rainbowHerring: ["a", "e", "i", "m"], rainbowCategoryName: "R", rainbowCategoryEmoji: "🌈",
    };
    const pinned = pinnedContentFrom(puzzle)!;
    const rebuilt = applyPinnedContent({ ...puzzle, versionId: "v2" }, pinned);
    expect(rebuilt.groups[0].categoryEmoji).toBe("___ 💬");
    expect(rebuilt.rainbowCategoryEmoji).toBe("🌈");
    // A snapshot written before the field existed still rebuilds.
    const oldSnap = JSON.parse(JSON.stringify(pinned));
    delete oldSnap.rainbowCategoryEmoji;
    oldSnap.groups.forEach((g: Record<string, unknown>) => delete g.categoryEmoji);
    expect(applyPinnedContent(puzzle, oldSnap).groups[0].categoryEmoji).toBeUndefined();
  });
});

describe("custom puzzles", () => {
  beforeEach(() => {
    db.tables.custom_puzzles = [];
    db.signIn(null);
  });

  it("stores and returns each category's emoji and the Rainbow's, literally", async () => {
    const { shareId } = await createCustomPuzzle({
      creatorName: "Sam", title: "Emoji", visibility: "public",
      content: {
        mode: "rainbow",
        groups: WORDS.map((w, i) => ({
          category: `Cat ${i} 🚘`, words: w.map((x) => x.toUpperCase()), hintWord: null,
          categoryEmoji: i === 1 ? "___ 💬" : i === 2 ? ":caveman:" : null,
        })),
        wordOrder: WORDS.flat().map((x) => x.toUpperCase()),
        rainbowHerring: ["BLUE", "TIRE", "SWIFT", "TREE"], rainbowCategoryName: "Mixed", rainbowHintWord: null,
        rainbowCategoryEmoji: "🌈", alphabetizeCompleted: true,
      },
    });
    const { puzzle } = (await getCustomPuzzleByShareId(shareId))!;
    expect(puzzle.groups.map((g) => g.categoryEmoji)).toEqual([null, "___ 💬", ":caveman:", null]);
    expect(puzzle.groups[1].category).toBe("Cat 1 🚘");
    expect(puzzle.rainbowCategoryEmoji).toBe("🌈");
  });
});

describe("Full Hint display", () => {
  const puzzle = (overrides: Partial<Puzzle["groups"][number]>[]): Puzzle => ({
    id: "fx", date: "", designerName: "d", alphabetizeCompleted: true,
    groups: WORDS.map((w, i) => ({ category: `Cat ${"ABCD"[i]} 🚘`, words: w.map((x) => x.toUpperCase()), difficulty: (i + 1) as 1 | 2 | 3 | 4, ...(overrides[i] ?? {}) })),
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

  it("shows the explicit value exactly (\"___ 💬\", not \"💬\") and never the title's emoji when one is set", async () => {
    board(puzzle([{ categoryEmoji: "___ 💬" }, { categoryEmoji: "🎵" }, {}, {}]));
    await screen.findAllByTestId("hint-visual");
    expect(visuals()).toEqual(["___ 💬", "🎵", "🚘", "🚘"]);
  });

  it("older puzzles (no explicit value) keep the title-emoji fallback", async () => {
    board(puzzle([]));
    await screen.findAllByTestId("hint-visual");
    expect(visuals()).toEqual(["🚘", "🚘", "🚘", "🚘"]);
  });

  it("draws a custom emoji code as an image and the rest as literal text", async () => {
    board(puzzle([{ categoryEmoji: "___ :caveman:" }, {}, {}, {}]));
    const [first] = await screen.findAllByTestId("hint-visual");
    expect(first.textContent).toBe("___ ");
    const img = within(first).getByRole("img") as HTMLImageElement;
    expect(img.alt).toBe("caveman");
    expect(img.src).toContain("caveman");
  });
});

describe("/create builder page", () => {
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
      const [name, emoji, answers, hint] = within(card).getAllByRole("textbox") as HTMLInputElement[];
      fireEvent.change(name, { target: { value: `Cat ${i}` } });
      fireEvent.change(emoji, { target: { value: `e${i}` } });
      fireEvent.change(answers, { target: { value: WORDS[i].join(", ") } });
      fireEvent.change(hint, { target: { value: `hint${i}` } });
    });
  }

  it("shows Category Emoji (optional) with its helper on every standard category and the Rainbow", () => {
    renderCreate();
    fill();
    for (const card of cards()) {
      expect(within(card).getByText(LABEL)).toBeTruthy();
      expect(within(card).getByText(HELPER)).toBeTruthy();
    }
    // Rainbow is the default style and appears once all 16 answers exist.
    expect(screen.getAllByText(LABEL)).toHaveLength(5);
    expect(screen.getAllByText(HELPER)).toHaveLength(5);
  });

  it("accepts emoji, short text, underscores and codes as typed, keeping the three fields independent", () => {
    renderCreate();
    const card = cards()[0];
    const [name, emoji, , hint] = within(card).getAllByRole("textbox") as HTMLInputElement[];
    fireEvent.change(name, { target: { value: "Songs 🎵" } });
    fireEvent.change(emoji, { target: { value: "___ 💬" } });
    fireEvent.change(hint, { target: { value: "Encore" } });
    expect(name.value).toBe("Songs 🎵");
    expect(emoji.value).toBe("___ 💬");
    expect(hint.value).toBe("Encore");
    fireEvent.change(emoji, { target: { value: ":caveman:" } });
    expect(emoji.value).toBe(":caveman:");
    expect(name.value).toBe("Songs 🎵");
    expect(hint.value).toBe("Encore");
  });

  it("Start Over clears every Category Emoji, including the Rainbow's", async () => {
    renderCreate();
    fill();
    const rainbowInput = () =>
      screen.getAllByText(LABEL).map((l) => l.parentElement!.querySelector("input")!).slice(-1)[0] as HTMLInputElement;
    fireEvent.change(rainbowInput(), { target: { value: "🌈" } });
    expect(rainbowInput().value).toBe("🌈");

    fireEvent.click(screen.getByRole("button", { name: "Start Over" }));
    fireEvent.click(await screen.findByRole("button", { name: "Yes, start over" }));
    for (const card of cards()) {
      (within(card).getAllByRole("textbox") as HTMLInputElement[]).forEach((i) => expect(i.value).toBe(""));
    }
    expect(screen.getAllByText(LABEL)).toHaveLength(4); // Rainbow panel hides again until 16 answers exist
  });
});
