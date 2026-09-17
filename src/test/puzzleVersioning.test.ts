/**
 * Verification suite for lightweight puzzle content versioning, cases A-Q.
 *
 * These drive the REAL code paths — useGame -> useGameSession ->
 * lib/gameSession / lib/gameStats, plus lib/puzzleVersion and the admin save
 * RPC — against the in-memory fake Supabase, which mirrors the SQL rules the
 * versioning migration creates: the canonical-content comparison that decides
 * whether a save creates a version, the (puzzle_id, version_number) unique
 * index, the cross-puzzle guards, and the admin-only write path.
 *
 * The property under test throughout: an admin may edit a live puzzle, and
 *   - a player already playing the old version can still finish it;
 *   - a new player gets the new version;
 *   - NOTHING about counting changes, because every version is the same
 *     puzzle.
 *
 * Production is never touched.
 */
import { describe, it, expect, beforeEach, vi } from "vitest";
import { act, renderHook } from "@testing-library/react";
import { FakeSupabase, type FakeRow } from "./fakeSupabase";
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
import { loadStatsFromSupabase } from "@/lib/gameStats";
import { loadProgress, progressKey } from "@/lib/gameProgress";
import { resolvePlayablePuzzle, loadPlayedDifficulties } from "@/lib/puzzleVersion";

const ADMIN_ID = "admin-user";

const sessions = () => db.tables.game_sessions;
const guesses = () => db.tables.guess_events;
const versions = () => db.tables.puzzle_versions;
const groups = () => db.tables.puzzle_groups;

// ── Content fixtures ────────────────────────────────────────────────────────
//
// V1 and V2 differ in exactly one word: the Yellow category's "y4" becomes
// "y9". That is the smallest edit that produces the failure this feature
// exists to fix — a player mid-game holding a board with y4 on it, whose
// remaining correct answer for Yellow can no longer be submitted once the
// puzzle says the answer is y9.

const V1_CONTENT = {
  groups: [
    { category: "Yellow", words: ["y1", "y2", "y3", "y4"], difficulty: 1, hint_word: null },
    { category: "Green", words: ["g1", "g2", "g3", "g4"], difficulty: 2, hint_word: null },
    { category: "Blue", words: ["b1", "b2", "b3", "b4"], difficulty: 3, hint_word: null },
    { category: "Red", words: ["r1", "r2", "r3", "r4"], difficulty: 4, hint_word: null },
  ],
  word_order: null,
  rainbow_herring: ["y1", "g1", "b1", "r1"],
  rainbow_category_name: "Rainbow",
  rainbow_hint_word: null,
  theme: null,
  is_emoji_puzzle: false,
};

/** V1 with the single word swap. */
const V2_CONTENT = {
  ...V1_CONTENT,
  groups: [
    { category: "Yellow", words: ["y1", "y2", "y3", "y9"], difficulty: 1, hint_word: null },
    ...V1_CONTENT.groups.slice(1),
  ],
};

const METADATA = {
  date: "2026-09-17",
  title: "101",
  is_published: true,
  emoji_puzzle_icon: null,
  is_free_puzzle: false,
  free_puzzle_order: null,
};

/** Sign in as the admin, run one save, sign back out to the player's state. */
async function adminSave(
  puzzleId: string | null,
  content: unknown,
  metadata: Record<string, unknown> = METADATA
) {
  const previousUser = db.currentUserId();
  const previousAdmin = db.isAdmin;
  db.signIn(ADMIN_ID, { admin: true });
  const { data, error } = await db.rpc("admin_save_puzzle", {
    _puzzle_id: puzzleId,
    _metadata: metadata,
    _content: content,
  });
  db.signIn(previousUser, { admin: previousAdmin });
  return { data: data as FakeRow | null, error };
}

/**
 * The Puzzle a page would build from the database right now — the same
 * mapping lib/puzzles.ts does, from the same two tables, including the
 * current_version_id that comes along with `select("*")`.
 */
function currentPuzzle(puzzleId: string): Puzzle {
  const row = db.tables.puzzles.find((p) => p.id === puzzleId)!;
  const rows = [...groups().filter((g) => g.puzzle_id === puzzleId)].sort(
    (a, b) => (a.sort_order as number) - (b.sort_order as number)
  );
  return {
    id: puzzleId,
    date: row.date as string,
    title: (row.title as string) ?? null,
    groups: rows.map((g) => ({
      category: g.category as string,
      words: g.words as string[],
      difficulty: g.difficulty as 1 | 2 | 3 | 4,
      hintWord: (g.hint_word as string) ?? null,
    })),
    wordOrder: (row.word_order as string[]) ?? null,
    rainbowHerring: (row.rainbow_herring as string[]) ?? null,
    rainbowCategoryName: (row.rainbow_category_name as string) ?? null,
    rainbowHintWord: (row.rainbow_hint_word as string) ?? null,
    isEmojiPuzzle: (row.is_emoji_puzzle as boolean) ?? false,
    theme: (row.theme as string) ?? null,
    versionId: (row.current_version_id as string) ?? null,
  };
}

/** What a page actually hands the board: the version this player should play. */
function playablePuzzle(puzzleId: string): Puzzle {
  return resolvePlayablePuzzle(currentPuzzle(puzzleId));
}

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

/** Solve all four categories of whichever version is on the board. */
async function winGame(view: ReturnType<typeof mount>, p: Puzzle) {
  for (const g of p.groups) await guess(view, g.words);
}

async function mintDeviceIdentity() {
  const { data } = await db.rpc("create_device_identity");
  return (Array.isArray(data) ? data[0] : data) as {
    device_id: string;
    device_token: string;
  };
}

let puzzleId: string;

beforeEach(async () => {
  reduceMotion();

  // Drain stragglers from the previous test before clearing state — those
  // writes land in the progress blob and would otherwise make a resume
  // assertion compare a stale snapshot. Same ordering rule as the
  // durable-session suite.
  for (let i = 0; i < 5; i++) {
    await new Promise((r) => setTimeout(r, 10));
  }

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
  db.failAggregateWrites = 0;
  db.rpcUnavailable = false;

  const identity = await mintDeviceIdentity();

  localStorage.clear();
  sessionStorage.clear();
  localStorage.setItem("rc-device-id", identity.device_id);
  localStorage.setItem("rc-device-token", identity.device_token);

  db.signIn(null);
  const { data } = await adminSave(null, V1_CONTENT);
  puzzleId = data!.puzzle_id as string;

  db.signIn(null);
  db.writeLog = [];
  db.rpcLog = [];
});

// ── A. NEW PUZZLE CREATES VERSION 1 ────────────────────────────────────────
describe("A. a new puzzle creates Version 1", () => {
  it("writes exactly one version, promotes it, and populates the live groups", async () => {
    const all = versions().filter((v) => v.puzzle_id === puzzleId);
    expect(all).toHaveLength(1);
    expect(all[0].version_number).toBe(1);

    const puzzle = db.tables.puzzles.find((p) => p.id === puzzleId)!;
    expect(puzzle.current_version_id).toBe(all[0].id);

    // The live read path the game loads from is populated in the same save.
    expect(groups().filter((g) => g.puzzle_id === puzzleId)).toHaveLength(4);
    expect(currentPuzzle(puzzleId).groups[0].words).toEqual(["y1", "y2", "y3", "y4"]);
  });

  it("rejects content that could never be solved, rather than freezing it", async () => {
    const { error } = await adminSave(null, {
      ...V1_CONTENT,
      // The same word in two categories: 15 unique, not 16.
      groups: [
        { category: "Yellow", words: ["y1", "y2", "y3", "g1"], difficulty: 1, hint_word: null },
        ...V1_CONTENT.groups.slice(1),
      ],
    }, { ...METADATA, date: "2026-09-18" });

    expect(error).toBeTruthy();
    expect((error as { message: string }).message).toMatch(/16 unique words/);
  });

  it("refuses a Rainbow answer that is not on the board", async () => {
    const { error } = await adminSave(
      null,
      { ...V1_CONTENT, rainbow_herring: ["y1", "g1", "b1", "NOT_A_WORD"] },
      { ...METADATA, date: "2026-09-19" }
    );
    expect(error).toBeTruthy();
    expect((error as { message: string }).message).toMatch(/not one of this puzzle's 16 words/);
  });
});

// ── B. GAMEPLAY EDIT CREATES VERSION 2 ─────────────────────────────────────
describe("B. a gameplay edit creates Version 2", () => {
  it("writes a second version, promotes it, and leaves Version 1 untouched", async () => {
    const v1 = versions()[0];
    const v1Content = JSON.stringify(v1.content);

    const { data } = await adminSave(puzzleId, V2_CONTENT);

    expect(data!.created_version).toBe(true);
    expect(data!.version_number).toBe(2);

    const all = versions().filter((v) => v.puzzle_id === puzzleId);
    expect(all.map((v) => v.version_number)).toEqual([1, 2]);

    // Immutability, which is what makes an in-progress Version 1 board safe:
    // the snapshot a player pinned cannot change underneath them.
    expect(JSON.stringify(versions().find((v) => v.id === v1.id)!.content)).toBe(v1Content);

    const puzzle = db.tables.puzzles.find((p) => p.id === puzzleId)!;
    expect(puzzle.current_version_id).toBe(all[1].id);
    expect(currentPuzzle(puzzleId).groups[0].words).toEqual(["y1", "y2", "y3", "y9"]);
  });

  it.each([
    ["a replaced word", { ...V1_CONTENT, groups: V2_CONTENT.groups }],
    [
      "a word moved between categories",
      {
        ...V1_CONTENT,
        groups: [
          { category: "Yellow", words: ["y1", "y2", "y3", "g4"], difficulty: 1, hint_word: null },
          { category: "Green", words: ["g1", "g2", "g3", "y4"], difficulty: 2, hint_word: null },
          ...V1_CONTENT.groups.slice(2),
        ],
      },
    ],
    [
      "a corrected category name",
      {
        ...V1_CONTENT,
        groups: [
          { ...V1_CONTENT.groups[0], category: "Yellow Things" },
          ...V1_CONTENT.groups.slice(1),
        ],
      },
    ],
    [
      "a changed difficulty order",
      {
        ...V1_CONTENT,
        groups: [
          { ...V1_CONTENT.groups[0], difficulty: 4 },
          ...V1_CONTENT.groups.slice(1, 3),
          { ...V1_CONTENT.groups[3], difficulty: 1 },
        ],
      },
    ],
    ["a changed Rainbow answer", { ...V1_CONTENT, rainbow_herring: ["y2", "g2", "b2", "r2"] }],
    ["a changed Rainbow category name", { ...V1_CONTENT, rainbow_category_name: "Spectrum" }],
    ["a changed hint word", {
      ...V1_CONTENT,
      groups: [{ ...V1_CONTENT.groups[0], hint_word: "warm" }, ...V1_CONTENT.groups.slice(1)],
    }],
    ["a changed theme", { ...V1_CONTENT, theme: "autumn" }],
    ["a changed emoji flag", { ...V1_CONTENT, is_emoji_puzzle: true }],
  ])("versions %s", async (_label, content) => {
    const { data } = await adminSave(puzzleId, content);
    expect(data!.created_version).toBe(true);
    expect(data!.version_number).toBe(2);
  });
});

// ── C. METADATA-ONLY EDIT CREATES NO VERSION ───────────────────────────────
describe("C. a metadata-only edit creates no new version", () => {
  it.each([
    ["title", { title: "Renamed" }],
    ["date", { date: "2026-10-01" }],
    ["published state", { is_published: false }],
    ["the Archive card emoji", { emoji_puzzle_icon: "🍎" }],
    ["free-puzzle placement", { is_free_puzzle: true, free_puzzle_order: 3 }],
  ])("changing %s keeps the puzzle on Version 1", async (_label, patch) => {
    const { data } = await adminSave(puzzleId, V1_CONTENT, { ...METADATA, ...patch });

    expect(data!.created_version).toBe(false);
    expect(data!.version_number).toBe(1);
    expect(versions().filter((v) => v.puzzle_id === puzzleId)).toHaveLength(1);
  });

  it("still applies the metadata change itself", async () => {
    await adminSave(puzzleId, V1_CONTENT, { ...METADATA, title: "Renamed" });
    expect(db.tables.puzzles.find((p) => p.id === puzzleId)!.title).toBe("Renamed");
  });
});

// ── D. NO-OP SAVE CREATES NO VERSION ───────────────────────────────────────
describe("D. a no-op save creates no version", () => {
  it("re-saving identical content changes nothing", async () => {
    const { data } = await adminSave(puzzleId, V1_CONTENT);
    expect(data!.created_version).toBe(false);
    expect(versions().filter((v) => v.puzzle_id === puzzleId)).toHaveLength(1);
  });

  it("is not fooled by cosmetic differences in what the form sent", async () => {
    // Whitespace around a category name and an empty-string hint word both
    // canonicalise to the stored form, so neither is a gameplay change.
    const { data } = await adminSave(puzzleId, {
      ...V1_CONTENT,
      groups: [
        { ...V1_CONTENT.groups[0], category: "  Yellow  ", hint_word: "" },
        ...V1_CONTENT.groups.slice(1),
      ],
      rainbow_category_name: " Rainbow ",
    });
    expect(data!.created_version).toBe(false);
    expect(versions().filter((v) => v.puzzle_id === puzzleId)).toHaveLength(1);
  });

  it("saving ten times in a row still leaves exactly one version", async () => {
    for (let i = 0; i < 10; i++) await adminSave(puzzleId, V1_CONTENT);
    expect(versions().filter((v) => v.puzzle_id === puzzleId)).toHaveLength(1);
  });
});

// ── E/F. AN ACTIVE VERSION 1 BOARD SURVIVES THE EDIT ───────────────────────
describe("E+F. an in-progress Version 1 game after Version 2 is published", () => {
  it("stays playable in the same mount, and its session is pinned to Version 1", async () => {
    const v1Id = versions()[0].id;

    const view = mount(playablePuzzle(puzzleId));
    await guess(view, ["y1", "y2", "y3", "g1"]); // a real first action
    expect(sessions()).toHaveLength(1);
    expect(sessions()[0].puzzle_version_id).toBe(v1Id);

    // The admin publishes Version 2 mid-game.
    await adminSave(puzzleId, V2_CONTENT);

    // The board in front of the player still accepts the Version 1 answer.
    await guess(view, ["y1", "y2", "y3", "y4"]);
    expect(view.result.current.state.solvedGroups).toHaveLength(1);
  });

  it("resumes against Version 1 after a refresh, and can be finished", async () => {
    const v1Id = versions()[0].id;

    const first = mount(playablePuzzle(puzzleId));
    await guess(first, ["y1", "y2", "y3", "y4"]);
    expect(first.result.current.state.solvedGroups).toHaveLength(1);
    first.unmount();

    await adminSave(puzzleId, V2_CONTENT);

    // A refresh: the page re-fetches the CURRENT puzzle (Version 2) and
    // resolves what to actually play. Before versioning this handed the
    // board Version 2 while localStorage restored the Version 1 state, and
    // y4 — still on screen, still needed — belonged to no group any more.
    const resumed = playablePuzzle(puzzleId);
    expect(resumed.versionId).toBe(v1Id);
    expect(resumed.groups[0].words).toEqual(["y1", "y2", "y3", "y4"]);

    const second = mount(resumed);
    await settle();
    expect(second.result.current.state.solvedGroups).toHaveLength(1);

    // And the rest of Version 1 is still winnable.
    for (const g of resumed.groups.slice(1)) await guess(second, g.words);
    expect(second.result.current.state.isWon).toBe(true);

    // One session throughout, still pinned to Version 1, now completed.
    expect(sessions()).toHaveLength(1);
    expect(sessions()[0].puzzle_version_id).toBe(v1Id);
    expect(sessions()[0].status).toBe("won");
  });

  it("does not silently convert the in-progress session to Version 2", async () => {
    const v1Id = versions()[0].id;
    const view = mount(playablePuzzle(puzzleId));
    await guess(view, ["y1", "y2", "y3", "g1"]);
    view.unmount();

    await adminSave(puzzleId, V2_CONTENT);
    const v2Id = db.tables.puzzles.find((p) => p.id === puzzleId)!.current_version_id;
    expect(v2Id).not.toBe(v1Id);

    const resumed = mount(playablePuzzle(puzzleId));
    await guess(resumed, ["b1", "b2", "b3", "b4"]);

    expect(sessions()).toHaveLength(1);
    expect(sessions()[0].puzzle_version_id).toBe(v1Id);
  });

  it("pins Version 1 even when the edit lands before the player's first action", async () => {
    // The exact race the product rule calls out: the board on screen is
    // Version 1, Version 2 is published, and only THEN does the player act.
    // Their guess will be judged against the board they can see, so the
    // session must say Version 1.
    const v1Id = versions()[0].id;
    const view = mount(playablePuzzle(puzzleId)); // opened on V1, no action yet
    await settle();

    await adminSave(puzzleId, V2_CONTENT);

    await guess(view, ["y1", "y2", "y3", "y4"]);

    expect(sessions()).toHaveLength(1);
    expect(sessions()[0].puzzle_version_id).toBe(v1Id);
    expect(view.result.current.state.solvedGroups).toHaveLength(1);
  });
});

// ── G. A NEW PLAYER GETS VERSION 2 ─────────────────────────────────────────
describe("G. a new player receives Version 2", () => {
  it("loads the current version and pins their session to it", async () => {
    await adminSave(puzzleId, V2_CONTENT);
    const v2Id = db.tables.puzzles.find((p) => p.id === puzzleId)!.current_version_id;

    // A brand-new browser: no local progress for this puzzle.
    localStorage.removeItem(progressKey(puzzleId));

    const fresh = playablePuzzle(puzzleId);
    expect(fresh.versionId).toBe(v2Id);
    expect(fresh.groups[0].words).toEqual(["y1", "y2", "y3", "y9"]);

    const view = mount(fresh);
    await guess(view, ["y1", "y2", "y3", "y9"]);

    expect(view.result.current.state.solvedGroups).toHaveLength(1);
    expect(sessions()[0].puzzle_version_id).toBe(v2Id);
  });
});

// ── H. A COMPLETED PLAYER SEES THE NEWEST SOLUTION ─────────────────────────
describe("H. a completed Version 1 player revisiting the Archive", () => {
  it("sees the current Version 2 solution, not the one they played", async () => {
    const v1 = playablePuzzle(puzzleId);
    const view = mount(v1, { isArchive: true, entryContext: "archive_direct" });
    await winGame(view, v1);
    expect(view.result.current.state.isWon).toBe(true);
    view.unmount();

    await adminSave(puzzleId, V2_CONTENT);

    // Product rule: a finished player gets the newest corrected answers.
    const revisited = playablePuzzle(puzzleId);
    expect(revisited.groups[0].words).toEqual(["y1", "y2", "y3", "y9"]);
    expect(revisited.versionId).toBe(
      db.tables.puzzles.find((p) => p.id === puzzleId)!.current_version_id
    );
  });

  it("still keeps their board finished, not reopened", async () => {
    const v1 = playablePuzzle(puzzleId);
    const view = mount(v1, { isArchive: true, entryContext: "archive_direct" });
    await winGame(view, v1);
    view.unmount();

    await adminSave(puzzleId, V2_CONTENT);

    const revisited = mount(playablePuzzle(puzzleId), { isArchive: true });
    await settle();
    expect(revisited.result.current.state.isComplete).toBe(true);
    expect(revisited.result.current.state.isWon).toBe(true);
  });
});

// ── I. RAW GUESS EVENTS ARE NEVER REWRITTEN ────────────────────────────────
describe("I. raw Version 1 guess events keep their original words", () => {
  it("a guess of y4 still says y4 after y4 is replaced by y9", async () => {
    const v1 = playablePuzzle(puzzleId);
    const view = mount(v1);
    await guess(view, ["y1", "y2", "y3", "y4"]);

    const before = guesses().map((g) => ({
      words: [...(g.words as string[])],
      correct: g.correct,
      guessed_at: g.guessed_at,
      guess_number: g.guess_number,
      is_one_away: g.is_one_away,
      is_rainbow_attempt: g.is_rainbow_attempt,
    }));
    expect(before[0].words).toContain("y4");

    await adminSave(puzzleId, V2_CONTENT);

    // Not one field of the historical record moved. Timestamps, correctness,
    // One Away, Rainbow classification and event order are all preserved —
    // an admin correcting a puzzle does not get to change what a player did.
    const after = guesses().map((g) => ({
      words: [...(g.words as string[])],
      correct: g.correct,
      guessed_at: g.guessed_at,
      guess_number: g.guess_number,
      is_one_away: g.is_one_away,
      is_rainbow_attempt: g.is_rainbow_attempt,
    }));
    expect(after).toEqual(before);
    expect(after[0].words).toContain("y4");
    expect(after[0].words).not.toContain("y9");
  });

  it("preserves the share grid's colours from the version that was played", async () => {
    const v1 = playablePuzzle(puzzleId);
    const view = mount(v1);
    await winGame(view, v1);
    await settle();
    const savedShareGrid = sessions()[0].share_grid;
    view.unmount();

    // An edit that swaps Yellow's and Red's difficulties — i.e. recolours
    // the board — must not repaint a finished player's saved result.
    await adminSave(puzzleId, {
      ...V1_CONTENT,
      groups: [
        { ...V1_CONTENT.groups[0], difficulty: 4 },
        ...V1_CONTENT.groups.slice(1, 3),
        { ...V1_CONTENT.groups[3], difficulty: 1 },
      ],
    });

    // The server-side record is untouched.
    expect(sessions()[0].share_grid).toBe(savedShareGrid);
    // And the colours the UI would redraw come from the pinned snapshot.
    expect(loadPlayedDifficulties(puzzleId)).toEqual([1, 2, 3, 4]);
  });
});

// ── J/K/L. COUNTING IS COMPLETELY UNAFFECTED ───────────────────────────────
describe("J+K+L. versioning changes no counting semantics", () => {
  it("J. My Stats still counts the puzzle exactly once across an edit", async () => {
    const v1 = playablePuzzle(puzzleId);
    const view = mount(v1);
    await winGame(view, v1);
    await settle();

    const before = await loadStatsFromSupabase();
    expect(before.gamesPlayed).toBe(1);

    await adminSave(puzzleId, V2_CONTENT);

    const after = await loadStatsFromSupabase();
    expect(after.gamesPlayed).toBe(1);
    expect(after.gamesWon).toBe(before.gamesWon);
    expect(after.currentStreak).toBe(before.currentStreak);
  });

  it("K. Global Stats combine official completions from Version 1 and Version 2", async () => {
    // Player one finishes Version 1.
    const v1 = playablePuzzle(puzzleId);
    const one = mount(v1);
    await winGame(one, v1);
    await settle();
    one.unmount();

    await adminSave(puzzleId, V2_CONTENT);

    // Player two — a different device, a clean browser — finishes Version 2.
    const second = await mintDeviceIdentity();
    localStorage.clear();
    localStorage.setItem("rc-device-id", second.device_id);
    localStorage.setItem("rc-device-token", second.device_token);

    const v2 = playablePuzzle(puzzleId);
    expect(v2.groups[0].words).toEqual(["y1", "y2", "y3", "y9"]);
    const two = mount(v2);
    await winGame(two, v2);
    await settle();

    const played = sessions().map((s) => s.puzzle_version_id);
    expect(new Set(played).size).toBe(2); // genuinely two different versions

    const { data } = await db.rpc("get_puzzle_stats", { _puzzle_id: puzzleId });
    // One puzzle, two official completed plays — the version is not part of
    // the question Global Stats asks.
    expect((data as { total_players: number }).total_players).toBe(2);
    expect((data as { wins: number }).wins).toBe(2);
  });

  it("L. editing creates no play, session, guess or aggregate rows", async () => {
    const v1 = playablePuzzle(puzzleId);
    const view = mount(v1);
    await winGame(view, v1);
    await settle();

    const before = {
      sessions: sessions().length,
      guesses: guesses().length,
      results: db.tables.game_results.length,
      streaks: JSON.stringify(db.tables.user_streaks),
      aggregates: JSON.stringify(db.tables.puzzle_aggregates),
    };

    await adminSave(puzzleId, V2_CONTENT);
    await adminSave(puzzleId, V1_CONTENT); // and back again

    expect(sessions()).toHaveLength(before.sessions);
    expect(guesses()).toHaveLength(before.guesses);
    expect(db.tables.game_results).toHaveLength(before.results);
    expect(JSON.stringify(db.tables.user_streaks)).toBe(before.streaks);
    expect(JSON.stringify(db.tables.puzzle_aggregates)).toBe(before.aggregates);
  });

  it("an existing session does not become a second session after an edit", async () => {
    const v1 = playablePuzzle(puzzleId);
    const view = mount(v1);
    await guess(view, ["y1", "y2", "y3", "y4"]);
    const sessionId = sessions()[0].id;
    view.unmount();

    await adminSave(puzzleId, V2_CONTENT);

    const resumed = playablePuzzle(puzzleId);
    const second = mount(resumed);
    await guess(second, resumed.groups[1].words);

    expect(sessions()).toHaveLength(1);
    expect(sessions()[0].id).toBe(sessionId);
  });

  it("official-result priority stays per puzzle identity, not per version", async () => {
    const v1 = playablePuzzle(puzzleId);
    const first = mount(v1);
    await winGame(first, v1);
    await settle();
    expect(sessions()[0].is_official).toBe(true);
    first.unmount();

    await adminSave(puzzleId, V2_CONTENT);

    // The same player comes back to the SAME puzzle on the new version, with
    // their local progress gone. The board locks, exactly as it would have
    // without an edit: has_official_result asks about the puzzle IDENTITY,
    // and a new version is not a new puzzle to replay.
    localStorage.removeItem(progressKey(puzzleId));
    const v2 = playablePuzzle(puzzleId);
    const again = mount(v2);
    await settle();
    expect(again.result.current.state.isComplete).toBe(true);

    const official = sessions().filter((s) => s.is_official === true);
    expect(official).toHaveLength(1);
    expect((await loadStatsFromSupabase()).gamesPlayed).toBe(1);
  });

  it("in-progress sessions stay excluded from completion statistics", async () => {
    const v1 = playablePuzzle(puzzleId);
    const view = mount(v1);
    await guess(view, ["y1", "y2", "y3", "g1"]);

    await adminSave(puzzleId, V2_CONTENT);

    expect(sessions()[0].status).toBe("in_progress");
    const { data } = await db.rpc("get_puzzle_stats", { _puzzle_id: puzzleId });
    expect((data as { total_players: number }).total_players).toBe(0);
    expect((await loadStatsFromSupabase()).gamesPlayed).toBe(0);
  });
});

// ── M/N/O. SECURITY AND CONCURRENCY ────────────────────────────────────────
describe("M+N+O. version integrity", () => {
  it("M. a version from puzzle A cannot be attached to a session for puzzle B", async () => {
    const { data: other } = await adminSave(null, V1_CONTENT, {
      ...METADATA,
      date: "2026-09-20",
    });
    const otherVersionId = db.tables.puzzles.find((p) => p.id === other!.puzzle_id)!
      .current_version_id;

    const { data, error } = await db.rpc("create_game_session", {
      _puzzle_id: puzzleId,
      _device_id: localStorage.getItem("rc-device-id"),
      _device_token: localStorage.getItem("rc-device-token"),
      _entry_context: "daily_home",
      _active_time_seconds: 0,
      _mistakes: 0,
      _puzzle_version_id: otherVersionId,
    });

    expect(data).toBeNull();
    expect((error as { code: string }).code).toBe("23503");
    expect(sessions()).toHaveLength(0);
  });

  it("M2. a puzzle cannot be promoted onto another puzzle's version", async () => {
    const { data: other } = await adminSave(null, V1_CONTENT, {
      ...METADATA,
      date: "2026-09-21",
    });
    const otherVersionId = db.tables.puzzles.find((p) => p.id === other!.puzzle_id)!
      .current_version_id;

    db.signIn(ADMIN_ID, { admin: true });
    const { error } = await db
      .from("puzzles")
      .update({ current_version_id: otherVersionId })
      .eq("id", puzzleId);
    db.signIn(null);

    expect(error).toBeTruthy();
    expect(db.tables.puzzles.find((p) => p.id === puzzleId)!.current_version_id).not.toBe(
      otherVersionId
    );
  });

  it("M3. a fabricated version id is refused rather than stored", async () => {
    const { data, error } = await db.rpc("create_game_session", {
      _puzzle_id: puzzleId,
      _device_id: localStorage.getItem("rc-device-id"),
      _device_token: localStorage.getItem("rc-device-token"),
      _entry_context: "daily_home",
      _active_time_seconds: 0,
      _mistakes: 0,
      _puzzle_version_id: "no-such-version",
    });
    expect(data).toBeNull();
    expect(error).toBeTruthy();
  });

  it("N. a non-admin cannot create or promote a version", async () => {
    db.signIn("ordinary-player");
    const { error: rpcError } = await db.rpc("admin_save_puzzle", {
      _puzzle_id: puzzleId,
      _metadata: METADATA,
      _content: V2_CONTENT,
    });
    expect((rpcError as { code: string }).code).toBe("42501");

    // Nor by writing the tables directly, which is why there is no INSERT
    // policy on puzzle_versions and no write policy on puzzles for
    // non-admins.
    const { error: insertError } = await db.from("puzzle_versions").insert({
      puzzle_id: puzzleId,
      version_number: 99,
      content: V2_CONTENT,
    });
    expect(insertError).toBeTruthy();

    const { error: promoteError } = await db
      .from("puzzles")
      .update({ current_version_id: "anything" })
      .eq("id", puzzleId);
    expect(promoteError).toBeTruthy();

    db.signIn(null);
    expect(versions().filter((v) => v.puzzle_id === puzzleId)).toHaveLength(1);
  });

  it("N2. not even an admin can rewrite an existing version", async () => {
    db.signIn(ADMIN_ID, { admin: true });
    const { error } = await db
      .from("puzzle_versions")
      .update({ content: V2_CONTENT })
      .eq("id", versions()[0].id);
    db.signIn(null);

    expect(error).toBeTruthy();
    expect(JSON.stringify(versions()[0].content)).toContain("y4");
  });

  it("N3. anonymous players can read the version data they need to play", async () => {
    // Public read is what lets a resuming player's snapshot be verifiable,
    // and it exposes puzzle content only — never player data.
    const { data } = await db.from("puzzle_versions").select("*").eq("puzzle_id", puzzleId);
    expect((data as FakeRow[]).length).toBe(1);

    // A draft puzzle's versions stay invisible, exactly like its groups.
    await adminSave(puzzleId, V1_CONTENT, { ...METADATA, is_published: false });
    const { data: hidden } = await db.from("puzzle_versions").select("*").eq("puzzle_id", puzzleId);
    expect(hidden as FakeRow[]).toHaveLength(0);
  });

  it("O. a retried save cannot mint a duplicate version number", async () => {
    await adminSave(puzzleId, V2_CONTENT);
    const numbers = () =>
      versions()
        .filter((v) => v.puzzle_id === puzzleId)
        .map((v) => v.version_number);
    expect(numbers()).toEqual([1, 2]);

    // The retry of a save that already landed: identical content, so it is
    // a no-op rather than a second "Version 2".
    const retry = await adminSave(puzzleId, V2_CONTENT);
    expect(retry.data!.created_version).toBe(false);
    expect(numbers()).toEqual([1, 2]);

    // And a genuinely new edit continues the sequence rather than colliding.
    const next = await adminSave(puzzleId, { ...V2_CONTENT, theme: "autumn" });
    expect(next.data!.version_number).toBe(3);
    expect(new Set(numbers()).size).toBe(numbers().length);
  });

  it("O2. concurrent saves of different content produce distinct version numbers", async () => {
    db.signIn(ADMIN_ID, { admin: true });
    await Promise.all([
      db.rpc("admin_save_puzzle", { _puzzle_id: puzzleId, _metadata: METADATA, _content: V2_CONTENT }),
      db.rpc("admin_save_puzzle", {
        _puzzle_id: puzzleId,
        _metadata: METADATA,
        _content: { ...V2_CONTENT, theme: "autumn" },
      }),
    ]);
    db.signIn(null);

    const numbers = versions()
      .filter((v) => v.puzzle_id === puzzleId)
      .map((v) => v.version_number);
    expect(new Set(numbers).size).toBe(numbers.length);
    expect(numbers).toContain(1);
  });
});

// ── P. LEGACY SESSIONS ─────────────────────────────────────────────────────
describe("P. existing legacy sessions", () => {
  it("remain visible and counted with no version reference at all", async () => {
    // A completed session from before versioning existed: it predates the
    // column, so its real version is genuinely unknowable and is left NULL
    // rather than being stamped with today's snapshot.
    sessions().push({
      id: "legacy-session",
      puzzle_id: puzzleId,
      puzzle_version_id: null,
      user_id: null,
      device_id: localStorage.getItem("rc-device-id"),
      status: "won",
      won: true,
      mistakes: 1,
      is_official: true,
      bonus_rainbow_attempted: false,
      found_rainbow: false,
      hints_used: false,
      rainbow_source: null,
      solve_order: ["orange", "green", "blue", "red"],
      completed_at: new Date().toISOString(),
      share_grid: "🟨🟨🟨🟨",
    });

    const stats = await loadStatsFromSupabase();
    expect(stats.gamesPlayed).toBe(1);
    expect(stats.gamesWon).toBe(1);

    const { data } = await db.rpc("get_puzzle_stats", { _puzzle_id: puzzleId });
    expect((data as { total_players: number }).total_players).toBe(1);

    // And an edit leaves it exactly as it was.
    await adminSave(puzzleId, V2_CONTENT);
    expect(sessions().find((s) => s.id === "legacy-session")!.puzzle_version_id).toBeNull();
    expect((await loadStatsFromSupabase()).gamesPlayed).toBe(1);
  });

  it("a legacy local progress blob with no snapshot resumes on the current version", async () => {
    // The pre-cutover blob shape: real progress, no puzzleSnapshot field.
    localStorage.setItem(
      progressKey(puzzleId),
      JSON.stringify({
        solvedGroups: [1],
        mistakes: 0,
        guessHistory: [
          { words: ["g1", "g2", "g3", "g4"], groupIndices: [1, 1, 1, 1], isCorrect: true },
        ],
        gotRainbow: false,
        shuffledWords: ["y1", "y2", "y3", "y4", "b1", "b2", "b3", "b4", "r1", "r2", "r3", "r4"],
        rainbowWords: [],
      })
    );

    const resolved = playablePuzzle(puzzleId);
    expect(resolved.versionId).toBe(
      db.tables.puzzles.find((p) => p.id === puzzleId)!.current_version_id
    );
    expect(loadPlayedDifficulties(puzzleId)).toBeNull();

    // It still plays, and its first meaningful action creates a session
    // pinned to the version it is actually being played on.
    const view = mount(resolved);
    await guess(view, ["b1", "b2", "b3", "b4"]);
    expect(view.result.current.state.solvedGroups).toHaveLength(2);
    expect(sessions()[0].puzzle_version_id).toBe(resolved.versionId);
  });

  it("a puzzle with no version at all still loads and plays", async () => {
    // A database that has not had the versioning migration applied: no
    // current_version_id anywhere. The availability-first rule says the
    // puzzle must remain fully playable.
    db.tables.puzzles.find((p) => p.id === puzzleId)!.current_version_id = null;

    const resolved = playablePuzzle(puzzleId);
    expect(resolved.versionId).toBeNull();

    const view = mount(resolved);
    await winGame(view, resolved);
    await settle();

    expect(view.result.current.state.isWon).toBe(true);
    expect(sessions()).toHaveLength(1);
    expect(sessions()[0].puzzle_version_id).toBeNull();
    expect((await loadStatsFromSupabase()).gamesPlayed).toBe(1);
  });
});

// ── Q. ONBOARDING/IMPORT COUNTING INVARIANTS STILL HOLD ────────────────────
describe("Q. onboarding and import invariants under versioning", () => {
  it("importing guest history adds no play, and the version pin travels with the row", async () => {
    const v1Id = versions()[0].id;

    // Logged-out play on Version 1.
    const v1 = playablePuzzle(puzzleId);
    const view = mount(v1);
    await winGame(view, v1);
    await settle();
    view.unmount();

    const beforePlays = sessions().length;
    const beforeAggregate = JSON.stringify(db.tables.puzzle_aggregates);

    // A brand-new account signs in and chooses Add My Progress.
    db.signIn("new-account");
    db.tables.account_onboarding = [
      { user_id: "new-account", status: "pending", source_device_id: null, decided_at: null },
    ];
    const { data: imported } = await db.rpc("import_guest_history", {
      _device_id: localStorage.getItem("rc-device-id"),
      _device_token: localStorage.getItem("rc-device-token"),
    });

    expect((imported as FakeRow[])[0].outcome).toBe("imported");
    // Ownership transferred IN PLACE: same row, same id, same version pin,
    // nothing created and nothing counted twice.
    expect(sessions()).toHaveLength(beforePlays);
    expect(sessions()[0].user_id).toBe("new-account");
    expect(sessions()[0].puzzle_version_id).toBe(v1Id);
    expect(JSON.stringify(db.tables.puzzle_aggregates)).toBe(beforeAggregate);

    const { data: stats } = await db.rpc("get_puzzle_stats", { _puzzle_id: puzzleId });
    expect((stats as { total_players: number }).total_players).toBe(1);
  });

  it("an edit after an import still counts exactly one play", async () => {
    const v1 = playablePuzzle(puzzleId);
    const view = mount(v1);
    await winGame(view, v1);
    await settle();
    view.unmount();

    db.signIn("new-account");
    db.tables.account_onboarding = [
      { user_id: "new-account", status: "pending", source_device_id: null, decided_at: null },
    ];
    await db.rpc("import_guest_history", {
      _device_id: localStorage.getItem("rc-device-id"),
      _device_token: localStorage.getItem("rc-device-token"),
    });

    await adminSave(puzzleId, V2_CONTENT);

    expect((await loadStatsFromSupabase()).gamesPlayed).toBe(1);
    const { data } = await db.rpc("get_puzzle_stats", { _puzzle_id: puzzleId });
    expect((data as { total_players: number }).total_players).toBe(1);
  });
});

// ── AVAILABILITY ───────────────────────────────────────────────────────────
describe("availability: versioning never blocks play", () => {
  it("the puzzle stays fully playable when every RPC is unavailable", async () => {
    // The frontend/database cutover window, or an outage: puzzle content is
    // available (it comes from the tables, not an RPC), saving is not. The
    // existing rule applies unchanged — play continues, nothing is recorded,
    // and the player is told rather than misled.
    const p = playablePuzzle(puzzleId);
    db.rpcUnavailable = true;

    const view = mount(p);
    await winGame(view, p);
    await settle();

    expect(view.result.current.state.isWon).toBe(true);
    expect(sessions()).toHaveLength(0);
    expect(guesses()).toHaveLength(0);
  });

  it("a resumed pinned board does not need the network at all", async () => {
    const view = mount(playablePuzzle(puzzleId));
    await guess(view, ["y1", "y2", "y3", "y4"]);
    view.unmount();

    await adminSave(puzzleId, V2_CONTENT);

    // The pinned content is already in local progress, so resolving which
    // version to play is synchronous — no request, no flicker through the
    // wrong board, and it works with saving completely down.
    db.rpcUnavailable = true;
    const resumed = playablePuzzle(puzzleId);
    expect(resumed.groups[0].words).toEqual(["y1", "y2", "y3", "y4"]);
    expect(loadProgress(puzzleId)?.puzzleSnapshot?.versionId).toBe(versions()[0].id);
  });
});
