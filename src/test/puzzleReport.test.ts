import { describe, it, expect } from "vitest";
import { describeWrongGuess, scoreStanding, wrongGuessSentence, categoryForSolveKey } from "@/lib/puzzleReport";
import type { Puzzle } from "@/lib/types";

const puzzle: Puzzle = {
  id: "p1",
  date: "2026-09-24",
  groups: [
    { category: "MLB Teams Singular", words: ["ANGEL", "BRAVE", "BREWER", "CUB"], difficulty: 1 },
    { category: "Parts of the Leg", words: ["CALF", "FOOT", "HIP", "QUAD"], difficulty: 2 },
    { category: "Ugly ___", words: ["CRY", "DUCKLING", "SWEATER", "TRUTH"], difficulty: 3 },
    { category: "Adore", words: ["FANCY", "FAWN", "GUSH", "TREASURE"], difficulty: 4 },
  ],
  rainbowHerring: ["CUB", "CALF", "DUCKLING", "FAWN"],
} as Puzzle;

describe("describeWrongGuess", () => {
  it("counts which categories a guess drew from, most first", () => {
    const d = describeWrongGuess(["calf", "FOOT", "hip", "FANCY"], puzzle);
    expect(d.parts).toEqual([
      { category: "Parts of the Leg", difficulty: 2, count: 3 },
      { category: "Adore", difficulty: 4, count: 1 },
    ]);
    expect(d.isRainbowSet).toBe(false);
    expect(d.unknown).toBe(0);
  });

  it("recognises the Rainbow set in any order or case", () => {
    expect(describeWrongGuess(["fawn", "CUB", "Duckling", "CALF"], puzzle).isRainbowSet).toBe(true);
  });

  it("counts words that match no category as unknown", () => {
    expect(describeWrongGuess(["CALF", "ZEBRA"], puzzle).unknown).toBe(1);
  });
});

describe("wrongGuessSentence", () => {
  const base = { one_away: false, rainbow_attempt: false, almost_rainbow: false };

  it("spells out the category split and the one-away flag", () => {
    expect(wrongGuessSentence({ ...base, words: ["CALF", "FOOT", "HIP", "FANCY"], players: 5, one_away: true }, puzzle))
      .toBe("5 players: 3 from Parts of the Leg and 1 from Adore. One away.");
  });

  it("uses the singular for one player", () => {
    expect(wrongGuessSentence({ ...base, words: ["CALF", "FOOT", "CRY", "FANCY"], players: 1 }, puzzle))
      .toBe("1 player: 2 from Parts of the Leg, 1 from Ugly ___ and 1 from Adore.");
  });

  it("calls out the Rainbow trap", () => {
    expect(wrongGuessSentence({ ...base, words: ["CALF", "CUB", "DUCKLING", "FAWN"], players: 3 }, puzzle))
      .toBe("3 players submitted the Rainbow words as a normal category. That is the trap working.");
  });
});

describe("scoreStanding", () => {
  it("removes the player's own score once before comparing", () => {
    // Four players including me on 90: two below, one above.
    const s = scoreStanding({ "80": 1, "70": 1, "90": 1, "95": 1 }, 90);
    expect(s.others).toBe(3);
    expect(s.betterThanPct).toBe(67);
    expect(s.average).toBe(84);
  });

  it("has nobody to compare against when the player is alone", () => {
    const s = scoreStanding({ "90": 1 }, 90);
    expect(s.others).toBe(0);
    expect(s.betterThanPct).toBeNull();
    expect(s.average).toBe(90);
  });

  it("copes with a report that does not yet include the player's session", () => {
    const s = scoreStanding({ "80": 2 }, 90);
    expect(s.others).toBe(2);
    expect(s.betterThanPct).toBe(100);
  });

  it("ignores junk keys", () => {
    expect(scoreStanding({ abc: 3, "90": 1 }, 90).others).toBe(0);
  });
});

describe("categoryForSolveKey", () => {
  it("maps the client's colour names to the puzzle's categories", () => {
    expect(categoryForSolveKey("orange", puzzle)?.category).toBe("MLB Teams Singular");
    expect(categoryForSolveKey("red", puzzle)?.category).toBe("Adore");
    expect(categoryForSolveKey("purple", puzzle)).toBeUndefined();
  });
});
