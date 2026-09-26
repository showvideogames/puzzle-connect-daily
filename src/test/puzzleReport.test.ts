import { describe, it, expect } from "vitest";
import {
  describeWrongGuess,
  scoreStanding,
  wrongGuessSentence,
  categoryForSolveKey,
  listedWrongGuesses,
  perfectAndWrongPct,
  type PuzzleReport,
} from "@/lib/puzzleReport";
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

});

describe("listedWrongGuesses", () => {
  const base = { words: [] as string[], players: 1, one_away: false, rainbow_attempt: false, almost_rainbow: false };
  // Finding the Rainbow is a find, not a mistake.
  it("never lists the Rainbow's own words, in any order or case, and keeps every real wrong guess", () => {
    const report = {
      common_wrong_guesses: [
        { ...base, words: ["CALF", "FANCY", "FOOT", "HIP"], players: 3 },
        { ...base, words: ["fawn", "CUB", "Duckling", "CALF"], players: 2 },
        { ...base, words: ["ANGEL", "BRAVE", "CRY", "QUAD"], players: 1 },
      ],
    } as PuzzleReport;
    expect(listedWrongGuesses(report, puzzle).map((g) => g.words[0])).toEqual(["CALF", "ANGEL"]);
  });

  it("keeps a guess that is only one word away from the Rainbow", () => {
    const report = { common_wrong_guesses: [{ ...base, words: ["CALF", "CUB", "DUCKLING", "FANCY"], players: 1 }] } as PuzzleReport;
    expect(listedWrongGuesses(report, puzzle)).toHaveLength(1);
  });
});

describe("perfectAndWrongPct", () => {
  it("describes the same finishers, so the two always add up to 100", () => {
    expect(perfectAndWrongPct({ total_players: 13, perfect: 8 })).toEqual({ perfectPct: 62, wrongPct: 38 });
    expect(perfectAndWrongPct({ total_players: 3, perfect: 1 })).toEqual({ perfectPct: 33, wrongPct: 67 });
    expect(perfectAndWrongPct({ total_players: 4, perfect: 4 })).toEqual({ perfectPct: 100, wrongPct: 0 });
  });

  it("is zero for zero finishers", () => {
    expect(perfectAndWrongPct({ total_players: 0, perfect: 0 })).toEqual({ perfectPct: 0, wrongPct: 0 });
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
