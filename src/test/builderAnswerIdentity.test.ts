/**
 * Targeted tests for the builder's stable per-answer identity — the fix for
 * the "editing a word destroys the custom board layout" bug (see
 * lib/builder/answerIdentity.ts and hooks/useBuilderForm.ts).
 */
import { describe, it, expect } from "vitest";
import { reconcileCategory, splitAnswerField, shuffle, type AnswerSlot } from "@/lib/builder/answerIdentity";

/** Convenience: reconcile from an empty history (a brand-new category). */
function fresh(texts: string[]): AnswerSlot[] {
  return reconcileCategory([], [], texts).answers;
}

describe("splitAnswerField", () => {
  it("splits and trims a comma-separated field", () => {
    expect(splitAnswerField("Blue, Green,Red ,Yellow")).toEqual(["Blue", "Green", "Red", "Yellow"]);
  });

  it("returns an empty array for a blank field", () => {
    expect(splitAnswerField("   ")).toEqual([]);
  });
});

describe("reconcileCategory — the Zombie -> Monster case", () => {
  it("keeps the same id when one word's text changes at its own comma position", () => {
    const prev = fresh(["Bird", "Zombie", "Tree", "White"]);
    const zombieId = prev[1].id;

    const { answers: next } = reconcileCategory(prev, [], ["Bird", "Monster", "Tree", "White"]);

    expect(next[1].id).toBe(zombieId);
    expect(next[1].text).toBe("Monster");
    // Every other slot is completely untouched.
    expect(next[0]).toEqual(prev[0]);
    expect(next[2]).toEqual(prev[2]);
    expect(next[3]).toEqual(prev[3]);
  });

  it("keeps ids and text stable when nothing changes", () => {
    const prev = fresh(["a", "b", "c", "d"]);
    const { answers: next } = reconcileCategory(prev, [], ["a", "b", "c", "d"]);
    expect(next).toEqual(prev);
  });

  it("gives a brand-new id to an answer added beyond the previous length", () => {
    const prev = fresh(["a", "b"]);
    const { answers: next } = reconcileCategory(prev, [], ["a", "b", "c"]);
    expect(next[0].id).toBe(prev[0].id);
    expect(next[1].id).toBe(prev[1].id);
    expect(next[2].id).not.toBe(prev[0].id);
    expect(next[2].id).not.toBe(prev[1].id);
    expect(next[2].text).toBe("c");
  });

  it("tombstones (does not simply lose) an id when its slot is removed", () => {
    const prev = fresh(["a", "b", "c"]);
    const { answers: next, tombstones } = reconcileCategory(prev, [], ["a", "b"]);
    expect(next).toHaveLength(2);
    expect(next[0].id).toBe(prev[0].id);
    expect(next[1].id).toBe(prev[1].id);
    expect(tombstones).toHaveLength(1);
    expect(tombstones[0].id).toBe(prev[2].id);
  });
});

describe("shuffle", () => {
  it("never mutates its input and always returns the same elements", () => {
    const input = [1, 2, 3, 4, 5];
    const copy = [...input];
    const out = shuffle(input);
    expect(input).toEqual(copy);
    expect([...out].sort()).toEqual([...input].sort());
  });
});
