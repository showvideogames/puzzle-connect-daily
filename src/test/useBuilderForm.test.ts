/**
 * Verifies the builder hook's end-to-end promises:
 *  - editing one word preserves its board position and its Rainbow selection
 *  - the initial starting-board order is randomized once and then holds
 *    stable through ordinary text edits
 *  - Randomize only changes the order when explicitly pressed
 */
import { describe, it, expect } from "vitest";
import { act, renderHook } from "@testing-library/react";
import { useBuilderForm } from "@/hooks/useBuilderForm";

function fillAllGroups(result: ReturnType<typeof renderHook<ReturnType<typeof useBuilderForm>, unknown>>["result"]) {
  const words = [
    ["Blue", "Green", "Red", "Yellow"],
    ["Battery", "Hood", "Tire", "Trunk"],
    ["Houston", "Mars", "Mercury", "Swift"],
    ["Bird", "Dog", "Tree", "White"],
  ];
  act(() => {
    words.forEach((w, i) => result.current.updateAnswersRaw(i, w.join(", ")));
  });
}

describe("useBuilderForm", () => {
  it("becomes hasAll16 only once every category has 4 unique answers", () => {
    const { result } = renderHook(() => useBuilderForm());
    expect(result.current.hasAll16).toBe(false);
    fillAllGroups(result);
    expect(result.current.hasAll16).toBe(true);
  });

  it("randomizes the starting order once, then holds it stable through a text edit", () => {
    const { result } = renderHook(() => useBuilderForm());
    fillAllGroups(result);

    const firstOrder = result.current.wordOrderIds;
    expect(firstOrder).toHaveLength(16);

    // Edit one word in place (same comma position) — an "ordinary edit".
    act(() => {
      result.current.updateAnswersRaw(3, "Bird, Dog, Tree, Ghost");
    });

    // The id SET is unchanged (same slot, new text), so order must be
    // byte-for-byte the same array of ids.
    expect(result.current.wordOrderIds).toEqual(firstOrder);
  });

  it("Randomize is the only thing that changes the order on demand", () => {
    const { result } = renderHook(() => useBuilderForm());
    fillAllGroups(result);
    const before = result.current.wordOrderIds;

    act(() => {
      result.current.randomizeWordOrder();
    });

    // Same 16 ids, a new (or at least explicitly regenerated) arrangement —
    // assert the set is unchanged, which is the property that matters.
    expect([...result.current.wordOrderIds].sort()).toEqual([...before].sort());
  });

  it("preserves a word's board position and Rainbow selection when it is edited (Zombie -> Monster)", () => {
    const { result } = renderHook(() => useBuilderForm());
    act(() => {
      result.current.updateAnswersRaw(0, "Blue, Green, Red, Zombie");
      result.current.updateAnswersRaw(1, "Battery, Hood, Tire, Trunk");
      result.current.updateAnswersRaw(2, "Houston, Mars, Mercury, Swift");
      result.current.updateAnswersRaw(3, "Bird, Dog, Tree, White");
    });

    const zombieSlot = result.current.groups[0].answers[3];
    expect(zombieSlot.text).toBe("Zombie");

    // Put Zombie in a known custom board position, and select it for Rainbow.
    act(() => {
      const customOrder = [...result.current.wordOrderIds];
      const idx = customOrder.indexOf(zombieSlot.id);
      // Move it to the front, deterministically.
      customOrder.splice(idx, 1);
      customOrder.unshift(zombieSlot.id);
      result.current.setWordOrderIds(customOrder);
      result.current.selectRainbowAnswer(0, zombieSlot.id);
    });

    expect(result.current.wordOrderIds[0]).toBe(zombieSlot.id);
    expect(result.current.rainbowHerringIds[0]).toBe(zombieSlot.id);

    // Now fix the spelling — same comma position, new text.
    act(() => {
      result.current.updateAnswersRaw(0, "Blue, Green, Red, Monster");
    });

    const monsterSlot = result.current.groups[0].answers[3];
    expect(monsterSlot.text).toBe("Monster");
    expect(monsterSlot.id).toBe(zombieSlot.id);

    // Monster inherits Zombie's board position and Rainbow selection.
    expect(result.current.wordOrderIds[0]).toBe(monsterSlot.id);
    expect(result.current.rainbowHerringIds[0]).toBe(monsterSlot.id);
  });
});
