/**
 * The category-color ring on a GENUINELY found Rainbow answer, end to end —
 * corrects an earlier, wrong version of this feature.
 *
 * That earlier version let a player paint "Rainbow" onto any arbitrary tile
 * through a new palette swatch (a fake per-word `tileRainbowMarks` flag,
 * fully decoupled from real gameplay). This suite proves that's gone, and
 * that the real replacement only ever activates on words the player has
 * actually solved as the puzzle's Rainbow answer — driven through the REAL
 * useGame/GameBoard guess flow, not a shortcut.
 */
import { describe, it, expect, beforeEach, vi } from "vitest";
import { act, fireEvent, render, renderHook, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { FakeSupabase } from "./fakeSupabase";
import type { Puzzle } from "@/lib/types";

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

import { useGame } from "@/hooks/useGame";
import { GameBoard } from "@/components/GameBoard";
import { loadProgress, progressKey } from "@/lib/gameProgress";
import { FULL_FORMAT, progressStorageId } from "@/lib/puzzleFormat";

function reduceMotion() {
  Object.defineProperty(window, "matchMedia", {
    writable: true,
    value: (query: string) => ({
      matches: query.includes("prefers-reduced-motion"),
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

async function settle() {
  await act(async () => {
    for (let i = 0; i < 25; i++) await new Promise((r) => setTimeout(r, 0));
  });
}

const FULL_ID = "genuine-rainbow-full-1";
const fullPuzzle: Puzzle = {
  id: FULL_ID,
  date: "2026-09-22",
  designerName: "Sam West",
  alphabetizeCompleted: true,
  groups: [
    { category: "Yellow Things", words: ["y1", "y2", "y3", "y4"], difficulty: 1, hintWord: "yh" },
    { category: "Green Things", words: ["g1", "g2", "g3", "g4"], difficulty: 2, hintWord: "gh" },
    { category: "Blue Things", words: ["b1", "b2", "b3", "b4"], difficulty: 3, hintWord: "bh" },
    { category: "Red Things", words: ["r1", "r2", "r3", "r4"], difficulty: 4, hintWord: "rh" },
  ],
  // One word per category — the real Rainbow answer, exactly what a player
  // has to select and submit together to genuinely find it.
  rainbowHerring: ["y1", "g1", "b1", "r1"],
};

const MINI_ID = "genuine-rainbow-mini-1";
const miniPuzzle: Puzzle = {
  id: MINI_ID,
  format: "mini",
  date: "2026-09-22",
  designerName: "Sam West",
  alphabetizeCompleted: true,
  groups: [
    { category: "Green", words: ["mg1", "mg2", "mg3"], difficulty: 2 },
    { category: "Blue", words: ["mb1", "mb2", "mb3"], difficulty: 3 },
    { category: "Red", words: ["mr1", "mr2", "mr3"], difficulty: 4 },
  ],
  rainbowHerring: ["mg1", "mb1", "mr1"],
};

beforeEach(() => {
  reduceMotion();
  localStorage.clear();
  sessionStorage.clear();
});

function renderBoard(puzzle: Puzzle) {
  return render(
    <MemoryRouter>
      <GameBoard puzzle={puzzle} settings={{ colorPaletteMode: true } as never} customMode showModeBadge={false} />
    </MemoryRouter>
  );
}

const tileButton = (container: HTMLElement, word: string) =>
  container.querySelector(`[data-word="${word}"] button`) as HTMLButtonElement;
const ring = (container: HTMLElement, word: string) =>
  container.querySelector(`[data-word="${word}"] button > span[aria-hidden="true"]`);

/** Selects and submits exactly the puzzle's real Rainbow words — the one and
 *  only way `isRainbow` ever becomes true for those tiles. */
async function findGenuineRainbow(container: HTMLElement, herring: string[]) {
  for (const w of herring) {
    await act(async () => { fireEvent.click(tileButton(container, w)); });
  }
  await act(async () => { fireEvent.click(screen.getByRole("button", { name: /^submit$/i })); });
  await settle();
}

function paint(container: HTMLElement, label: string, word: string) {
  fireEvent.click(screen.getByLabelText(label));
  fireEvent.click(tileButton(container, word));
}

describe("no player-selectable Rainbow palette color", () => {
  it("there is no Rainbow paint button in the palette row", () => {
    renderBoard(fullPuzzle);
    expect(screen.queryByLabelText("Rainbow paint")).toBeNull();
  });

  it("an arbitrary (non-herring) tile can never render the Rainbow gradient via painting", () => {
    const { container } = renderBoard(fullPuzzle);
    // Only Select / Yellow / Green / Blue / Red / Eraser exist — paint every
    // color at y2 (never part of the herring) and confirm none of them ever
    // produces the gradient.
    for (const label of ["Yellow paint", "Green paint", "Blue paint", "Red paint"]) {
      paint(container, label, "y2");
      expect(tileButton(container, "y2").className).not.toContain("rainbow-tile");
    }
  });
});

describe("genuine Rainbow discovery + category color (Full)", () => {
  it("finding the real Rainbow renders the gradient on exactly its four words", async () => {
    const { container } = renderBoard(fullPuzzle);
    await findGenuineRainbow(container, fullPuzzle.rainbowHerring!);
    for (const w of fullPuzzle.rainbowHerring!) {
      expect(tileButton(container, w).className).toContain("rainbow-tile");
    }
    // A word that was never part of the herring stays untouched.
    expect(tileButton(container, "y2").className).not.toContain("rainbow-tile");
  });

  it.each(["Yellow paint", "Green paint", "Blue paint", "Red paint"] as const)(
    "every genuine Rainbow word can receive %s, gradient + ring together",
    async (label) => {
      const { container } = renderBoard(fullPuzzle);
      await findGenuineRainbow(container, fullPuzzle.rainbowHerring!);
      paint(container, label, "y1");
      const btn = tileButton(container, "y1");
      expect(btn.className).toContain("rainbow-tile");
      expect(ring(container, "y1")).not.toBeNull();
    }
  );

  it("selecting a painted genuine Rainbow tile adds the independent outer selection border", async () => {
    const { container } = renderBoard(fullPuzzle);
    await findGenuineRainbow(container, fullPuzzle.rainbowHerring!);
    paint(container, "Green paint", "g1");

    fireEvent.click(screen.getByLabelText("Select mode"));
    fireEvent.click(tileButton(container, "g1"));

    const btn = tileButton(container, "g1");
    expect(btn.getAttribute("aria-pressed")).toBe("true");
    expect(btn.className).toContain("border-foreground");
    const r = ring(container, "g1");
    expect(r).not.toBeNull();
    expect(r!.className).toContain("border-group-2");
  });

  it("erasing category paint removes only the ring — the genuine gradient stays", async () => {
    const { container } = renderBoard(fullPuzzle);
    await findGenuineRainbow(container, fullPuzzle.rainbowHerring!);
    paint(container, "Blue paint", "b1");
    expect(ring(container, "b1")).not.toBeNull();

    fireEvent.click(screen.getByLabelText("Eraser"));
    fireEvent.click(tileButton(container, "b1"));

    const btn = tileButton(container, "b1");
    expect(btn.className).toContain("rainbow-tile");
    expect(ring(container, "b1")).toBeNull();
  });

  it("Clear Colors removes the ring without touching genuine Rainbow discovery", async () => {
    const { container } = renderBoard(fullPuzzle);
    await findGenuineRainbow(container, fullPuzzle.rainbowHerring!);
    paint(container, "Red paint", "r1");
    expect(ring(container, "r1")).not.toBeNull();

    fireEvent.click(screen.getByRole("button", { name: /clear colors/i }));

    // The category ring is gone...
    expect(ring(container, "r1")).toBeNull();
    // ...but the real Rainbow gradient — gameplay state, not paint — is
    // completely unaffected on every one of its words.
    for (const w of fullPuzzle.rainbowHerring!) {
      expect(tileButton(container, w).className).toContain("rainbow-tile");
    }
  });

  it("refresh/restoration preserves category paint on an already-revealed Rainbow answer", async () => {
    const { container, unmount } = renderBoard(fullPuzzle);
    await findGenuineRainbow(container, fullPuzzle.rainbowHerring!);
    paint(container, "Yellow paint", "g1");
    expect(ring(container, "g1")).not.toBeNull();
    unmount();

    const second = renderBoard(fullPuzzle);
    await settle();
    expect(tileButton(second.container, "g1").className).toContain("rainbow-tile");
    expect(ring(second.container, "g1")).not.toBeNull();
    expect(ring(second.container, "g1")!.className).toContain("border-group-1");
  });
});

describe("genuine Rainbow discovery + category color (Mini)", () => {
  it("finding the real Rainbow and painting it works the same as Full", async () => {
    const { container } = renderBoard(miniPuzzle);
    await findGenuineRainbow(container, miniPuzzle.rainbowHerring!);
    for (const w of miniPuzzle.rainbowHerring!) {
      expect(tileButton(container, w).className).toContain("rainbow-tile");
    }
    paint(container, "Red paint", "mg1");
    const btn = tileButton(container, "mg1");
    expect(btn.className).toContain("rainbow-tile");
    const r = ring(container, "mg1");
    expect(r).not.toBeNull();
    expect(r!.className).toContain("border-group-4");
  });

  it("the Eraser clears only the ring on a Mini board too", async () => {
    const { container } = renderBoard(miniPuzzle);
    await findGenuineRainbow(container, miniPuzzle.rainbowHerring!);
    paint(container, "Blue paint", "mb1");
    fireEvent.click(screen.getByLabelText("Eraser"));
    fireEvent.click(tileButton(container, "mb1"));

    const btn = tileButton(container, "mb1");
    expect(btn.className).toContain("rainbow-tile");
    expect(ring(container, "mb1")).toBeNull();
  });
});

describe("existing non-Rainbow palette behavior is unchanged", () => {
  it("a plain colored tile (never a genuine Rainbow word) still renders the pastel category wash, no ring", () => {
    const { container } = renderBoard(fullPuzzle);
    paint(container, "Green paint", "b2");
    const btn = tileButton(container, "b2");
    expect(btn.className).toContain("tile-paint-2");
    expect(btn.className).not.toContain("rainbow-tile");
    expect(ring(container, "b2")).toBeNull();
  });

  it("Clear Colors still clears an ordinary painted tile", () => {
    const { container } = renderBoard(fullPuzzle);
    paint(container, "Yellow paint", "b2");
    expect(tileButton(container, "b2").className).toContain("tile-paint-1");
    fireEvent.click(screen.getByRole("button", { name: /clear colors/i }));
    expect(tileButton(container, "b2").className).not.toContain("tile-paint-1");
  });
});

describe("useGame no longer exposes the removed Rainbow-mark state", () => {
  function mount(p: Puzzle) {
    return renderHook(({ o }) => useGame(p, o as never), { initialProps: { o: { mode: "custom" as const } } });
  }

  it("tileRainbowMarks and setTileRainbow are gone from the hook's return value", () => {
    const view = mount(fullPuzzle);
    expect((view.result.current as Record<string, unknown>).tileRainbowMarks).toBeUndefined();
    expect((view.result.current as Record<string, unknown>).setTileRainbow).toBeUndefined();
  });

  it("clearAllColors and hasAnyColor operate on tileColors alone", () => {
    const view = mount(fullPuzzle);
    expect(view.result.current.hasAnyColor).toBe(false);
    act(() => view.result.current.setTileColor("y1", "yellow"));
    expect(view.result.current.hasAnyColor).toBe(true);
    act(() => view.result.current.clearAllColors());
    expect(view.result.current.tileColors).toEqual({});
    expect(view.result.current.hasAnyColor).toBe(false);
  });

  it("a legacy blob carrying the obsolete tileRainbowMarks property loads without error and ignores it", () => {
    const storageId = progressStorageId(FULL_ID, FULL_FORMAT, "custom");
    localStorage.setItem(
      progressKey(storageId),
      JSON.stringify({
        solvedGroups: [],
        mistakes: 0,
        guessHistory: [],
        gotRainbow: false,
        shuffledWords: fullPuzzle.groups.flatMap((g) => g.words),
        rainbowWords: [],
        tileColors: { y1: "yellow" },
        // Obsolete field from the earlier, incorrect implementation —
        // must be safely ignored, not crash or resurrect any behavior.
        tileRainbowMarks: { y2: true },
      })
    );
    const view = mount(fullPuzzle);
    expect(view.result.current.tileColors.y1).toBe("yellow");
    expect((view.result.current as Record<string, unknown>).tileRainbowMarks).toBeUndefined();

    const saved = loadProgress(storageId);
    expect(saved?.tileColors?.y1).toBe("yellow");
  });
});
