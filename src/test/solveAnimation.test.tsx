/**
 * The correct-guess solve animation: gather → merge → pop (with settle).
 *
 * What these lock down, from playtest recordings and Sam's review:
 *  - the guessed words no longer fly across the board as separate dark
 *    copies — the real tiles swap into the top row, and only the tiles that
 *    have to move do;
 *  - the solved bar merges in exactly over that row: it is taken out of the
 *    page flow until the row leaves (so the board doesn't jump down to make
 *    room for it), is a one-tile-row .solved-bar, and doesn't scale while
 *    it merges;
 *  - once the tiles are gone the bar does its own distinct pop, and only
 *    then (on the final solve) does the celebration start;
 *  - nothing dims and re-brightens mid-solve;
 *  - reduced motion skips all of it.
 *
 * jsdom has no layout, so the exact row-height geometry is checked in a
 * real browser instead (it was measured on phone widths for Full and Mini).
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { act, fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { FakeSupabase } from "./fakeSupabase";
import type { Puzzle } from "@/lib/types";
import type { GameSettings } from "@/lib/settings";

const db = new FakeSupabase();

vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    from: (t: string) => db.from(t),
    rpc: (n: string, a: Record<string, unknown>) => db.rpc(n, a),
    auth: {
      getUser: () => db.auth.getUser(),
      onAuthStateChange: () => ({ data: { subscription: { unsubscribe: () => {} } } }),
    },
  },
}));
vi.mock("canvas-confetti", () => ({ default: () => {} }));
vi.mock("@/lib/sounds", () => ({ playRainbowSound: () => {}, playGiftOpenSound: () => {} }));
vi.mock("@/lib/haptics", () => ({
  vibrateSuccess: () => {},
  vibrateError: () => {},
  vibrateCelebration: () => {},
}));
vi.mock("@/lib/analytics", () => ({ trackEvent: () => {} }));

import { GameBoard } from "@/components/GameBoard";
import {
  gatherIntoFirstRow,
  SOLVE_BAR_FADE_MS,
  SOLVE_GATHER_MS,
  SOLVE_POP_MS,
  SOLVE_POP_PAUSE_MS,
} from "@/lib/solveAnimation";

// useGame's shared "checking guess" suspense before any outcome shows
// (CHECK_SUSPENSE_MS + CHECK_REVEAL_PAUSE_MS).
const CHECKING_MS = 1000;

const fullPuzzle: Puzzle = {
  id: "solve-anim-full",
  date: "2026-09-24",
  designerName: "Sam West",
  alphabetizeCompleted: true,
  groups: [
    { category: "Yellow Things", words: ["y1", "y2", "y3", "y4"], difficulty: 1 },
    { category: "Green Things", words: ["g1", "g2", "g3", "g4"], difficulty: 2 },
    { category: "Blue Things", words: ["b1", "b2", "b3", "b4"], difficulty: 3 },
    { category: "Red Things", words: ["r1", "r2", "r3", "r4"], difficulty: 4 },
  ],
};

const miniPuzzle: Puzzle = {
  id: "solve-anim-mini",
  format: "mini",
  date: "2026-09-24",
  designerName: "Sam West",
  alphabetizeCompleted: true,
  groups: [
    { category: "Green Things", words: ["g1", "g2", "g3"], difficulty: 2 },
    { category: "Blue Things", words: ["b1", "b2", "b3"], difficulty: 3 },
    { category: "Red Things", words: ["r1", "r2", "r3"], difficulty: 4 },
  ],
};

function setReducedMotion(reduce: boolean) {
  Object.defineProperty(window, "matchMedia", {
    writable: true,
    value: (query: string) => ({
      matches: reduce && query.includes("prefers-reduced-motion"),
      media: query,
      addEventListener: () => {},
      removeEventListener: () => {},
      addListener: () => {},
      removeListener: () => {},
      onchange: null,
      dispatchEvent: () => {},
    }),
  });
}

function renderBoard(puzzle: Puzzle) {
  return render(
    <MemoryRouter>
      <GameBoard puzzle={puzzle} settings={{} as GameSettings} customMode showModeBadge={false} />
    </MemoryRouter>
  );
}

const gridWords = (container: HTMLElement) =>
  Array.from(container.querySelectorAll<HTMLElement>("div[data-word]")).map((el) => el.dataset.word!);
const tileWrapper = (container: HTMLElement, word: string) =>
  container.querySelector(`div[data-word="${word}"]`) as HTMLElement;
const tileButton = (container: HTMLElement, word: string) =>
  container.querySelector(`div[data-word="${word}"] button`) as HTMLButtonElement;
/** The solved bar's root element, found by its category name. */
const bar = (category: string) => screen.getByText(category).parentElement as HTMLElement;

/**
 * Advance fake time in small steps, letting React commit between them — a
 * phase timer is only scheduled once the previous phase has rendered, just
 * as in the browser.
 */
async function advance(ms: number) {
  const STEP = 10;
  let left = ms;
  do {
    const step = Math.min(STEP, left);
    await act(async () => { vi.advanceTimersByTime(step); });
    left -= step;
  } while (left > 0);
}

async function submit(container: HTMLElement, words: string[]) {
  for (const w of words) await act(async () => { fireEvent.click(tileButton(container, w)); });
  await act(async () => { fireEvent.click(screen.getByRole("button", { name: /^submit$/i })); });
}

/** A category that isn't already the whole top row, so the gather has work to do. */
function groupNeedingGather(container: HTMLElement, puzzle: Puzzle, columns: number) {
  const top = new Set(gridWords(container).slice(0, columns));
  return puzzle.groups.find((g) => !g.words.every((w) => top.has(w)))!;
}

beforeEach(() => {
  localStorage.clear();
  sessionStorage.clear();
});

afterEach(() => {
  vi.useRealTimers();
  setReducedMotion(false);
});

// ── The pure gather ────────────────────────────────────────────────────────
describe("gatherIntoFirstRow", () => {
  const board = [
    "a", "B1", "c", "d",
    "e", "f", "B2", "h",
    "B3", "j", "k", "l",
    "m", "n", "o", "B4",
  ];
  const group = ["B1", "B2", "B3", "B4"];

  it("puts the category in the top row", () => {
    const out = gatherIntoFirstRow(board, group, 4);
    expect(new Set(out.slice(0, 4))).toEqual(new Set(group));
    expect([...out].sort()).toEqual([...board].sort());
  });

  it("moves only the tiles it has to — each displaced word takes a vacated slot", () => {
    const out = gatherIntoFirstRow(board, group, 4);
    // B1 was already in the top row: it stays exactly where it was.
    expect(out[1]).toBe("B1");
    // Every word that was neither a category word below the top row nor a
    // non-category word in the top row is untouched.
    const moved = new Set([0, 2, 3, 6, 8, 15]);
    board.forEach((w, i) => { if (!moved.has(i)) expect(out[i]).toBe(w); });
    // The three displaced top-row words land in the three vacated slots.
    expect(new Set([out[6], out[8], out[15]])).toEqual(new Set(["a", "c", "d"]));
  });

  it("pairs slots to keep paths short (no needless crossing)", () => {
    // Category words straight below free slots 0 and 3 should go straight up.
    const b = [
      "x", "G1", "G2", "y",
      "G3", "p", "q", "G4",
      "r", "s", "t", "u",
    ];
    const out = gatherIntoFirstRow(b, ["G1", "G2", "G3", "G4"], 4);
    expect(out.slice(0, 4)).toEqual(["G3", "G1", "G2", "G4"]);
    expect(out[4]).toBe("x");
    expect(out[7]).toBe("y");
  });

  it("does nothing when the category is already the top row", () => {
    const b = ["B2", "B4", "B1", "B3", "a", "c", "d", "e"];
    expect(gatherIntoFirstRow(b, group, 4)).toEqual(b);
  });

  it("works for a Mini's three-wide row", () => {
    const b = ["a", "b", "M1", "c", "M2", "d", "M3", "e", "f"];
    const out = gatherIntoFirstRow(b, ["M1", "M2", "M3"], 3);
    expect(new Set(out.slice(0, 3))).toEqual(new Set(["M1", "M2", "M3"]));
    expect(out[2]).toBe("M1");
  });

  it("leaves the order alone when the category isn't exactly one row wide", () => {
    expect(gatherIntoFirstRow(board, ["B1", "B2", "B3"], 4)).toEqual(board);
    expect(gatherIntoFirstRow(board, ["B1", "B2", "B3", "zz"], 4)).toEqual(board);
  });
});

// ── The sequence on a real board ───────────────────────────────────────────
describe.each([
  ["Full", fullPuzzle, 4],
  ["Mini", miniPuzzle, 3],
] as const)("%s board: gather, merge, then pop", (_name, puzzle, columns) => {
  it("plays the beats in order: the bar merges in place, then pops", async () => {
    setReducedMotion(false);
    const { container } = renderBoard(puzzle);
    await act(async () => {});
    const group = groupNeedingGather(container, puzzle, columns);
    const others = gridWords(container).filter((w) => !group.words.includes(w));

    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    await submit(container, group.words);

    // Checking: nothing is dimmed — not the guessed tiles, not the rest.
    for (const w of gridWords(container)) expect(tileButton(container, w).className).not.toMatch(/(^|\s)opacity-50/);

    await advance(CHECKING_MS);

    // Beat 1 — gather. The four real tiles are now the top row, still
    // showing as selected; the bar is mounted but invisible and out of the
    // page flow, so nothing below it has been pushed down.
    expect(new Set(gridWords(container).slice(0, columns))).toEqual(new Set(group.words));
    for (const w of group.words) expect(tileButton(container, w).getAttribute("aria-pressed")).toBe("true");
    expect(bar(group.category).style.position).toBe("absolute");
    expect(bar(group.category).style.opacity).toBe("0");
    for (const w of gridWords(container)) expect(tileButton(container, w).className).not.toMatch(/(^|\s)opacity-50/);

    // Beat 2 — merge: the one-row bar fades in over the row, without any
    // pop yet; the tiles fade out beneath it.
    await advance(SOLVE_GATHER_MS);
    const merging = bar(group.category);
    expect(merging.className).toContain("solved-bar");
    expect(merging.style.position).toBe("absolute");
    expect(merging.style.opacity).toBe("1");
    expect(merging.className).not.toContain("animate-solved-pop");
    for (const w of group.words) expect(tileWrapper(container, w).style.opacity).toBe("0");
    expect(screen.getByText(group.category).className).toContain("animate-solved-content-land");

    // Still merging through the short pause before the pop.
    await advance(SOLVE_BAR_FADE_MS);
    expect(bar(group.category).className).not.toContain("animate-solved-pop");

    // Beats 3 and 4 — pop and settle. The row has left the grid, the bar is
    // in the page flow (drawn above its neighbours) and pops; everything
    // else is still on the board.
    await advance(SOLVE_POP_PAUSE_MS);
    const popping = bar(group.category);
    for (const w of group.words) expect(tileWrapper(container, w)).toBeNull();
    expect(popping.style.position).toBe("relative");
    expect(popping.className).toContain("animate-solved-pop");
    expect(new Set(gridWords(container))).toEqual(new Set(others));

    // Done: a plain solved bar, still one row tall.
    await advance(SOLVE_POP_MS);
    const done = bar(group.category);
    expect(done.className).toContain("solved-bar");
    expect(done.className).not.toMatch(/animate-solved-pop|animate-group-appear/);
    expect(done.style.position).toBe("");
    expect(done.style.opacity).toBe("");
    expect(done.style.transform).toBe("");
    expect(screen.getByText(group.category).className).not.toContain("animate-solved-content-land");
  });
});

describe("the final solve", () => {
  it("un-gates the results only once the last category's pop has finished", async () => {
    setReducedMotion(false);
    const { container } = renderBoard(miniPuzzle);
    await act(async () => {});
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    const full = CHECKING_MS + SOLVE_GATHER_MS + SOLVE_BAR_FADE_MS + SOLVE_POP_PAUSE_MS + SOLVE_POP_MS;

    for (const g of miniPuzzle.groups.slice(0, 2)) {
      await submit(container, g.words);
      await advance(full);
    }
    const last = miniPuzzle.groups[2];
    await submit(container, last.words);
    await advance(CHECKING_MS);
    expect(screen.queryByText(/perfect game/i)).toBeNull();
    // The last row is the whole board, so there is nothing to gather: the bar
    // merges straight in, then pops — and the celebration waits for the pop.
    await advance(SOLVE_BAR_FADE_MS + SOLVE_POP_PAUSE_MS);
    expect(bar(last.category).className).toContain("animate-solved-pop");
    expect(screen.queryByText(/perfect game/i)).toBeNull();
    await advance(SOLVE_POP_MS);
    // The celebration is un-gated on a zero-delay timer from that last beat
    // (fake timers run a zero delay set inside a tick one millisecond later).
    await advance(10);
    expect(screen.getByText(/perfect game/i)).toBeTruthy();
    expect(gridWords(container)).toEqual([]);
  });
});

describe("reduced motion", () => {
  it("shows the bar in place at once and removes the row, with no animation", async () => {
    setReducedMotion(true);
    const { container } = renderBoard(fullPuzzle);
    await act(async () => {});
    const group = fullPuzzle.groups[0];
    await submit(container, group.words);
    await act(async () => {});

    const b = bar(group.category);
    expect(b.style.position).toBe("");
    expect(b.style.opacity).toBe("");
    expect(screen.getByText(group.category).className).not.toContain("animate-solved-content-land");
    for (const w of group.words) expect(tileWrapper(container, w)).toBeNull();
  });
});
