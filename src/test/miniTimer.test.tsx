/**
 * The Mini solve timer — active VISIBLE time.
 *
 * Two layers are tested, deliberately separately:
 *
 *   1. lib/activeTimer.ts, driven directly with clock values. This is where
 *      the arithmetic lives, so it is checked without React, timers or a DOM
 *      in the way — every "what should the number be" question is answered
 *      here, exactly.
 *   2. useGame's wiring of it: when it starts, what pauses it, what survives
 *      a refresh, what freezes it. Driven through the real hook and the real
 *      progress layer.
 *
 * ROUNDING, stated once and asserted throughout: time accumulates in
 * milliseconds and every reported value is COMPLETED whole seconds, rounded
 * DOWN. 59.9s reads "59s". See createActiveTimer's doc comment.
 */
import { describe, it, expect, beforeEach, vi } from "vitest";
import { act, renderHook } from "@testing-library/react";
import { FakeSupabase } from "./fakeSupabase";
import type { Puzzle } from "@/lib/types";

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
import { createActiveTimer, formatActiveTime, shareTimeLine } from "@/lib/activeTimer";
import { loadProgress, saveProgress, progressKey } from "@/lib/gameProgress";
import { MINI_FORMAT, FULL_FORMAT, progressStorageId } from "@/lib/puzzleFormat";

// ───────────────────────────────────────────────────────────────────────────
// 1. The accumulator, driven with explicit clock values
// ───────────────────────────────────────────────────────────────────────────

describe("the active-time accumulator", () => {
  it("counts only while running", () => {
    const t = createActiveTimer();
    expect(t.seconds(0)).toBe(0);
    t.resume(0);
    expect(t.seconds(5_000)).toBe(5);
    t.pause(5_000);
    // 30 more seconds pass while paused — none of them count.
    expect(t.seconds(35_000)).toBe(5);
    t.resume(35_000);
    expect(t.seconds(37_000)).toBe(7);
  });

  it("counts idle thinking time — no interaction is required", () => {
    const t = createActiveTimer();
    t.resume(0);
    // Nothing happens at all. The board is simply on screen.
    expect(t.seconds(90_000)).toBe(90);
  });

  it("rounds DOWN to completed whole seconds", () => {
    const t = createActiveTimer();
    t.resume(0);
    expect(t.seconds(999)).toBe(0);
    expect(t.seconds(1_000)).toBe(1);
    expect(t.seconds(1_999)).toBe(1);
    expect(t.seconds(59_999)).toBe(59);
    expect(t.seconds(60_000)).toBe(60);
  });

  it("gives the same total whether banked in one stretch or many", () => {
    const one = createActiveTimer();
    one.resume(0);
    one.pause(10_000);

    const many = createActiveTimer();
    let clock = 0;
    for (let i = 0; i < 10; i++) {
      many.resume(clock);
      many.pause(clock + 1_000);
      clock += 1_000 + 500; // half a second hidden between each stretch
    }
    expect(many.seconds(clock)).toBe(one.seconds(10_000));
    expect(many.seconds(clock)).toBe(10);
  });

  it("resumes from banked seconds rather than restarting", () => {
    const t = createActiveTimer(42);
    expect(t.seconds(0)).toBe(42);
    t.resume(0);
    expect(t.seconds(8_000)).toBe(50);
  });

  it("is idempotent: a second resume does not start a second stretch", () => {
    const t = createActiveTimer();
    t.resume(0);
    t.resume(0);
    t.resume(1_000); // a remount racing the first mount
    expect(t.seconds(10_000)).toBe(10);
  });

  it("is idempotent: a second pause banks nothing extra", () => {
    const t = createActiveTimer();
    t.resume(0);
    t.pause(5_000);
    t.pause(9_000);
    t.pause(20_000);
    expect(t.seconds(30_000)).toBe(5);
  });

  it("freezes permanently — later resumes are ignored", () => {
    const t = createActiveTimer();
    t.resume(0);
    t.freeze(12_000);
    expect(t.frozen).toBe(true);
    expect(t.seconds(12_000)).toBe(12);
    t.resume(20_000);
    expect(t.running).toBe(false);
    expect(t.seconds(999_000)).toBe(12);
  });

  it("never runs backwards if the clock jumps back", () => {
    const t = createActiveTimer();
    t.resume(10_000);
    // A wall-clock fallback correcting backwards mid-stretch.
    expect(t.seconds(4_000)).toBe(0);
    t.pause(4_000);
    expect(t.seconds(4_000)).toBe(0);
  });

  it("treats a corrupt stored value as zero rather than trusting it", () => {
    expect(createActiveTimer(Number.NaN).seconds(0)).toBe(0);
    expect(createActiveTimer(-500).seconds(0)).toBe(0);
    expect(createActiveTimer(Number.POSITIVE_INFINITY).seconds(0)).toBe(0);
  });
});

// ───────────────────────────────────────────────────────────────────────────
// 2. Display formatting
// ───────────────────────────────────────────────────────────────────────────

describe("solve-time formatting", () => {
  it("shows bare seconds under a minute", () => {
    expect(formatActiveTime(1)).toBe("1s");
    expect(formatActiveTime(42)).toBe("42s");
    expect(formatActiveTime(59)).toBe("59s");
  });

  it("pads the seconds once minutes appear, so times line up", () => {
    expect(formatActiveTime(60)).toBe("1m 00s");
    expect(formatActiveTime(65)).toBe("1m 05s");
    expect(formatActiveTime(90)).toBe("1m 30s");
    expect(formatActiveTime(725)).toBe("12m 05s");
  });

  it("does not roll minutes into hours", () => {
    expect(formatActiveTime(3_600)).toBe("60m 00s");
    expect(formatActiveTime(4_500)).toBe("75m 00s");
  });

  it("rounds down, matching the accumulator", () => {
    expect(formatActiveTime(59.9)).toBe("59s");
    expect(formatActiveTime(90.99)).toBe("1m 30s");
  });

  it("degrades safely instead of printing nonsense", () => {
    expect(formatActiveTime(0)).toBe("0s");
    expect(formatActiveTime(-5)).toBe("0s");
    expect(formatActiveTime(Number.NaN)).toBe("0s");
    expect(formatActiveTime(Number.POSITIVE_INFINITY)).toBe("0s");
  });

  it("builds the share line", () => {
    expect(shareTimeLine(90)).toBe("⏳ 1m 30s");
    expect(shareTimeLine(42)).toBe("⏳ 42s");
  });
});

// ───────────────────────────────────────────────────────────────────────────
// 3. useGame's wiring
// ───────────────────────────────────────────────────────────────────────────

/**
 * EVERY test gets its own puzzle id.
 *
 * Not decoration: a hook left mounted by an earlier test keeps its effects
 * alive for a beat into the next one, and a shared id means both runs write
 * the same localStorage progress key — so a previous test's banked seconds
 * can land on top of this test's blob. Unique ids make each run's storage
 * genuinely its own, which is what the product does anyway (two puzzles never
 * share a progress key).
 */
let MINI_ID = "mini-timer-0";
let miniPuzzle: Puzzle;
let seq = 0;

function makeMiniPuzzle(id: string): Puzzle {
  return {
    id,
    format: "mini",
    date: "2026-09-21",
    title: "Mini #11",
    designerName: "Sam West",
    alphabetizeCompleted: true,
    groups: [
      { category: "Green", words: ["g1", "g2", "g3"], difficulty: 2 },
      { category: "Blue", words: ["b1", "b2", "b3"], difficulty: 3 },
      { category: "Red", words: ["r1", "r2", "r3"], difficulty: 4 },
    ],
    rainbowHerring: null,
  };
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
    for (let i = 0; i < 25; i++) await new Promise((r) => setTimeout(r, 0));
  });
}

function mount(p: Puzzle, opts: Record<string, unknown> = {}) {
  return renderHook(() => useGame(p, opts as never));
}

async function guess(view: ReturnType<typeof mount>, words: string[]) {
  await act(async () => { view.result.current.deselectAll(); });
  await act(async () => { for (const w of words) view.result.current.toggleWord(w); });
  await act(async () => { view.result.current.submitGuess(); });
  await settle();
  await act(async () => { view.result.current.releaseRevealHold(); });
  await settle();
}

/** Drives document.hidden + the visibilitychange event, as a browser does. */
function setHidden(hidden: boolean) {
  Object.defineProperty(document, "hidden", { configurable: true, value: hidden });
  Object.defineProperty(document, "visibilityState", {
    configurable: true,
    value: hidden ? "hidden" : "visible",
  });
  document.dispatchEvent(new Event("visibilitychange"));
}

/**
 * Moves the MONOTONIC clock the timer reads. The timer uses
 * performance.now(), so advancing fake timers alone would not move it — the
 * clock has to be moved explicitly, which is exactly the point of using a
 * monotonic source rather than tick-counting.
 */
let nowMs = 0;
function advance(ms: number) {
  nowMs += ms;
}

async function mintDeviceIdentity() {
  const { data } = await db.rpc("create_device_identity");
  return (Array.isArray(data) ? data[0] : data) as { device_id: string; device_token: string };
}

beforeEach(async () => {
  reduceMotion();
  for (let i = 0; i < 5; i++) await new Promise((r) => setTimeout(r, 10));
  const identity = await mintDeviceIdentity();

  db.tables.game_sessions = [];
  db.tables.guess_events = [];
  db.tables.hint_events = [];
  db.tables.game_results = [];
  db.tables.user_streaks = [];
  db.tables.puzzle_aggregates = [];
  db.tables.puzzle_versions = [];
  db.tables.puzzle_groups = [];

  localStorage.clear();
  sessionStorage.clear();
  localStorage.setItem("rc-device-id", identity.device_id);
  localStorage.setItem("rc-device-token", identity.device_token);
  MINI_ID = `mini-timer-${++seq}`;
  miniPuzzle = makeMiniPuzzle(MINI_ID);
  db.tables.puzzles = [
    { id: MINI_ID, format: "mini", date: "2026-09-21", rainbow_herring: null, is_published: true },
  ];
  db.signIn(null);

  nowMs = 0;
  vi.spyOn(performance, "now").mockImplementation(() => nowMs);
  setHidden(false);
});

describe("the timer in the game", () => {
  it("starts as soon as the playable board is up — no first click needed", async () => {
    const view = mount(miniPuzzle);
    await settle();
    advance(7_000);
    // Read through the live ref, which is what persistence uses.
    expect(view.result.current.activeSecondsRef.current).toBe(7);
  });

  it("does NOT start while the board is still loading", async () => {
    const view = mount(miniPuzzle, { boardReady: false });
    await settle();
    advance(10_000);
    expect(view.result.current.activeSecondsRef.current).toBe(0);
  });

  it("starts once the board finishes loading", async () => {
    const view = renderHook(({ ready }) => useGame(miniPuzzle, { boardReady: ready }), {
      initialProps: { ready: false },
    });
    await settle();
    advance(10_000); // spent on a spinner — must not count
    view.rerender({ ready: true });
    await settle();
    advance(3_000);
    expect(view.result.current.activeSecondsRef.current).toBe(3);
  });

  it("counts idle time spent looking at the board", async () => {
    const view = mount(miniPuzzle);
    await settle();
    advance(45_000); // no guesses, no clicks
    expect(view.result.current.activeSecondsRef.current).toBe(45);
  });

  it("pauses while the document is hidden and resumes when visible", async () => {
    const view = mount(miniPuzzle);
    await settle();
    advance(5_000);
    expect(view.result.current.activeSecondsRef.current).toBe(5);

    await act(async () => { setHidden(true); });
    advance(600_000); // ten minutes in another app
    expect(view.result.current.activeSecondsRef.current).toBe(5);

    await act(async () => { setHidden(false); });
    advance(4_000);
    expect(view.result.current.activeSecondsRef.current).toBe(9);
  });

  it("does not start counting in a tab that is already hidden", async () => {
    setHidden(true);
    const view = mount(miniPuzzle);
    await settle();
    advance(30_000);
    expect(view.result.current.activeSecondsRef.current).toBe(0);
    await act(async () => { setHidden(false); });
    advance(2_000);
    expect(view.result.current.activeSecondsRef.current).toBe(2);
  });

  it("persists accumulated time through a refresh", async () => {
    const first = mount(miniPuzzle);
    await settle();
    advance(12_000);
    // A real state change writes the full progress blob.
    await guess(first, ["g1", "g2", "g3"]);
    first.unmount();
    await settle();

    const saved = loadProgress(progressStorageId(MINI_ID, MINI_FORMAT));
    expect(saved?.activeTimeSeconds).toBeGreaterThanOrEqual(12);

    const resumed = mount(miniPuzzle);
    await settle();
    expect(resumed.result.current.activeSecondsRef.current).toBeGreaterThanOrEqual(12);
  });

  it("does not count the time the puzzle was closed", async () => {
    const first = mount(miniPuzzle);
    await settle();
    advance(10_000);
    await guess(first, ["g1", "g2", "g3"]);
    first.unmount();
    await settle();
    const banked = loadProgress(progressStorageId(MINI_ID, MINI_FORMAT))!.activeTimeSeconds!;

    // Hours pass with the puzzle closed.
    advance(6 * 60 * 60 * 1000);

    const resumed = mount(miniPuzzle);
    await settle();
    // The gap added nothing.
    expect(resumed.result.current.activeSecondsRef.current).toBe(banked);
    advance(3_000);
    expect(resumed.result.current.activeSecondsRef.current).toBe(banked + 3);
  });

  it("a remount cannot double-count", async () => {
    const first = mount(miniPuzzle);
    await settle();
    advance(10_000);
    await guess(first, ["g1", "g2", "g3"]);
    first.unmount();
    await settle();
    const afterFirst = loadProgress(progressStorageId(MINI_ID, MINI_FORMAT))!.activeTimeSeconds!;

    // Three remounts in a row, each adding one second of real time.
    let expected = afterFirst;
    for (let i = 0; i < 3; i++) {
      const v = mount(miniPuzzle);
      await settle();
      advance(1_000);
      expected += 1;
      expect(v.result.current.activeSecondsRef.current).toBe(expected);
      await guess(v, [`g${i + 1}`, "b1", "r1"]);
      v.unmount();
      await settle();
    }
    // Linear, not multiplied.
    expect(loadProgress(progressStorageId(MINI_ID, MINI_FORMAT))!.activeTimeSeconds).toBe(expected);
  });

  it("freezes at completion and never moves again", async () => {
    const view = mount(miniPuzzle);
    await settle();
    advance(20_000);
    await guess(view, ["g1", "g2", "g3"]);
    await guess(view, ["b1", "b2", "b3"]);
    await guess(view, ["r1", "r2", "r3"]);
    await settle();
    expect(view.result.current.state.isComplete).toBe(true);
    const finalTime = view.result.current.activeSecondsRef.current;
    expect(finalTime).toBeGreaterThanOrEqual(20);

    // Sitting on the result screen adds nothing.
    advance(300_000);
    await settle();
    expect(view.result.current.activeSecondsRef.current).toBe(finalTime);
  });

  it("freezes on a LOSS too", async () => {
    const view = mount(miniPuzzle);
    await settle();
    advance(8_000);
    await guess(view, ["g1", "b1", "r1"]);
    await guess(view, ["g1", "b1", "r2"]);
    await guess(view, ["g1", "b1", "r3"]);
    await guess(view, ["g1", "b2", "r1"]);
    await settle();
    expect(view.result.current.state.isComplete).toBe(true);
    expect(view.result.current.state.isWon).toBe(false);
    const finalTime = view.result.current.activeSecondsRef.current;
    advance(120_000);
    await settle();
    expect(view.result.current.activeSecondsRef.current).toBe(finalTime);
  });

  it("a restored COMPLETED run keeps its frozen time", async () => {
    const view = mount(miniPuzzle);
    await settle();
    advance(33_000);
    await guess(view, ["g1", "g2", "g3"]);
    await guess(view, ["b1", "b2", "b3"]);
    await guess(view, ["r1", "r2", "r3"]);
    await settle();
    const finalTime = view.result.current.activeSecondsRef.current;
    view.unmount();
    await settle();

    advance(500_000); // a long time away
    const reopened = mount(miniPuzzle);
    await settle();
    expect(reopened.result.current.state.isComplete).toBe(true);
    expect(reopened.result.current.activeSecondsRef.current).toBe(finalTime);
    advance(60_000);
    await settle();
    expect(reopened.result.current.activeSecondsRef.current).toBe(finalTime);
  });

  it("Replay starts a fresh timer at zero", async () => {
    const first = mount(miniPuzzle);
    await settle();
    advance(25_000);
    await guess(first, ["g1", "g2", "g3"]);
    first.unmount();
    await settle();
    expect(loadProgress(progressStorageId(MINI_ID, MINI_FORMAT))!.activeTimeSeconds).toBeGreaterThanOrEqual(25);

    // Replay is "clear this attempt's blob, then remount" — what
    // CustomPuzzle's Replay button does.
    localStorage.removeItem(progressKey(progressStorageId(MINI_ID, MINI_FORMAT)));

    const replay = mount(miniPuzzle);
    await settle();
    expect(replay.result.current.activeSecondsRef.current).toBe(0);
    advance(4_000);
    expect(replay.result.current.activeSecondsRef.current).toBe(4);
  });

  it("saves the final time on the run's own session, creating no extra play", async () => {
    const view = mount(miniPuzzle);
    await settle();
    advance(15_000);
    await guess(view, ["g1", "g2", "g3"]);
    await guess(view, ["b1", "b2", "b3"]);
    await guess(view, ["r1", "r2", "r3"]);
    await settle();

    const sessions = db.tables.game_sessions.filter((s) => s.puzzle_id === MINI_ID);
    expect(sessions).toHaveLength(1);
    expect(sessions[0].active_time_seconds).toBeGreaterThanOrEqual(15);
    expect(sessions[0].format).toBe("mini");
  });

  it("a legacy blob with no stored time starts from zero, never a guess", async () => {
    const storageId = progressStorageId(MINI_ID, MINI_FORMAT);
    saveProgress(storageId, {
      solvedGroups: [0],
      mistakes: 0,
      guessHistory: [],
      gotRainbow: false,
      shuffledWords: ["b1", "b2", "b3", "r1", "r2", "r3"],
      rainbowWords: [],
      // NO activeTimeSeconds — a blob written before the field existed.
    });
    const view = mount(miniPuzzle);
    await settle();
    expect(view.result.current.activeSecondsRef.current).toBe(0);
  });
});

describe("format scope", () => {
  it("Mini shows a timer and Full does not", () => {
    expect(MINI_FORMAT.showsTimer).toBe(true);
    expect(FULL_FORMAT.showsTimer).toBe(false);
  });

  it("a Full game still records its active time, it just isn't displayed", async () => {
    const fullPuzzle: Puzzle = {
      id: "full-timer-1",
      date: "2026-09-21",
      title: "#1",
      designerName: "Sam West",
      alphabetizeCompleted: true,
      groups: [
        { category: "Yellow", words: ["y1", "y2", "y3", "y4"], difficulty: 1 },
        { category: "Green", words: ["gg1", "gg2", "gg3", "gg4"], difficulty: 2 },
        { category: "Blue", words: ["bb1", "bb2", "bb3", "bb4"], difficulty: 3 },
        { category: "Red", words: ["rr1", "rr2", "rr3", "rr4"], difficulty: 4 },
      ],
      rainbowHerring: null,
    };
    db.tables.puzzles.push({
      id: "full-timer-1", date: "2026-09-21", rainbow_herring: null, is_published: true,
    });
    const view = mount(fullPuzzle);
    await settle();
    advance(9_000);
    expect(view.result.current.activeSecondsRef.current).toBe(9);
  });
});
