/**
 * The Lucky Bot skill score formula. These fixtures are ALSO run through
 * the SQL copy (public.skill_score) in e2e/scripts/verify-db.ts, so a
 * change to either side that is not mirrored fails somewhere.
 */
import { describe, it, expect } from "vitest";
import { computeSkillScore, rainbowSourceOf, solveOrderOf } from "@/lib/skillScore";
import { FULL_FORMAT, MINI_FORMAT } from "@/lib/puzzleFormat";
import type { Puzzle } from "@/lib/types";

const base = {
  rainbowFound: false,
  rainbowSource: null,
  format: FULL_FORMAT,
} as const;

describe("computeSkillScore", () => {
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
