/**
 * The colours each board offers for hand-colouring tiles.
 *
 * A board has exactly as many category colours as it has categories: a Full
 * 4×4 has Yellow/Green/Blue/Red, a Mini 3×3 has Green/Blue/Red and NO Yellow.
 * There are two separate interfaces for painting a tile — Color Palette
 * Mode's swatch row and Color-Code Tiles' per-tile double-tap picker — and
 * the bug these tests lock down is the two disagreeing: palette mode read the
 * format while the picker had its own hardcoded four-colour array, so a Mini
 * player double-tapping a tile was offered a Yellow the board has no category
 * for.
 *
 * Both now render categorySwatches(format), so every assertion below is about
 * the two interfaces AGREEING, not about either one's private list.
 */
import { describe, it, expect, vi } from "vitest";
import { act, fireEvent, render, screen, within } from "@testing-library/react";
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
import { FULL_FORMAT, MINI_FORMAT } from "@/lib/puzzleFormat";
import { categorySwatches } from "@/lib/categoryPalette";

/** A Full 4×4: four categories, difficulties 1-4 (Yellow/Green/Blue/Red). */
const fullPuzzle: Puzzle = {
  id: "full-palette-1",
  date: "2026-09-22",
  designerName: "Sam West",
  alphabetizeCompleted: true,
  groups: [
    { category: "Yellow Things", words: ["y1", "y2", "y3", "y4"], difficulty: 1 },
    { category: "Green Things", words: ["g1", "g2", "g3", "g4"], difficulty: 2 },
    { category: "Blue Things", words: ["b1", "b2", "b3", "b4"], difficulty: 3 },
    { category: "Red Things", words: ["r1", "r2", "r3", "r4"], difficulty: 4 },
  ],
};

/** A Mini 3×3: three categories, difficulties 2-4 (Green/Blue/Red). */
const miniPuzzle: Puzzle = {
  id: "mini-palette-1",
  format: "mini",
  date: "2026-09-22",
  designerName: "Sam West",
  alphabetizeCompleted: true,
  groups: [
    { category: "Green Things", words: ["g1", "g2", "g3"], difficulty: 2 },
    { category: "Blue Things", words: ["b1", "b2", "b3"], difficulty: 3 },
    { category: "Red Things", words: ["r1", "r2", "r3"], difficulty: 4 },
  ],
};

const ALL_COLORS = ["Yellow", "Green", "Blue", "Red"] as const;

function renderBoard(puzzle: Puzzle, settings: Partial<GameSettings>) {
  return render(
    <MemoryRouter>
      <GameBoard
        puzzle={puzzle}
        settings={settings as GameSettings}
        customMode
        showModeBadge={false}
      />
    </MemoryRouter>
  );
}

/** The labels on Color Palette Mode's swatch row, in rendered order. */
function paletteColors(): string[] {
  return ALL_COLORS.filter((c) => screen.queryByLabelText(`${c} paint`) !== null);
}

const tileButton = (container: HTMLElement, word: string) =>
  container.querySelector(`[data-word="${word}"] button`) as HTMLButtonElement;

/**
 * Double-tap a tile the way a player does: two taps inside the 250ms window.
 * Returns the open picker popover.
 */
function doubleTap(container: HTMLElement, word: string): HTMLElement {
  const btn = tileButton(container, word);
  act(() => {
    fireEvent.click(btn);
    fireEvent.click(btn);
  });
  const picker = container.querySelector(`[data-word="${word}"] .animate-fade-up`);
  expect(picker).not.toBeNull();
  return picker as HTMLElement;
}

/** The labels on one open double-tap picker, in rendered order. */
function pickerColors(picker: HTMLElement): string[] {
  return ALL_COLORS.filter(
    (c) => within(picker).queryByLabelText(`${c} tile color`) !== null
  );
}

// ── The shared list itself ─────────────────────────────────────────────────
describe("categorySwatches is the one list both interfaces read", () => {
  it("gives a Full four colours and a Mini three, easiest first", () => {
    expect(categorySwatches(FULL_FORMAT).map((s) => s.color)).toEqual([
      "yellow", "green", "blue", "red",
    ]);
    expect(categorySwatches(MINI_FORMAT).map((s) => s.color)).toEqual([
      "green", "blue", "red",
    ]);
  });

  it("gives every colour the solved-bar fill for its difficulty", () => {
    expect(categorySwatches(MINI_FORMAT).map((s) => s.swatchClass)).toEqual([
      "bg-group-2", "bg-group-3", "bg-group-4",
    ]);
  });
});

// ── Mini: three colours, no Yellow, in BOTH interfaces ─────────────────────
describe("Mini 3×3 offers Green, Blue and Red only", () => {
  it("palette mode shows exactly Green, Blue, Red", () => {
    renderBoard(miniPuzzle, { colorPaletteMode: true });
    expect(paletteColors()).toEqual(["Green", "Blue", "Red"]);
  });

  it("the double-tap picker shows exactly Green, Blue, Red", () => {
    const { container } = renderBoard(miniPuzzle, { colorCodeTiles: true });
    expect(pickerColors(doubleTap(container, "g1"))).toEqual(["Green", "Blue", "Red"]);
  });

  it("has no Yellow anywhere in either interface", () => {
    const palette = renderBoard(miniPuzzle, { colorPaletteMode: true });
    expect(screen.queryByLabelText("Yellow paint")).toBeNull();
    palette.unmount();

    const { container } = renderBoard(miniPuzzle, { colorCodeTiles: true });
    const picker = doubleTap(container, "b1");
    expect(within(picker).queryByLabelText("Yellow tile color")).toBeNull();
    // Not merely unlabelled: the picker holds three colour circles, not four.
    expect(picker.querySelectorAll("[aria-label$='tile color']")).toHaveLength(3);
  });

  it("offers the same colours in both interfaces", () => {
    const palette = renderBoard(miniPuzzle, { colorPaletteMode: true });
    const fromPalette = paletteColors();
    palette.unmount();

    const { container } = renderBoard(miniPuzzle, { colorCodeTiles: true });
    expect(pickerColors(doubleTap(container, "r1"))).toEqual(fromPalette);
  });
});

// ── Full: unchanged, all four colours, in BOTH interfaces ──────────────────
describe("the regular 4×4 game still offers all four colours", () => {
  it("palette mode shows Yellow, Green, Blue, Red", () => {
    renderBoard(fullPuzzle, { colorPaletteMode: true });
    expect(paletteColors()).toEqual(["Yellow", "Green", "Blue", "Red"]);
  });

  it("the double-tap picker shows Yellow, Green, Blue, Red", () => {
    const { container } = renderBoard(fullPuzzle, { colorCodeTiles: true });
    const picker = doubleTap(container, "y1");
    expect(pickerColors(picker)).toEqual(["Yellow", "Green", "Blue", "Red"]);
    expect(picker.querySelectorAll("[aria-label$='tile color']")).toHaveLength(4);
  });
});

// ── The gesture still does its job on both sizes ───────────────────────────
describe("double-tap colouring still applies and removes a colour", () => {
  it("paints a Mini tile Blue and then clears it", () => {
    const { container } = renderBoard(miniPuzzle, { colorCodeTiles: true });
    const btn = tileButton(container, "g1");

    const picker = doubleTap(container, "g1");
    act(() => {
      fireEvent.click(within(picker).getByLabelText("Blue tile color"));
    });
    // The painted fill is the pastel wash of Blue's solved-bar colour.
    expect(btn.className).toContain("tile-paint-3");

    const reopened = doubleTap(container, "g1");
    act(() => {
      fireEvent.click(within(reopened).getByLabelText("Remove tile color"));
    });
    expect(btn.className).not.toContain("tile-paint-3");
  });

  it("paints a Full tile Yellow and then clears it", () => {
    const { container } = renderBoard(fullPuzzle, { colorCodeTiles: true });
    const btn = tileButton(container, "y1");

    const picker = doubleTap(container, "y1");
    act(() => {
      fireEvent.click(within(picker).getByLabelText("Yellow tile color"));
    });
    expect(btn.className).toContain("tile-paint-1");

    const reopened = doubleTap(container, "y1");
    act(() => {
      fireEvent.click(within(reopened).getByLabelText("Remove tile color"));
    });
    expect(btn.className).not.toContain("tile-paint-1");
  });

  it("paints a Mini tile from palette mode too", () => {
    const { container } = renderBoard(miniPuzzle, { colorPaletteMode: true });
    // Two separate acts: the paint mode has to be committed before the tile
    // click reads it, exactly as it is for a player making two taps.
    act(() => { fireEvent.click(screen.getByLabelText("Red paint")); });
    act(() => { fireEvent.click(tileButton(container, "b1")); });
    expect(tileButton(container, "b1").className).toContain("tile-paint-4");
  });
});
