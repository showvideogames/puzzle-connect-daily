/**
 * The Lucky Bot Luck Score: the formula, the 500-player threshold and the
 * wording. Who counts and whose path matches is decided in SQL
 * (public.get_luck_report) and pinned in e2e/scripts/verify-db.ts.
 */
import { describe, it, expect } from "vitest";
import {
  computeLuckScore,
  formatOneIn,
  luckRarity,
  luckView,
  parseLuckReport,
  pathSentence,
  type LuckReport,
} from "@/lib/luckScore";

const ok = (eligiblePlayers: number, samePath: number, ceiling = 5000): LuckReport => ({
  status: "ok",
  eligiblePlayers,
  samePath,
  ceiling,
  minPlayers: 500,
});

describe("computeLuckScore", () => {
  it("is 0 when everyone took the same path", () => {
    expect(computeLuckScore(1)).toBe(0);
  });

  it("is 100 at the ceiling, and stays 100 beyond it", () => {
    expect(computeLuckScore(5000)).toBe(100);
    expect(computeLuckScore(80000)).toBe(100);
  });

  it("follows round(100 × log10(rarity) ÷ log10(ceiling))", () => {
    expect(computeLuckScore(Math.sqrt(5000))).toBe(50);
    expect(computeLuckScore(10)).toBe(27);
    expect(computeLuckScore(500)).toBe(73);
    expect(computeLuckScore(2)).toBe(8);
  });

  it("uses the puzzle's own ceiling, so a later, bigger ceiling does not move an old puzzle", () => {
    expect(computeLuckScore(500, 5000)).toBe(73);
    expect(computeLuckScore(500, 50000)).toBe(57);
  });

  it("never goes below 0 on nonsense input", () => {
    expect(computeLuckScore(0.5)).toBe(0);
    expect(computeLuckScore(Number.NaN)).toBe(0);
  });
});

describe("luckRarity", () => {
  it("divides everyone by everyone who took the same path", () => {
    expect(luckRarity(600, 3)).toBe(200);
    expect(luckRarity(500, 500)).toBe(1);
  });
  it("refuses counts that cannot be real", () => {
    expect(luckRarity(0, 0)).toBeNull();
    expect(luckRarity(10, 0)).toBeNull();
    expect(luckRarity(3, 4)).toBeNull();
  });
});

describe("wording", () => {
  it("writes 1 in N with one decimal below 10 and whole numbers above", () => {
    expect(formatOneIn(2.5)).toBe("2.5");
    expect(formatOneIn(3)).toBe("3");
    expect(formatOneIn(12.4)).toBe("12");
    expect(formatOneIn(5000)).toBe("5,000");
  });

  it("describes the path in plain English", () => {
    expect(pathSentence(500, 1)).toBe("Nobody else took your exact path — 1 in 500.");
    expect(pathSentence(500, 4)).toBe("1 in 125 players took your path.");
    expect(pathSentence(12, 12)).toBe("All 12 players took your path.");
    expect(pathSentence(1, 1)).toBe("You're the first player counted.");
  });
});

describe("luckView — the 500-player threshold", () => {
  it("shows no number at 499 eligible players, but does show the rarity so far", () => {
    const v = luckView(ok(499, 7));
    expect(v.kind).toBe("collecting");
    if (v.kind !== "collecting") return;
    expect(v.eligiblePlayers).toBe(499);
    expect(v.sentence).toBe("1 in 71 players took your path.");
  });

  it("shows the number from 500 eligible players", () => {
    const v = luckView(ok(500, 1));
    expect(v).toEqual({
      kind: "score",
      score: 73,
      eligiblePlayers: 500,
      samePath: 1,
      ceiling: 5000,
      sentence: "Nobody else took your exact path — 1 in 500.",
    });
  });

  it("keeps loading, failure and not-counted apart", () => {
    expect(luckView(undefined).kind).toBe("loading");
    expect(luckView(null).kind).toBe("unavailable");
    expect(luckView({ status: "unsupported" }).kind).toBe("unavailable");
    expect(luckView({ status: "no_session" })).toEqual({
      kind: "not_counted",
      message: "Luck Score only counts a saved first attempt.",
    });
    expect(luckView({ status: "not_eligible", reason: "admin" })).toEqual({
      kind: "not_counted",
      message: "Admin plays aren't counted in Luck Score.",
    });
    expect(luckView({ status: "not_eligible", reason: "incomplete_history" })).toEqual({
      kind: "not_counted",
      message: "Lucky Bot couldn't read your full path for this game.",
    });
  });
});

describe("parseLuckReport", () => {
  it("reads the function's JSON", () => {
    expect(
      parseLuckReport({ status: "ok", eligible_players: 612, same_path: 2, ceiling: 5000, min_players: 500 })
    ).toEqual(ok(612, 2));
    expect(parseLuckReport({ status: "not_eligible", reason: "admin" })).toEqual({ status: "not_eligible", reason: "admin" });
  });

  it("returns null for anything it does not recognise", () => {
    expect(parseLuckReport(null)).toBeNull();
    expect(parseLuckReport({ status: "surprise" })).toBeNull();
  });
});
