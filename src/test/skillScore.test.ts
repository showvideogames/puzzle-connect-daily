/**
 * The Lucky Bot skill score formulas. These fixtures are ALSO run through
 * the SQL copy (public.skill_score) in e2e/scripts/verify-db.ts, so a
 * change to either side that is not mirrored fails somewhere.
 */
import { describe, it, expect } from "vitest";
import {
  computeFullSkillScore,
  computeSkillScore,
  rainbowSourceOf,
  skillScoreForGame,
  solveOrderOf,
  submittedSolveOrderOf,
} from "@/lib/skillScore";
import { FULL_FORMAT, MINI_FORMAT } from "@/lib/puzzleFormat";
import type { GameState, GuessAttempt, Puzzle } from "@/lib/types";

const base = {
  rainbowFound: false,
  rainbowSource: null,
  format: FULL_FORMAT,
} as const;

// The original formula. Since the Full rules changed it is used by the Mini
// only, and stays exactly as it was until Mini gets its own rules.
describe("computeSkillScore (Mini rules, unchanged)", () => {
  it("scores a clean win in easiest-first order at 90", () => {
    const r = computeSkillScore({ ...base, won: true, mistakes: 0, solveOrder: [1, 2, 3, 4] });
    expect(r.score).toBe(90);
    expect(r.lines).toEqual([{ label: "Solved with no mistakes", points: 90 }]);
  });

  it("takes ten points per mistake on a win", () => {
    expect(computeSkillScore({ ...base, won: true, mistakes: 1, solveOrder: [1, 2, 3, 4] }).score).toBe(80);
    expect(computeSkillScore({ ...base, won: true, mistakes: 2, solveOrder: [1, 2, 3, 4] }).score).toBe(70);
    expect(computeSkillScore({ ...base, won: true, mistakes: 3, solveOrder: [1, 2, 3, 4] }).score).toBe(60);
  });

  it("scores a loss from 50 by categories found", () => {
    expect(computeSkillScore({ ...base, won: false, mistakes: 4, solveOrder: [] }).score).toBe(50);
    expect(computeSkillScore({ ...base, won: false, mistakes: 4, solveOrder: [1, 2] }).score).toBe(58);
    expect(computeSkillScore({ ...base, won: false, mistakes: 4, solveOrder: [1, 2, 3] }).score).toBe(62);
  });

  it("gives +4 for a mid-game Rainbow and +1 for a post-game one", () => {
    const mid = computeSkillScore({ ...base, won: true, mistakes: 0, solveOrder: [1, 2, 3, 4], rainbowFound: true, rainbowSource: "in_game" });
    expect(mid.score).toBe(94);
    expect(mid.lines[1]).toEqual({ label: "Spotted the Rainbow mid-game", points: 4 });
    const post = computeSkillScore({ ...base, won: true, mistakes: 0, solveOrder: [1, 2, 3, 4], rainbowFound: true, rainbowSource: "post_game" });
    expect(post.score).toBe(91);
    expect(post.lines[1]).toEqual({ label: "Spotted the Rainbow after the game", points: 1 });
  });

  it("treats a legacy Rainbow with no recorded source as mid-game, like the SQL copy", () => {
    expect(computeSkillScore({ ...base, won: true, mistakes: 0, solveOrder: [1, 2, 3, 4], rainbowFound: true, rainbowSource: null }).score).toBe(94);
  });

  it("gives +2 for Red first and +3 more for a full reverse order", () => {
    const redFirst = computeSkillScore({ ...base, won: true, mistakes: 0, solveOrder: [4, 1, 2, 3] });
    expect(redFirst.score).toBe(92);
    expect(redFirst.lines[1]).toEqual({ label: "Red category first", points: 2 });
    const reverse = computeSkillScore({ ...base, won: true, mistakes: 0, solveOrder: [4, 3, 2, 1] });
    expect(reverse.score).toBe(95);
    expect(reverse.lines.map((l) => l.label)).toEqual([
      "Solved with no mistakes",
      "Red category first",
      "Solved hardest to easiest",
    ]);
  });

  it("caps at 99 for the perfect reverse Rainbow game", () => {
    const r = computeSkillScore({ ...base, won: true, mistakes: 0, solveOrder: [4, 3, 2, 1], rainbowFound: true, rainbowSource: "in_game" });
    expect(r.score).toBe(99);
    expect(r.lines.some((l) => l.label.startsWith("Capped"))).toBe(false);
  });

  it("still counts Red-first on a loss", () => {
    expect(computeSkillScore({ ...base, won: false, mistakes: 4, solveOrder: [4] }).score).toBe(56);
  });

  it("understands a Mini's three-colour reverse order", () => {
    const r = computeSkillScore({ ...base, format: MINI_FORMAT, won: true, mistakes: 0, solveOrder: [4, 3, 2] });
    expect(r.score).toBe(95);
    // Green, Blue, Red in that order is easiest-first for a Mini: no bonus.
    expect(computeSkillScore({ ...base, format: MINI_FORMAT, won: true, mistakes: 0, solveOrder: [2, 3, 4] }).score).toBe(90);
  });
});

const puzzle: Puzzle = {
  id: "p1",
  date: "2026-09-24",
  groups: [
    { category: "A", words: ["A1", "A2", "A3", "A4"], difficulty: 3 },
    { category: "B", words: ["B1", "B2", "B3", "B4"], difficulty: 1 },
    { category: "C", words: ["C1", "C2", "C3", "C4"], difficulty: 4 },
    { category: "D", words: ["D1", "D2", "D3", "D4"], difficulty: 2 },
  ],
  rainbowHerring: ["A1", "B1", "C1", "D1"],
} as Puzzle;

describe("solveOrderOf / rainbowSourceOf", () => {
  it("maps solved group indices to their difficulties in solve order", () => {
    expect(solveOrderOf({ solvedGroups: [2, 0, 3, 1] }, puzzle)).toEqual([4, 3, 2, 1]);
  });

  it("reads a Rainbow found before the last category as mid-game", () => {
    expect(rainbowSourceOf({ gotRainbow: true, rainbowSolveIndex: 2 }, puzzle)).toBe("in_game");
  });

  it("reads a Rainbow found once all categories were solved as post-game", () => {
    expect(rainbowSourceOf({ gotRainbow: true, rainbowSolveIndex: 4 }, puzzle)).toBe("post_game");
  });

  it("treats a legacy Rainbow with no index as mid-game, and no Rainbow as null", () => {
    expect(rainbowSourceOf({ gotRainbow: true, rainbowSolveIndex: null }, puzzle)).toBe("in_game");
    expect(rainbowSourceOf({ gotRainbow: false, rainbowSolveIndex: null }, puzzle)).toBeNull();
  });
});

// ─── Full rules ──────────────────────────────────────────────────────────
// Every row here is also asserted against public.skill_score in
// e2e/scripts/verify-db.ts ("FULL_SKILL_FIXTURES"), with 1–4 written as the
// colour names the client stores: orange (Yellow), green, blue, red.

const full = (won: boolean, mistakes: number, solveOrder: (1 | 2 | 3 | 4)[], rainbowFound = false) =>
  computeFullSkillScore({ won, mistakes, solveOrder, rainbowFound }).score;

describe("computeFullSkillScore — the examples in the brief", () => {
  it("perfect standard-order win with Rainbow = 96", () => {
    expect(full(true, 0, [1, 2, 3, 4], true)).toBe(96);
  });
  it("perfect Red-first win that is not fully reversed, with Rainbow = 99", () => {
    expect(full(true, 0, [4, 1, 2, 3], true)).toBe(99);
    expect(full(true, 0, [4, 3, 1, 2], true)).toBe(99);
  });
  it("perfect full reverse without Rainbow = 99", () => {
    expect(full(true, 0, [4, 3, 2, 1])).toBe(99);
  });
  it("perfect full reverse with Rainbow = 100", () => {
    expect(full(true, 0, [4, 3, 2, 1], true)).toBe(100);
  });
  it("one-mistake Yellow-first win with Rainbow = 89", () => {
    expect(full(true, 1, [1, 3, 2, 4], true)).toBe(89);
  });
  it("loss with Red and Blue solved plus Rainbow = 69", () => {
    expect(full(false, 4, [4, 3], true)).toBe(69);
  });
});

describe("computeFullSkillScore — the rules", () => {
  it("bases a win on mistakes: 95 / 88 / 81 / 74", () => {
    expect(full(true, 0, [1, 2, 3, 4])).toBe(95);
    expect(full(true, 1, [1, 2, 3, 4])).toBe(88);
    expect(full(true, 2, [1, 2, 3, 4])).toBe(81);
    expect(full(true, 3, [1, 2, 3, 4])).toBe(74);
  });

  it("adds the first category solved on a win: Yellow +0, Green +1, Blue +2, Red +3", () => {
    expect(full(true, 0, [1, 2, 3, 4])).toBe(95);
    expect(full(true, 0, [2, 1, 3, 4])).toBe(96);
    expect(full(true, 0, [3, 1, 2, 4])).toBe(97);
    expect(full(true, 0, [4, 1, 2, 3])).toBe(98);
  });

  it("gives +4 in place of +3 only for the exact order Red → Blue → Green → Yellow", () => {
    expect(full(true, 2, [4, 3, 2, 1])).toBe(85);
    expect(full(true, 2, [4, 3, 1, 2])).toBe(84);
    const r = computeFullSkillScore({ won: true, mistakes: 0, solveOrder: [4, 3, 2, 1], rainbowFound: false });
    expect(r.lines).toEqual([
      { label: "Solved with no mistakes", points: 95 },
      { label: "Full reverse order: Red → Blue → Green → Yellow", points: 4 },
    ]);
  });

  it("scores a loss from 50 plus each category actually solved, with no order bonus", () => {
    expect(full(false, 4, [])).toBe(50);
    expect(full(false, 4, [1])).toBe(54);
    expect(full(false, 4, [2])).toBe(56);
    expect(full(false, 4, [3])).toBe(58);
    expect(full(false, 4, [4])).toBe(60);
    expect(full(false, 4, [4, 3])).toBe(68);
    // Order does not matter on a loss.
    expect(full(false, 4, [3, 4])).toBe(68);
  });

  // The brief assumed the fourth category is awarded automatically, so a
  // loss could never have three solved. This game has no auto-solve: the
  // last category is submitted like any other, so three-solved losses are
  // real. Scored exactly by the stated rule — flagged for review, because
  // Green+Blue+Red solved (74) ties a three-mistake win.
  it("scores a three-category loss by the same per-category rule", () => {
    expect(full(false, 4, [2, 3, 4])).toBe(74);
    expect(full(false, 4, [1, 2, 3])).toBe(68);
  });

  it("adds exactly one point for the Rainbow, win or loss", () => {
    expect(full(true, 3, [1, 2, 3, 4], true)).toBe(75);
    expect(full(false, 4, [], true)).toBe(51);
  });

  it("shows the order line even when it is worth nothing", () => {
    const r = computeFullSkillScore({ won: true, mistakes: 0, solveOrder: [1, 2, 3, 4], rainbowFound: true });
    expect(r.lines).toEqual([
      { label: "Solved with no mistakes", points: 95 },
      { label: "Started with Yellow", points: 0 },
      { label: "Found the Rainbow", points: 1 },
    ]);
  });

  it("never goes above 100", () => {
    expect(full(true, 0, [4, 3, 2, 1], true)).toBe(100);
    expect(full(true, -3, [4, 3, 2, 1], true)).toBe(100);
  });
});

describe("submittedSolveOrderOf", () => {
  const correct = (words: string[]): GuessAttempt => ({ words, groupIndices: [], isCorrect: true });
  const wrong = (words: string[]): GuessAttempt => ({ words, groupIndices: [], isCorrect: false });

  it("reads the submitted order from guess history, not from the revealed board", () => {
    // Lost after solving C (Red) then A (Blue); the board then REVEALS B and
    // D, appending them to solvedGroups. Only the two submitted count.
    const state = {
      isWon: false,
      solvedGroups: [2, 0, 1, 3],
      guessHistory: [
        wrong(["A1", "B1", "C1", "D2"]),
        correct(["C4", "C3", "c2", "C1"]),
        { words: [], groupIndices: [], isCorrect: false, isHintMarker: true, hintType: "small" as const },
        correct(["A1", "A2", "A3", "A4"]),
        wrong(["B1", "B2", "D1", "D2"]),
      ],
    };
    expect(submittedSolveOrderOf(state, puzzle)).toEqual([4, 3]);
  });

  it("ignores an in-game Rainbow find", () => {
    const state = {
      isWon: false,
      solvedGroups: [],
      guessHistory: [{ words: ["A1", "B1", "C1", "D1"], groupIndices: [], isCorrect: false, isRainbow: true }],
    };
    expect(submittedSolveOrderOf(state, puzzle)).toEqual([]);
  });

  it("falls back to solvedGroups for a win saved without guess history", () => {
    expect(submittedSolveOrderOf({ isWon: true, solvedGroups: [2, 0, 3, 1], guessHistory: [] }, puzzle)).toEqual([4, 3, 2, 1]);
  });
});

describe("skillScoreForGame — Full versus Mini", () => {
  const finished = (overrides: Partial<GameState>): GameState => ({
    puzzleId: "p1",
    solvedGroups: [2, 0, 3, 1],
    mistakes: 0,
    maxMistakes: 4,
    selectedWords: [],
    isComplete: true,
    isWon: true,
    guessHistory: [],
    gotRainbow: false,
    rainbowSolveIndex: null,
    ...overrides,
  });

  it("uses the Full rules for a four-category puzzle", () => {
    expect(skillScoreForGame(finished({}), puzzle).score).toBe(99);
    expect(skillScoreForGame(finished({ gotRainbow: true, rainbowSolveIndex: 4 }), puzzle).score).toBe(100);
  });

  it("adds the post-game Rainbow point once, when the board records the find", () => {
    const before = finished({ solvedGroups: [1, 3, 0, 2], mistakes: 1 });
    expect(skillScoreForGame(before, puzzle).score).toBe(88);
    const after = { ...before, gotRainbow: true, rainbowSolveIndex: 4 };
    expect(skillScoreForGame(after, puzzle).score).toBe(89);
  });

  it("leaves the Mini on its original rules", () => {
    const mini = {
      id: "m1",
      date: "2026-09-24",
      format: "mini",
      groups: [
        { category: "G", words: ["G1", "G2", "G3"], difficulty: 2 },
        { category: "B", words: ["B1", "B2", "B3"], difficulty: 3 },
        { category: "R", words: ["R1", "R2", "R3"], difficulty: 4 },
      ],
      rainbowHerring: null,
    } as unknown as Puzzle;
    // Red, Blue, Green: 90 + 2 (Red first) + 3 (reverse) under the old rules.
    const r = skillScoreForGame(finished({ solvedGroups: [2, 1, 0] }), mini);
    expect(r.score).toBe(95);
    expect(r.lines.map((l) => l.label)).toEqual(["Solved with no mistakes", "Red category first", "Solved hardest to easiest"]);
  });
});
