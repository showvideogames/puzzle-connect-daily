/**
 * Regression: the Admin builder showed "Club" everywhere in the UI (answers
 * field, Starting Board, Rainbow dropdown, Rainbow display order), yet saving
 * failed with
 *   rainbow_herring word "Club" is not one of this puzzle's 16 words
 *
 * These tests build the REAL Admin save payload (lib/builder/contentPayload —
 * the same functions Admin.tsx calls) from the REAL builder hook, then run it
 * through canonicalizePuzzleContent, which mirrors the case-sensitive
 * validate_puzzle_content() that admin_save_puzzle runs before any write.
 */
import { describe, it, expect } from "vitest";
import { act, renderHook } from "@testing-library/react";
import { useBuilderForm } from "@/hooks/useBuilderForm";
import { buildContentPayload, builderContentInput } from "@/lib/builder/contentPayload";
import { canonicalizePuzzleContent } from "./fakeSupabase";

type Hook = { current: ReturnType<typeof useBuilderForm> };

/** Every keystroke as its own updateAnswersRaw call, exactly like CategoryEditor's onChange. */
function typeSteps(result: Hook, groupIdx: number, steps: string[]) {
  for (const raw of steps) act(() => result.current.updateAnswersRaw(groupIdx, raw));
}

function typeFromScratch(result: Hook, groupIdx: number, finalText: string) {
  const steps: string[] = [];
  for (let i = 1; i <= finalText.length; i++) steps.push(finalText.slice(0, i));
  typeSteps(result, groupIdx, steps);
}

const GROUPS = [
  "Blue, Green, Red, Yellow",
  "Bag, Club, Tee, Towel",
  "Houston, Mars, Mercury, Swift",
  "Bird, Dog, Tree, White",
];

/** A complete, valid Rainbow puzzle with Club selected as the Green group's Rainbow answer. */
function completeRainbowPuzzle() {
  const { result } = renderHook(() => useBuilderForm());
  GROUPS.forEach((g, i) => {
    act(() => result.current.updateCategoryName(i, `Category ${i + 1}`));
    typeFromScratch(result, i, g);
  });
  expect(result.current.hasAll16).toBe(true);

  const clubId = result.current.groups[1].answers.find((a) => a.text === "Club")!.id;
  act(() => {
    result.current.selectRainbowAnswer(0, result.current.groups[0].answers[0].id);
    result.current.selectRainbowAnswer(1, clubId);
    result.current.selectRainbowAnswer(2, result.current.groups[2].answers[0].id);
    result.current.selectRainbowAnswer(3, result.current.groups[3].answers[0].id);
  });
  expect(result.current.rainbowComplete).toBe(true);
  return { result, clubId };
}

/** Exactly what Admin's handleSave sends as _content, then the server's validation. */
function saveAsAdmin(result: Hook) {
  const payload = buildContentPayload(builderContentInput(result.current, false));
  const canonical = canonicalizePuzzleContent(payload); // throws like admin_save_puzzle would
  return { payload, canonical };
}

function boardTexts(result: Hook): string[] {
  return result.current.wordOrderIds.map((id) => result.current.slotById.get(id)?.text ?? "");
}

describe("Admin save payload stays consistent with the live builder state", () => {
  it("a mixed-case Rainbow puzzle saves: rainbow_herring and word_order use the same normalized words as the groups", () => {
    const { result } = completeRainbowPuzzle();
    const { payload } = saveAsAdmin(result); // must not throw

    const groupWords = payload.groups.flatMap((g) => g.words);
    expect(groupWords).toContain("CLUB");
    expect(payload.rainbow_herring).toContain("CLUB");
    for (const w of payload.rainbow_herring!) expect(groupWords).toContain(w);
    for (const w of payload.word_order!) expect(groupWords).toContain(w);
    expect([...payload.word_order!].sort()).toEqual([...groupWords].sort());
  });

  it("remove Club, retype Club (one keystroke at a time): same slot, still on the board, still the Rainbow answer, save succeeds", () => {
    const { result, clubId } = completeRainbowPuzzle();
    const positionBefore = result.current.wordOrderIds.indexOf(clubId);
    const orderBefore = [...result.current.wordOrderIds];

    // Backspace "Club" out of the field, leaving an empty comma slot...
    typeSteps(result, 1, [
      "Bag, Clu, Tee, Towel",
      "Bag, Cl, Tee, Towel",
      "Bag, C, Tee, Towel",
      "Bag, , Tee, Towel",
    ]);
    expect(result.current.hasAll16).toBe(false);
    // ...then type it back in.
    typeSteps(result, 1, [
      "Bag, C, Tee, Towel",
      "Bag, Cl, Tee, Towel",
      "Bag, Clu, Tee, Towel",
      "Bag, Club, Tee, Towel",
    ]);

    expect(result.current.hasAll16).toBe(true);
    const club = result.current.groups[1].answers.find((a) => a.text === "Club")!;
    expect(club.id).toBe(clubId); // same stable slot
    expect(result.current.wordOrderIds).toEqual(orderBefore); // board untouched
    expect(result.current.wordOrderIds.indexOf(club.id)).toBe(positionBefore);
    expect(boardTexts(result)).toContain("Club");
    expect(result.current.rainbowHerringIds[1]).toBe(club.id);
    expect(result.current.textsFor(result.current.rainbowWordOrderIds)).toContain("Club");

    const { payload } = saveAsAdmin(result);
    expect(payload.groups[1].words).toEqual(["BAG", "CLUB", "TEE", "TOWEL"]);
    expect(payload.rainbow_herring).toContain("CLUB");
  });

  it("delete Club as a whole entry, then add it back at the end: same slot and Rainbow selection, save succeeds", () => {
    const { result, clubId } = completeRainbowPuzzle();
    const positionBefore = result.current.wordOrderIds.indexOf(clubId);

    act(() => result.current.updateAnswersRaw(1, "Bag, Tee, Towel"));
    expect(result.current.rainbowHerringIds[1]).toBe(clubId); // selection survives the deletion
    act(() => result.current.updateAnswersRaw(1, "Bag, Tee, Towel, Club"));

    const club = result.current.groups[1].answers.find((a) => a.text === "Club")!;
    expect(club.id).toBe(clubId);
    expect(result.current.wordOrderIds.indexOf(club.id)).toBe(positionBefore);
    expect(result.current.rainbowHerringIds[1]).toBe(club.id);

    const { payload } = saveAsAdmin(result);
    expect(payload.rainbow_herring).toContain("CLUB");
  });

  it("replacing Club with a different word: the Rainbow selection follows the same slot, and the saved payload agrees", () => {
    const { result, clubId } = completeRainbowPuzzle();
    const positionBefore = result.current.wordOrderIds.indexOf(clubId);

    // One edit...
    act(() => result.current.updateAnswersRaw(1, "Bag, Driver, Tee, Towel"));
    let driver = result.current.groups[1].answers.find((a) => a.text === "Driver")!;
    expect(driver.id).toBe(clubId);
    expect(result.current.wordOrderIds.indexOf(driver.id)).toBe(positionBefore);
    expect(result.current.rainbowHerringIds[1]).toBe(clubId);
    let { payload } = saveAsAdmin(result);
    expect(payload.rainbow_herring).toContain("DRIVER");
    expect(payload.rainbow_herring).not.toContain("CLUB");

    // ...and the same replacement typed one keystroke at a time (a fresh puzzle).
    const fresh = completeRainbowPuzzle();
    typeSteps(fresh.result, 1, [
      "Bag, Clu, Tee, Towel",
      "Bag, Cl, Tee, Towel",
      "Bag, C, Tee, Towel",
      "Bag, , Tee, Towel",
      "Bag, D, Tee, Towel",
      "Bag, Dr, Tee, Towel",
      "Bag, Driver, Tee, Towel",
    ]);
    driver = fresh.result.current.groups[1].answers.find((a) => a.text === "Driver")!;
    expect(driver.id).toBe(fresh.clubId);
    expect(fresh.result.current.rainbowHerringIds[1]).toBe(driver.id);
    payload = saveAsAdmin(fresh.result).payload;
    expect(payload.rainbow_herring).toContain("DRIVER");
    expect(payload.rainbow_herring).not.toContain("CLUB");
  });
});

describe("a stray (non-board) id can never hide an answer from the Starting Board", () => {
  it("trailing comma -> backspace -> delete -> retype: every answer stays on the board and the puzzle saves", () => {
    const { result } = completeRainbowPuzzle();
    typeSteps(result, 1, [
      "Bag, Club, Tee, Towel,", // a 5th, blank slot appears
      "Bag, Club, Tee, Towel",
      "Bag, Club, Tee, ", // Towel deleted, leaving an empty comma slot
      "Bag, Club, Tee, Towel", // ...and retyped
    ]);

    const g1 = result.current.groups[1];
    expect(g1.answers.map((a) => a.text)).toEqual(["Bag", "Club", "Tee", "Towel"]);
    // Every answer holds one of the category's 4 board-position ids.
    for (const a of g1.answers) expect(g1.poolIds).toContain(a.id);
    expect(boardTexts(result).filter((t) => t !== "").sort()).toEqual(
      ["Bag", "Bird", "Blue", "Club", "Dog", "Green", "Houston", "Mars", "Mercury", "Red", "Swift", "Tee", "Towel", "Tree", "White", "Yellow"].sort()
    );
    expect(() => saveAsAdmin(result)).not.toThrow();
  });

  it("a Rainbow selection on an answer that gets moved onto its board slot follows it", () => {
    const { result } = renderHook(() => useBuilderForm());
    // 5 answers: the 5th ("Wedge") has no board position of its own.
    act(() => result.current.updateAnswersRaw(1, "Bag, Club, Tee, Towel, Wedge"));
    const wedge = result.current.groups[1].answers.find((a) => a.text === "Wedge")!;
    expect(result.current.groups[1].poolIds).not.toContain(wedge.id);
    act(() => result.current.selectRainbowAnswer(1, wedge.id));

    // Deleting "Club" frees its board slot; Wedge moves onto it.
    act(() => result.current.updateAnswersRaw(1, "Bag, Tee, Towel, Wedge"));

    const moved = result.current.groups[1].answers.find((a) => a.text === "Wedge")!;
    expect(result.current.groups[1].poolIds).toContain(moved.id);
    expect(boardTexts(result)).toContain("Wedge");
    expect(result.current.rainbowHerringIds[1]).toBe(moved.id);
  });
});
