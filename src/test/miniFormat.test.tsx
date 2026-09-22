/**
 * Mini 3×3 — the shared game system, proven to run BOTH formats.
 *
 * Everything here drives the REAL shared code: useGame, the real progress
 * layer, the real payload builders, the real builder hook, and the same
 * in-memory fake Supabase the durable-session suite uses (which mirrors the
 * Mini migration's validation and format columns). Nothing constructs a
 * shortcut version of the rules it is checking.
 */
import { describe, it, expect, beforeEach, vi } from "vitest";
import { act, renderHook } from "@testing-library/react";
import { FakeSupabase } from "./fakeSupabase";
import type { Puzzle } from "@/lib/types";

// A completed game fans out through several awaited hops, and the losing
// board plays a multi-second category-reveal cascade (see below). 20s keeps
// those honest rather than racing the default 5s budget.
vi.setConfig({ testTimeout: 20000 });

const db = new FakeSupabase();

vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    from: (t: string) => db.from(t),
    rpc: (n: string, a: Record<string, unknown>) => db.rpc(n, a),
    auth: {
      getUser: () => db.auth.getUser(),
      onAuthStateChange: () => ({ data: { subscription: { unsubscribe: () => {} } } }),
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
import { useBuilderForm } from "@/hooks/useBuilderForm";
import { loadStatsFromSupabase } from "@/lib/gameStats";
import { loadProgress, progressKey } from "@/lib/gameProgress";
import {
  FULL_FORMAT,
  MINI_FORMAT,
  formatOf,
  oneAwayThreshold,
  progressStorageId,
  rainbowHerringFor,
} from "@/lib/puzzleFormat";
import { buildContentPayload, builderContentInput } from "@/lib/builder/contentPayload";
import { buildOfficialShareText } from "@/lib/shareText";

const MINI_ID = "mini-puzzle-1";
const FULL_ID = "full-puzzle-1";

const miniPuzzle: Puzzle = {
  id: MINI_ID,
  format: "mini",
  date: "2026-09-21",
  title: "M1",
  designerName: "Sam West",
  alphabetizeCompleted: true,
  groups: [
    // Green / Blue / Red — difficulties 2, 3, 4 (see lib/puzzleFormat.ts).
    { category: "Green", words: ["g1", "g2", "g3"], difficulty: 2 },
    { category: "Blue", words: ["b1", "b2", "b3"], difficulty: 3 },
    { category: "Red", words: ["r1", "r2", "r3"], difficulty: 4 },
  ],
  rainbowHerring: null,
};

const fullPuzzle: Puzzle = {
  id: FULL_ID,
  date: "2026-09-21",
  title: "F1",
  designerName: "Sam West",
  alphabetizeCompleted: true,
  groups: [
    { category: "Yellow", words: ["y1", "y2", "y3", "y4"], difficulty: 1 },
    { category: "Green", words: ["gg1", "gg2", "gg3", "gg4"], difficulty: 2 },
    { category: "Blue", words: ["bb1", "bb2", "bb3", "bb4"], difficulty: 3 },
    { category: "Red", words: ["rr1", "rr2", "rr3", "rr4"], difficulty: 4 },
  ],
  rainbowHerring: ["y1", "gg1", "bb1", "rr1"],
  rainbowCategoryName: "Rainbow",
};

function reduceMotion() {
  // Collapses useGame's "checking guess" suspense to a 0ms timeout, so a
  // guess resolves inside act() instead of a real ~1s animation.
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
    for (let i = 0; i < 25; i++) await new Promise((r) => setTimeout(r, 0));
  });
}

function mount(p: Puzzle, opts: Record<string, unknown> = {}) {
  return renderHook(() => useGame(p, opts as never));
}

/**
 * Submits one guess through the real hook, exactly as the board does.
 *
 * The releaseRevealHold() at the end is not a shortcut — it is the board's
 * own contract. A correct guess keeps the solved tiles in the grid while
 * GameBoard runs its clone-based reveal animation, and the board calls
 * releaseRevealHold() when that finishes. Without it, a hook-only test would
 * see tiles that a real player never sees.
 */
async function guess(view: ReturnType<typeof mount>, words: string[]) {
  await act(async () => { view.result.current.deselectAll(); });
  await act(async () => { for (const w of words) view.result.current.toggleWord(w); });
  await act(async () => { view.result.current.submitGuess(); });
  await settle();
  await act(async () => { view.result.current.releaseRevealHold(); });
  await settle();
}

async function mintDeviceIdentity() {
  const { data } = await db.rpc("create_device_identity");
  return (Array.isArray(data) ? data[0] : data) as { device_id: string; device_token: string };
}

beforeEach(async () => {
  reduceMotion();

  // Ordering matters, for the same reason it does in durableSession.test.ts.
  // Every await is a window in which a straggling promise from the PREVIOUS
  // test can still land a session row or a progress write — and a leftover
  // completed session makes the next mount believe this puzzle was already
  // played, which silently locks the board. So: drain, mint (the last
  // await), and only THEN reset tables and storage, with nothing awaited
  // in between.
  for (let i = 0; i < 5; i++) await new Promise((r) => setTimeout(r, 10));
  const identity = await mintDeviceIdentity();

  db.tables.game_sessions = [];
  db.tables.guess_events = [];
  db.tables.hint_events = [];
  db.tables.game_results = [];
  db.tables.user_streaks = [];
  db.tables.account_onboarding = [];
  db.tables.puzzle_aggregates = [];
  db.tables.puzzle_versions = [];
  db.tables.puzzle_groups = [];
  db.tables.custom_puzzles = [];

  localStorage.clear();
  sessionStorage.clear();
  localStorage.setItem("rc-device-id", identity.device_id);
  localStorage.setItem("rc-device-token", identity.device_token);

  db.tables.puzzles = [
    { id: MINI_ID, format: "mini", date: "2026-09-21", rainbow_herring: null, is_published: true },
    // Deliberately NO format key — this is what an existing Full row looks
    // like on a database that has not had the Mini migration applied.
    { id: FULL_ID, date: "2026-09-21", rainbow_herring: fullPuzzle.rainbowHerring, is_published: true },
  ];
  db.signIn(null);
  db.writeLog = [];
  db.rpcLog = [];
});

// ───────────────────────────────────────────────────────────────────────────
// Format definition
// ───────────────────────────────────────────────────────────────────────────

describe("the format definition", () => {
  it("describes a Mini 3x3 as three categories of three, Green/Blue/Red", () => {
    expect(MINI_FORMAT.rows).toBe(3);
    expect(MINI_FORMAT.columns).toBe(3);
    expect(MINI_FORMAT.categoryCount).toBe(3);
    expect(MINI_FORMAT.answersPerCategory).toBe(3);
    expect(MINI_FORMAT.tileCount).toBe(9);
    expect(MINI_FORMAT.maxMistakes).toBe(4);
    expect(MINI_FORMAT.colorOrder).toEqual(["green", "blue", "red"]);
    expect(MINI_FORMAT.difficultyOrder).toEqual([2, 3, 4]);
    // A Mini CAN carry a Rainbow. Whether a given Mini does is a property of
    // that puzzle's content, not of the format — see rainbowHerringFor.
    expect(MINI_FORMAT.hasRainbow).toBe(true);
    // ...but a NEW Mini starts Classic, so Rainbow stays opt-in per puzzle.
    expect(MINI_FORMAT.defaultBuilderStyle).toBe("classic");
  });

  it("leaves the Full 4x4 exactly as it was", () => {
    expect(FULL_FORMAT.categoryCount).toBe(4);
    expect(FULL_FORMAT.answersPerCategory).toBe(4);
    expect(FULL_FORMAT.tileCount).toBe(16);
    expect(FULL_FORMAT.maxMistakes).toBe(4);
    expect(FULL_FORMAT.colorOrder).toEqual(["yellow", "green", "blue", "red"]);
    expect(FULL_FORMAT.hasRainbow).toBe(true);
    // A new Full still starts on Rainbow, as it always has.
    expect(FULL_FORMAT.defaultBuilderStyle).toBe("rainbow");
    // Full shows no clock — the timer is a Mini feature.
    expect(FULL_FORMAT.showsTimer).toBe(false);
    // The Full progress namespace is empty on purpose: every already-saved
    // board is stored un-prefixed and must keep resuming.
    expect(FULL_FORMAT.progressNamespace).toBe("");
  });

  it("treats anything without a format as Full (test 19, client half)", () => {
    expect(formatOf(undefined).id).toBe("full");
    expect(formatOf({}).id).toBe("full");
    expect(formatOf({ format: null }).id).toBe("full");
    expect(formatOf(fullPuzzle).id).toBe("full");
    expect(formatOf(miniPuzzle).id).toBe("mini");
  });

  it("derives One Away as all-but-one, not the literal three", () => {
    expect(oneAwayThreshold(FULL_FORMAT)).toBe(3);
    expect(oneAwayThreshold(MINI_FORMAT)).toBe(2);
  });

  it("answers the Rainbow question PER PUZZLE, sized to the format", () => {
    // A Classic Mini — no herring stored — has no Rainbow.
    expect(rainbowHerringFor(miniPuzzle)).toBeNull();
    // A Rainbow Mini is THREE answers, one per category.
    expect(rainbowHerringFor({ ...miniPuzzle, rainbowHerring: ["g1", "b1", "r1"] })).toEqual([
      "g1", "b1", "r1",
    ]);
    // A Full Rainbow is four. The length is checked against the format's own
    // category count, so a four-answer herring on a Mini is not a Rainbow at
    // all rather than a mis-sized one.
    expect(rainbowHerringFor(fullPuzzle)).toEqual(["y1", "gg1", "bb1", "rr1"]);
    expect(
      rainbowHerringFor({ ...miniPuzzle, rainbowHerring: ["g1", "b1", "r1", "g2"] })
    ).toBeNull();
    expect(rainbowHerringFor({ ...fullPuzzle, rainbowHerring: ["y1", "gg1", "bb1"] })).toBeNull();
  });
});

// ───────────────────────────────────────────────────────────────────────────
// Gameplay (tests 2-9)
// ───────────────────────────────────────────────────────────────────────────

describe("gameplay selection limits", () => {
  it("2. Full still requires four selected answers", async () => {
    const view = mount(fullPuzzle);
    await act(async () => {
      for (const w of ["y1", "y2", "y3", "y4", "gg1"]) view.result.current.toggleWord(w);
    });
    // The fifth selection is refused: a guess is one category's worth.
    expect(view.result.current.state.selectedWords).toEqual(["y1", "y2", "y3", "y4"]);

    // Three selected is not submittable on Full.
    await act(async () => { view.result.current.deselectAll(); });
    await act(async () => { for (const w of ["y1", "y2", "y3"]) view.result.current.toggleWord(w); });
    await act(async () => { view.result.current.submitGuess(); });
    await settle();
    expect(view.result.current.state.guessHistory).toHaveLength(0);
  });

  it("3. Mini requires exactly three", async () => {
    const view = mount(miniPuzzle);
    await act(async () => {
      for (const w of ["g1", "g2", "g3", "b1"]) view.result.current.toggleWord(w);
    });
    expect(view.result.current.state.selectedWords).toEqual(["g1", "g2", "g3"]);

    // Two selected is not submittable on Mini.
    await act(async () => { view.result.current.deselectAll(); });
    await act(async () => { for (const w of ["g1", "g2"]) view.result.current.toggleWord(w); });
    await act(async () => { view.result.current.submitGuess(); });
    await settle();
    expect(view.result.current.state.guessHistory).toHaveLength(0);
  });
});

describe("Mini guess resolution", () => {
  it("4. correct guesses solve Green, Blue and Red", async () => {
    const view = mount(miniPuzzle);
    await guess(view, ["g1", "g2", "g3"]);
    await guess(view, ["b1", "b2", "b3"]);

    // Solve order is recorded by COLOUR, from the format's own ladder.
    const solved = view.result.current.state.solvedGroups.map(
      (i) => miniPuzzle.groups[i].difficulty
    );
    expect(solved).toEqual([2, 3]);

    await guess(view, ["r1", "r2", "r3"]);
    expect(view.result.current.state.isWon).toBe(true);
    expect(view.result.current.state.solvedGroups).toHaveLength(3);
  });

  it("5. One Away fires for exactly two answers from one unsolved group", async () => {
    const view = mount(miniPuzzle);
    await guess(view, ["g1", "g2", "b1"]);
    expect(view.result.current.oneAway).toBe(true);
    const attempt = view.result.current.state.guessHistory[0];
    expect(attempt.isCorrect).toBe(false);
    expect(attempt.isOneAway).toBe(true);
  });

  it("6. a mixed Mini guess is NOT One Away", async () => {
    const view = mount(miniPuzzle);
    // One from each category — no category contributes two.
    await guess(view, ["g1", "b1", "r1"]);
    expect(view.result.current.oneAway).toBe(false);
    expect(view.result.current.state.guessHistory[0].isOneAway).toBe(false);
  });

  it("a CLASSIC Mini has no Rainbow to find", async () => {
    const view = mount(miniPuzzle);
    // One word from each of the 3 categories is the Rainbow SHAPE, and on a
    // Rainbow Mini it would be the winning guess. This puzzle is Classic, so
    // there is nothing to find: the guess is an ordinary miss.
    await guess(view, ["g1", "b1", "r1"]);
    expect(view.result.current.rainbowHerring).toBeNull();
    expect(view.result.current.state.gotRainbow).toBe(false);
    expect(view.result.current.state.guessHistory[0].isRainbow).toBeFalsy();
    expect(view.result.current.state.mistakes).toBe(1);
  });

  it("7. four Mini mistakes end the game as a loss", async () => {
    const view = mount(miniPuzzle);
    await guess(view, ["g1", "b1", "r1"]);
    await guess(view, ["g1", "b1", "r2"]);
    await guess(view, ["g1", "b1", "r3"]);
    expect(view.result.current.state.isComplete).toBe(false);
    expect(view.result.current.state.mistakes).toBe(3);

    await guess(view, ["g1", "b2", "r1"]);
    expect(view.result.current.state.mistakes).toBe(4);
    expect(view.result.current.state.isComplete).toBe(true);
    expect(view.result.current.state.isWon).toBe(false);
    expect(view.result.current.state.maxMistakes).toBe(4);

    // A loss reveals the unsolved categories one at a time, easiest first,
    // on a real multi-second cascade (800ms + 1500ms each in useGame). This
    // waits it out rather than leaving its timers to fire during a later
    // test — and while waiting, checks it actually reveals all three Mini
    // categories in Green -> Blue -> Red order.
    await act(async () => { await new Promise((r) => setTimeout(r, 800 + 3 * 1500)); });
    expect(view.result.current.state.solvedGroups).toEqual([0, 1, 2]);
    expect(
      view.result.current.state.solvedGroups.map((i) => miniPuzzle.groups[i].difficulty)
    ).toEqual([2, 3, 4]);
  });

  it("8/9. the final category is not auto-solved — the player must submit it", async () => {
    const view = mount(miniPuzzle);
    await guess(view, ["g1", "g2", "g3"]);
    await guess(view, ["b1", "b2", "b3"]);

    // Two solved, the last three tiles still on the board, game not over.
    expect(view.result.current.state.solvedGroups).toHaveLength(2);
    expect(view.result.current.state.isComplete).toBe(false);
    expect(view.result.current.state.isWon).toBe(false);
    expect([...view.result.current.remainingWords].sort()).toEqual(["r1", "r2", "r3"]);

    await guess(view, ["r1", "r2", "r3"]);
    expect(view.result.current.state.isWon).toBe(true);
    expect(view.result.current.state.isComplete).toBe(true);
  });
});

// ───────────────────────────────────────────────────────────────────────────
// Persistence and isolation (tests 10, 11, 13)
// ───────────────────────────────────────────────────────────────────────────

describe("Mini progress", () => {
  it("10. survives a reload and hydrates back onto the same board", async () => {
    const view = mount(miniPuzzle);
    await guess(view, ["g1", "g2", "g3"]);
    await guess(view, ["b1", "b2", "r1"]); // one mistake
    view.unmount();

    const resumed = mount(miniPuzzle);
    await settle();
    expect(resumed.result.current.state.solvedGroups).toHaveLength(1);
    expect(resumed.result.current.state.mistakes).toBe(1);
    expect([...resumed.result.current.remainingWords].sort()).toEqual(
      ["b1", "b2", "b3", "r1", "r2", "r3"]
    );
  });

  it("11. Full and Mini local progress never collide", async () => {
    const mini = mount(miniPuzzle);
    await guess(mini, ["g1", "g2", "g3"]);

    const full = mount(fullPuzzle);
    await guess(full, ["y1", "y2", "y3", "y4"]);
    await guess(full, ["gg1", "gg2", "gg3", "gg4"]);

    // Two distinct blobs under two distinct keys.
    const miniKey = progressStorageId(MINI_ID, MINI_FORMAT);
    const fullKey = progressStorageId(FULL_ID, FULL_FORMAT);
    expect(miniKey).toBe(`mini:${MINI_ID}`);
    // Full keeps the BARE id, so every board already in progress resumes.
    expect(fullKey).toBe(FULL_ID);

    expect(loadProgress(miniKey)?.solvedGroups).toHaveLength(1);
    expect(loadProgress(fullKey)?.solvedGroups).toHaveLength(2);
    expect(localStorage.getItem(progressKey(miniKey))).not.toBeNull();
    expect(localStorage.getItem(progressKey(fullKey))).not.toBeNull();

    // Resetting one leaves the other untouched.
    localStorage.removeItem(progressKey(miniKey));
    expect(loadProgress(miniKey)).toBeNull();
    expect(loadProgress(fullKey)?.solvedGroups).toHaveLength(2);
  });

  it("a same-date Full and Mini can both be played independently", async () => {
    // Same date, different formats, both in progress at once.
    expect(miniPuzzle.date).toBe(fullPuzzle.date);

    const mini = mount(miniPuzzle);
    await guess(mini, ["g1", "g2", "g3"]);
    const full = mount(fullPuzzle);
    await guess(full, ["y1", "y2", "y3", "y4"]);

    expect(mini.result.current.state.solvedGroups).toHaveLength(1);
    expect(full.result.current.state.solvedGroups).toHaveLength(1);

    // Two separate durable sessions, each stamped with its own format.
    await settle();
    const formats = db.tables.game_sessions.map((s) => s.format ?? "full").sort();
    expect(formats).toEqual(["full", "mini"]);
    mini.unmount();
    full.unmount();
  });

  it("13. Reset and Replay start a genuinely new Mini run", async () => {
    const view = mount(miniPuzzle);
    await guess(view, ["g1", "g2", "g3"]);
    const firstRunId = loadProgress(progressStorageId(MINI_ID, MINI_FORMAT))?.runId;
    expect(firstRunId).toBeTruthy();
    view.unmount();

    // Reset/Replay is "clear this attempt's blob, then remount" — the same
    // thing CustomPuzzle's Replay button does.
    localStorage.removeItem(progressKey(progressStorageId(MINI_ID, MINI_FORMAT)));

    const replay = mount(miniPuzzle);
    await settle();
    expect(replay.result.current.state.solvedGroups).toEqual([]);
    expect(replay.result.current.state.mistakes).toBe(0);
    expect(replay.result.current.remainingWords).toHaveLength(9);

    await guess(replay, ["g1", "g2", "g3"]);
    const secondRunId = loadProgress(progressStorageId(MINI_ID, MINI_FORMAT))?.runId;
    expect(secondRunId).toBeTruthy();
    expect(secondRunId).not.toBe(firstRunId);
  });
});

// ───────────────────────────────────────────────────────────────────────────
// Statistics and streaks (test 12)
// ───────────────────────────────────────────────────────────────────────────

describe("12. statistics and streaks stay isolated", () => {
  it("a Mini completion touches no Full stat, and vice versa", async () => {
    // Win the Mini.
    const mini = mount(miniPuzzle);
    await guess(mini, ["g1", "g2", "g3"]);
    await guess(mini, ["b1", "b2", "b3"]);
    await guess(mini, ["r1", "r2", "r3"]);
    await settle();

    const fullStats = await loadStatsFromSupabase(FULL_FORMAT);
    const miniStats = await loadStatsFromSupabase(MINI_FORMAT);

    expect(miniStats.gamesPlayed).toBe(1);
    expect(miniStats.gamesWon).toBe(1);
    expect(miniStats.currentStreak).toBe(1);

    // The Full record is untouched: no Played, no win, no streak.
    expect(fullStats.gamesPlayed).toBe(0);
    expect(fullStats.gamesWon).toBe(0);
    expect(fullStats.currentStreak).toBe(0);
    expect(fullStats.guessDistribution.every((n) => n === 0)).toBe(true);

    // Now win the Full, on the same date.
    const full = mount(fullPuzzle);
    await guess(full, ["y1", "y2", "y3", "y4"]);
    await guess(full, ["gg1", "gg2", "gg3", "gg4"]);
    await guess(full, ["bb1", "bb2", "bb3", "bb4"]);
    await guess(full, ["rr1", "rr2", "rr3", "rr4"]);
    await settle();

    const fullAfter = await loadStatsFromSupabase(FULL_FORMAT);
    const miniAfter = await loadStatsFromSupabase(MINI_FORMAT);

    expect(fullAfter.gamesPlayed).toBe(1);
    expect(fullAfter.currentStreak).toBe(1);
    // Both counted correctly, neither doubled.
    expect(miniAfter.gamesPlayed).toBe(1);
    expect(miniAfter.currentStreak).toBe(1);

    // Two separate streak rows, one per format.
    const streakFormats = db.tables.user_streaks.map((r) => r.format ?? "full").sort();
    expect(streakFormats).toEqual(["full", "mini"]);
  });

  it("a Mini loss does not break the Full streak", async () => {
    // Establish a Full streak first.
    const full = mount(fullPuzzle);
    await guess(full, ["y1", "y2", "y3", "y4"]);
    await guess(full, ["gg1", "gg2", "gg3", "gg4"]);
    await guess(full, ["bb1", "bb2", "bb3", "bb4"]);
    await guess(full, ["rr1", "rr2", "rr3", "rr4"]);
    await settle();
    expect((await loadStatsFromSupabase(FULL_FORMAT)).currentStreak).toBe(1);

    // Lose the Mini.
    const mini = mount(miniPuzzle);
    await guess(mini, ["g1", "b1", "r1"]);
    await guess(mini, ["g1", "b1", "r2"]);
    await guess(mini, ["g1", "b1", "r3"]);
    await guess(mini, ["g1", "b2", "r1"]);
    await settle();

    expect((await loadStatsFromSupabase(FULL_FORMAT)).currentStreak).toBe(1);
    expect((await loadStatsFromSupabase(FULL_FORMAT)).gamesPlayed).toBe(1);
  });

  it("reports no Rainbow rate for a format that has no Rainbow", async () => {
    const mini = mount(miniPuzzle);
    await guess(mini, ["g1", "g2", "g3"]);
    await guess(mini, ["b1", "b2", "b3"]);
    await guess(mini, ["r1", "r2", "r3"]);
    await settle();
    const stats = await loadStatsFromSupabase(MINI_FORMAT);
    expect(stats.rainbowSpotRate).toBeNull();
    expect(stats.rainbowSpottedCount).toBe(0);
  });

  it("counts a Mini solved Green->Blue->Red as In Order", async () => {
    const mini = mount(miniPuzzle);
    await guess(mini, ["g1", "g2", "g3"]);
    await guess(mini, ["b1", "b2", "b3"]);
    await guess(mini, ["r1", "r2", "r3"]);
    await settle();
    const stats = await loadStatsFromSupabase(MINI_FORMAT);
    // The Mini ascending order is green->blue->red, not the Full
    // orange->green->blue->red.
    expect(stats.inOrderCount).toBe(1);
  });
});

// ───────────────────────────────────────────────────────────────────────────
// Share output (tests 14, 15)
// ───────────────────────────────────────────────────────────────────────────

describe("share output", () => {
  it("14. a Mini share grid is 3 columns with no Rainbow data", async () => {
    const view = mount(miniPuzzle);
    await guess(view, ["g1", "b1", "r1"]);     // incorrect, mixed
    await guess(view, ["g1", "g2", "g3"]);     // green
    await guess(view, ["b1", "b2", "b3"]);     // blue
    await guess(view, ["r1", "r2", "r3"]);     // red
    await settle();

    const session = db.tables.game_sessions.find((s) => s.puzzle_id === MINI_ID);
    const grid = String(session?.share_grid ?? "");
    const lines = grid.split("\n");

    expect(lines).toHaveLength(4);
    for (const line of lines) {
      expect([...line]).toHaveLength(3);
    }
    expect(lines[1]).toBe("🟩🟩🟩");
    expect(lines[2]).toBe("🟦🟦🟦");
    expect(lines[3]).toBe("🟥🟥🟥");
    // No Rainbow row and no yellow square anywhere.
    expect(grid).not.toContain("🌈");
    expect(grid).not.toContain("🟨");
  });

  it("14. the Mini share text leads with the puzzle's own title and links the Mini Daily", () => {
    const text = buildOfficialShareText("Mini #1", ["🟩🟩🟩", "🟦🟦🟦", "🟥🟥🟥"], MINI_FORMAT);
    // The admin's title verbatim — NOT "Puzzle Mini #1".
    expect(text.split("\n")[0]).toBe("Mini #1");
    expect(text).not.toContain("Puzzle Mini #1");
    expect(text.trim().split("\n").pop()).toBe("rainbowcategories.com/mini");
  });

  it("15. the Full share output is unchanged", async () => {
    const view = mount(fullPuzzle);
    await guess(view, ["y1", "y2", "y3", "y4"]);
    await guess(view, ["gg1", "gg2", "gg3", "gg4"]);
    await guess(view, ["bb1", "bb2", "bb3", "bb4"]);
    await guess(view, ["rr1", "rr2", "rr3", "rr4"]);
    await settle();

    const session = db.tables.game_sessions.find((s) => s.puzzle_id === FULL_ID);
    expect(session?.share_grid).toBe("🟨🟨🟨🟨\n🟩🟩🟩🟩\n🟦🟦🟦🟦\n🟥🟥🟥🟥");

    // And the Full share TEXT is byte-for-byte what it has always been:
    // header, rows, bare domain — no format name, no /mini path.
    const text = buildOfficialShareText("F1", ["🟨🟨🟨🟨"]);
    expect(text).toBe("Puzzle F1\n🟨🟨🟨🟨\nrainbowcategories.com");
  });

  it("a Full Rainbow row is still four wide", async () => {
    const view = mount(fullPuzzle);
    await guess(view, ["y1", "gg1", "bb1", "rr1"]); // the herring
    await settle();
    expect(view.result.current.state.gotRainbow).toBe(true);
    await guess(view, ["y1", "y2", "y3", "y4"]);
    await guess(view, ["gg1", "gg2", "gg3", "gg4"]);
    await guess(view, ["bb1", "bb2", "bb3", "bb4"]);
    await guess(view, ["rr1", "rr2", "rr3", "rr4"]);
    await settle();
    const session = db.tables.game_sessions.find((s) => s.puzzle_id === FULL_ID);
    expect(String(session?.share_grid).split("\n")[0]).toBe("🌈🌈🌈🌈");
  });
});

// ───────────────────────────────────────────────────────────────────────────
// Builder (tests 16, 17)
// ───────────────────────────────────────────────────────────────────────────

const MINI_ANSWERS = [
  ["Hood", "Tire", "Trunk"],
  ["Mars", "Mercury", "Swift"],
  ["Bird", "Dog", "White"],
];

function fillMini(result: { current: ReturnType<typeof useBuilderForm> }) {
  act(() => {
    MINI_ANSWERS.forEach((words, i) => {
      result.current.updateCategoryName(i, `Cat ${i + 1}`);
      result.current.updateAnswersRaw(i, words.join(", "));
    });
  });
}

describe("16/17. the shared builder runs both formats", () => {
  it("starts a Mini with three Green/Blue/Red cards of three answers", () => {
    const { result } = renderHook(() => useBuilderForm("mini"));
    expect(result.current.format.id).toBe("mini");
    expect(result.current.groups).toHaveLength(3);
    expect(result.current.groups.map((g) => g.difficulty)).toEqual([2, 3, 4]);
    expect(result.current.groups.every((g) => g.answers.length === 3)).toBe(true);
    // Nine board positions exist from the first render, blank or not.
    expect(result.current.wordOrderIds).toHaveLength(9);
    expect(new Set(result.current.wordOrderIds).size).toBe(9);
    // A Mini is always Classic — there is no Rainbow to choose.
    expect(result.current.style).toBe("classic");
    expect(result.current.rainbowComplete).toBe(false);
  });

  it("becomes complete only once all nine unique answers are entered", () => {
    const { result } = renderHook(() => useBuilderForm("mini"));
    expect(result.current.hasAll16).toBe(false);
    fillMini(result);
    expect(result.current.hasAll16).toBe(true);
    expect(result.current.hasAllAnswers).toBe(true);

    // A duplicate across categories makes it invalid again.
    act(() => { result.current.updateAnswersRaw(2, "Bird, Dog, Mars"); });
    expect(result.current.hasAll16).toBe(false);
  });

  it("17. keeps identity and board order through trailing-comma editing", () => {
    const { result } = renderHook(() => useBuilderForm("mini"));
    fillMini(result);
    const idsBefore = result.current.groups[0].answers.map((a) => a.id);
    const orderBefore = [...result.current.wordOrderIds];

    // Typing a trailing comma, then a replacement word, then removing the
    // comma again — the sequence that used to strand an answer with no tile.
    act(() => { result.current.updateAnswersRaw(0, "Hood, Tire, Trunk,"); });
    act(() => { result.current.updateAnswersRaw(0, "Hood, Tire, Trunk, "); });
    act(() => { result.current.updateAnswersRaw(0, "Hood, Tire, Bumper"); });

    const idsAfter = result.current.groups[0].answers.map((a) => a.id);
    // Three answers, all still on the board's own nine positions.
    expect(idsAfter).toHaveLength(3);
    expect(idsAfter.every((id) => orderBefore.includes(id))).toBe(true);
    // The two untouched answers kept their exact identities.
    expect(idsAfter[0]).toBe(idsBefore[0]);
    expect(idsAfter[1]).toBe(idsBefore[1]);
    // No orphaned ids: the board still names exactly nine distinct slots.
    expect(result.current.wordOrderIds).toHaveLength(9);
    expect(new Set(result.current.wordOrderIds).size).toBe(9);
    expect(result.current.hasAll16).toBe(true);
  });

  it("reorders Mini categories without losing content or colours", () => {
    const { result } = renderHook(() => useBuilderForm("mini"));
    fillMini(result);
    act(() => { result.current.moveGroup(0, 2); });
    // The card that was easiest is now hardest — content travels, colour is
    // reassigned from the destination slot.
    expect(result.current.groups.map((g) => g.difficulty)).toEqual([2, 3, 4]);
    expect(result.current.groups[2].answersRaw).toBe("Hood, Tire, Trunk");
    // An out-of-range move is a no-op (the bound is the format's own count).
    act(() => { result.current.moveGroup(0, 3); });
    expect(result.current.groups).toHaveLength(3);
  });

  it("Start Over keeps the currently selected format", () => {
    const { result } = renderHook(() => useBuilderForm("mini"));
    fillMini(result);
    act(() => { result.current.reset(); });
    expect(result.current.format.id).toBe("mini");
    expect(result.current.groups).toHaveLength(3);
    expect(result.current.hasAll16).toBe(false);
  });

  it("switching format produces a blank form in the new size", () => {
    const { result } = renderHook(() => useBuilderForm());
    expect(result.current.format.id).toBe("full");
    expect(result.current.isDirty).toBe(false);

    act(() => { result.current.updateCategoryName(0, "Something"); });
    // isDirty is the signal the shell uses to decide whether to confirm.
    expect(result.current.isDirty).toBe(true);

    act(() => { result.current.changeFormat("mini"); });
    expect(result.current.format.id).toBe("mini");
    expect(result.current.groups).toHaveLength(3);
    expect(result.current.isDirty).toBe(false);
  });

  it("loading preserves a puzzle's saved format and never silently changes it", () => {
    const { result } = renderHook(() => useBuilderForm("mini"));
    // Loading a FULL puzzle into a form currently on Mini switches to Full,
    // because the loaded puzzle's own format wins.
    act(() => {
      result.current.load({
        format: "full",
        groups: fullPuzzle.groups.map((g) => ({
          category: g.category, words: g.words, difficulty: g.difficulty, hintWord: null,
        })),
        wordOrder: null,
        rainbowHerring: fullPuzzle.rainbowHerring,
        rainbowCategoryName: "Rainbow",
        rainbowHintWord: "",
        theme: "",
        alphabetizeCompleted: true,
        style: "rainbow",
      });
    });
    expect(result.current.format.id).toBe("full");
    expect(result.current.groups).toHaveLength(4);

    // And a source with NO format loads as Full — every existing puzzle and
    // every draft saved before Mini.
    act(() => {
      result.current.load({
        groups: fullPuzzle.groups.map((g) => ({
          category: g.category, words: g.words, difficulty: g.difficulty, hintWord: null,
        })),
        wordOrder: null,
        rainbowHerring: null,
        rainbowCategoryName: "",
        rainbowHintWord: "",
        theme: "",
        alphabetizeCompleted: true,
      });
    });
    expect(result.current.format.id).toBe("full");
  });

  it("loads a saved Mini back as a Mini", () => {
    const { result } = renderHook(() => useBuilderForm());
    act(() => {
      result.current.load({
        format: "mini",
        groups: miniPuzzle.groups.map((g) => ({
          category: g.category, words: g.words, difficulty: g.difficulty, hintWord: null,
        })),
        wordOrder: ["r1", "g1", "b1", "g2", "b2", "r2", "g3", "b3", "r3"],
        rainbowHerring: null,
        rainbowCategoryName: "",
        rainbowHintWord: "",
        theme: "",
        alphabetizeCompleted: true,
        // What Admin passes for a stored puzzle with no Rainbow — see its
        // hasStoredRainbow.
        style: "classic",
      });
    });
    expect(result.current.format.id).toBe("mini");
    expect(result.current.groups).toHaveLength(3);
    expect(result.current.wordOrderIds).toHaveLength(9);
    // The saved opening layout is preserved, not reshuffled.
    expect(result.current.textsFor(result.current.wordOrderIds)).toEqual([
      "r1", "g1", "b1", "g2", "b2", "r2", "g3", "b3", "r3",
    ]);
    expect(result.current.style).toBe("classic");
    expect(result.current.rainbowComplete).toBe(false);
  });

  it("loads a saved RAINBOW Mini back with its three selections intact", () => {
    const { result } = renderHook(() => useBuilderForm());
    act(() => {
      result.current.load({
        format: "mini",
        groups: miniPuzzle.groups.map((g) => ({
          category: g.category, words: g.words, difficulty: g.difficulty, hintWord: null,
        })),
        wordOrder: ["r1", "g1", "b1", "g2", "b2", "r2", "g3", "b3", "r3"],
        // Stored in DISPLAY order, which is not group order — the builder has
        // to match each answer to the group that actually contains it.
        rainbowHerring: ["r2", "g3", "b1"],
        rainbowCategoryName: "Hidden Trio",
        rainbowHintWord: "clue",
        rainbowCategoryEmoji: "🌈",
        theme: "",
        alphabetizeCompleted: true,
        style: "rainbow",
      });
    });
    expect(result.current.format.id).toBe("mini");
    expect(result.current.style).toBe("rainbow");
    // One selection per category, each resolved back to the RIGHT group.
    expect(result.current.rainbowHerringIds).toHaveLength(3);
    expect(result.current.rainbowComplete).toBe(true);
    expect(result.current.textsFor(result.current.rainbowHerringIds as string[])).toEqual([
      "g3", "b1", "r2",
    ]);
    // The saved display order is preserved as saved.
    expect(result.current.textsFor(result.current.rainbowWordOrderIds)).toEqual(["r2", "g3", "b1"]);
    expect(result.current.rainbowCategoryName).toBe("Hidden Trio");
    expect(result.current.rainbowHintWord).toBe("clue");
    expect(result.current.rainbowCategoryEmoji).toBe("🌈");
  });
});

// ───────────────────────────────────────────────────────────────────────────
// Payload + database validation (tests 18, 19, 16-save)
// ───────────────────────────────────────────────────────────────────────────

/** A valid Mini content payload, built through the REAL builder + payload code. */
function miniContentPayload() {
  const { result } = renderHook(() => useBuilderForm("mini"));
  fillMini(result);
  return buildContentPayload(builderContentInput(result.current, false));
}

function fullContentPayload() {
  const { result } = renderHook(() => useBuilderForm());
  act(() => {
    [
      ["Blue", "Green", "Red", "Yellow"],
      ["Battery", "Hood", "Tire", "Trunk"],
      ["Houston", "Mars", "Mercury", "Swift"],
      ["Bird", "Dog", "Tree", "White"],
    ].forEach((words, i) => {
      result.current.updateCategoryName(i, `Cat ${i + 1}`);
      result.current.updateAnswersRaw(i, words.join(", "));
    });
  });
  return buildContentPayload(builderContentInput(result.current, false));
}

describe("18. database validation accepts Mini and rejects mismatches", () => {
  beforeEach(() => {
    db.signIn("admin-user", { admin: true });
  });

  it("the builder produces a payload the save path accepts", async () => {
    const content = miniContentPayload();
    expect(content.format).toBe("mini");
    expect(content.groups).toHaveLength(3);
    expect(content.groups.map((g) => g.difficulty)).toEqual([2, 3, 4]);
    expect(content.word_order).toHaveLength(9);
    expect(content.rainbow_herring).toBeNull();

    const { data, error } = await db.rpc("admin_save_puzzle", {
      _puzzle_id: null,
      _metadata: { date: "2026-10-01", is_published: true },
      _content: content,
    });
    expect(error).toBeNull();
    expect((data as { format?: string })?.format).toBe("mini");

    const saved = db.tables.puzzles.find((p) => p.id === (data as { puzzle_id: string }).puzzle_id);
    expect(saved?.format).toBe("mini");
    expect(db.tables.puzzle_groups.filter((g) => g.puzzle_id === saved?.id)).toHaveLength(3);
  });

  it("16. an admin can save, reload and re-edit a Mini", async () => {
    const { data } = await db.rpc("admin_save_puzzle", {
      _puzzle_id: null,
      _metadata: { date: "2026-10-02", is_published: true },
      _content: miniContentPayload(),
    });
    const pid = (data as { puzzle_id: string }).puzzle_id;

    // Reload it exactly as Admin's editPuzzle does.
    const row = db.tables.puzzles.find((p) => p.id === pid)!;
    const groups = db.tables.puzzle_groups
      .filter((g) => g.puzzle_id === pid)
      .sort((a, b) => (a.sort_order as number) - (b.sort_order as number));

    const { result } = renderHook(() => useBuilderForm());
    act(() => {
      result.current.load({
        format: row.format as "mini",
        groups: groups.map((g) => ({
          category: g.category as string,
          words: g.words as string[],
          difficulty: g.difficulty as 2 | 3 | 4,
          hintWord: (g.hint_word as string | null) ?? null,
        })),
        wordOrder: row.word_order as string[],
        rainbowHerring: null,
        rainbowCategoryName: "",
        rainbowHintWord: "",
        theme: "",
        alphabetizeCompleted: true,
      });
    });
    expect(result.current.format.id).toBe("mini");
    expect(result.current.groups).toHaveLength(3);

    // Re-saving the untouched content creates NO new version.
    const resave = await db.rpc("admin_save_puzzle", {
      _puzzle_id: pid,
      _metadata: { date: "2026-10-02", is_published: true },
      _content: buildContentPayload(builderContentInput(result.current, false)),
    });
    expect(resave.error).toBeNull();
    expect((resave.data as { created_version: boolean }).created_version).toBe(false);

    // An actual edit does.
    act(() => { result.current.updateAnswersRaw(0, "Hood, Tire, Bumper"); });
    const edited = await db.rpc("admin_save_puzzle", {
      _puzzle_id: pid,
      _metadata: { date: "2026-10-02", is_published: true },
      _content: buildContentPayload(builderContentInput(result.current, false)),
    });
    expect(edited.error).toBeNull();
    expect((edited.data as { created_version: boolean }).created_version).toBe(true);
  });

  it("rejects a Mini claiming four groups", async () => {
    const bad = { ...fullContentPayload(), format: "mini" as const };
    const { error } = await db.rpc("admin_save_puzzle", {
      _puzzle_id: null,
      _metadata: { date: "2026-10-03" },
      _content: bad,
    });
    expect(error?.message).toMatch(/exactly 3 groups/);
  });

  it("rejects a Full claiming three groups", async () => {
    const mini = miniContentPayload();
    const bad = { ...mini };
    delete (bad as { format?: string }).format;
    const { error } = await db.rpc("admin_save_puzzle", {
      _puzzle_id: null,
      _metadata: { date: "2026-10-04" },
      _content: bad,
    });
    expect(error?.message).toMatch(/exactly 4 groups/);
  });

  it("rejects a Mini group with four answers", async () => {
    const content = miniContentPayload();
    content.groups[0] = { ...content.groups[0], words: ["Hood", "Tire", "Trunk", "Bumper"] };
    const { error } = await db.rpc("admin_save_puzzle", {
      _puzzle_id: null,
      _metadata: { date: "2026-10-05" },
      _content: content,
    });
    expect(error?.message).toMatch(/exactly 3 words/);
  });

  it("rejects a Mini whose difficulties are not Green/Blue/Red", async () => {
    const content = miniContentPayload();
    content.groups = content.groups.map((g, i) => ({ ...g, difficulty: i + 1 }));
    const { error } = await db.rpc("admin_save_puzzle", {
      _puzzle_id: null,
      _metadata: { date: "2026-10-06" },
      _content: content,
    });
    expect(error?.message).toMatch(/difficulties between 2 and 4/);
  });

  it("ACCEPTS a Rainbow Mini of one answer per category", async () => {
    const content = miniContentPayload();
    // One from Green, one from Blue, one from Red — stored uppercase, as the
    // builder normalises every word (see wordNormalization.ts).
    const rainbow = {
      ...content,
      rainbow_herring: ["HOOD", "MARS", "BIRD"],
      rainbow_category_name: "Hidden Trio",
      rainbow_hint_word: "clue",
      rainbow_category_emoji: "🌈",
    };
    const { data, error } = await db.rpc("admin_save_puzzle", {
      _puzzle_id: null,
      _metadata: { date: "2026-10-07" },
      _content: rainbow,
    });
    expect(error).toBeNull();
    expect((data as { puzzle_id?: string } | null)?.puzzle_id).toBeTruthy();
  });

  it("rejects a Mini Rainbow taking two answers from the same category", async () => {
    const content = miniContentPayload();
    // HOOD and TIRE are both in the Green category; nothing from Red.
    const bad = { ...content, rainbow_herring: ["HOOD", "TIRE", "MARS"] };
    const { error } = await db.rpc("admin_save_puzzle", {
      _puzzle_id: null,
      _metadata: { date: "2026-10-21" },
      _content: bad,
    });
    expect(error?.message).toMatch(/exactly one Rainbow answer/);
  });

  it("rejects a Mini Rainbow of four answers", async () => {
    const content = miniContentPayload();
    const bad = { ...content, rainbow_herring: ["HOOD", "MARS", "BIRD", "DOG"] };
    const { error } = await db.rpc("admin_save_puzzle", {
      _puzzle_id: null,
      _metadata: { date: "2026-10-22" },
      _content: bad,
    });
    expect(error?.message).toMatch(/exactly 3 words/);
  });

  it("rejects a word_order that is not the whole Mini board", async () => {
    const content = miniContentPayload();
    const bad = { ...content, word_order: content.word_order!.slice(0, 8) };
    const { error } = await db.rpc("admin_save_puzzle", {
      _puzzle_id: null,
      _metadata: { date: "2026-10-08" },
      _content: bad,
    });
    expect(error?.message).toMatch(/all 9 words/);
  });

  it("rejects a word_order answer that is not on the board", async () => {
    const content = miniContentPayload();
    const bad = { ...content, word_order: [...content.word_order!.slice(0, 8), "NOTHERE"] };
    const { error } = await db.rpc("admin_save_puzzle", {
      _puzzle_id: null,
      _metadata: { date: "2026-10-09" },
      _content: bad,
    });
    expect(error?.message).toMatch(/is not one of this puzzle's 9 words/);
  });

  it("refuses to change an existing puzzle's format", async () => {
    const { data } = await db.rpc("admin_save_puzzle", {
      _puzzle_id: null,
      _metadata: { date: "2026-10-10", is_published: true },
      _content: miniContentPayload(),
    });
    const pid = (data as { puzzle_id: string }).puzzle_id;
    const { error } = await db.rpc("admin_save_puzzle", {
      _puzzle_id: pid,
      _metadata: { date: "2026-10-10" },
      _content: fullContentPayload(),
    });
    expect(error?.message).toMatch(/cannot change format/);
  });

  it("19. an existing Full payload with no format still validates as Full", async () => {
    const content = fullContentPayload();
    // The Full payload carries NO format key at all — that is the whole
    // backward-compatibility contract.
    expect("format" in content).toBe(false);
    const { data, error } = await db.rpc("admin_save_puzzle", {
      _puzzle_id: null,
      _metadata: { date: "2026-10-11", is_published: true },
      _content: content,
    });
    expect(error).toBeNull();
    expect((data as { format?: string })?.format).toBe("full");
    const saved = db.tables.puzzles.find((p) => p.id === (data as { puzzle_id: string }).puzzle_id);
    expect(saved?.format).toBe("full");
  });
});

describe("18. custom-puzzle validation is format-aware", () => {
  it("accepts a Mini custom payload and rejects a mismatched one", async () => {
    const good = {
      format: "mini",
      mode: "classic",
      groups: MINI_ANSWERS.map((words, i) => ({
        category: `Cat ${i + 1}`,
        words,
        hint_word: null,
      })),
      word_order: MINI_ANSWERS.flat(),
      alphabetize_completed: true,
    };
    const created = await db.rpc("create_custom_puzzle", {
      _creator_name: "Tester",
      _title: "Mini Custom",
      _visibility: "public",
      _content: good,
    });
    expect(created.error).toBeNull();

    // Four groups under a Mini format is refused.
    const bad = { ...good, groups: [...good.groups, { category: "X", words: ["a", "b", "c"], hint_word: null }] };
    const rejected = await db.rpc("create_custom_puzzle", {
      _creator_name: "Tester",
      _title: "Bad",
      _visibility: "public",
      _content: bad,
    });
    expect(rejected.error?.message).toMatch(/exactly 3 groups/);

    // A CUSTOM Mini still cannot be a Rainbow. Official Minis gained an
    // optional Rainbow (migration 20260924000000), but Custom Mini creation
    // is deliberately still switched off, and
    // validate_custom_puzzle_content keeps its own rule — so this refusal is
    // unchanged on purpose, not an oversight.
    const rainbow = { ...good, mode: "rainbow", rainbow_herring: ["Hood", "Mars", "Bird"] };
    const refusedRainbow = await db.rpc("create_custom_puzzle", {
      _creator_name: "Tester",
      _title: "Bad Rainbow",
      _visibility: "public",
      _content: rainbow,
    });
    expect(refusedRainbow.error?.message).toMatch(/cannot be a Rainbow puzzle/);
  });

  it("19. a custom payload with no format is still a Full puzzle", async () => {
    const content = {
      mode: "classic",
      groups: [
        { category: "A", words: ["a1", "a2", "a3", "a4"], hint_word: null },
        { category: "B", words: ["b1", "b2", "b3", "b4"], hint_word: null },
        { category: "C", words: ["c1", "c2", "c3", "c4"], hint_word: null },
        { category: "D", words: ["d1", "d2", "d3", "d4"], hint_word: null },
      ],
      word_order: ["a1","a2","a3","a4","b1","b2","b3","b4","c1","c2","c3","c4","d1","d2","d3","d4"],
      alphabetize_completed: true,
    };
    const { data, error } = await db.rpc("create_custom_puzzle", {
      _creator_name: "Tester",
      _title: "Legacy Full",
      _visibility: "public",
      _content: content,
    });
    expect(error).toBeNull();
    const shareId = (data as { share_id: string }).share_id;
    const fetched = await db.rpc("get_custom_puzzle", { _share_id: shareId });
    const row = fetched.data as { content: Record<string, unknown> };
    // No format key is stored, and it reads back as Full.
    expect("format" in row.content).toBe(false);
  });
});
