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
    rpc: (n: string, a: Record<string, unknown>) => db.rpc(n, a),
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
  db.rpcLog = [];
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
    expect(s.is_official).toBe(false); // DB default: only set at completion
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

    // Note what is NOT passed: isOfficial. The database decides it from
    // the session's own stored identity and returns the answer, so a
    // client claiming to be official cannot make itself official.
    const becameOfficial = await finalizeGameSession({
      puzzleId: PUZZLE_ID,
      sessionId: replayId,
      entryContext: "daily_home",
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

    expect(becameOfficial).toBe(false);

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

    const reFinalized = await finalizeGameSession({
      puzzleId: PUZZLE_ID,
      sessionId: s.id as string,
      entryContext: "daily_home",
      won: true,
      mistakes: 0,
      activeTimeSeconds: 1,
      foundRainbow: true,
      rainbowSolveIndex: 0,
      solveOrder: ["orange", "green", "blue", "red"],
      guessHistory: [],
    });

    // Refused outright: the session is no longer in_progress.
    expect(reFinalized).toBe(false);
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
    const { recordBonusRainbowAttempt } = await import("@/lib/gameStats");
    await recordBonusRainbowAttempt({
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


// ── RAINBOW OUTCOME MODEL ──────────────────────────────────────────────────
// The three outcomes must be mutually exclusive and reliably resolvable at
// the session level, for a WIN or a formal LOSS alike:
//
//   A. NOT ATTEMPTED     found_rainbow = false AND bonus_rainbow_attempted = false
//   B. ATTEMPTED, FAILED found_rainbow = false AND bonus_rainbow_attempted = true
//   C. FOUND             found_rainbow = true   (+ rainbow_source)
describe("Rainbow outcome model", () => {
  type Outcome = "NOT_ATTEMPTED" | "ATTEMPTED_FAILED" | "FOUND";

  /** Exactly how analytics is expected to classify a completed session. */
  function classify(s: Record<string, unknown>): Outcome {
    if (s.found_rainbow === true) return "FOUND";
    return s.bonus_rainbow_attempted === true ? "ATTEMPTED_FAILED" : "NOT_ATTEMPTED";
  }

  /** Drives the bonus modal exactly as GameBoard's handleSpotResult does. */
  async function submitBonus(
    view: ReturnType<typeof mount>,
    correct: boolean,
    words: string[],
    failedSoFar = 0
  ) {
    const { recordBonusRainbowAttempt } = await import("@/lib/gameStats");
    const s = sessions()[0];
    await recordBonusRainbowAttempt({
      sessionId: s.id as string,
      guessNumber: view.result.current.nextGuessNumber(failedSoFar),
      words,
      correct,
      guessedAt: new Date().toISOString(),
      activeTimeSeconds: view.result.current.activeSecondsRef.current,
      groupsSolved: 4,
    });
  }

  async function playToWin(view: ReturnType<typeof mount>) {
    await guess(view, ["y1", "y2", "y3", "y4"]);
    await guess(view, ["g1", "g2", "g3", "g4"]);
    await guess(view, ["b1", "b2", "b3", "b4"]);
    await guess(view, ["r1", "r2", "r3", "r4"]);
  }

  async function playToLoss(view: ReturnType<typeof mount>) {
    await guess(view, ["y1", "y2", "y3", "g1"]);
    await guess(view, ["y1", "y2", "y3", "b1"]);
    await guess(view, ["y1", "y2", "y3", "r1"]);
    await guess(view, ["y1", "y2", "g2", "r1"]);
  }

  const bonusEvents = () => guesses().filter((g) => g.attempt_type === "bonus_rainbow");

  // 1. Win, Rainbow found during gameplay -> FOUND, source = in_game
  it("1. win with an in-game Rainbow find: FOUND, source in_game", async () => {
    const view = mount();
    await guess(view, ["y1", "y2", "y3", "y4"]);
    // The herring set, submitted as an ordinary board guess.
    await guess(view, ["y1", "g1", "b1", "r1"]);
    await guess(view, ["g1", "g2", "g3", "g4"]);
    await guess(view, ["b1", "b2", "b3", "b4"]);
    await guess(view, ["r1", "r2", "r3", "r4"]);

    const s = sessions()[0];
    expect(s.status).toBe("won");
    expect(classify(s)).toBe("FOUND");
    expect(s.found_rainbow).toBe(true);
    expect(s.rainbow_source).toBe("in_game");
    // The player never opened the post-game flow.
    expect(s.bonus_rainbow_attempted).toBe(false);
    expect(bonusEvents()).toHaveLength(0);

    const stats = await loadStatsFromSupabase();
    expect(stats.rainbowSpottedCount).toBe(1);
  });

  // 2. Win, never finds it, never opens the prompt -> NOT ATTEMPTED
  it("2. win with no Rainbow and no bonus attempt: NOT_ATTEMPTED", async () => {
    const view = mount();
    await playToWin(view);

    const s = sessions()[0];
    expect(classify(s)).toBe("NOT_ATTEMPTED");
    expect(s.found_rainbow).toBe(false);
    expect(s.bonus_rainbow_attempted).toBe(false);
    expect(s.rainbow_source).toBeNull();

    const stats = await loadStatsFromSupabase();
    expect(stats.rainbowSpottedCount).toBe(0);
  });

  // 3. Win, bonus attempted and wrong -> ATTEMPTED_FAILED
  it("3. win with a failed bonus attempt: ATTEMPTED_FAILED", async () => {
    const view = mount();
    await playToWin(view);
    await submitBonus(view, false, ["y1", "g2", "b3", "r4"]);

    const s = sessions()[0];
    expect(classify(s)).toBe("ATTEMPTED_FAILED");
    expect(s.found_rainbow).toBe(false);
    expect(s.bonus_rainbow_attempted).toBe(true);
    expect(s.rainbow_source).toBeNull();

    // The failed attempt is durable rather than vanishing.
    expect(bonusEvents()).toHaveLength(1);
    expect(bonusEvents()[0].correct).toBe(false);

    const stats = await loadStatsFromSupabase();
    expect(stats.rainbowSpottedCount).toBe(0);
  });

  // 4. Win, bonus attempted and correct -> FOUND, source = post_game
  it("4. win with a correct bonus attempt: FOUND, source post_game", async () => {
    const view = mount();
    await playToWin(view);
    await submitBonus(view, true, ["y1", "g1", "b1", "r1"]);

    const s = sessions()[0];
    expect(classify(s)).toBe("FOUND");
    expect(s.found_rainbow).toBe(true);
    expect(s.rainbow_source).toBe("post_game");
    expect(s.bonus_rainbow_attempted).toBe(true);
    expect(s.rainbow_solve_index).toBe(4);

    const stats = await loadStatsFromSupabase();
    expect(stats.rainbowSpottedCount).toBe(1);
  });

  // 5. Loss, never opens the prompt -> NOT ATTEMPTED
  it("5. loss with no bonus attempt: NOT_ATTEMPTED", async () => {
    const view = mount();
    await playToLoss(view);

    const s = sessions()[0];
    expect(s.status).toBe("lost");
    expect(classify(s)).toBe("NOT_ATTEMPTED");
    expect(s.bonus_rainbow_attempted).toBe(false);
    expect(s.rainbow_source).toBeNull();
  });

  // 6. Loss, bonus attempted and wrong -> ATTEMPTED_FAILED
  it("6. loss with a failed bonus attempt: ATTEMPTED_FAILED", async () => {
    const view = mount();
    await playToLoss(view);
    await submitBonus(view, false, ["y1", "g2", "b3", "r4"]);

    const s = sessions()[0];
    expect(s.status).toBe("lost");
    expect(classify(s)).toBe("ATTEMPTED_FAILED");
    expect(s.found_rainbow).toBe(false);
    expect(s.bonus_rainbow_attempted).toBe(true);
    expect(bonusEvents()).toHaveLength(1);

    const stats = await loadStatsFromSupabase();
    expect(stats.rainbowSpottedCount).toBe(0);
  });

  // 7. Loss, bonus attempted and correct -> FOUND, and it COUNTS.
  it("7. loss with a correct bonus attempt: FOUND, post_game, and it counts", async () => {
    const view = mount();
    await playToLoss(view);
    const finalTime = sessions()[0].active_time_seconds as number;
    await submitBonus(view, true, ["y1", "g1", "b1", "r1"]);

    const s = sessions()[0];
    // The firm product rule: failing the main puzzle does not forfeit the
    // Rainbow.
    expect(s.status).toBe("lost");
    expect(s.won).toBe(false);
    expect(classify(s)).toBe("FOUND");
    expect(s.found_rainbow).toBe(true);
    expect(s.rainbow_source).toBe("post_game");
    expect(s.bonus_rainbow_attempted).toBe(true);
    // "Found after a formal loss" is answerable directly.
    expect(s.found_rainbow === true && s.status === "lost").toBe(true);
    // The loss itself is untouched — no accidental promotion to a win.
    expect(s.mistakes).toBe(4);
    expect(s.active_time_seconds).toBe(finalTime);

    const stats = await loadStatsFromSupabase();
    expect(stats.rainbowSpottedCount).toBe(1);
    expect(stats.gamesWon).toBe(0);
    expect(stats.gamesPlayed).toBe(1);
  });

  // 8. A Rainbow-SHAPED normal guess must never read as a bonus attempt.
  it("8. a Rainbow-shaped in-game guess is not a Spot the Rainbow attempt", async () => {
    const view = mount();
    // One word from each category, but NOT the herring set — so it is
    // Rainbow-SHAPED and incorrect, exactly the heuristic's false positive.
    await guess(view, ["y2", "g2", "b2", "r2"]);

    const g = guesses()[0];
    // The shape heuristic fires...
    expect(g.is_rainbow_attempt).toBe(true);
    // ...but intent does not.
    expect(g.attempt_type).toBe("normal");
    expect(bonusEvents()).toHaveLength(0);
    expect(sessions()[0].bonus_rainbow_attempted).toBe(false);

    await guess(view, ["y1", "y2", "y3", "y4"]);
    await guess(view, ["g1", "g2", "g3", "g4"]);
    await guess(view, ["b1", "b2", "b3", "b4"]);
    await guess(view, ["r1", "r2", "r3", "r4"]);

    const s = sessions()[0];
    expect(s.status).toBe("won");
    // Classified as never having tried the bonus flow, which is the truth.
    expect(classify(s)).toBe("NOT_ATTEMPTED");
    expect(s.bonus_rainbow_attempted).toBe(false);
  });

  // The in-game FIND is likewise a normal guess, not a bonus attempt.
  it("classifies the in-game herring find as a normal guess", async () => {
    const view = mount();
    await guess(view, ["y1", "g1", "b1", "r1"]);

    const g = guesses()[0];
    expect(g.attempt_type).toBe("normal");
    expect(bonusEvents()).toHaveLength(0);
  });

  // Every completed session lands in exactly one bucket. Asserted over the
  // full grid of (outcome x bonus attempt) directly against the column
  // combinations the writers above produce, so the classification rule is
  // checked exhaustively rather than one scenario at a time.
  it("the three outcomes are mutually exclusive and total", () => {
    const grid = [
      { found_rainbow: false, bonus_rainbow_attempted: false, expected: "NOT_ATTEMPTED" },
      { found_rainbow: false, bonus_rainbow_attempted: true, expected: "ATTEMPTED_FAILED" },
      { found_rainbow: true, bonus_rainbow_attempted: false, expected: "FOUND" },
      { found_rainbow: true, bonus_rainbow_attempted: true, expected: "FOUND" },
    ] as const;

    for (const row of grid) {
      const outcome = classify({
        found_rainbow: row.found_rainbow,
        bonus_rainbow_attempted: row.bonus_rainbow_attempted,
      });
      expect(outcome).toBe(row.expected);
      // Exactly one bucket, never zero and never two.
      const buckets = [
        outcome === "NOT_ATTEMPTED",
        outcome === "ATTEMPTED_FAILED",
        outcome === "FOUND",
      ].filter(Boolean);
      expect(buckets).toHaveLength(1);
    }
  });
});

// ── THREE-STATE `won` ──────────────────────────────────────────────────────
describe("three-state won", () => {
  it("is NULL while in progress and TRUE on a win", async () => {
    const view = mount();
    await guess(view, ["y1", "y2", "y3", "g1"]);

    // in_progress -> won IS NULL. Not false: a placeholder false would read as
    // "this player lost" to anything that skipped the status check.
    expect(sessions()[0].status).toBe("in_progress");
    expect(sessions()[0].won).toBeNull();

    await guess(view, ["y1", "y2", "y3", "y4"]);
    await guess(view, ["g1", "g2", "g3", "g4"]);
    await guess(view, ["b1", "b2", "b3", "b4"]);
    await guess(view, ["r1", "r2", "r3", "r4"]);
    expect(sessions()[0].status).toBe("won");
    expect(sessions()[0].won).toBe(true);
  });

  it("is FALSE on a formal loss", async () => {
    const view = mount();
    await guess(view, ["y1", "y2", "y3", "g1"]);
    await guess(view, ["y1", "y2", "y3", "b1"]);
    await guess(view, ["y1", "y2", "y3", "r1"]);
    await guess(view, ["y1", "y2", "g2", "r1"]);
    expect(sessions()[0].status).toBe("lost");
    expect(sessions()[0].won).toBe(false);
  });

  it("never lets a won = NULL row read as a win or a loss in Stats or Archive", async () => {
    const view = mount();
    await guess(view, ["y1", "y2", "y3", "g1"]);
    view.unmount();

    expect(sessions()[0].won).toBeNull();

    // Player-facing Stats: neither played, nor won, nor a loss bucket.
    const stats = await loadStatsFromSupabase();
    expect(stats.gamesPlayed).toBe(0);
    expect(stats.gamesWon).toBe(0);
    expect(stats.guessDistribution).toEqual([0, 0, 0, 0, 0]);

    // Archive calendar: the same completed-only filter the page applies.
    const { data: calendarRows } = await db
      .from("game_sessions")
      .select("puzzle_id, won, found_rainbow")
      .in("status", ["won", "lost"]);
    expect(calendarRows).toHaveLength(0);
  });
});


// ── LIVE `mistakes` COUNT ──────────────────────────────────────────────────
// game_sessions.mistakes must be the player's CURRENT real mistake count at
// every point, not a placeholder that only becomes true at completion.
describe("live mistake count", () => {
  it("tracks the real count while the session is still in progress", async () => {
    const view = mount();

    // A session that has just started.
    await guess(view, ["y1", "y2", "y3", "y4"]); // correct — no mistake
    expect(sessions()[0].status).toBe("in_progress");
    expect(sessions()[0].mistakes).toBe(0);

    await guess(view, ["g1", "g2", "g3", "b1"]); // miss 1
    expect(sessions()[0].mistakes).toBe(1);

    await guess(view, ["g1", "g2", "g3", "r1"]); // miss 2
    expect(sessions()[0].status).toBe("in_progress");
    expect(sessions()[0].mistakes).toBe(2);

    // A correct guess must not move it.
    await guess(view, ["g1", "g2", "g3", "g4"]);
    expect(sessions()[0].mistakes).toBe(2);
  });

  it("reaches 4 on a formal loss", async () => {
    const view = mount();
    await guess(view, ["y1", "y2", "y3", "g1"]);
    expect(sessions()[0].mistakes).toBe(1);
    await guess(view, ["y1", "y2", "y3", "b1"]);
    await guess(view, ["y1", "y2", "y3", "r1"]);
    expect(sessions()[0].mistakes).toBe(3);
    await guess(view, ["y1", "y2", "g2", "r1"]);
    expect(sessions()[0].status).toBe("lost");
    expect(sessions()[0].mistakes).toBe(4);
  });

  it("survives abandonment, so an abandoned game says how it was going", async () => {
    const view = mount();
    await guess(view, ["y1", "y2", "y3", "g1"]);
    await guess(view, ["y1", "y2", "y3", "b1"]);
    view.unmount();

    const s = sessions()[0];
    expect(s.status).toBe("in_progress");
    expect(s.mistakes).toBe(2);
    expect(s.won).toBeNull();
    expect(s.completed_at).toBeNull();
    expect(s.last_activity_at).toEqual(expect.any(String));
  });

  it("does not write on tile selections, shuffles or deselects", async () => {
    const view = mount();
    await guess(view, ["y1", "y2", "y3", "g1"]);
    const writesAfterGuess = db.writeLog.length;

    await act(async () => {
      view.result.current.toggleWord("b1");
      view.result.current.toggleWord("b2");
      view.result.current.shuffle();
      view.result.current.deselectAll();
    });
    await settle();

    // A guess and a hint are meaningful; fiddling with tiles is not.
    expect(db.writeLog).toHaveLength(writesAfterGuess);
  });
});

// ── ACCESS CONTROL ─────────────────────────────────────────────────────────
// These assert the CLIENT-side half of the security model: that the app's
// real code paths keep working under the post-migration policies, and that
// they never fall back to a direct table read that production will refuse.
//
// The fake models the policies (anonymous callers get no direct SELECT on the
// three gameplay tables; authenticated callers see only their own). It is NOT
// a substitute for verifying the SQL itself, which can only be done against
// the live database after the migration is applied — see section 6g of the
// migration for the queries that do that.
describe("access control", () => {
  /** Another player's completed session, seeded directly into the table. */
  function seedStrangerSession(id: string) {
    db.tables.game_sessions.push({
      id,
      puzzle_id: "someone-elses-puzzle",
      user_id: "stranger-user-id",
      device_id: "stranger-device-id",
      status: "won",
      is_official: true,
      won: true,
      mistakes: 1,
      found_rainbow: true,
      solve_order: ["orange", "green", "blue", "red"],
      hints_used: false,
      completed_at: new Date().toISOString(),
    });
    db.tables.guess_events.push({
      id: "stranger-guess",
      game_session_id: id,
      guess_number: 1,
      words: ["a", "b", "c", "d"],
      correct: true,
      attempt_type: "normal",
    });
    db.tables.hint_events.push({
      id: "stranger-hint",
      game_session_id: id,
      hint_type: "small",
      revealed_at: new Date().toISOString(),
    });
  }

  it("an anonymous client cannot enumerate game_sessions", async () => {
    seedStrangerSession("stranger-session");
    db.signIn(null);

    const { data } = await db.from("game_sessions").select("*");
    expect(data).toEqual([]);
  });

  it("an anonymous client cannot enumerate guess_events or hint_events", async () => {
    seedStrangerSession("stranger-session");
    db.signIn(null);

    const guessRows = await db.from("guess_events").select("*");
    const hintRows = await db.from("hint_events").select("*");
    expect(guessRows.data).toEqual([]);
    expect(hintRows.data).toEqual([]);
  });

  it("a signed-in client sees only its own sessions, not another user's", async () => {
    seedStrangerSession("stranger-session");
    db.signIn("me-user-id");
    db.tables.game_sessions.push({
      id: "my-session",
      puzzle_id: PUZZLE_ID,
      user_id: "me-user-id",
      device_id: getDeviceId(),
      status: "won",
      is_official: true,
      won: true,
      mistakes: 0,
      completed_at: new Date().toISOString(),
    });

    const { data } = await db.from("game_sessions").select("*");
    expect((data as { id: string }[]).map((r) => r.id)).toEqual(["my-session"]);
  });

  it("the own-data function answers only for the device id supplied", async () => {
    seedStrangerSession("stranger-session");
    db.signIn(null);

    // Someone else's device id — the bearer capability the caller lacks.
    const { data: theirs } = await db.rpc("get_own_completed_sessions", {
      _device_id: "stranger-device-id",
    });
    // (It answers for a device id you DO hold; that is the point of the model.)
    expect((theirs as unknown[]).length).toBe(1);

    // A device id nobody owns returns nothing, and there is no query shape
    // that widens this to "everyone".
    const { data: none } = await db.rpc("get_own_completed_sessions", {
      _device_id: "00000000-0000-4000-8000-000000000000",
    });
    expect(none).toEqual([]);
  });

  it("the shared 'unknown' device id unlocks nothing", async () => {
    // getDeviceId() returns this literal when localStorage is unavailable, so
    // every storage-blocked player shares it. It is the one device id that is
    // guessable, and it must not be a master key to their pooled gameplay.
    db.tables.game_sessions.push({
      id: "storage-blocked-session",
      puzzle_id: PUZZLE_ID,
      user_id: null,
      device_id: "unknown",
      status: "won",
      is_official: true,
      won: true,
      mistakes: 0,
      completed_at: new Date().toISOString(),
    });
    db.signIn(null);

    const { data } = await db.rpc("get_own_completed_sessions", { _device_id: "unknown" });
    expect(data).toEqual([]);
    const { data: n } = await db.rpc("count_own_anonymous_sessions", { _device_id: "unknown" });
    expect(n).toBe(0);
    const { data: official } = await db.rpc("has_official_result", {
      _puzzle_id: PUZZLE_ID,
      _device_id: "unknown",
    });
    expect(official).toBe(false);
  });

  it("an admin can still read everything through the privileged path", async () => {
    seedStrangerSession("stranger-session");
    db.signIn("admin-user-id", { admin: true });

    const { data } = await db.from("game_sessions").select("*");
    expect((data as unknown[]).length).toBe(1);
  });

  it("the normal anonymous game still works end to end", async () => {
    db.signIn(null);
    const view = mount();

    // Play, abandon, resume, and finish — all as an anonymous player with no
    // direct SELECT on any of the three tables.
    await guess(view, ["y1", "y2", "y3", "y4"]);
    const sessionId = sessions()[0].id;
    view.unmount();

    const resumed = mount();
    await settle();
    expect(resumed.result.current.sessionIdRef.current).toBe(sessionId);

    await guess(resumed, ["g1", "g2", "g3", "g4"]);
    await guess(resumed, ["b1", "b2", "b3", "b4"]);
    await guess(resumed, ["r1", "r2", "r3", "r4"]);

    expect(sessions()).toHaveLength(1);
    expect(sessions()[0].status).toBe("won");

    // Own-result detection and My Stats both still answer.
    const { hasOfficialResult } = await import("@/lib/gameStats");
    expect(await hasOfficialResult(PUZZLE_ID)).toBe(true);

    const stats = await loadStatsFromSupabase();
    expect(stats.gamesPlayed).toBe(1);
    expect(stats.gamesWon).toBe(1);
  });

  it("a signed-in player's own-session flows still work", async () => {
    db.signIn("me-user-id");
    const view = mount();

    await guess(view, ["y1", "y2", "y3", "y4"]);
    expect(sessions()[0].user_id).toBe("me-user-id");

    await guess(view, ["g1", "g2", "g3", "g4"]);
    await guess(view, ["b1", "b2", "b3", "b4"]);
    await guess(view, ["r1", "r2", "r3", "r4"]);

    const { hasOfficialResult } = await import("@/lib/gameStats");
    expect(await hasOfficialResult(PUZZLE_ID)).toBe(true);

    const stats = await loadStatsFromSupabase();
    expect(stats.gamesPlayed).toBe(1);
  });

  it("session creation cannot be stamped with another account's id", async () => {
    // create_game_session takes user_id from auth internally; the client has
    // no parameter for it.
    db.signIn("me-user-id");
    const view = mount();
    await guess(view, ["y1", "y2", "y3", "g1"]);
    expect(sessions()[0].user_id).toBe("me-user-id");
    expect(sessions()[0].user_id).not.toBe("stranger-user-id");
  });

  it("no app code path reads the gameplay tables directly while anonymous", async () => {
    // The real regression guard: if any of these flows ever goes back to a
    // direct table SELECT, it will silently return nothing in production for
    // every anonymous player. Here that failure is loud instead.
    db.signIn(null);
    const view = mount();
    await guess(view, ["y1", "y2", "y3", "y4"]);
    await guess(view, ["g1", "g2", "g3", "g4"]);
    await guess(view, ["b1", "b2", "b3", "b4"]);
    await guess(view, ["r1", "r2", "r3", "r4"]);
    await loadStatsFromSupabase();

    // Every own-data read went through a function.
    expect(db.rpcLog).toContain("has_official_result");
    expect(db.rpcLog).toContain("get_own_completed_sessions");
    expect(db.rpcLog).toContain("create_game_session");
  });
});


// ── ANONYMOUS WRITE ACCESS ─────────────────────────────────────────────────
// Section 7 of the migration removed the last generic anonymous mutation
// path. game_sessions has no UPDATE policy at all, and neither child table has
// an INSERT policy; every write goes through a function that verifies the
// session against its device capability first.
//
// As with the read tests, the fake models those policies. It is not a
// substitute for running the SQL — see section 7i of the migration for the
// queries that verify it against the live database once applied.
describe("anonymous write access", () => {
  /** A completed anonymous session belonging to somebody else. */
  function seedStrangerSession(id = "stranger-session") {
    db.tables.game_sessions.push({
      id,
      puzzle_id: "someone-elses-puzzle",
      user_id: null,
      device_id: "stranger-device-id",
      status: "won",
      is_official: true,
      won: true,
      mistakes: 1,
      found_rainbow: false,
      bonus_rainbow_attempted: false,
      completed_at: new Date().toISOString(),
    });
    return id;
  }

  /** An in-progress session belonging to somebody else. */
  function seedStrangerInProgress(id = "stranger-live") {
    db.tables.game_sessions.push({
      id,
      puzzle_id: "someone-elses-puzzle",
      user_id: null,
      device_id: "stranger-device-id",
      status: "in_progress",
      is_official: false,
      won: null,
      mistakes: 1,
      completed_at: null,
    });
    return id;
  }

  // B. Generic anonymous UPDATE is not permitted.
  it("B. an anonymous client cannot issue a blanket UPDATE", async () => {
    seedStrangerSession();
    seedStrangerInProgress();
    db.signIn(null);

    // The attack RLS alone could never prevent: one unfiltered statement.
    const { error } = await db.from("game_sessions").update({ mistakes: 0 });
    expect(error).toBeTruthy();
    expect((error as { code: string }).code).toBe("42501");

    // Nothing moved.
    expect(sessions().find((s) => s.id === "stranger-session")!.mistakes).toBe(1);
    expect(sessions().find((s) => s.id === "stranger-live")!.mistakes).toBe(1);
  });

  it("B2. an anonymous client cannot insert guess or hint events directly", async () => {
    const id = seedStrangerInProgress();
    db.signIn(null);

    const g = await db.from("guess_events").insert({
      game_session_id: id,
      guess_number: 99,
      words: ["x", "y", "z", "w"],
      correct: true,
    });
    const h = await db.from("hint_events").insert({
      game_session_id: id,
      hint_type: "small",
    });
    expect(g.error).toBeTruthy();
    expect(h.error).toBeTruthy();
    expect(guesses()).toHaveLength(0);
    expect(hints()).toHaveLength(0);
  });

  // C. A session ID alone is not enough.
  it("C. knowing only a session id cannot mutate that session", async () => {
    const liveId = seedStrangerInProgress();
    const doneId = seedStrangerSession();
    db.signIn(null);

    // Every write function, called with the right session id but the WRONG
    // device capability. The session id is not a secret worth much on its own
    // — the device_id it was created with is the second factor.
    const wrongDevice = "attacker-device-id";

    expect(
      (await db.rpc("touch_game_session", {
        _session_id: liveId,
        _device_id: wrongDevice,
        _active_time_seconds: 9999,
        _mistakes: 0,
      })).data
    ).toBe(false);

    expect(
      (await db.rpc("finalize_game_session", {
        _session_id: liveId,
        _device_id: wrongDevice,
        _won: true,
        _mistakes: 0,
        _active_time_seconds: 1,
        _found_rainbow: true,
        _rainbow_solve_index: 0,
        _solve_order: [],
        _hints_used: false,
        _share_grid: "",
      })).data
    ).toBeNull();

    expect(
      (await db.rpc("record_guess_events", {
        _session_id: liveId,
        _device_id: wrongDevice,
        _events: [{ guess_number: 1, words: ["a"], correct: true }],
      })).data
    ).toBeNull();

    expect(
      (await db.rpc("record_hint_event", {
        _session_id: liveId,
        _device_id: wrongDevice,
        _hint_type: "small",
      })).data
    ).toBe(false);

    expect(
      (await db.rpc("record_bonus_rainbow", {
        _session_id: doneId,
        _device_id: wrongDevice,
        _guess_number: 5,
        _words: ["a", "b", "c", "d"],
        _correct: true,
      })).data
    ).toBe(false);

    // Every field is exactly as seeded.
    const live = sessions().find((s) => s.id === liveId)!;
    expect(live.status).toBe("in_progress");
    expect(live.mistakes).toBe(1);
    expect(live.active_time_seconds).toBeUndefined();
    const done = sessions().find((s) => s.id === doneId)!;
    expect(done.found_rainbow).toBe(false);
    expect(done.bonus_rainbow_attempted).toBe(false);
    expect(guesses()).toHaveLength(0);
    expect(hints()).toHaveLength(0);
  });

  // D. The legitimate holder of both can do the scoped operations.
  it("D. the matching device capability performs the legitimate operations", async () => {
    const liveId = seedStrangerInProgress();
    db.signIn(null);
    const right = "stranger-device-id";

    expect(
      (await db.rpc("touch_game_session", {
        _session_id: liveId,
        _device_id: right,
        _active_time_seconds: 42,
        _mistakes: 2,
      })).data
    ).toBe(true);

    const live = sessions().find((s) => s.id === liveId)!;
    expect(live.active_time_seconds).toBe(42);
    expect(live.mistakes).toBe(2);
    expect(live.last_activity_at).toEqual(expect.any(String));
    // Still in progress, still outcome-free — the heartbeat owns three
    // columns and nothing else.
    expect(live.status).toBe("in_progress");
    expect(live.won).toBeNull();
    expect(live.completed_at).toBeNull();
  });

  it("D2. the heartbeat cannot reopen or rewrite a finished game", async () => {
    const doneId = seedStrangerSession();
    db.signIn(null);

    const { data } = await db.rpc("touch_game_session", {
      _session_id: doneId,
      _device_id: "stranger-device-id",
      _active_time_seconds: 99999,
      _mistakes: 0,
    });
    // Capability is fine; the session is simply no longer in progress.
    expect(data).toBe(false);
    const done = sessions().find((s) => s.id === doneId)!;
    expect(done.status).toBe("won");
    expect(done.mistakes).toBe(1);
  });

  // E. The shared 'unknown' device id is not a capability.
  it("E. device_id 'unknown' unlocks nothing on the write path either", async () => {
    db.tables.game_sessions.push({
      id: "storage-blocked",
      puzzle_id: PUZZLE_ID,
      user_id: null,
      device_id: "unknown",
      status: "in_progress",
      is_official: false,
      won: null,
      mistakes: 1,
      completed_at: null,
    });
    db.signIn(null);

    const { data } = await db.rpc("touch_game_session", {
      _session_id: "storage-blocked",
      _device_id: "unknown",
      _active_time_seconds: 500,
      _mistakes: 4,
    });
    expect(data).toBe(false);
    expect(sessions().find((s) => s.id === "storage-blocked")!.mistakes).toBe(1);
  });

  // F / G. Authenticated ownership.
  it("F. a signed-in player can finalize their own session", async () => {
    db.signIn("me-user-id");
    const view = mount();
    await guess(view, ["y1", "y2", "y3", "y4"]);
    await guess(view, ["g1", "g2", "g3", "g4"]);
    await guess(view, ["b1", "b2", "b3", "b4"]);
    await guess(view, ["r1", "r2", "r3", "r4"]);

    const s = sessions()[0];
    expect(s.user_id).toBe("me-user-id");
    expect(s.status).toBe("won");
    expect(s.is_official).toBe(true);
  });

  it("G. a signed-in player cannot touch another user's session", async () => {
    db.tables.game_sessions.push({
      id: "other-account-session",
      puzzle_id: PUZZLE_ID,
      user_id: "other-user-id",
      device_id: "shared-device-id",
      status: "in_progress",
      is_official: false,
      won: null,
      mistakes: 1,
      completed_at: null,
    });
    db.signIn("me-user-id");

    // Not via the capability check...
    expect(
      (await db.rpc("touch_game_session", {
        _session_id: "other-account-session",
        _device_id: "shared-device-id",
        _active_time_seconds: 1,
        _mistakes: 4,
      })).data
    ).toBe(false);

    // ...and not by supplying the device_id that session carries either: for
    // an ACCOUNT-owned session, only a matching auth.uid() unlocks it, so
    // possession of a device id can never reach someone's account games.
    expect(
      (await db.rpc("finalize_game_session", {
        _session_id: "other-account-session",
        _device_id: "shared-device-id",
        _won: true,
        _mistakes: 0,
        _active_time_seconds: 1,
        _found_rainbow: false,
        _rainbow_solve_index: null,
        _solve_order: [],
        _hints_used: false,
        _share_grid: "",
      })).data
    ).toBeNull();

    const other = sessions().find((s) => s.id === "other-account-session")!;
    expect(other.status).toBe("in_progress");
    expect(other.mistakes).toBe(1);
  });

  it("G2. an anonymous caller cannot reach an account-owned session", async () => {
    db.tables.game_sessions.push({
      id: "account-session",
      puzzle_id: PUZZLE_ID,
      user_id: "some-user-id",
      device_id: "known-device-id",
      status: "in_progress",
      is_official: false,
      won: null,
      mistakes: 0,
      completed_at: null,
    });
    db.signIn(null);

    expect(
      (await db.rpc("touch_game_session", {
        _session_id: "account-session",
        _device_id: "known-device-id",
        _active_time_seconds: 1,
        _mistakes: 4,
      })).data
    ).toBe(false);
    expect(sessions().find((s) => s.id === "account-session")!.mistakes).toBe(0);
  });

  it("claiming guest sessions requires an account and only moves rows to it", async () => {
    db.tables.game_sessions.push({
      id: "guest-1",
      puzzle_id: PUZZLE_ID,
      user_id: null,
      device_id: "my-device",
      status: "won",
      is_official: true,
      won: true,
      mistakes: 0,
      completed_at: new Date().toISOString(),
    });
    db.tables.game_sessions.push({
      id: "other-account",
      puzzle_id: PUZZLE_ID,
      user_id: "other-user-id",
      device_id: "my-device",
      status: "won",
      is_official: true,
      won: true,
      mistakes: 0,
      completed_at: new Date().toISOString(),
    });

    // Anonymous: refused outright.
    db.signIn(null);
    expect((await db.rpc("claim_anonymous_sessions", { _device_id: "my-device" })).data).toBe(0);
    expect(sessions().find((s) => s.id === "guest-1")!.user_id).toBeNull();

    // Signed in: claims only the anonymous row, never another account's.
    db.signIn("me-user-id");
    expect((await db.rpc("claim_anonymous_sessions", { _device_id: "my-device" })).data).toBe(1);
    expect(sessions().find((s) => s.id === "guest-1")!.user_id).toBe("me-user-id");
    expect(sessions().find((s) => s.id === "other-account")!.user_id).toBe("other-user-id");
  });

  it("a client cannot forge attempt_type = bonus_rainbow on a normal guess", async () => {
    // record_guess_events forces 'normal', so the bonus value can only ever
    // originate from the genuine post-completion flow. That is what makes it
    // usable as an intent signal at all.
    db.signIn(null);
    const view = mount();
    await guess(view, ["y1", "y2", "y3", "g1"]);
    const sessionId = sessions()[0].id as string;

    await db.rpc("record_guess_events", {
      _session_id: sessionId,
      _device_id: getDeviceId(),
      _events: [
        {
          guess_number: 50,
          words: ["y1", "g1", "b1", "r1"],
          correct: true,
          attempt_type: "bonus_rainbow",
          is_rainbow_attempt: true,
        },
      ],
    });

    const forged = guesses().find((g) => g.guess_number === 50)!;
    expect(forged.attempt_type).toBe("normal");
    expect(guesses().filter((g) => g.attempt_type === "bonus_rainbow")).toHaveLength(0);
    expect(sessions()[0].bonus_rainbow_attempted).toBe(false);
  });

  // H. Full anonymous gameplay, end to end, through the scoped write path.
  it("H. full anonymous game: start, guesses, hint, resume, win, bonus, stats", async () => {
    db.signIn(null);
    const first = mount(puzzle, { smallHintUsed: false });

    await guess(first, ["y1", "y2", "y3", "g1"]); // a miss
    const sessionId = sessions()[0].id;
    expect(sessions()[0].mistakes).toBe(1);

    // A hint reveal.
    await act(async () => first.rerender({ o: { smallHintUsed: true } }));
    await settle();
    expect(hints()).toHaveLength(1);

    // Refresh.
    first.unmount();
    const second = mount();
    await settle();
    expect(second.result.current.sessionIdRef.current).toBe(sessionId);

    await guess(second, ["y1", "y2", "y3", "y4"]);
    await guess(second, ["g1", "g2", "g3", "g4"]);
    await guess(second, ["b1", "b2", "b3", "b4"]);
    await guess(second, ["r1", "r2", "r3", "r4"]);

    expect(sessions()).toHaveLength(1);
    const s = sessions()[0];
    expect(s.status).toBe("won");
    expect(s.is_official).toBe(true);
    expect(s.mistakes).toBe(1);
    expect(s.hints_used).toBe(true);
    expect(hints()).toHaveLength(1);

    // Bonus Rainbow, after the win.
    const { recordBonusRainbowAttempt } = await import("@/lib/gameStats");
    await recordBonusRainbowAttempt({
      sessionId: s.id as string,
      guessNumber: second.result.current.nextGuessNumber(0),
      words: ["y1", "g1", "b1", "r1"],
      correct: true,
      guessedAt: new Date().toISOString(),
      activeTimeSeconds: second.result.current.activeSecondsRef.current,
      groupsSolved: 4,
    });
    expect(sessions()[0].found_rainbow).toBe(true);
    expect(sessions()[0].rainbow_source).toBe("post_game");
    expect(sessions()[0].bonus_rainbow_attempted).toBe(true);

    const stats = await loadStatsFromSupabase();
    expect(stats.gamesPlayed).toBe(1);
    expect(stats.gamesWon).toBe(1);
    expect(stats.rainbowSpottedCount).toBe(1);
  });

  // I. Signed-in gameplay, end to end.
  it("I. full signed-in game still works", async () => {
    db.signIn("me-user-id");
    const view = mount();
    await guess(view, ["y1", "y2", "y3", "g1"]);
    await guess(view, ["y1", "y2", "y3", "y4"]);
    await guess(view, ["g1", "g2", "g3", "g4"]);
    await guess(view, ["b1", "b2", "b3", "b4"]);
    await guess(view, ["r1", "r2", "r3", "r4"]);

    const s = sessions()[0];
    expect(s.user_id).toBe("me-user-id");
    expect(s.status).toBe("won");
    expect(s.mistakes).toBe(1);

    const stats = await loadStatsFromSupabase();
    expect(stats.gamesPlayed).toBe(1);
    expect(stats.gamesWon).toBe(1);
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
