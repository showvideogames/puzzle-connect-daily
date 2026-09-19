/**
 * Focused verification of the incremental starting-board preview fix.
 *
 * Before this fix, the board (wordOrderIds) stayed empty — and the Admin UI
 * hid the whole StartingBoardArranger — until every category held 4 unique
 * answers. This proves the board now exists, and is randomized, the instant
 * the form does, and that ordinary editing/deletion/replacement/duplicates
 * behave as specified without ever reshuffling it.
 */
import { describe, it, expect } from "vitest";
import { act, renderHook } from "@testing-library/react";
import { useBuilderForm } from "@/hooks/useBuilderForm";

describe("A blank puzzle form", () => {
  it("has all 16 board positions arranged immediately, before anything is typed", () => {
    const { result } = renderHook(() => useBuilderForm());
    expect(result.current.wordOrderIds).toHaveLength(16);
    expect(new Set(result.current.wordOrderIds).size).toBe(16);
    // Every id resolves to a real (blank) slot — nothing dangling.
    for (const id of result.current.wordOrderIds) {
      expect(result.current.slotById.get(id)).toBeDefined();
      expect(result.current.slotById.get(id)!.text).toBe("");
    }
    expect(result.current.hasAll16).toBe(false);
  });
});

describe("partial preview", () => {
  it("shows one populated answer as one tile the moment it's typed, everything else still blank", () => {
    const { result } = renderHook(() => useBuilderForm());
    const initialOrder = [...result.current.wordOrderIds];

    act(() => {
      result.current.updateAnswersRaw(0, "Blue");
    });

    const blueId = result.current.groups[0].answers.find((a) => a.text === "Blue")!.id;
    expect(result.current.wordOrderIds).toContain(blueId);
    // The board itself did not reshuffle — same 16 ids, same order.
    expect(result.current.wordOrderIds).toEqual(initialOrder);

    const texts = result.current.wordOrderIds.map((id) => result.current.slotById.get(id)?.text ?? "");
    expect(texts.filter((t) => t !== "")).toEqual(["Blue"]);
    expect(texts.filter((t) => t === "")).toHaveLength(15);
    expect(result.current.hasAll16).toBe(false);
  });

  it("fills in incrementally as more answers are typed, one tile at a time, across categories", () => {
    const { result } = renderHook(() => useBuilderForm());
    const order = [...result.current.wordOrderIds];

    act(() => result.current.updateAnswersRaw(0, "Blue"));
    act(() => result.current.updateAnswersRaw(1, "Battery"));
    act(() => result.current.updateAnswersRaw(2, "Houston"));

    expect(result.current.wordOrderIds).toEqual(order); // never reshuffled
    const texts = result.current.wordOrderIds.map((id) => result.current.slotById.get(id)?.text ?? "");
    expect(texts.filter((t) => t !== "").sort()).toEqual(["Battery", "Blue", "Houston"]);
    expect(texts.filter((t) => t === "")).toHaveLength(13);
  });
});

describe("real character-by-character typing (the /create production bug)", () => {
  /**
   * Simulates a real user typing `finalText` into a category one keystroke
   * at a time — updateAnswersRaw fires once per character, exactly as
   * CategoryEditor's onChange does, not once with the finished string (every
   * OTHER test in this file sets the full string in a single call, which
   * never exercised this path and is why this bug shipped).
   */
  function typeIncrementally(
    result: { current: ReturnType<typeof useBuilderForm> },
    groupIdx: number,
    finalText: string
  ) {
    for (let i = 1; i <= finalText.length; i++) {
      act(() => result.current.updateAnswersRaw(groupIdx, finalText.slice(0, i)));
    }
  }

  function filledTexts(result: { current: ReturnType<typeof useBuilderForm> }): string[] {
    return result.current.wordOrderIds
      .map((id) => result.current.slotById.get(id)?.text ?? "")
      .filter((t) => t !== "");
  }

  it("shows all 4 comma-separated answers in their predetermined board positions once fully typed", () => {
    const { result } = renderHook(() => useBuilderForm());
    const originalGroup0Ids = result.current.groups[0].answers.map((a) => a.id).sort();

    typeIncrementally(result, 0, "Here, Comes, The, Sun");

    const g0 = result.current.groups[0];
    expect(g0.answers.map((a) => a.text)).toEqual(["Here", "Comes", "The", "Sun"]);
    // Every typed answer landed on one of this category's ORIGINAL 4 pool
    // ids — not an orphaned id minted mid-typing that was never part of
    // wordOrderIds (the actual production bug: only the first word, which
    // always keeps the very first pool id, ever appeared on the board).
    expect(g0.answers.map((a) => a.id).sort()).toEqual(originalGroup0Ids);
    expect(filledTexts(result).sort()).toEqual(["Comes", "Here", "Sun", "The"]);
  });

  it("progressively fills 1, then 2, then 3, then 4 tiles as each answer is completed", () => {
    const { result } = renderHook(() => useBuilderForm());
    const finalText = "Here, Comes, The, Sun";
    const checkpoints: Record<string, number> = {
      Here: 1,
      "Here, Comes": 2,
      "Here, Comes, The": 3,
      "Here, Comes, The, Sun": 4,
    };

    for (let i = 1; i <= finalText.length; i++) {
      const prefix = finalText.slice(0, i);
      act(() => result.current.updateAnswersRaw(0, prefix));
      if (prefix in checkpoints) {
        expect(filledTexts(result)).toHaveLength(checkpoints[prefix]);
      }
    }
  });

  it("multiple categories populate simultaneously, each keeping its own 4 predetermined positions", () => {
    const { result } = renderHook(() => useBuilderForm());
    const group0Ids = result.current.groups[0].answers.map((a) => a.id).sort();
    const group1Ids = result.current.groups[1].answers.map((a) => a.id).sort();

    typeIncrementally(result, 0, "Here, Comes, The, Sun");
    typeIncrementally(result, 1, "Carry, On, Wayward, Son");

    expect(result.current.groups[0].answers.map((a) => a.id).sort()).toEqual(group0Ids);
    expect(result.current.groups[1].answers.map((a) => a.id).sort()).toEqual(group1Ids);

    expect(filledTexts(result).sort()).toEqual(
      ["Carry", "Comes", "Here", "On", "Son", "Sun", "The", "Wayward"].sort()
    );
    // The remaining two categories' 8 slots are still blank.
    expect(
      result.current.wordOrderIds.map((id) => result.current.slotById.get(id)?.text ?? "").filter((t) => t === "")
    ).toHaveLength(8);
  });
});

describe("editing in place", () => {
  it("updates the same tile's text without moving it", () => {
    const { result } = renderHook(() => useBuilderForm());
    act(() => result.current.updateAnswersRaw(0, "Blue"));
    const blueId = result.current.groups[0].answers.find((a) => a.text === "Blue")!.id;
    const position = result.current.wordOrderIds.indexOf(blueId);
    const orderBefore = [...result.current.wordOrderIds];

    act(() => result.current.updateAnswersRaw(0, "Azure"));

    const azure = result.current.groups[0].answers.find((a) => a.text === "Azure")!;
    expect(azure.id).toBe(blueId);
    expect(result.current.wordOrderIds).toEqual(orderBefore);
    expect(result.current.wordOrderIds.indexOf(azure.id)).toBe(position);
  });
});

describe("deletion and replacement", () => {
  it("deleting an answer leaves its tile blank; adding a replacement fills that same tile", () => {
    const { result } = renderHook(() => useBuilderForm());
    act(() => result.current.updateAnswersRaw(0, "Computer, Keyboard, Mouse, Screen"));
    const mouseId = result.current.groups[0].answers.find((a) => a.text === "Mouse")!.id;
    const mousePosition = result.current.wordOrderIds.indexOf(mouseId);
    const orderBefore = [...result.current.wordOrderIds];

    act(() => result.current.updateAnswersRaw(0, "Computer, Keyboard, Screen"));

    // Board array itself untouched; Mouse's tile now resolves blank.
    expect(result.current.wordOrderIds).toEqual(orderBefore);
    expect(result.current.slotById.get(mouseId)).toBeUndefined();
    const textAtMousePosition = result.current.slotById.get(result.current.wordOrderIds[mousePosition])?.text ?? "";
    expect(textAtMousePosition).toBe("");

    act(() => result.current.updateAnswersRaw(0, "Computer, Keyboard, Screen, Cookie"));

    const cookie = result.current.groups[0].answers.find((a) => a.text === "Cookie")!;
    expect(cookie.id).toBe(mouseId); // inherited via the (unmodified) tombstone reconciliation
    expect(result.current.wordOrderIds).toEqual(orderBefore); // still never reshuffled
    expect(result.current.wordOrderIds[mousePosition]).toBe(cookie.id);
  });
});

describe("duplicate/invalid answers", () => {
  it("still appear in the preview rather than being hidden", () => {
    const { result } = renderHook(() => useBuilderForm());
    act(() => result.current.updateAnswersRaw(0, "Blue, Blue, Red, Yellow"));

    expect(result.current.hasAll16).toBe(false); // duplicates make it invalid to save
    const g0 = result.current.groups[0];
    const blueEntries = g0.answers.filter((a) => a.text === "Blue");
    expect(blueEntries).toHaveLength(2);
    // Both duplicate entries have real, distinct ids and both are on the board.
    expect(blueEntries[0].id).not.toBe(blueEntries[1].id);
    for (const a of blueEntries) {
      expect(result.current.wordOrderIds).toContain(a.id);
    }
  });
});

describe("Randomize", () => {
  it("is the only thing that reshuffles the board — not ordinary typing", () => {
    const { result } = renderHook(() => useBuilderForm());
    const before = [...result.current.wordOrderIds];

    act(() => result.current.updateAnswersRaw(0, "Blue, Green, Red, Yellow"));
    act(() => result.current.updateAnswersRaw(1, "Battery, Hood, Tire, Trunk"));
    expect(result.current.wordOrderIds).toEqual(before);

    act(() => result.current.randomizeWordOrder());
    // Same 16 ids, still — Randomize just permutes them (it CAN coincidentally
    // land on the same order, so only the id set is asserted, not inequality).
    expect([...result.current.wordOrderIds].sort()).toEqual([...before].sort());
    expect(result.current.wordOrderIds).toHaveLength(16);
  });
});

describe("loading an existing puzzle", () => {
  it("shows its saved board order immediately, not a freshly generated one", () => {
    const { result } = renderHook(() => useBuilderForm());
    const savedOrder = [
      "Trunk", "Houston", "Blue", "Bird",
      "Mars", "Battery", "Green", "Dog",
      "Mercury", "Hood", "Red", "Tree",
      "Swift", "Tire", "Yellow", "White",
    ];
    act(() => {
      result.current.load({
        groups: [
          { category: "Colors", words: ["Blue", "Green", "Red", "Yellow"], difficulty: 1, hintWord: null },
          { category: "Car parts", words: ["Battery", "Hood", "Tire", "Trunk"], difficulty: 2, hintWord: null },
          { category: "Singers", words: ["Houston", "Mars", "Mercury", "Swift"], difficulty: 3, hintWord: null },
          { category: "House", words: ["Bird", "Dog", "Tree", "White"], difficulty: 4, hintWord: null },
        ],
        wordOrder: savedOrder,
        rainbowHerring: null,
        rainbowCategoryName: "",
        rainbowHintWord: "",
        theme: "",
        alphabetizeCompleted: true,
      });
    });

    const renderedTexts = result.current.wordOrderIds.map((id) => result.current.slotById.get(id)?.text ?? "");
    expect(renderedTexts).toEqual(savedOrder);
    expect(result.current.hasAll16).toBe(true);
  });

  it("falls back to a fresh random arrangement for a legacy puzzle with no saved order", () => {
    const { result } = renderHook(() => useBuilderForm());
    act(() => {
      result.current.load({
        groups: [
          { category: "Colors", words: ["Blue", "Green", "Red", "Yellow"], difficulty: 1, hintWord: null },
          { category: "Car parts", words: ["Battery", "Hood", "Tire", "Trunk"], difficulty: 2, hintWord: null },
          { category: "Singers", words: ["Houston", "Mars", "Mercury", "Swift"], difficulty: 3, hintWord: null },
          { category: "House", words: ["Bird", "Dog", "Tree", "White"], difficulty: 4, hintWord: null },
        ],
        wordOrder: null,
        rainbowHerring: null,
        rainbowCategoryName: "",
        rainbowHintWord: "",
        theme: "",
        alphabetizeCompleted: true,
      });
    });

    expect(result.current.wordOrderIds).toHaveLength(16);
    expect(new Set(result.current.wordOrderIds).size).toBe(16);
    const renderedTexts = result.current.wordOrderIds.map((id) => result.current.slotById.get(id)?.text ?? "");
    expect(renderedTexts.every((t) => t !== "")).toBe(true);
  });
});
