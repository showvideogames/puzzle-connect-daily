/**
 * Save-time answer normalization: every standard-category answer is
 * uppercased (Unicode-safe, via toUpperCase — deliberately NOT
 * toLocaleUpperCase, so a canonical stored answer never varies with the
 * admin device's locale) before it is ever sent to the server, for both
 * Full and Mini, through both Admin and /create.
 *
 * What this deliberately does NOT do: reorder the stored answers. There is a
 * separate, purely-display-time "Automatically alphabetize answers in
 * completed categories" setting (Puzzle.alphabetizeCompleted, default true —
 * see SolvedGroup.tsx and RainbowRevealBar.tsx) that sorts for display only.
 * Storage always keeps the author's typed order. Category names, Category
 * Emoji, Small Hints, and the Rainbow's own name/hint are never uppercased.
 */
import { describe, it, expect, beforeEach, vi } from "vitest";
import { act, renderHook } from "@testing-library/react";
import { FakeSupabase } from "./fakeSupabase";

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
import { normalizeWord } from "@/lib/builder/wordNormalization";
import { parseWords, buildContentPayload, builderContentInput } from "@/lib/builder/contentPayload";
import { createCustomPuzzle, getCustomPuzzleByShareId } from "@/lib/customPuzzles";

describe("normalizeWord / parseWords: deterministic, locale-independent uppercasing", () => {
  it("uppercases a multiword answer", () => {
    expect(normalizeWord("click mesh")).toBe("CLICK MESH");
  });

  it("uppercases a hyphenated answer, keeping the hyphens", () => {
    expect(normalizeWord("jack-in-the-box")).toBe("JACK-IN-THE-BOX");
  });

  it("uppercases around punctuation without altering it", () => {
    expect(normalizeWord("don't stop")).toBe("DON'T STOP");
    expect(normalizeWord("rock 'n' roll")).toBe("ROCK 'N' ROLL");
    expect(normalizeWord("mother-in-law's")).toBe("MOTHER-IN-LAW'S");
  });

  it("uppercases Unicode letters correctly", () => {
    expect(normalizeWord("café")).toBe("CAFÉ");
    expect(normalizeWord("über")).toBe("ÜBER");
    expect(normalizeWord("naïve")).toBe("NAÏVE");
    expect(normalizeWord("straße")).toBe("STRASSE");
  });

  it("uses the locale-independent mapping for 'i', not the Turkish dotted/dotless variant — a canonical answer must not depend on the admin's device locale", () => {
    // toLocaleUpperCase() under a Turkish locale would map "i" -> "İ"
    // (dotted capital I). toUpperCase() always maps it to plain "I",
    // regardless of the runtime's configured locale.
    expect(normalizeWord("island")).toBe("ISLAND");
    expect(normalizeWord("i")).toBe("I");
  });

  it("trims surrounding whitespace as part of normalizing", () => {
    expect(normalizeWord("  click mesh  ")).toBe("CLICK MESH");
  });

  it("still lowercases custom emoji (img:) references instead of uppercasing them", () => {
    expect(normalizeWord("img:Caveman")).toBe("img:caveman");
  });

  it("parseWords uppercases every comma-separated answer and preserves authored order (no alphabetizing)", () => {
    // A deliberately non-alphabetical author order.
    expect(parseWords("gel, vibe, click mesh")).toEqual(["GEL", "VIBE", "CLICK MESH"]);
  });
});

describe("buildContentPayload: what actually gets saved", () => {
  it("uppercases answers but leaves the category name, hint, and Category Emoji untouched", () => {
    const payload = buildContentPayload({
      groups: [
        {
          category: "click mesh things",
          words: parseWords("gel, vibe, click mesh, jack-in-the-box"),
          difficulty: 1,
          hintWord: "not a real answer",
          categoryEmoji: "🎵",
        },
        { category: "Cars", words: parseWords("café, über, naïve, résumé"), difficulty: 2, hintWord: null },
        { category: "Plain", words: parseWords("A, B, C, D"), difficulty: 3, hintWord: null },
        { category: "Plain 2", words: parseWords("E, F, G, H"), difficulty: 4, hintWord: null },
      ],
      wordOrder: null,
      rainbowHerring: null,
      rainbowCategoryName: "Mixed Bag",
      rainbowHintWord: "not uppercased either",
      rainbowCategoryEmoji: "🌈",
      theme: null,
      isEmojiPuzzle: false,
      alphabetizeCompleted: true,
    });
    // Answers: uppercase, authored order preserved (NOT alphabetized).
    expect(payload.groups[0].words).toEqual(["GEL", "VIBE", "CLICK MESH", "JACK-IN-THE-BOX"]);
    expect(payload.groups[1].words).toEqual(["CAFÉ", "ÜBER", "NAÏVE", "RÉSUMÉ"]);
    // Category name, hint, and Category Emoji are left exactly as authored.
    expect(payload.groups[0].category).toBe("click mesh things");
    expect(payload.groups[0].hint_word).toBe("not a real answer");
    expect(payload.groups[0].category_emoji).toBe("🎵");
    expect(payload.rainbow_category_name).toBe("Mixed Bag");
    expect(payload.rainbow_hint_word).toBe("not uppercased either");
    expect(payload.rainbow_category_emoji).toBe("🌈");
  });
});

describe("Admin save path (real builder hook, Full and Mini)", () => {
  beforeEach(() => {
    for (const t of ["puzzles", "puzzle_groups", "puzzle_versions"]) db.tables[t] = [];
    db.signIn("admin-1", { admin: true });
  });

  function type(result: { current: ReturnType<typeof useBuilderForm> }, i: number, name: string, answers: string) {
    act(() => {
      result.current.updateCategoryName(i, name);
      result.current.updateAnswersRaw(i, answers);
    });
  }

  it("Full: saves every answer uppercase, in authored order, with the category title unchanged", async () => {
    const { result } = renderHook(() => useBuilderForm("full"));
    type(result, 0, "click mesh things", "gel, vibe, click mesh, jack-in-the-box");
    type(result, 1, "Accents", "café, über, naïve, résumé");
    type(result, 2, "Punctuation", "don't stop, rock 'n' roll, y'all, ma'am");
    type(result, 3, "Plain", "one, two, three, four");
    act(() => {
      result.current.selectRainbowAnswer(0, result.current.groups[0].answers[0].id); // "gel"
      result.current.selectRainbowAnswer(1, result.current.groups[1].answers[0].id);
      result.current.selectRainbowAnswer(2, result.current.groups[2].answers[0].id);
      result.current.selectRainbowAnswer(3, result.current.groups[3].answers[0].id);
    });
    expect(result.current.rainbowComplete).toBe(true);

    const payload = buildContentPayload(builderContentInput(result.current, false));
    expect(payload.groups[0].words).toEqual(["GEL", "VIBE", "CLICK MESH", "JACK-IN-THE-BOX"]);
    expect(payload.groups[0].category).toBe("click mesh things"); // never uppercased
    expect(payload.groups[2].words).toEqual(["DON'T STOP", "ROCK 'N' ROLL", "Y'ALL", "MA'AM"]);
    // Rainbow references the SAME normalized text as its source answer — no
    // second, independently-cased copy of it.
    expect(payload.rainbow_herring).toContain("GEL");

    const res = await db.rpc("admin_save_puzzle", {
      _puzzle_id: null,
      _metadata: { date: "2026-10-02", title: "Norm Test", is_published: false },
      _content: payload,
    });
    const id = (res.data as { puzzle_id: string }).puzzle_id;
    const rows = db.tables.puzzle_groups
      .filter((g) => g.puzzle_id === id)
      .sort((a, b) => Number(a.sort_order) - Number(b.sort_order));
    expect(rows[0].words).toEqual(["GEL", "VIBE", "CLICK MESH", "JACK-IN-THE-BOX"]);
    expect(rows[0].category).toBe("click mesh things");

    // Re-saving unchanged content is idempotent: no new version.
    const resave = await db.rpc("admin_save_puzzle", {
      _puzzle_id: id,
      _metadata: { date: "2026-10-02", title: "Norm Test", is_published: false },
      _content: buildContentPayload(builderContentInput(result.current, false)),
    });
    expect((resave.data as { created_version: boolean }).created_version).toBe(false);
    // Running normalization again (re-typing the same content) is also a no-op.
    type(result, 0, "click mesh things", "gel, vibe, click mesh, jack-in-the-box");
    const resaveAgain = await db.rpc("admin_save_puzzle", {
      _puzzle_id: id,
      _metadata: { date: "2026-10-02", title: "Norm Test", is_published: false },
      _content: buildContentPayload(builderContentInput(result.current, false)),
    });
    expect((resaveAgain.data as { created_version: boolean }).created_version).toBe(false);
  });

  it("Mini: saves every answer uppercase, in authored order, with the category title unchanged", async () => {
    const { result } = renderHook(() => useBuilderForm("mini"));
    type(result, 0, "click mesh things", "gel, vibe, click mesh");
    type(result, 1, "Accents", "café, über, naïve");
    type(result, 2, "Plain", "one, two, three");
    act(() => {
      result.current.selectRainbowAnswer(0, result.current.groups[0].answers[0].id);
      result.current.selectRainbowAnswer(1, result.current.groups[1].answers[0].id);
      result.current.selectRainbowAnswer(2, result.current.groups[2].answers[0].id);
    });
    expect(result.current.rainbowComplete).toBe(true);

    const payload = buildContentPayload(builderContentInput(result.current, false));
    expect(payload.format).toBe("mini");
    expect(payload.groups[0].words).toEqual(["GEL", "VIBE", "CLICK MESH"]);
    expect(payload.groups[0].category).toBe("click mesh things");
    expect(payload.groups[1].words).toEqual(["CAFÉ", "ÜBER", "NAÏVE"]);
    expect(payload.rainbow_herring).toContain("CAFÉ");

    const res = await db.rpc("admin_save_puzzle", {
      _puzzle_id: null,
      _metadata: { date: "2026-10-03", title: "Mini Norm Test", is_published: false },
      _content: payload,
    });
    const id = (res.data as { puzzle_id: string }).puzzle_id;
    const rows = db.tables.puzzle_groups
      .filter((g) => g.puzzle_id === id)
      .sort((a, b) => Number(a.sort_order) - Number(b.sort_order));
    expect(rows[0].words).toEqual(["GEL", "VIBE", "CLICK MESH"]);
  });
});

describe("/create save path (real builder hook, Full and Mini)", () => {
  beforeEach(() => {
    db.tables.custom_puzzles = [];
    db.signIn(null);
  });

  it("Full: stores uppercase answers, authored order, unchanged category title, correct Rainbow identity", async () => {
    const { result } = renderHook(() => useBuilderForm("full"));
    act(() => {
      result.current.updateCategoryName(0, "click mesh things");
      result.current.updateAnswersRaw(0, "gel, vibe, click mesh, jack-in-the-box");
      result.current.updateCategoryName(1, "Accents");
      result.current.updateAnswersRaw(1, "café, über, naïve, résumé");
      result.current.updateCategoryName(2, "Punctuation");
      result.current.updateAnswersRaw(2, "don't stop, rock 'n' roll, y'all, ma'am");
      result.current.updateCategoryName(3, "Plain");
      result.current.updateAnswersRaw(3, "one, two, three, four");
    });
    act(() => {
      result.current.selectRainbowAnswer(0, result.current.groups[0].answers[0].id); // "gel"
      result.current.selectRainbowAnswer(1, result.current.groups[1].answers[0].id);
      result.current.selectRainbowAnswer(2, result.current.groups[2].answers[0].id);
      result.current.selectRainbowAnswer(3, result.current.groups[3].answers[0].id);
    });
    expect(result.current.rainbowComplete).toBe(true);

    const input = builderContentInput(result.current, false);
    const { shareId } = await createCustomPuzzle({
      creatorName: "Sam",
      title: "Norm Test",
      visibility: "public",
      content: {
        mode: "rainbow",
        groups: input.groups.map((g) => ({ category: g.category, words: g.words, hintWord: g.hintWord, categoryEmoji: g.categoryEmoji })),
        wordOrder: input.wordOrder!,
        rainbowHerring: input.rainbowHerring,
        rainbowCategoryName: input.rainbowCategoryName,
        rainbowHintWord: input.rainbowHintWord,
        rainbowCategoryEmoji: input.rainbowCategoryEmoji,
        alphabetizeCompleted: input.alphabetizeCompleted,
      },
    });

    const { puzzle } = (await getCustomPuzzleByShareId(shareId))!;
    expect(puzzle.groups[0].words).toEqual(["GEL", "VIBE", "CLICK MESH", "JACK-IN-THE-BOX"]);
    expect(puzzle.groups[0].category).toBe("click mesh things"); // never uppercased
    expect(puzzle.groups[2].words).toEqual(["DON'T STOP", "ROCK 'N' ROLL", "Y'ALL", "MA'AM"]);
    // The Rainbow references the same normalized answer, not a re-typed copy.
    expect(puzzle.rainbowHerring).toContain("GEL");
    expect(puzzle.groups[0].words).toContain("GEL");
  });

  it("Mini: stores uppercase answers, authored order, unchanged category title", async () => {
    // Custom (/create) Minis cannot be Rainbow puzzles yet (mirrors
    // validate_custom_puzzle_content) — Classic mode is the supported path.
    const { result } = renderHook(() => useBuilderForm("mini"));
    act(() => {
      result.current.setStyle("classic");
      result.current.updateCategoryName(0, "click mesh things");
      result.current.updateAnswersRaw(0, "gel, vibe, click mesh");
      result.current.updateCategoryName(1, "Accents");
      result.current.updateAnswersRaw(1, "café, über, naïve");
      result.current.updateCategoryName(2, "Plain");
      result.current.updateAnswersRaw(2, "one, two, three");
    });

    const input = builderContentInput(result.current, false);
    const { shareId } = await createCustomPuzzle({
      creatorName: "Sam",
      title: "Mini Norm Test",
      visibility: "public",
      content: {
        format: "mini",
        mode: "classic",
        groups: input.groups.map((g) => ({ category: g.category, words: g.words, hintWord: g.hintWord, categoryEmoji: g.categoryEmoji })),
        wordOrder: input.wordOrder!,
        rainbowHerring: null,
        rainbowCategoryName: null,
        rainbowHintWord: null,
        rainbowCategoryEmoji: null,
        alphabetizeCompleted: input.alphabetizeCompleted,
      },
    });

    const { puzzle } = (await getCustomPuzzleByShareId(shareId))!;
    expect(puzzle.groups[0].words).toEqual(["GEL", "VIBE", "CLICK MESH"]);
    expect(puzzle.groups[0].category).toBe("click mesh things");
    expect(puzzle.groups[1].words).toEqual(["CAFÉ", "ÜBER", "NAÏVE"]);
  });
});
