/**
 * Focused verification of the builder's replacement/deletion/reorder
 * identity behavior, cases A-E as specified in review. Each case is proven
 * directly against the real hook (useBuilderForm), not just the lower-level
 * reconcileCategory unit, so the board-position and Rainbow-selection
 * claims are exercised end to end.
 */
import { describe, it, expect } from "vitest";
import { act, renderHook } from "@testing-library/react";
import { useBuilderForm } from "@/hooks/useBuilderForm";

function setup() {
  const { result } = renderHook(() => useBuilderForm());
  act(() => {
    result.current.updateAnswersRaw(0, "Computer, Keyboard, Mouse, Screen");
    result.current.updateAnswersRaw(1, "Battery, Hood, Tire, Trunk");
    result.current.updateAnswersRaw(2, "Houston, Mars, Mercury, Swift");
    result.current.updateAnswersRaw(3, "Bird, Dog, Tree, White");
  });
  return result;
}

function idsByText(result: ReturnType<typeof setup>) {
  const map = new Map<string, string>();
  for (const g of result.current.groups) {
    for (const a of g.answers) if (a.text.trim() !== "") map.set(a.text, a.id);
  }
  return map;
}

describe("A. delete without replacing", () => {
  it("keeps the other three ids and board positions, vacates Mouse's, does not rerandomize", () => {
    const result = setup();
    expect(result.current.hasAll16).toBe(true);

    const before = idsByText(result);
    const computerId = before.get("Computer")!;
    const keyboardId = before.get("Keyboard")!;
    const mouseId = before.get("Mouse")!;
    const screenId = before.get("Screen")!;

    // Arrange a known custom board order first.
    act(() => {
      result.current.setWordOrderIds([...result.current.wordOrderIds].sort());
    });
    const customOrder = [...result.current.wordOrderIds];

    act(() => {
      result.current.updateAnswersRaw(0, "Computer, Keyboard, Screen");
    });

    const g0 = result.current.groups[0];
    const afterTexts = g0.answers.map((a) => a.text);
    expect(afterTexts).toEqual(["Computer", "Keyboard", "Screen"]);

    // Original ids retained, not reshuffled onto the wrong text.
    expect(g0.answers.find((a) => a.text === "Computer")!.id).toBe(computerId);
    expect(g0.answers.find((a) => a.text === "Keyboard")!.id).toBe(keyboardId);
    expect(g0.answers.find((a) => a.text === "Screen")!.id).toBe(screenId);
    // None of them stole Mouse's id.
    expect(g0.answers.some((a) => a.id === mouseId)).toBe(false);

    // Mouse's id is tombstoned, not lost.
    expect(g0.tombstones.map((t) => t.id)).toContain(mouseId);

    // Board order array itself is completely untouched (the puzzle is no
    // longer complete, so the board-order effect does not even run) — every
    // id, including the now-vacant Mouse id, keeps its exact position.
    expect(result.current.wordOrderIds).toEqual(customOrder);
    expect(result.current.hasAll16).toBe(false);
  });
});

describe("B. later edit adds a replacement", () => {
  it("the new answer inherits the deleted answer's id, board position and Rainbow selection", () => {
    const result = setup();

    const mouseId = idsByText(result).get("Mouse")!;

    // Give the board a deterministic order and select Mouse for Rainbow.
    act(() => {
      result.current.setWordOrderIds([...result.current.wordOrderIds].sort());
      result.current.selectRainbowAnswer(0, mouseId);
    });
    const orderWithMouse = [...result.current.wordOrderIds];
    const mousePosition = orderWithMouse.indexOf(mouseId);
    expect(mousePosition).toBeGreaterThanOrEqual(0);
    expect(result.current.rainbowHerringIds[0]).toBe(mouseId);

    // Delete Mouse (case A), as a separate, already-committed edit.
    act(() => {
      result.current.updateAnswersRaw(0, "Computer, Keyboard, Screen");
    });
    expect(result.current.rainbowHerringIds[0]).toBe(mouseId); // survives as a tombstone-backed selection

    // Later edit: add Cookie.
    act(() => {
      result.current.updateAnswersRaw(0, "Computer, Keyboard, Screen, Cookie");
    });

    const g0 = result.current.groups[0];
    const cookie = g0.answers.find((a) => a.text === "Cookie")!;
    expect(cookie.id).toBe(mouseId);
    expect(g0.tombstones).toHaveLength(0);

    // The other three are untouched.
    expect(g0.answers.find((a) => a.text === "Computer")).toBeTruthy();
    expect(g0.answers.find((a) => a.text === "Keyboard")).toBeTruthy();
    expect(g0.answers.find((a) => a.text === "Screen")).toBeTruthy();

    // Board position inherited via the same id.
    expect(result.current.hasAll16).toBe(true);
    expect(result.current.wordOrderIds[mousePosition]).toBe(cookie.id);

    // Rainbow selection, still pointing at the same id, now resolves to Cookie.
    expect(result.current.rainbowHerringIds[0]).toBe(cookie.id);
  });
});

describe("C. reordering the comma-separated field without changing words", () => {
  it("every word keeps its id, board order and Rainbow selection are unaffected", () => {
    const result = setup();
    const before = idsByText(result);

    act(() => {
      result.current.setWordOrderIds([...result.current.wordOrderIds].sort());
      result.current.selectRainbowAnswer(0, before.get("Mouse")!);
    });
    const orderBefore = [...result.current.wordOrderIds];
    const rainbowBefore = [...result.current.rainbowHerringIds];

    act(() => {
      result.current.updateAnswersRaw(0, "Screen, Computer, Mouse, Keyboard");
    });

    const after = idsByText(result);
    expect(after.get("Computer")).toBe(before.get("Computer"));
    expect(after.get("Keyboard")).toBe(before.get("Keyboard"));
    expect(after.get("Mouse")).toBe(before.get("Mouse"));
    expect(after.get("Screen")).toBe(before.get("Screen"));

    // Authored order changed (answersRaw), but no downstream identity did.
    expect(result.current.groups[0].answersRaw).toBe("Screen, Computer, Mouse, Keyboard");
    expect(result.current.wordOrderIds).toEqual(orderBefore);
    expect(result.current.rainbowHerringIds).toEqual(rainbowBefore);
  });
});

describe("D. direct one-edit replacement (Mouse -> Cookie)", () => {
  it("Cookie inherits Mouse's id, board position and Rainbow selection in a single edit", () => {
    const result = setup();
    const mouseId = idsByText(result).get("Mouse")!;

    act(() => {
      result.current.setWordOrderIds([...result.current.wordOrderIds].sort());
      result.current.selectRainbowAnswer(0, mouseId);
    });
    const mousePosition = result.current.wordOrderIds.indexOf(mouseId);

    act(() => {
      result.current.updateAnswersRaw(0, "Computer, Keyboard, Cookie, Screen");
    });

    const cookie = result.current.groups[0].answers.find((a) => a.text === "Cookie")!;
    expect(cookie.id).toBe(mouseId);
    expect(result.current.groups[0].tombstones).toHaveLength(0);
    expect(result.current.wordOrderIds[mousePosition]).toBe(cookie.id);
    expect(result.current.rainbowHerringIds[0]).toBe(cookie.id);
  });
});

describe("E. the board never rerandomizes on ordinary editing", () => {
  it("holds the exact same order through a delete-then-readd, changing only on Randomize", () => {
    const result = setup();
    const initialOrder = [...result.current.wordOrderIds];
    expect(initialOrder).toHaveLength(16);

    act(() => {
      result.current.updateAnswersRaw(1, "Battery, Hood, Tire"); // delete Trunk
    });
    expect(result.current.hasAll16).toBe(false);

    act(() => {
      result.current.updateAnswersRaw(1, "Battery, Hood, Tire, Cupboard"); // re-add
    });
    expect(result.current.hasAll16).toBe(true);

    // Same 16 ids, same arrangement — no reshuffle happened.
    expect(result.current.wordOrderIds).toEqual(initialOrder);

    act(() => {
      result.current.randomizeWordOrder();
    });
    // Only now is the order allowed to differ; the set of ids is unchanged.
    expect([...result.current.wordOrderIds].sort()).toEqual([...initialOrder].sort());
  });
});
