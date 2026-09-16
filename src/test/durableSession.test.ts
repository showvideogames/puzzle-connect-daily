/**
 * Verification suite for the durable session + live gameplay event
 * foundation (Task #6), cases A-O.
 *
 * These drive the REAL hook (useGame -> useGameSession -> lib/gameSession /
 * lib/gameStats) against an in-memory fake Supabase that enforces the same
 * two unique constraints the migration creates. Nothing here touches the
 * production database.
 */
import { describe, it, expect, beforeEach, vi } from "vitest";
import { act, renderHook } from "@testing-library/react";
import { FakeSupabase } from "./fakeSupabase";
import type { Puzzle } from "@/lib/types";

const db = new FakeSupabase();

vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    from: (t: string) => db.from(t),
    rpc: (n: string, a: unknown) => db.rpc(n, a),
    auth: { getUser: () => db.auth.getUser() },
  },
}));

// Gameplay side effects that are irrelevant here and unavailable in jsdom.
vi.mock("canvas-confetti", () => ({ default: () => {} }));
vi.mock("@/lib/sounds", () => ({ playRainbowSound: () => {}, playGiftOpenSound: () => {} }));
vi.mock("@/lib/haptics", () => ({
  vibrateSuccess: () => {},
  vibrateError: () => {},
  vibrateCelebration: () => {},
}));
vi.mock("@/lib/analytics", () => ({ trackEvent: () => {} }));

import { useGame } from "@/hooks/useGame";
import { loadStatsFromSupabase, getDeviceId } from "@/lib/gameStats";
import { progressKey } from "@/lib/gameProgress";

const PUZZLE_ID = "puzzle-1";

const puzzle: Puzzle = {
  id: PUZZLE_ID,
  date: "2026-09-16",
  groups: [
    { category: "Yellow", words: ["y1", "y2", "y3", "y4"], difficulty: 1 },
    { category: "Green", words: ["g1", "g2", "g3", "g4"], difficulty: 2 },
    { category: "Blue", words: ["b1", "b2", "b3", "b4"], difficulty: 3 },
    { category: "Red", words: ["r1", "r2", "r3", "r4"], difficulty: 4 },
  ],
  rainbowHerring: ["y1", "g1", "b1", "r1"],
  rainbowCategoryName: "Rainbow",
};

/** Puzzle with no Rainbow, for the "rainbow_found must be null" check. */
const plainPuzzle: Puzzle = { ...puzzle, id: "puzzle-plain", rainbowHerring: null };

const sessions = () => db.tables.game_sessions;
const guesses = () => db.tables.guess_events;
const hints = () => db.tables.hint_events;

function reduceMotion() {
  // Collapses useGame's "checking guess" suspense to a 0ms timeout, so a
  // guess resolves within the act() below instead of a real ~1s animation.
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

/**
 * Lets every queued microtask and 0ms timeout settle.
 *
 * Generous on purpose: a completion fans out through several awaited hops
 * (identity lookup -> official-result check -> session update -> guess
 * backfill -> aggregates -> streak), and a stingy flush here would make the
 * assertions racy rather than meaningful.
 */
async function settle() {
  await act(async () => {
    for (let i = 0; i < 25; i++) {
      await new Promise((r) => setTimeout(r, 0));
    }
  });
}

function mount(p: Puzzle = puzzle, opts: Record<string, unknown> = {}) {
  return renderHook(({ o }) => useGame(p, o as never), {
    initialProps: { o: opts },
  });
}

/**
 * Submits one guess: clears any leftover selection, selects the four words,
 * then submits.
 *
 * The deselect matters: an INCORRECT guess deliberately leaves its tiles
 * selected (matching NYT Connections), so without clearing first, toggling an
 * already-selected word would deselect it and the next submit would be
 * silently ignored for having fewer than 4 words.
 */
async function guess(
  view: ReturnType<typeof mount>,
  words: string[]
) {
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

beforeEach(() => {
  reduceMotion();
  localStorage.clear();
  sessionStorage.clear();
  db.tables.game_sessions = [];
  db.tables.guess_events = [];
  db.tables.hint_events = [];
  db.tables.game_results = [];
  db.tables.user_streaks = [];
  db.tables.puzzles = [
    { id: PUZZLE_ID, rainbow_herring: puzzle.rainbowHerring },
    { id: "puzzle-completed", rainbow_herring: puzzle.rainbowHerring },
  ];
  db.writeLog = [];
  db.signIn(null);
});

// ── A. PAGE VIEW ONLY ──────────────────────────────────────────────────────
describe("A. page view only", () => {
  it("creates no session, no events and no local progress", async () => {
    mount();
    await settle();

    expect(sessions()).toHaveLength(0);
    expect(guesses()).toHaveLength(0);
    expect(hints()).toHaveLength(0);
    expect(localStorage.getItem(progressKey(PUZZLE_ID))).toBeNull();
  });

  it("does not write even when the player only fiddles with tiles", async () => {
    const view = mount();
    await act(async () => {
      view.result.current.toggleWord("y1");
      view.result.current.toggleWord("y2");
      view.result.current.toggleWord("y2");
      view.result.current.shuffle();
      view.result.current.deselectAll();
    });
    await settle();

    // Tile selections, deselections and shuffles are UI, not gameplay events.
    expect(db.writeLog).toHaveLength(0);
    expect(sessions()).toHaveLength(0);
  });
});

// ── B. FIRST GUESS ─────────────────────────────────────────────────────────
describe("B. first guess", () => {
  it("creates exactly one in_progress session and one guess event", async () => {
    const view = mount();
    await guess(view, ["y1", "y2", "y3", "g1"]);

    expect(sessions()).toHaveLength(1);
    const s = sessions()[0];
    expect(s.status).toBe("in_progress");
    expect(s.completed_at).toBeNull();
    expect(s.is_official).toBeUndefined(); // left to the DB default (false)
    expect(s.entry_context).toBe("daily_home");
    expect(s.started_at).toEqual(expect.any(String));
    expect(s.last_activity_at).toEqual(expect.any(String));

    expect(guesses()).toHaveLength(1);
    const g = guesses()[0];
    expect(g.game_session_id).toBe(s.id);
    expect(g.guess_number).toBe(1);
    expect(g.correct).toBe(false);
    expect(g.is_one_away).toBe(true);
    expect(g.guessed_at).toEqual(expect.any(String));
    expect(g.groups_solved).toBe(0);
    expect(g.active_time_seconds).toEqual(expect.any(Number));

    expect(hints()).toHaveLength(0);
  });

  it("records entry_context from the route the player came through", async () => {
    const view = mount(puzzle, { isArchive: true, entryContext: "free_collection" });
    await guess(view, ["y1", "y2", "y3", "g1"]);
    expect(sessions()[0].entry_context).toBe("free_collection");
  });
});

// ── C. HINT BEFORE ANY GUESS ───────────────────────────────────────────────
describe("C. hint before any guess", () => {
  it("creates the session from the hint alone, with no fabricated guess", async () => {
    const view = mount(puzzle, { smallHintUsed: false });
    await act(async () => {
      view.rerender({ o: { smallHintUsed: true } });
    });
    await settle();

    expect(sessions()).toHaveLength(1);
    expect(sessions()[0].status).toBe("in_progress");
    expect(hints()).toHaveLength(1);
    expect(hints()[0].hint_type).toBe("small");
    expect(hints()[0].guess_count).toBe(0);
    expect(hints()[0].mistakes).toBe(0);
    expect(hints()[0].groups_solved).toBe(0);
    expect(hints()[0].rainbow_found).toBe(false);

    // No guess was invented to carry the hint.
    expect(guesses()).toHaveLength(0);
  });

  it("records rainbow_found as null on a puzzle that has no Rainbow", async () => {
    const view = mount(plainPuzzle, { smallHintUsed: false });
    await act(async () => {
      view.rerender({ o: { smallHintUsed: true } });
    });
    await settle();
    // null means "no Rainbow to find", never "hadn't found it yet".
    expect(hints()[0].rainbow_found).toBeNull();
  });
});

// ── D. MULTIPLE GUESSES ────────────────────────────────────────────────────
describe("D. multiple guesses", () => {
  it("keeps one session and writes ordered, distinct guess events", async () => {
    const view = mount();
    await guess(view, ["y1", "y2", "y3", "y4"]); // correct
    await guess(view, ["g1", "g2", "g3", "b1"]); // miss
    await guess(view, ["g1", "g2", "g3", "g4"]); // correct

    expect(sessions()).toHaveLength(1);
    expect(guesses()).toHaveLength(3);
    expect(guesses().map((g) => g.guess_number)).toEqual([1, 2, 3]);
    expect(guesses().map((g) => g.correct)).toEqual([true, false, true]);
    expect(guesses().map((g) => g.game_session_id)).toEqual([
      sessions()[0].id,
      sessions()[0].id,
      sessions()[0].id,
    ]);
    // Group name is recorded for correct guesses only.
    expect(guesses()[0].group_name).toBe("orange");
    expect(guesses()[1].group_name).toBeNull();
    // Solved-count snapshot advances with play.
    expect(guesses().map((g) => g.groups_solved)).toEqual([0, 1, 1]);
    for (const g of guesses()) {
      expect(typeof g.guessed_at).toBe("string");
      expect(typeof g.active_time_seconds).toBe("number");
    }
  });
});

// ── E. REFRESH / RESUME ────────────────────────────────────────────────────
describe("E. refresh and resume", () => {
  it("reuses the same session and never duplicates the earlier guess", async () => {
    const first = mount();
    await guess(first, ["y1", "y2", "y3", "g1"]);
    const sessionId = sessions()[0].id;
    first.unmount();

    // Refresh: fresh mount, same localStorage.
    const second = mount();
    await settle();
    await guess(second, ["g1", "g2", "g3", "b1"]);

    expect(sessions()).toHaveLength(1);
    expect(sessions()[0].id).toBe(sessionId);
    expect(guesses()).toHaveLength(2);
    expect(guesses().map((g) => g.guess_number)).toEqual([1, 2]);
  });

  it("discards a replayed write of an already-recorded guess number", async () => {
    const view = mount();
    await guess(view, ["y1", "y2", "y3", "g1"]);
    const before = guesses().length;

    // Simulate a retry of the identical guess event (same idempotency key).
    const dup = { ...guesses()[0] };
    delete (dup as Record<string, unknown>).id;
    await db.from("guess_events").upsert(dup, {
      onConflict: "game_session_id,guess_number",
      ignoreDuplicates: true,
    });

    expect(guesses()).toHaveLength(before);
  });
});

// ── F. HINT THEN REFRESH ───────────────────────────────────────────────────
describe("F. hint then refresh", () => {
  it("records exactly one hint event across the reload", async () => {
    const first = mount(puzzle, { smallHintUsed: false });
    await act(async () => first.rerender({ o: { smallHintUsed: true } }));
    await settle();
    expect(hints()).toHaveLength(1);
    first.unmount();

    // On resume the page's own hint flag starts false again; useGame restores
    // "a hint was used" from the progress blob WITHOUT replaying the reveal.
    const second = mount(puzzle, { smallHintUsed: false });
    await settle();
    expect(hints()).toHaveLength(1);

    // And if the player clicks Small Hint again, the unique constraint
    // discards the duplicate rather than recording a second reveal.
    await act(async () => second.rerender({ o: { smallHintUsed: true } }));
    await settle();
    expect(hints()).toHaveLength(1);
  });
});

// ── G. CLOSE / RESUME EQUIVALENT ───────────────────────────────────────────
describe("G. navigate away and back", () => {
  it("resumes the same session across unmount/remount", async () => {
    const first = mount();
    await guess(first, ["y1", "y2", "y3", "g1"]);
    const sessionId = sessions()[0].id;
    first.unmount();

    const second = mount();
    await settle();
    expect(second.result.current.sessionIdRef.current).toBe(sessionId);

    await guess(second, ["g1", "g2", "g3", "b1"]);
    expect(sessions()).toHaveLength(1);
    expect(guesses()).toHaveLength(2);
  });
});

// ── H. ABANDONED / INCOMPLETE ──────────────────────────────────────────────
describe("H. abandoned game", () => {
  it("leaves a durable in_progress session that no player-facing stat counts", async () => {
    const view = mount();
    await guess(view, ["y1", "y2", "y3", "y4"]);
    await guess(view, ["g1", "g2", "g3", "b1"]);
    view.unmount(); // player leaves; no beforeunload, nothing marked abandoned

    const s = sessions()[0];
    expect(s.status).toBe("in_progress");
    expect(s.completed_at).toBeNull();
    expect(s.last_activity_at).toEqual(expect.any(String));
    // Roughly-how-long-they-played survives for free.
    expect(typeof s.active_time_seconds).toBe("number");

    const stats = await loadStatsFromSupabase();
    expect(stats.gamesPlayed).toBe(0);
    expect(stats.gamesWon).toBe(0);
    expect(stats.guessDistribution).toEqual([0, 0, 0, 0, 0]);
    expect(stats.averageMistakes).toBe(0);
  });
});

// ── I. WIN ─────────────────────────────────────────────────────────────────
describe("I. win", () => {
  it("promotes the SAME session to won, exactly once", async () => {
    const view = mount();
    await guess(view, ["y1", "y2", "y3", "y4"]);
    const sessionId = sessions()[0].id;
    await guess(view, ["g1", "g2", "g3", "g4"]);
    await guess(view, ["b1", "b2", "b3", "b4"]);
    await guess(view, ["r1", "r2", "r3", "r4"]);

    expect(sessions()).toHaveLength(1);
    const s = sessions()[0];
    expect(s.id).toBe(sessionId);
    expect(s.status).toBe("won");
    expect(s.won).toBe(true);
    expect(s.is_official).toBe(true);
    expect(s.completed_at).toEqual(expect.any(String));
    expect(s.mistakes).toBe(0);
    expect(s.solve_order).toEqual(["orange", "green", "blue", "red"]);
    expect(s.share_grid).toEqual(expect.any(String));
    expect(s.hints_used).toBe(false);

    // Aggregates and streak happen exactly once, at official completion.
    expect(db.writeLog.filter((w) => w.table === "rpc:increment_puzzle_aggregate")).toHaveLength(1);
    expect(db.tables.user_streaks).toHaveLength(1);

    // Four guesses, no duplicates from the completion-time backfill.
    expect(guesses()).toHaveLength(4);
    expect(guesses().map((g) => g.guess_number)).toEqual([1, 2, 3, 4]);

    const stats = await loadStatsFromSupabase();
    expect(stats.gamesPlayed).toBe(1);
    expect(stats.gamesWon).toBe(1);
    expect(stats.perfectGamesCount).toBe(1);
    expect(stats.noHintsUsedCount).toBe(1);
  });
});

// ── J. FORMAL LOSS ─────────────────────────────────────────────────────────
describe("J. formal loss", () => {
  it("marks the same session lost with mistakes = 4 and buckets it correctly", async () => {
    const view = mount();
    await guess(view, ["y1", "y2", "y3", "g1"]);
    await guess(view, ["y1", "y2", "y3", "b1"]);
    await guess(view, ["y1", "y2", "y3", "r1"]);
    await guess(view, ["y1", "y2", "g2", "r1"]);

    expect(sessions()).toHaveLength(1);
    const s = sessions()[0];
    expect(s.status).toBe("lost");
    expect(s.won).toBe(false);
    expect(s.mistakes).toBe(4);
    expect(s.is_official).toBe(true);
    expect(s.completed_at).toEqual(expect.any(String));

    const stats = await loadStatsFromSupabase();
    expect(stats.gamesPlayed).toBe(1);
    expect(stats.gamesWon).toBe(0);
    // Formal losses populate bucket 4 — the fix this must not regress.
    expect(stats.guessDistribution).toEqual([0, 0, 0, 0, 1]);
    expect(stats.averageMistakes).toBe(4);
  });
});

// ── K. DAILY REPLAY ────────────────────────────────────────────────────────
describe("K. daily replay", () => {
  /** Plays the puzzle to a formal loss (4 wrong guesses). */
  async function playToLoss(view: ReturnType<typeof mount>) {
    await guess(view, ["y1", "y2", "y3", "g1"]);
    await guess(view, ["y1", "y2", "y3", "b1"]);
    await guess(view, ["y1", "y2", "y3", "r1"]);
    await guess(view, ["y1", "y2", "g2", "r1"]);
  }

  it("locks the board on return, so a replay cannot even begin", async () => {
    const first = mount();
    await playToLoss(first);
    const officialId = sessions()[0].id;
    expect(sessions()[0].status).toBe("lost");
    first.unmount();

    // The player clears local progress but keeps their identity.
    localStorage.removeItem(progressKey(PUZZLE_ID));
    const second = mount();
    await settle();

    // hasOfficialResult() finds the completed official result and locks the
    // board — the first and strongest layer of replay protection.
    expect(second.result.current.state.isComplete).toBe(true);
    await guess(second, ["y1", "y2", "y3", "y4"]);

    expect(sessions()).toHaveLength(1);
    expect(sessions()[0].id).toBe(officialId);
    expect(sessions()[0].status).toBe("lost");
    expect(guesses().every((g) => g.game_session_id === officialId)).toBe(true);
  });

  it("does NOT lock the board while a session is merely in progress", async () => {
    // The mirror image of the test above, and the regression this whole
    // distinction exists to prevent: an unfinished session must never be
    // mistaken for a prior official result and lock the player out of
    // finishing the game they are in the middle of.
    const first = mount();
    await guess(first, ["y1", "y2", "y3", "g1"]);
    expect(sessions()[0].status).toBe("in_progress");
    first.unmount();

    localStorage.removeItem(progressKey(PUZZLE_ID));
    const second = mount();
    await settle();
    expect(second.result.current.state.isComplete).toBe(false);
  });

  it("finalizes a replay that slips through as completed-but-not-official", async () => {
    // The narrow window the board lock cannot cover: two tabs finishing at
    // once, or a completion racing the async official-result check. Exercised
    // at the layer that implements the rule.
    const { finalizeGameSession, hasOfficialResult } = await import("@/lib/gameStats");

    const first = mount();
    await playToLoss(first);
    const officialId = sessions()[0].id as string;
    const aggregatesAfterFirst = db.writeLog.filter(
      (w) => w.table === "rpc:increment_puzzle_aggregate"
    ).length;
    const streaksAfterFirst = db.tables.user_streaks.length;
    first.unmount();

    // A second session exists and reaches completion anyway.
    const { data: replay } = await db.from("game_sessions").insert({
      puzzle_id: PUZZLE_ID,
      user_id: null,
      device_id: getDeviceId(),
      status: "in_progress",
      is_official: false,
      won: false,
      mistakes: 0,
      completed_at: null,
    }).select("id").single();
    const replayId = (replay as { id: string }).id;

    // The rule: an official result already exists, so this one is not it.
    const alreadyOfficial = await hasOfficialResult(PUZZLE_ID);
    expect(alreadyOfficial).toBe(true);

    await finalizeGameSession({
      puzzleId: PUZZLE_ID,
      sessionId: replayId,
      entryContext: "daily_home",
      isOfficial: !alreadyOfficial,
      won: true,
      mistakes: 0,
      activeTimeSeconds: 30,
      foundRainbow: true,
      rainbowSolveIndex: 4,
      solveOrder: ["orange", "green", "blue", "red"],
      guessHistory: [],
      hintsUsed: false,
      shareGrid: "",
    });

    // The permanent official result is untouched — not improved, not
    // worsened, not given a Rainbow it never earned.
    const official = sessions().find((s) => s.id === officialId)!;
    expect(official.status).toBe("lost");
    expect(official.won).toBe(false);
    expect(official.mistakes).toBe(4);
    expect(official.found_rainbow).not.toBe(true);
    expect(official.is_official).toBe(true);

    // The replay's own row finished truthfully, but is not official — and is
    // NOT parked at in_progress, which would corrupt abandonment analytics.
    const replayRow = sessions().find((s) => s.id === replayId)!;
    expect(replayRow.status).toBe("won");
    expect(replayRow.is_official).toBe(false);
    expect(replayRow.completed_at).toEqual(expect.any(String));

    // No second aggregate bump and no second streak update.
    expect(
      db.writeLog.filter((w) => w.table === "rpc:increment_puzzle_aggregate")
    ).toHaveLength(aggregatesAfterFirst);
    expect(db.tables.user_streaks).toHaveLength(streaksAfterFirst);

    // Stats still describe the first completed official attempt only.
    const stats = await loadStatsFromSupabase();
    expect(stats.gamesPlayed).toBe(1);
    expect(stats.gamesWon).toBe(0);
    expect(stats.perfectGamesCount).toBe(0);
    expect(stats.rainbowSpottedCount).toBe(0);
  });

  it("refuses to re-finalize an already-completed session", async () => {
    // Row-level backstop for the same rule: finalizeGameSession only ever
    // targets a session whose status is still in_progress.
    const { finalizeGameSession } = await import("@/lib/gameStats");
    const view = mount();
    await playToLoss(view);
    const s = sessions()[0];

    await finalizeGameSession({
      puzzleId: PUZZLE_ID,
      sessionId: s.id as string,
      entryContext: "daily_home",
      isOfficial: true,
      won: true,
      mistakes: 0,
      activeTimeSeconds: 1,
      foundRainbow: true,
      rainbowSolveIndex: 0,
      solveOrder: ["orange", "green", "blue", "red"],
      guessHistory: [],
    });

    expect(sessions()[0].status).toBe("lost");
    expect(sessions()[0].won).toBe(false);
    expect(sessions()[0].mistakes).toBe(4);
    expect(sessions()[0].found_rainbow).not.toBe(true);
  });
});


// ── L. ARCHIVE ─────────────────────────────────────────────────────────────
describe("L. archive", () => {
  it("persists normally but never touches the Daily streak", async () => {
    const view = mount(puzzle, { isArchive: true, entryContext: "archive_calendar" });
    await guess(view, ["y1", "y2", "y3", "y4"]);
    await guess(view, ["g1", "g2", "g3", "g4"]);
    await guess(view, ["b1", "b2", "b3", "b4"]);
    await guess(view, ["r1", "r2", "r3", "r4"]);

    const s = sessions()[0];
    expect(s.status).toBe("won");
    expect(s.is_official).toBe(true);
    expect(s.entry_context).toBe("archive_calendar");
    // Archive completion never writes user_streaks.
    expect(db.tables.user_streaks).toHaveLength(0);
  });
});

// ── M. POST-COMPLETION RAINBOW ─────────────────────────────────────────────
describe("M. post-completion Rainbow bonus", () => {
  it("attaches to the completed session without inflating solve time", async () => {
    const view = mount();
    await guess(view, ["y1", "y2", "y3", "y4"]);
    await guess(view, ["g1", "g2", "g3", "g4"]);
    await guess(view, ["b1", "b2", "b3", "b4"]);
    await guess(view, ["r1", "r2", "r3", "r4"]);

    const s = sessions()[0];
    const finalTime = s.active_time_seconds as number;
    const guessesAtCompletion = guesses().length;

    // The bonus write path, as GameBoard drives it after completion.
    const { markRainbowFoundInSession, recordRainbowAttempt } = await import("@/lib/gameStats");
    await markRainbowFoundInSession(s.id as string);
    await recordRainbowAttempt({
      sessionId: s.id as string,
      guessNumber: view.result.current.nextGuessNumber(0),
      words: ["y1", "g1", "b1", "r1"],
      correct: true,
      guessedAt: new Date().toISOString(),
      activeTimeSeconds: view.result.current.activeSecondsRef.current,
      groupsSolved: 4,
    });

    expect(sessions()).toHaveLength(1);
    expect(sessions()[0].found_rainbow).toBe(true);
    expect(sessions()[0].rainbow_solve_index).toBe(4);
    // Solve time is unchanged — the timer stopped at the normal win.
    expect(sessions()[0].active_time_seconds).toBe(finalTime);
    expect(sessions()[0].status).toBe("won");

    expect(guesses()).toHaveLength(guessesAtCompletion + 1);
    const bonus = guesses()[guesses().length - 1];
    expect(bonus.is_rainbow_attempt).toBe(true);
    expect(bonus.correct).toBe(true);
    expect(bonus.guess_number).toBe(guessesAtCompletion + 1);
  });
});

// ── N. LEGACY LOCAL PROGRESS ───────────────────────────────────────────────
describe("N. legacy local progress", () => {
  it("adopts a pre-durable-session game and backfills truthfully", async () => {
    // A blob shaped like one saved before gameSessionId (and before
    // GuessAttempt.guessedAt) existed.
    localStorage.setItem(
      progressKey(PUZZLE_ID),
      JSON.stringify({
        solvedGroups: [0],
        mistakes: 1,
        guessHistory: [
          { words: ["y1", "y2", "y3", "y4"], groupIndices: [0, 0, 0, 0], isCorrect: true },
          { words: ["g1", "g2", "g3", "b1"], groupIndices: [1, 1, 1, 2], isCorrect: false },
        ],
        gotRainbow: false,
        shuffledWords: ["g1", "g2", "g3", "g4", "b1", "b2", "b3", "b4", "r1", "r2", "r3", "r4"],
        rainbowWords: [],
      })
    );

    const view = mount();
    await settle();
    // No session yet: restoring progress is not a gameplay action.
    expect(sessions()).toHaveLength(0);

    // Next meaningful action adopts the game.
    await guess(view, ["g1", "g2", "g3", "g4"]);
    expect(sessions()).toHaveLength(1);
    expect(sessions()[0].status).toBe("in_progress");

    // Only the NEW guess is written live; the earlier two are not invented
    // as live events at their original numbers yet.
    expect(guesses()).toHaveLength(1);
    expect(guesses()[0].guess_number).toBe(3);

    await guess(view, ["b1", "b2", "b3", "b4"]);
    await guess(view, ["r1", "r2", "r3", "r4"]);

    // At completion the local history is backfilled — real words/outcomes,
    // but guessed_at stays NULL for the entries whose real time was never
    // captured, rather than being fabricated.
    const numbers = guesses().map((g) => g.guess_number).sort((a, b) => (a as number) - (b as number));
    expect(numbers).toEqual([1, 2, 3, 4, 5]);
    const backfilled = guesses().filter((g) => g.guess_number === 1 || g.guess_number === 2);
    expect(backfilled).toHaveLength(2);
    for (const g of backfilled) expect(g.guessed_at).toBeNull();
    // The live-written ones kept their real timestamps.
    for (const g of guesses().filter((x) => (x.guess_number as number) >= 3)) {
      expect(typeof g.guessed_at).toBe("string");
    }

    expect(sessions()).toHaveLength(1);
    expect(sessions()[0].status).toBe("won");
  });
});

// ── O. STATS IGNORE IN-PROGRESS ────────────────────────────────────────────
describe("O. stats with an in-progress session alongside completed ones", () => {
  it("excludes the in-progress row from every player-facing stat", async () => {
    // One completed official win, seeded directly.
    db.tables.game_sessions.push({
      id: "completed-1",
      // A DIFFERENT puzzle: seeding a completed official result for
      // PUZZLE_ID would (correctly) lock that board as already finished,
      // so no second session could ever be started on it.
      puzzle_id: "puzzle-completed",
      user_id: null,
      device_id: getDeviceId(),
      status: "won",
      is_official: true,
      won: true,
      mistakes: 1,
      found_rainbow: true,
      rainbow_solve_index: 4,
      solve_order: ["orange", "green", "blue", "red"],
      hints_used: false,
      completed_at: new Date().toISOString(),
    });

    const before = await loadStatsFromSupabase();

    // Now start a real second game and abandon it mid-play.
    const view = mount();
    await guess(view, ["y1", "y2", "y3", "g1"]);
    await guess(view, ["g1", "g2", "g3", "b1"]);
    view.unmount();

    expect(sessions().some((s) => s.status === "in_progress")).toBe(true);

    const after = await loadStatsFromSupabase();
    expect(after.gamesPlayed).toBe(before.gamesPlayed);
    expect(after.gamesWon).toBe(before.gamesWon);
    expect(after.guessDistribution).toEqual(before.guessDistribution);
    expect(after.averageMistakes).toBe(before.averageMistakes);
    expect(after.rainbowSpottedCount).toBe(before.rainbowSpottedCount);
    expect(after.hardestFirstCount).toBe(before.hardestFirstCount);
    expect(after.perfectGamesCount).toBe(before.perfectGamesCount);
    expect(after.noHintsUsedCount).toBe(before.noHintsUsedCount);
    expect(after.inOrderCount).toBe(before.inOrderCount);
    expect(after.reverseRainbowCount).toBe(before.reverseRainbowCount);
    expect(after.rainbowSpotRate).toBe(before.rainbowSpotRate);
    // Exactly the one completed row participates.
    expect(after.gamesPlayed).toBe(1);
  });
});

// ── Write volume ───────────────────────────────────────────────────────────
describe("write volume", () => {
  it("stays proportional to real gameplay actions", async () => {
    const view = mount();
    await guess(view, ["y1", "y2", "y3", "y4"]);
    await guess(view, ["g1", "g2", "g3", "g4"]);
    await guess(view, ["b1", "b2", "b3", "b4"]);
    await guess(view, ["r1", "r2", "r3", "r4"]);

    const inserts = db.writeLog.filter((w) => w.table === "game_sessions" && w.op === "insert");
    const guessWrites = db.writeLog.filter((w) => w.table === "guess_events");
    expect(inserts).toHaveLength(1);
    // 4 live guess writes + 1 completion backfill upsert.
    expect(guessWrites).toHaveLength(5);
    // No stray writes to unrelated tables.
    expect(db.writeLog.every((w) => w.table !== "hint_events")).toBe(true);
  });
});
