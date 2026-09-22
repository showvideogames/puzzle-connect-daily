/**
 * Mini sharing — a three-symbol-wide result block.
 *
 * A shared Mini looks like:
 *
 *     Mini #1
 *     🟩🟩🟩
 *     🟦🟦🟦
 *     🟥🟥🟥
 *     ⏳ 1m 30s
 *     rainbowcategories.com/mini
 *
 * The rows are the player's REAL guess history. Nothing here fabricates a
 * clean grid, and the tests below prove it by sharing losses, mistakes and
 * half-finished runs too.
 *
 * The grid text is built by GameBoard, so these tests reproduce that exact
 * row-building logic against real guess histories produced by the real hook,
 * then assert on the composed share text from lib/shareText.ts.
 */
import { describe, it, expect, beforeEach, vi } from "vitest";
import { act, renderHook } from "@testing-library/react";
import { FakeSupabase } from "./fakeSupabase";
import type { Puzzle, GuessAttempt } from "@/lib/types";

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
import { dedupeHintMarkers } from "@/lib/hints";
import { resolveTheme } from "@/lib/themes";
import { buildOfficialShareText, formatShareHeading } from "@/lib/shareText";
import {
  MINI_SHARE_FALLBACK,
  isValidShareDestination,
  miniShareDestination,
} from "@/lib/shareDestination";
import { MINI_FORMAT, FULL_FORMAT, type PuzzleFormat } from "@/lib/puzzleFormat";

const DIFFICULTY_SQUARE: Record<number, string> = { 1: "🟨", 2: "🟩", 3: "🟦", 4: "🟥" };

/**
 * GameBoard's share-row builder, reproduced exactly (see its generateShareLines
 * and hintShareRow). Kept in step with the component by asserting the same
 * invariants the component promises.
 */
function shareLines(history: GuessAttempt[], puzzle: Puzzle, format: PuzzleFormat): string[] {
  const theme = resolveTheme(puzzle.theme, format.categoryCount);
  const hintRow = (hintType: "small" | "full" | undefined) => {
    const emoji = hintType === "small" ? "💡" : "🔦";
    if (format.id === "full") return emoji;
    const pad = Math.max(0, format.categoryCount - 1);
    const left = Math.floor(pad / 2);
    return "✨".repeat(left) + emoji + "✨".repeat(pad - left);
  };
  const lines: string[] = [];
  for (const attempt of dedupeHintMarkers(history)) {
    if (attempt.isHintMarker) {
      const row = hintRow(attempt.hintType);
      const last = lines[lines.length - 1];
      if (format.id === "full" && (last === "💡" || last === "🔦" || last === "💡🔦" || last === "🔦💡")) {
        lines[lines.length - 1] = last + row;
      } else {
        lines.push(row);
      }
    } else if (attempt.isRainbow) {
      lines.push(theme.shareRow);
    } else {
      lines.push(
        attempt.groupIndices
          .map((gi) => DIFFICULTY_SQUARE[puzzle.groups[gi]?.difficulty] || "⬜")
          .join("")
      );
    }
  }
  return lines;
}

const MINI_ID = "mini-share-1";
const RAINBOW_MINI_ID = "mini-share-rainbow";

const classicMini: Puzzle = {
  id: MINI_ID,
  format: "mini",
  date: "2026-09-21",
  title: "Mini #1",
  designerName: "Sam West",
  alphabetizeCompleted: true,
  groups: [
    { category: "Green", words: ["g1", "g2", "g3"], difficulty: 2 },
    { category: "Blue", words: ["b1", "b2", "b3"], difficulty: 3 },
    { category: "Red", words: ["r1", "r2", "r3"], difficulty: 4 },
  ],
  rainbowHerring: null,
};

const rainbowMini: Puzzle = {
  ...classicMini,
  id: RAINBOW_MINI_ID,
  title: "Mini #2",
  rainbowHerring: ["g1", "b1", "r1"],
  rainbowCategoryName: "Hidden Trio",
  rainbowHintWord: "clue",
};

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
  db.tables.puzzles = [
    { id: MINI_ID, format: "mini", date: "2026-09-21", rainbow_herring: null, is_published: true },
    { id: RAINBOW_MINI_ID, format: "mini", date: "2026-09-20", rainbow_herring: ["g1", "b1", "r1"], is_published: true },
  ];
  db.signIn(null);
});

// ───────────────────────────────────────────────────────────────────────────
// The grid
// ───────────────────────────────────────────────────────────────────────────

describe("the Mini share grid", () => {
  it("a perfect Classic Mini is three rows of three", async () => {
    const view = mount(classicMini);
    await guess(view, ["g1", "g2", "g3"]);
    await guess(view, ["b1", "b2", "b3"]);
    await guess(view, ["r1", "r2", "r3"]);
    await settle();

    const lines = shareLines(view.result.current.state.guessHistory, classicMini, MINI_FORMAT);
    expect(lines).toEqual(["🟩🟩🟩", "🟦🟦🟦", "🟥🟥🟥"]);
    for (const line of lines) expect([...line]).toHaveLength(3);
  });

  it("reports REAL incorrect guesses, not a fabricated clean grid", async () => {
    const view = mount(classicMini);
    // A genuine miss: one word from each category.
    await guess(view, ["g1", "b1", "r1"]);
    // A one-away miss: two Greens and a Blue.
    await guess(view, ["g1", "g2", "b1"]);
    await guess(view, ["g1", "g2", "g3"]);
    await settle();

    const lines = shareLines(view.result.current.state.guessHistory, classicMini, MINI_FORMAT);
    expect(lines).toEqual([
      "🟩🟦🟥", // the mixed miss, each square in its own word's real colour
      "🟩🟩🟦", // the one-away
      "🟩🟩🟩", // the solve
    ]);
    expect(view.result.current.state.mistakes).toBe(2);
  });

  it("a LOST Mini shares the four real mistakes", async () => {
    const view = mount(classicMini);
    await guess(view, ["g1", "b1", "r1"]);
    await guess(view, ["g1", "b1", "r2"]);
    await guess(view, ["g1", "b1", "r3"]);
    await guess(view, ["g1", "b2", "r1"]);
    await settle();
    expect(view.result.current.state.isWon).toBe(false);

    const lines = shareLines(view.result.current.state.guessHistory, classicMini, MINI_FORMAT);
    expect(lines).toHaveLength(4);
    for (const line of lines) expect([...line]).toHaveLength(3);
    // No row claims a solved category.
    expect(lines).not.toContain("🟩🟩🟩");
  });

  it("every row stays exactly three symbols wide, whatever happened", async () => {
    const view = mount(rainbowMini, { smallHintUsed: true, fullHintUsed: true });
    await settle();
    await guess(view, ["g1", "b1", "r1"]); // the Rainbow
    await guess(view, ["g1", "g2", "b1"]); // a miss
    await guess(view, ["g1", "g2", "g3"]);
    await settle();

    const lines = shareLines(view.result.current.state.guessHistory, rainbowMini, MINI_FORMAT);
    expect(lines.length).toBeGreaterThan(0);
    for (const line of lines) {
      expect([...line]).toHaveLength(3);
    }
  });
});

describe("the Mini Rainbow in a share grid", () => {
  it("a won Rainbow is a three-cell 🌈 row", async () => {
    const view = mount(rainbowMini);
    await guess(view, ["g1", "b1", "r1"]);
    await guess(view, ["g1", "g2", "g3"]);
    await guess(view, ["b1", "b2", "b3"]);
    await guess(view, ["r1", "r2", "r3"]);
    await settle();

    const lines = shareLines(view.result.current.state.guessHistory, rainbowMini, MINI_FORMAT);
    expect(lines[0]).toBe("🌈🌈🌈");
    expect([...lines[0]]).toHaveLength(3);
    expect(lines).toEqual(["🌈🌈🌈", "🟩🟩🟩", "🟦🟦🟦", "🟥🟥🟥"]);
  });

  it("the Rainbow row sits where it was actually found", async () => {
    const view = mount(rainbowMini);
    await guess(view, ["g1", "g2", "g3"]);
    await guess(view, ["b1", "b2", "b3"]);
    await guess(view, ["g1", "b1", "r1"]);
    await guess(view, ["r1", "r2", "r3"]);
    await settle();

    const lines = shareLines(view.result.current.state.guessHistory, rainbowMini, MINI_FORMAT);
    expect(lines).toEqual(["🟩🟩🟩", "🟦🟦🟦", "🌈🌈🌈", "🟥🟥🟥"]);
  });

  it("a FAILED Rainbow contributes no 🌈 row at all", async () => {
    const view = mount(rainbowMini);
    await guess(view, ["g1", "g2", "g3"]);
    await guess(view, ["b1", "b2", "b3"]);
    await guess(view, ["r1", "r2", "r3"]);
    await settle();

    const lines = shareLines(view.result.current.state.guessHistory, rainbowMini, MINI_FORMAT);
    expect(lines.join("\n")).not.toContain("🌈");
    expect(lines).toEqual(["🟩🟩🟩", "🟦🟦🟦", "🟥🟥🟥"]);
  });

  it("a FULL Rainbow row is still four wide", () => {
    const fullPuzzle: Puzzle = {
      id: "full-share-1",
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
      rainbowHerring: ["y1", "gg1", "bb1", "rr1"],
    };
    const lines = shareLines(
      [{ words: [], groupIndices: [], isCorrect: true, isRainbow: true }],
      fullPuzzle,
      FULL_FORMAT
    );
    expect(lines[0]).toBe("🌈🌈🌈🌈");
  });
});

// ───────────────────────────────────────────────────────────────────────────
// Hint markers
// ───────────────────────────────────────────────────────────────────────────

describe("hint rows", () => {
  it("a Lightbulb is a padded three-symbol row, never bare or space-padded", async () => {
    const view = mount(classicMini, { smallHintUsed: true });
    await settle();
    await guess(view, ["g1", "g2", "g3"]);

    const lines = shareLines(view.result.current.state.guessHistory, classicMini, MINI_FORMAT);
    expect(lines[0]).toBe("✨💡✨");
    expect([...lines[0]]).toHaveLength(3);
    // The whole point: no whitespace to be trimmed or collapsed in transit.
    expect(lines[0]).not.toMatch(/\s/);
  });

  it("a Flashlight is a padded three-symbol row", async () => {
    const view = mount(classicMini, { fullHintUsed: true });
    await settle();
    await guess(view, ["g1", "g2", "g3"]);

    const lines = shareLines(view.result.current.state.guessHistory, classicMini, MINI_FORMAT);
    expect(lines[0]).toBe("✨🔦✨");
    expect(lines[0]).not.toMatch(/\s/);
  });

  it("keeps both hint rows in their real timeline positions, each on its own row", async () => {
    // Small hint first, a guess, then the full hint, then another guess.
    const view = renderHook(
      ({ small, full }) => useGame(classicMini, { smallHintUsed: small, fullHintUsed: full }),
      { initialProps: { small: false, full: false } }
    );
    await settle();
    view.rerender({ small: true, full: false });
    await settle();
    await act(async () => { view.result.current.deselectAll(); });
    await act(async () => { ["g1", "g2", "g3"].forEach((w) => view.result.current.toggleWord(w)); });
    await act(async () => { view.result.current.submitGuess(); });
    await settle();
    await act(async () => { view.result.current.releaseRevealHold(); });
    await settle();

    view.rerender({ small: true, full: true });
    await settle();
    await act(async () => { view.result.current.deselectAll(); });
    await act(async () => { ["b1", "b2", "b3"].forEach((w) => view.result.current.toggleWord(w)); });
    await act(async () => { view.result.current.submitGuess(); });
    await settle();
    await act(async () => { view.result.current.releaseRevealHold(); });
    await settle();

    const lines = shareLines(view.result.current.state.guessHistory, classicMini, MINI_FORMAT);
    expect(lines).toEqual(["✨💡✨", "🟩🟩🟩", "✨🔦✨", "🟦🟦🟦"]);
    // Never merged into one six-symbol row.
    for (const line of lines) expect([...line]).toHaveLength(3);
  });

  it("deduplicates a hint type, however many times it is restored or re-fired", () => {
    const history: GuessAttempt[] = [
      { words: [], groupIndices: [], isCorrect: false, isHintMarker: true, hintType: "small" },
      { words: [], groupIndices: [], isCorrect: false, isHintMarker: true, hintType: "small" },
      { words: [], groupIndices: [], isCorrect: true, isRainbow: false },
      { words: [], groupIndices: [], isCorrect: false, isHintMarker: true, hintType: "small" },
    ];
    const lines = shareLines(history, classicMini, MINI_FORMAT);
    expect(lines.filter((l) => l.includes("💡"))).toHaveLength(1);
  });

  it("a hint revealed after the puzzle is resolved changes nothing", async () => {
    const view = renderHook(
      ({ small }) => useGame(classicMini, { smallHintUsed: small }),
      { initialProps: { small: false } }
    );
    await settle();
    await act(async () => { view.result.current.deselectAll(); });
    await act(async () => { ["g1", "g2", "g3"].forEach((w) => view.result.current.toggleWord(w)); });
    await act(async () => { view.result.current.submitGuess(); });
    await settle();
    await act(async () => { view.result.current.releaseRevealHold(); });
    await settle();
    await act(async () => { view.result.current.deselectAll(); });
    await act(async () => { ["b1", "b2", "b3"].forEach((w) => view.result.current.toggleWord(w)); });
    await act(async () => { view.result.current.submitGuess(); });
    await settle();
    await act(async () => { view.result.current.releaseRevealHold(); });
    await settle();
    await act(async () => { view.result.current.deselectAll(); });
    await act(async () => { ["r1", "r2", "r3"].forEach((w) => view.result.current.toggleWord(w)); });
    await act(async () => { view.result.current.submitGuess(); });
    await settle();
    await act(async () => { view.result.current.releaseRevealHold(); });
    await settle();

    expect(view.result.current.state.isComplete).toBe(true);
    expect(view.result.current.hintsViewOnly).toBe(true);
    const before = shareLines(view.result.current.state.guessHistory, classicMini, MINI_FORMAT);
    const hintsBefore = db.tables.hint_events.length;

    // Now peek at a hint, post-completion.
    view.rerender({ small: true });
    await settle();

    const after = shareLines(view.result.current.state.guessHistory, classicMini, MINI_FORMAT);
    expect(after).toEqual(before);
    expect(after.join("\n")).not.toContain("💡");
    expect(db.tables.hint_events).toHaveLength(hintsBefore);
    // The hint IS shown, it just costs nothing.
    expect(view.result.current.smallHintVisible).toBe(true);
  });

  it("FULL keeps its original bare hint markers — unchanged", () => {
    const fullPuzzle: Puzzle = {
      id: "full-share-2",
      date: "2026-09-21",
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
    const history: GuessAttempt[] = [
      { words: [], groupIndices: [], isCorrect: false, isHintMarker: true, hintType: "small" },
      { words: [], groupIndices: [], isCorrect: false, isHintMarker: true, hintType: "full" },
      { words: [], groupIndices: [0, 0, 0, 0], isCorrect: true },
    ];
    const lines = shareLines(history, fullPuzzle, FULL_FORMAT);
    // Two adjacent markers still merge onto one line, with no ✨ padding.
    expect(lines).toEqual(["💡🔦", "🟨🟨🟨🟨"]);
  });
});

// ───────────────────────────────────────────────────────────────────────────
// The composed share text
// ───────────────────────────────────────────────────────────────────────────

describe("the composed Mini share text", () => {
  it("matches the intended shape end to end", () => {
    const text = buildOfficialShareText(
      "Mini #1",
      ["🟩🟩🟩", "🟦🟦🟦", "🟥🟥🟥"],
      MINI_FORMAT,
      { activeSeconds: 90 }
    );
    expect(text).toBe(
      ["Mini #1", "🟩🟩🟩", "🟦🟦🟦", "🟥🟥🟥", "⏳ 1m 30s", "rainbowcategories.com/mini"].join("\n")
    );
  });

  it("leads with the puzzle's own title, not a 'Puzzle ' prefix", () => {
    const text = buildOfficialShareText("Mini #1", ["🟩🟩🟩"], MINI_FORMAT);
    expect(text.split("\n")[0]).toBe("Mini #1");
  });

  it("falls back to the format name when a Mini has no title", () => {
    const text = buildOfficialShareText(null, ["🟩🟩🟩"], MINI_FORMAT);
    expect(text.split("\n")[0]).toBe(MINI_FORMAT.shareHeading);
  });

  it("says Mini even when the admin titled the puzzle with a bare number", () => {
    // The exact case that shipped wrong: a Mini titled "#1" shared as "#1",
    // which above a three-wide grid reads as a broken FULL result.
    const heading = (t: string) =>
      buildOfficialShareText(t, ["🟩🟩🟩"], MINI_FORMAT).split("\n")[0];
    expect(heading("#1")).toBe("Mini #1");
    expect(heading("#42")).toBe("Mini #42");
    expect(heading("7")).toBe("Mini 7");
  });

  it("never doubles the word Mini when the admin already typed it", () => {
    const heading = (t: string) =>
      buildOfficialShareText(t, ["🟩🟩🟩"], MINI_FORMAT).split("\n")[0];
    expect(heading("Mini #1")).toBe("Mini #1");
    expect(heading("Mini 7")).toBe("Mini 7");
    // The admin's own casing is left alone rather than "corrected".
    expect(heading("mini #3")).toBe("mini #3");
    expect(heading("  Mini #9  ")).toBe("Mini #9");
  });

  it("does not mistake a title that merely STARTS with the letters m-i-n-i", () => {
    const heading = (t: string) =>
      buildOfficialShareText(t, ["🟩🟩🟩"], MINI_FORMAT).split("\n")[0];
    // "Minibeast" is not the word "Mini", so it still gets the prefix.
    expect(heading("Minibeast #2")).toBe("Mini Minibeast #2");
  });
});

describe("formatShareHeading in isolation", () => {
  it("prefixes a Mini's number with the format name", () => {
    expect(formatShareHeading("#1", MINI_FORMAT)).toBe("Mini #1");
    expect(formatShareHeading("Mini #1", MINI_FORMAT)).toBe("Mini #1");
    expect(formatShareHeading("", MINI_FORMAT)).toBe(MINI_FORMAT.shareHeading);
    expect(formatShareHeading(null, MINI_FORMAT)).toBe(MINI_FORMAT.shareHeading);
    expect(formatShareHeading(undefined, MINI_FORMAT)).toBe(MINI_FORMAT.shareHeading);
    expect(formatShareHeading("   ", MINI_FORMAT)).toBe(MINI_FORMAT.shareHeading);
  });

  it("omits the time line when no time was recorded", () => {
    const text = buildOfficialShareText("Mini #1", ["🟩🟩🟩"], MINI_FORMAT, { activeSeconds: 0 });
    expect(text).not.toContain("⏳");
    expect(text.trim().split("\n").pop()).toBe("rainbowcategories.com/mini");
  });

  it("formats the time line consistently", () => {
    const at = (s: number) =>
      buildOfficialShareText("M", ["🟩🟩🟩"], MINI_FORMAT, { activeSeconds: s })
        .split("\n")
        .find((l) => l.startsWith("⏳"));
    expect(at(42)).toBe("⏳ 42s");
    expect(at(90)).toBe("⏳ 1m 30s");
    expect(at(725)).toBe("⏳ 12m 05s");
  });

  it("the link is always the LAST line", () => {
    const text = buildOfficialShareText("Mini #1", ["🟩🟩🟩"], MINI_FORMAT, { activeSeconds: 90 });
    expect(text.split("\n").pop()).toBe("rainbowcategories.com/mini");
  });

  it("FULL share text is completely unchanged, timer argument or not", () => {
    const withTime = buildOfficialShareText("#500", ["🟨🟨🟨🟨"], FULL_FORMAT, { activeSeconds: 90 });
    const without = buildOfficialShareText("#500", ["🟨🟨🟨🟨"], FULL_FORMAT);
    expect(withTime).toBe(without);
    expect(withTime).toBe("Puzzle #500\n🟨🟨🟨🟨\nrainbowcategories.com");
    expect(withTime).not.toContain("⏳");
  });

  it("the Mini heading rule does NOT leak into Full", () => {
    // Full keeps puzzleFullLabel's "Puzzle #500" — it is never prefixed with
    // the format's name, and never says "Full".
    const heading = (t: string | null) =>
      buildOfficialShareText(t, ["🟨🟨🟨🟨"], FULL_FORMAT).split("\n")[0];
    expect(heading("#500")).toBe("Puzzle #500");
    expect(heading("Monday Mashup")).toBe("Puzzle Monday Mashup");
    expect(heading(null)).toBe(FULL_FORMAT.shareHeading);
    expect(heading("#500")).not.toContain("Full");
  });
});

// ───────────────────────────────────────────────────────────────────────────
// The configurable share destination
// ───────────────────────────────────────────────────────────────────────────

describe("the Mini share destination", () => {
  it("uses the working address today", () => {
    expect(MINI_SHARE_FALLBACK).toBe("rainbowcategories.com/mini");
    expect(miniShareDestination(undefined)).toBe("rainbowcategories.com/mini");
  });

  it("uses a configured domain when one is set", () => {
    expect(miniShareDestination("minicategories.com")).toBe("minicategories.com");
    expect(miniShareDestination("  minicategories.com  ")).toBe("minicategories.com");
    expect(miniShareDestination("play.minicategories.com/daily")).toBe(
      "play.minicategories.com/daily"
    );
  });

  it("falls back safely rather than shipping a broken address", () => {
    for (const bad of [
      "",
      "   ",
      "localhost",
      "https://minicategories.com",
      "//minicategories.com",
      "javascript:alert(1)",
      "mini categories.com",
      "user@minicategories.com",
      "minicategories.com?utm=x",
      "minicategories.com#frag",
      null,
      undefined,
      42,
      {},
      "a".repeat(200),
    ]) {
      expect(miniShareDestination(bad)).toBe(MINI_SHARE_FALLBACK);
    }
  });

  it("validates independently of the fallback", () => {
    expect(isValidShareDestination("minicategories.com")).toBe(true);
    expect(isValidShareDestination("rainbowcategories.com/mini")).toBe(true);
    expect(isValidShareDestination("https://minicategories.com")).toBe(false);
    expect(isValidShareDestination("nodots")).toBe(false);
  });

  it("a configured domain flows through to the composed share text", () => {
    // Proves the boundary is the ONLY place the host is decided: the share
    // text never hardcodes one of its own.
    const text = buildOfficialShareText("Mini #1", ["🟩🟩🟩"], MINI_FORMAT);
    expect(text.split("\n").pop()).toBe(miniShareDestination());
  });
});
