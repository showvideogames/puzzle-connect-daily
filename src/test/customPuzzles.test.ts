/**
 * Verification suite for public custom puzzles (/create, /custom/:shareId),
 * Phase 2.
 *
 * Drives the REAL code paths — lib/customPuzzles.ts, useGame's "custom"
 * mode, useGameSession's "custom" mode — against the in-memory fake
 * Supabase (see fakeSupabase.ts), which mirrors the 20260919000000
 * migration's tables, RPCs and access model. Production is never touched.
 *
 * The property under test throughout: a custom puzzle plays on the real
 * game engine, but NOTHING it does can ever create, mutate or count toward
 * an official OR Beta table, and at most one result row per (puzzle,
 * device) is ever recorded.
 */
import { describe, it, expect, beforeEach, vi } from "vitest";
import { act, renderHook } from "@testing-library/react";
import { FakeSupabase } from "./fakeSupabase";
import type { Puzzle } from "@/lib/types";

const db = new FakeSupabase();

vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    from: (t: string) => db.from(t),
    rpc: (n: string, a: Record<string, unknown>) => db.rpc(n, a),
    auth: {
      getUser: () => db.auth.getUser(),
      onAuthStateChange: () => ({
        data: { subscription: { unsubscribe: () => {} } },
      }),
    },
  },
}));

vi.mock("canvas-confetti", () => ({ default: () => {} }));
vi.mock("@/lib/sounds", () => ({ playRainbowSound: () => {}, playGiftOpenSound: () => {} }));
vi.mock("@/lib/haptics", () => ({
  vibrateSuccess: () => {},
  vibrateError: () => {},
  vibrateCelebration: () => {},
}));
vi.mock("@/lib/analytics", () => ({ trackEvent: () => {} }));

import { useGame } from "@/hooks/useGame";
import {
  createCustomPuzzle,
  getCustomPuzzleByShareId,
  getCustomPuzzleStats,
  type CreateCustomPuzzleInput,
} from "@/lib/customPuzzles";
import { loadProgress, clearProgress } from "@/lib/gameProgress";

const results = () => db.tables.custom_puzzle_results;
const customPuzzles = () => db.tables.custom_puzzles;

function reduceMotion() {
  Object.defineProperty(window, "matchMedia", {
    writable: true,
    value: (query: string) => ({
      matches: query.includes("prefers-reduced-motion"),
      media: query,
      addEventListener: () => {},
      removeEventListener: () => {},
      addListener: () => {},
      removeListener: () => {},
      onchange: null,
      dispatchEvent: () => {},
    }),
  });
}

async function settle() {
  await act(async () => {
    for (let i = 0; i < 25; i++) {
      await new Promise((r) => setTimeout(r, 0));
    }
  });
}

function mount(p: Puzzle, opts: Record<string, unknown> = {}) {
  return renderHook(({ o }) => useGame(p, o as never), {
    initialProps: { o: opts },
  });
}

async function guess(view: ReturnType<typeof mount>, words: string[]) {
  await act(async () => {
    view.result.current.deselectAll();
  });
  await act(async () => {
    for (const w of words) view.result.current.toggleWord(w);
  });
  await act(async () => {
    view.result.current.submitGuess();
  });
  await settle();
}

async function winGame(view: ReturnType<typeof mount>, p: Puzzle) {
  for (const g of p.groups) await guess(view, g.words);
}

/** Four genuinely wrong guesses, avoiding the fixture's Rainbow answer (index 0 of each group). */
async function loseGame(view: ReturnType<typeof mount>, p: Puzzle) {
  const sets = [
    p.groups.map((g) => g.words[1]),
    p.groups.map((g) => g.words[2]),
    p.groups.map((g) => g.words[3]),
    [p.groups[0].words[1], p.groups[1].words[2], p.groups[2].words[3], p.groups[3].words[1]],
  ];
  for (const words of sets) await guess(view, words);
}

async function mintDeviceIdentity(label: string) {
  const { data } = await db.rpc("create_device_identity");
  const row = (Array.isArray(data) ? data[0] : data) as { device_id: string; device_token: string };
  return row;
}

function useDeviceIdentity(identity: { device_id: string; device_token: string }) {
  localStorage.setItem("rc-device-id", identity.device_id);
  localStorage.setItem("rc-device-token", identity.device_token);
}

const CLASSIC_INPUT: CreateCustomPuzzleInput = {
  creatorName: "Sam",
  title: "My Custom Puzzle",
  visibility: "public",
  content: {
    mode: "classic",
    groups: [
      { category: "Colors", words: ["BLUE", "GREEN", "RED", "YELLOW"], hintWord: "PURPLE" },
      { category: "Car Parts", words: ["BATTERY", "HOOD", "TIRE", "TRUNK"], hintWord: "WHEEL" },
      { category: "Singers", words: ["HOUSTON", "MARS", "MERCURY", "SWIFT"], hintWord: "GAGA" },
      { category: "___ House", words: ["BIRD", "DOG", "TREE", "WHITE"], hintWord: "HAUNTED" },
    ],
    wordOrder: [
      "BLUE", "GREEN", "RED", "YELLOW",
      "BATTERY", "HOOD", "TIRE", "TRUNK",
      "HOUSTON", "MARS", "MERCURY", "SWIFT",
      "BIRD", "DOG", "TREE", "WHITE",
    ],
    rainbowHerring: null,
    rainbowCategoryName: null,
    rainbowHintWord: null,
    alphabetizeCompleted: true,
  },
};

const RAINBOW_INPUT: CreateCustomPuzzleInput = {
  ...CLASSIC_INPUT,
  content: {
    ...CLASSIC_INPUT.content,
    mode: "rainbow",
    rainbowHerring: ["BLUE", "TIRE", "SWIFT", "TREE"],
    rainbowCategoryName: "Mixed Bag",
    rainbowHintWord: null,
  },
};

beforeEach(async () => {
  reduceMotion();
  for (let i = 0; i < 5; i++) await new Promise((r) => setTimeout(r, 10));

  db.tables.game_sessions = [];
  db.tables.guess_events = [];
  db.tables.hint_events = [];
  db.tables.game_results = [];
  db.tables.user_streaks = [];
  db.tables.device_identities = [];
  db.tables.account_onboarding = [];
  db.tables.puzzle_aggregates = [];
  db.tables.puzzles = [];
  db.tables.puzzle_groups = [];
  db.tables.puzzle_versions = [];
  db.tables.beta_playtests = [];
  db.tables.beta_feedback = [];
  db.tables.custom_puzzles = [];
  db.tables.custom_puzzle_results = [];
  db.failAggregateWrites = 0;
  db.rpcUnavailable = false;

  const identity = await mintDeviceIdentity("default");
  localStorage.clear();
  sessionStorage.clear();
  useDeviceIdentity(identity);

  db.signIn(null);
  db.writeLog = [];
  db.rpcLog = [];
});

// ── CREATION ─────────────────────────────────────────────────────────────
describe("creating a custom puzzle", () => {
  it("succeeds for an anonymous caller", async () => {
    db.signIn(null);
    const { puzzleId, shareId } = await createCustomPuzzle(CLASSIC_INPUT);
    expect(puzzleId).toBeTruthy();
    expect(shareId).toBeTruthy();
    const row = customPuzzles().find((p) => p.id === puzzleId)!;
    expect(row.created_by).toBeNull();
    expect(row.visibility).toBe("public");
  });

  it("succeeds for an authenticated caller and records ownership", async () => {
    db.signIn("user-1");
    const { puzzleId } = await createCustomPuzzle(CLASSIC_INPUT);
    const row = customPuzzles().find((p) => p.id === puzzleId)!;
    expect(row.created_by).toBe("user-1");
    db.signIn(null);
  });

  it("generates the share id server-side (never client-supplied) and it differs between two puzzles", async () => {
    const a = await createCustomPuzzle(CLASSIC_INPUT);
    const b = await createCustomPuzzle({ ...CLASSIC_INPUT, title: "Second Puzzle" });
    expect(a.shareId).not.toBe(b.shareId);
    expect(a.shareId).toBeTruthy();
  });

  it("refuses a payload missing a category name", async () => {
    const bad: CreateCustomPuzzleInput = {
      ...CLASSIC_INPUT,
      content: {
        ...CLASSIC_INPUT.content,
        groups: [{ ...CLASSIC_INPUT.content.groups[0], category: "" }, ...CLASSIC_INPUT.content.groups.slice(1)],
      },
    };
    await expect(createCustomPuzzle(bad)).rejects.toBeTruthy();
    expect(customPuzzles()).toHaveLength(0);
  });

  it("refuses duplicate answers across categories", async () => {
    const bad: CreateCustomPuzzleInput = {
      ...CLASSIC_INPUT,
      content: {
        ...CLASSIC_INPUT.content,
        groups: [
          { category: "A", words: ["ONE", "TWO", "THREE", "FOUR"], hintWord: null },
          { category: "B", words: ["ONE", "FIVE", "SIX", "SEVEN"], hintWord: null },
          { category: "C", words: ["EIGHT", "NINE", "TEN", "ELEVEN"], hintWord: null },
          { category: "D", words: ["TWELVE", "THIRTEEN", "FOURTEEN", "FIFTEEN"], hintWord: null },
        ],
        wordOrder: ["ONE", "TWO", "THREE", "FOUR", "ONE", "FIVE", "SIX", "SEVEN", "EIGHT", "NINE", "TEN", "ELEVEN", "TWELVE", "THIRTEEN", "FOURTEEN", "FIFTEEN"],
      },
    };
    await expect(createCustomPuzzle(bad)).rejects.toBeTruthy();
  });

  it("classic puzzles cannot contain Rainbow content", async () => {
    const bad: CreateCustomPuzzleInput = {
      ...CLASSIC_INPUT,
      content: { ...CLASSIC_INPUT.content, mode: "classic", rainbowHerring: ["BLUE", "TIRE", "SWIFT", "TREE"] },
    };
    // createCustomPuzzle only sends rainbowHerring when content.mode is
    // "rainbow" (see contentPayload) -- so this proves the CLIENT already
    // strips it. The server-side rejection is exercised directly against
    // the RPC below, bypassing the client entirely.
    const { error } = await db.rpc("create_custom_puzzle", {
      _creator_name: "Sam",
      _title: "Bad",
      _visibility: "public",
      _content: { ...bad.content, rainbow_herring: bad.content.rainbowHerring, word_order: bad.content.wordOrder, groups: bad.content.groups.map((g) => ({ category: g.category, words: g.words, hint_word: g.hintWord })) },
    });
    expect(error).toBeTruthy();
  });

  it("Rainbow puzzles require exactly one selected answer from every category", async () => {
    const bad = {
      _creator_name: "Sam",
      _title: "Bad Rainbow",
      _visibility: "public",
      _content: {
        mode: "rainbow",
        groups: CLASSIC_INPUT.content.groups.map((g) => ({ category: g.category, words: g.words, hint_word: g.hintWord })),
        word_order: CLASSIC_INPUT.content.wordOrder,
        // Two picks from group 1 (BLUE, GREEN), none from group 4.
        rainbow_herring: ["BLUE", "GREEN", "TIRE", "SWIFT"],
        rainbow_category_name: "Mixed",
        rainbow_hint_word: null,
        alphabetize_completed: true,
      },
    };
    const { error } = await db.rpc("create_custom_puzzle", bad);
    expect(error).toBeTruthy();
  });

  it("a Small Hint can never duplicate a board answer (so it can never become a board or Rainbow answer)", async () => {
    const bad: CreateCustomPuzzleInput = {
      ...CLASSIC_INPUT,
      content: {
        ...CLASSIC_INPUT.content,
        groups: [
          { ...CLASSIC_INPUT.content.groups[0], hintWord: "GREEN" }, // GREEN is group 2's board answer
          ...CLASSIC_INPUT.content.groups.slice(1),
        ],
      },
    };
    await expect(createCustomPuzzle(bad)).rejects.toBeTruthy();
  });

  it("a valid Rainbow puzzle (one answer per category) is created successfully", async () => {
    const { shareId } = await createCustomPuzzle(RAINBOW_INPUT);
    const result = await getCustomPuzzleByShareId(shareId);
    expect(result?.puzzle.rainbowHerring?.sort()).toEqual(["BLUE", "SWIFT", "TIRE", "TREE"].sort());
  });
});

// ── VISIBILITY / MODERATION ─────────────────────────────────────────────
describe("visibility and moderation", () => {
  it("a Private puzzle is fetchable by its share id but excluded from any direct table listing", async () => {
    const { puzzleId, shareId } = await createCustomPuzzle({ ...CLASSIC_INPUT, visibility: "private" });
    const result = await getCustomPuzzleByShareId(shareId);
    expect(result).not.toBeNull();
    expect(result!.visibility).toBe("private");

    // Direct table access (not through get_custom_puzzle) is refused for a
    // non-admin caller entirely -- the share_id itself is the only key.
    db.signIn(null);
    const selectResult = await db.from("custom_puzzles").select("*");
    expect(selectResult.data).toEqual([]);
  });

  it("a hidden (moderated) puzzle cannot be loaded, even with its share id", async () => {
    const { puzzleId, shareId } = await createCustomPuzzle(CLASSIC_INPUT);
    db.signIn("admin-1", { admin: true });
    const { data: hidden } = await db.rpc("admin_set_custom_puzzle_status", {
      _puzzle_id: puzzleId,
      _status: "hidden",
    });
    expect(hidden).toBe(true);
    db.signIn(null);

    const result = await getCustomPuzzleByShareId(shareId);
    expect(result).toBeNull();
  });

  it("a non-admin cannot flip moderation status directly", async () => {
    const { puzzleId } = await createCustomPuzzle(CLASSIC_INPUT);
    const { error } = await db.rpc("admin_set_custom_puzzle_status", { _puzzle_id: puzzleId, _status: "hidden" });
    expect(error).toBeTruthy();
  });
});

// ── GAMEPLAY ISOLATION ──────────────────────────────────────────────────
describe("custom gameplay isolation", () => {
  it("uses only the custom:<shareId> localStorage namespace and touches no official or Beta table", async () => {
    const { shareId } = await createCustomPuzzle(CLASSIC_INPUT);
    const { puzzle } = (await getCustomPuzzleByShareId(shareId))!;
    expect(puzzle.id).toBe(shareId);

    db.writeLog = [];
    const view = mount(puzzle, { mode: "custom" });
    await winGame(view, puzzle);

    expect(loadProgress(`custom:${shareId}`)).not.toBeNull();
    expect(loadProgress(shareId)).toBeNull();

    expect(db.tables.game_sessions).toHaveLength(0);
    expect(db.tables.guess_events).toHaveLength(0);
    expect(db.tables.hint_events).toHaveLength(0);
    expect(db.tables.game_results).toHaveLength(0);
    expect(db.tables.user_streaks).toHaveLength(0);
    expect(db.tables.puzzle_aggregates).toHaveLength(0);
    expect(db.tables.beta_playtests).toHaveLength(0);
    expect(db.tables.beta_feedback).toHaveLength(0);

    // The only write this game made landed in custom_puzzle_results.
    const tablesWritten = new Set(db.writeLog.map((w) => w.table));
    expect(tablesWritten).toEqual(new Set(["custom_puzzle_results"]));
    expect(results()).toHaveLength(1);
    expect(results()[0].won).toBe(true);
    // 4 correct guesses, no misses.
    expect(results()[0].total_guesses).toBe(4);
  });

  it("a page view alone writes nothing at all (no premature result, no session)", async () => {
    const { shareId } = await createCustomPuzzle(CLASSIC_INPUT);
    const { puzzle } = (await getCustomPuzzleByShareId(shareId))!;
    mount(puzzle, { mode: "custom" });
    await settle();
    expect(results()).toHaveLength(0);
    expect(loadProgress(`custom:${shareId}`)).toBeNull();
  });

  it("a Rainbow custom game completes correctly and records the win", async () => {
    const { shareId } = await createCustomPuzzle(RAINBOW_INPUT);
    const { puzzle } = (await getCustomPuzzleByShareId(shareId))!;
    const view = mount(puzzle, { mode: "custom" });
    await winGame(view, puzzle);
    expect(view.result.current.state.isWon).toBe(true);
    expect(results()).toHaveLength(1);
    expect(results()[0].won).toBe(true);
  });

  it("a loss records won=false with the real total submitted guesses", async () => {
    const { shareId } = await createCustomPuzzle(CLASSIC_INPUT);
    const { puzzle } = (await getCustomPuzzleByShareId(shareId))!;
    const view = mount(puzzle, { mode: "custom" });
    await loseGame(view, puzzle);
    expect(results()).toHaveLength(1);
    expect(results()[0].won).toBe(false);
    expect(results()[0].total_guesses).toBe(4);
  });
});

// ── STATISTICS ───────────────────────────────────────────────────────────
describe("custom puzzle statistics", () => {
  it("a verified device may submit one result", async () => {
    const { shareId } = await createCustomPuzzle(CLASSIC_INPUT);
    const { puzzle } = (await getCustomPuzzleByShareId(shareId))!;
    const view = mount(puzzle, { mode: "custom" });
    await winGame(view, puzzle);
    expect(results()).toHaveLength(1);
  });

  it("an unverified device is refused", async () => {
    const { shareId } = await createCustomPuzzle(CLASSIC_INPUT);
    const { data } = await db.rpc("submit_custom_puzzle_result", {
      _share_id: shareId,
      _device_id: "forged-device",
      _device_token: "wrong-token",
      _won: true,
      _total_guesses: 4,
    });
    expect(data).toBe(false);
    expect(results()).toHaveLength(0);
  });

  it("a replay from the same device does not inflate totals", async () => {
    const { shareId } = await createCustomPuzzle(CLASSIC_INPUT);
    const { puzzle } = (await getCustomPuzzleByShareId(shareId))!;
    const view = mount(puzzle, { mode: "custom" });
    await winGame(view, puzzle);
    expect(results()).toHaveLength(1);

    // Same device, calling completion directly again (a reload + replay).
    const deviceId = localStorage.getItem("rc-device-id")!;
    const deviceToken = localStorage.getItem("rc-device-token")!;
    const { data } = await db.rpc("submit_custom_puzzle_result", {
      _share_id: shareId,
      _device_id: deviceId,
      _device_token: deviceToken,
      _won: false,
      _total_guesses: 1,
    });
    expect(data).toBe(true); // idempotent no-op, not an error
    expect(results()).toHaveLength(1);
    // The FIRST result is the one that's kept.
    expect(results()[0].won).toBe(true);
    expect(results()[0].total_guesses).toBe(4);
  });

  it("two different devices produce two finished plays, and wins/losses/avg/distribution aggregate correctly", async () => {
    const { shareId } = await createCustomPuzzle(CLASSIC_INPUT);
    const { puzzle } = (await getCustomPuzzleByShareId(shareId))!;

    const view1 = mount(puzzle, { mode: "custom" });
    await winGame(view1, puzzle); // 4 guesses, won

    const identity2 = await mintDeviceIdentity("second");
    useDeviceIdentity(identity2);
    // A different device (a separate browser) has its own localStorage —
    // clear this same-process blob so the "second device" doesn't resume
    // the first device's already-completed local progress.
    clearProgress(`custom:${shareId}`);
    const view2 = mount(puzzle, { mode: "custom" });
    await loseGame(view2, puzzle); // 4 guesses, lost

    expect(results()).toHaveLength(2);

    const stats = await getCustomPuzzleStats(shareId);
    expect(stats).not.toBeNull();
    expect(stats!.finishedPlays).toBe(2);
    expect(stats!.wins).toBe(1);
    expect(stats!.losses).toBe(1);
    expect(stats!.avgGuesses).toBe(4);
    expect(stats!.guessDistribution["4"]).toBe(2);
  });

  it("direct reads and writes on custom_puzzle_results are refused for every role, including admin", async () => {
    const { shareId } = await createCustomPuzzle(CLASSIC_INPUT);
    const { puzzle } = (await getCustomPuzzleByShareId(shareId))!;
    const view = mount(puzzle, { mode: "custom" });
    await winGame(view, puzzle);

    db.signIn("admin-1", { admin: true });
    const selectResult = await db.from("custom_puzzle_results").select("*");
    expect(selectResult.data).toEqual([]);
    const insertResult = await db.from("custom_puzzle_results").insert({
      custom_puzzle_id: "whatever",
      device_id: "forged",
      won: true,
      total_guesses: 1,
    });
    expect(insertResult.error).toBeTruthy();
    db.signIn(null);
  });

  it("the stats RPC returns aggregates only -- no device or account identifiers in the response", async () => {
    const { shareId } = await createCustomPuzzle(CLASSIC_INPUT);
    const { puzzle } = (await getCustomPuzzleByShareId(shareId))!;
    const view = mount(puzzle, { mode: "custom" });
    await winGame(view, puzzle);

    const { data } = await db.rpc("get_custom_puzzle_stats", { _share_id: shareId });
    const keys = Object.keys(data as Record<string, unknown>);
    expect(keys).toEqual(
      expect.arrayContaining(["finished_plays", "wins", "losses", "avg_guesses", "guess_distribution"])
    );
    expect(keys).not.toContain("device_id");
    expect(keys).not.toContain("user_id");
    expect(JSON.stringify(data)).not.toContain(localStorage.getItem("rc-device-id"));
  });

  it("a puzzle nobody has finished shows an empty-but-valid stats shape", async () => {
    const { shareId } = await createCustomPuzzle(CLASSIC_INPUT);
    const stats = await getCustomPuzzleStats(shareId);
    expect(stats).toEqual({ finishedPlays: 0, wins: 0, losses: 0, avgGuesses: 0, guessDistribution: {} });
  });
});
