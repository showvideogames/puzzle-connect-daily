/**
 * Who the results popup lists and in what order, Full and Mini, and what each
 * row says. Pure functions only.
 */
import { describe, expect, it } from "vitest";
import { formatSeconds, mistakeWords, rankResults, resultWording, usableSeconds } from "@/components/results/rankResults";
import type { FriendResult } from "@/lib/friendResults";

type Row = Pick<FriendResult, "id" | "name" | "status" | "mistakes" | "seconds"> & { isYou?: boolean };

const solved = (id: string, name: string, mistakes: number, seconds?: unknown): Row =>
  ({ id, name, status: "solved", mistakes, ...(seconds === undefined ? {} : { seconds }) }) as Row;
const lost = (id: string, name: string, mistakes = 4): Row => ({ id, name, status: "not-solved", mistakes });
const notPlayed = (id: string, name: string): Row => ({ id, name, status: "not-played", mistakes: 0 });

const order = (rows: Row[], format: "full" | "mini") => rankResults(rows, format).map((row) => row.id);

describe("who is listed", () => {
  it.each(["full", "mini"] as const)("%s: only people who finished; completed losses stay, not played is left out", (format) => {
    const rows = [notPlayed("p", "Pat"), lost("l", "Lee"), solved("s", "Sam", 1, 50)];
    expect(order(rows, format)).toEqual(["s", "l"]);
  });

  it("leaves the list it was given as it was", () => {
    const rows = [lost("l", "Lee"), solved("s", "Sam", 1)];
    rankResults(rows, "full");
    expect(rows.map((row) => row.id)).toEqual(["l", "s"]);
  });
});

describe("Full", () => {
  it("ranks solved by fewest mistakes, then completed losses", () => {
    const rows = [lost("l", "Aaron"), solved("b", "Bo", 3), solved("a", "Ada", 0), solved("c", "Cy", 1)];
    expect(order(rows, "full")).toEqual(["a", "c", "b", "l"]);
  });

  it("treats equal mistakes as a tie, ordered by name, never by time", () => {
    // Zoe is much faster, but time never counts on Full.
    const rows = [solved("z", "Zoe", 1, 10), solved("m", "Mia", 1, 900), solved("a", "Abe", 1)];
    expect(order(rows, "full")).toEqual(["a", "m", "z"]);
  });

  it("breaks a tie with the same name by id, so the order never jitters", () => {
    const rows = [solved("id-2", "Sam", 2), solved("id-1", "Sam", 2)];
    expect(order(rows, "full")).toEqual(["id-1", "id-2"]);
    expect(order([...rows].reverse(), "full")).toEqual(["id-1", "id-2"]);
  });

  it("puts my row where it ranks, not first", () => {
    const rows = [{ ...solved("you", "Alex", 2), isYou: true }, solved("f1", "Sam", 0), lost("f2", "Jo")];
    expect(order(rows, "full")).toEqual(["f1", "you", "f2"]);
  });

  it("says mistakes, never a time, even when a row carries one", () => {
    expect(resultWording(solved("a", "A", 0, 42), "full")).toBe("No mistakes");
    expect(resultWording(solved("a", "A", 1, 42), "full")).toBe("1 mistake");
    expect(resultWording(solved("a", "A", 3, 42), "full")).toBe("3 mistakes");
    expect(resultWording(lost("a", "A"), "full")).toBe("Not solved");
  });
});

describe("Mini", () => {
  it("ranks solved by fastest time, then completed losses", () => {
    const rows = [lost("l", "Al", 3), solved("slow", "Bo", 0, 125), solved("fast", "Cy", 2, 42), solved("mid", "Di", 1, 65)];
    expect(order(rows, "mini")).toEqual(["fast", "mid", "slow", "l"]);
  });

  it("treats equal times as a tie, ordered by name then id, whatever the mistakes", () => {
    const rows = [solved("z", "Zed", 0, 60), solved("b", "Bea", 2, 60), solved("b0", "Bea", 0, 60)];
    expect(order(rows, "mini")).toEqual(["b", "b0", "z"]);
  });

  it("never counts a missing, zero or broken time as 0 or first: those go after every timed solved row", () => {
    const rows = [
      solved("none", "Aa", 0),
      solved("zero", "Ab", 0, 0),
      solved("neg", "Ac", 0, -5),
      solved("frac", "Ad", 0, 1.5),
      solved("text", "Ae", 0, "30"),
      solved("nan", "Af", 0, Number.NaN),
      solved("timed", "Zz", 3, 3_600),
      lost("loss", "Aa"),
    ];
    const ranked = order(rows, "mini");
    expect(ranked[0]).toBe("timed");
    expect(ranked[ranked.length - 1]).toBe("loss");
    expect(ranked.slice(1, -1).sort()).toEqual(["frac", "nan", "neg", "none", "text", "zero"]);
  });

  it("puts my row where it ranks, not first", () => {
    const rows = [{ ...solved("you", "Alex", 0, 90), isYou: true }, solved("f1", "Sam", 2, 30)];
    expect(order(rows, "mini")).toEqual(["f1", "you"]);
  });

  it("says time and mistakes, or Solved without a usable time, or Not solved", () => {
    expect(resultWording(solved("a", "A", 1, 42), "mini")).toBe("0:42 · 1 mistake");
    expect(resultWording(solved("a", "A", 0, 65), "mini")).toBe("1:05 · No mistakes");
    expect(resultWording(solved("a", "A", 2, 3_600), "mini")).toBe("1:00:00 · 2 mistakes");
    expect(resultWording(solved("a", "A", 2), "mini")).toBe("Solved · 2 mistakes");
    expect(resultWording(solved("a", "A", 0, 0), "mini")).toBe("Solved · No mistakes");
    expect(resultWording(lost("a", "A"), "mini")).toBe("Not solved");
  });
});

describe("the pieces", () => {
  it("formats m:ss under an hour and h:mm:ss from an hour on", () => {
    expect(formatSeconds(1)).toBe("0:01");
    expect(formatSeconds(59)).toBe("0:59");
    expect(formatSeconds(60)).toBe("1:00");
    expect(formatSeconds(3_599)).toBe("59:59");
    expect(formatSeconds(3_600)).toBe("1:00:00");
    expect(formatSeconds(3_725)).toBe("1:02:05");
    expect(formatSeconds(36_000)).toBe("10:00:00");
  });

  it("accepts only a positive whole number of seconds", () => {
    expect(usableSeconds(42)).toBe(42);
    for (const bad of [0, -1, 1.5, Number.NaN, Number.POSITIVE_INFINITY, "42", null, undefined]) {
      expect(usableSeconds(bad)).toBeNull();
    }
  });

  it("words mistakes", () => {
    expect(mistakeWords(0)).toBe("No mistakes");
    expect(mistakeWords(1)).toBe("1 mistake");
    expect(mistakeWords(4)).toBe("4 mistakes");
  });
});
