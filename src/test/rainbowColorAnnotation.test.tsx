/**
 * The Rainbow-mark + regular-color dual annotation feature end to end:
 *
 *   - useGame's tileColors and tileRainbowMarks are independent state (no
 *     combination values) — setting/clearing one never touches the other.
 *   - That state persists and restores across a remount (the same
 *     localStorage progress blob both already use), and a legacy blob saved
 *     before tileRainbowMarks existed restores as "nothing marked" rather
 *     than crashing.
 *   - The real GameBoard UI (palette swatches, eraser, Clear Colors) drives
 *     both dimensions correctly, in both Full and Mini, through the shared
 *     WordTile component.
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

const PUZZLE_ID = "annot-puzzle-1";
const fullPuzzle: Puzzle = {
  id: PUZZLE_ID,
  date: "2026-09-22",
  designerName: "Sam West",
  alphabetizeCompleted: true,
  groups: [
    { category: "Yellow Things", words: ["y1", "y2", "y3", "y4"], difficulty: 1, hintWord: "yh" },
    { category: "Green Things", words: ["g1", "g2", "g3", "g4"], difficulty: 2, hintWord: "gh" },
    { category: "Blue Things", words: ["b1", "b2", "b3", "b4"], difficulty: 3, hintWord: "bh" },
    { category: "Red Things", words: ["r1", "r2", "r3", "r4"], difficulty: 4, hintWord: "rh" },
  ],
  rainbowHerring: null,
};

const MINI_ID = "annot-mini-1";
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
  rainbowHerring: null,
};

function mount(p: Puzzle) {
  return renderHook(({ o }) => useGame(p, o as never), { initialProps: { o: { mode: "custom" as const } } });
}

beforeEach(() => {
  localStorage.clear();
  sessionStorage.clear();
});

describe("tileColors and tileRainbowMarks are independent state", () => {
  it("Rainbow only: marks the word without touching tileColors", () => {
    const view = mount(fullPuzzle);
    act(() => view.result.current.setTileRainbow("y1", true));
    expect(view.result.current.tileRainbowMarks.y1).toBe(true);
    expect(view.result.current.tileColors.y1 ?? null).toBeNull();
  });

  it("Regular color only: sets tileColors without touching tileRainbowMarks", () => {
    const view = mount(fullPuzzle);
    act(() => view.result.current.setTileColor("y1", "yellow"));
    expect(view.result.current.tileColors.y1).toBe("yellow");
    expect(view.result.current.tileRainbowMarks.y1 ?? false).toBe(false);
  });

  it.each(["yellow", "green", "blue", "red"] as const)(
    "Rainbow + %s: both dimensions hold simultaneously",
    (color) => {
      const view = mount(fullPuzzle);
      act(() => {
        view.result.current.setTileRainbow("y1", true);
        view.result.current.setTileColor("y1", color);
      });
      expect(view.result.current.tileRainbowMarks.y1).toBe(true);
      expect(view.result.current.tileColors.y1).toBe(color);
    }
  );

  it("replacing a Rainbow tile's regular color leaves the Rainbow mark untouched", () => {
    const view = mount(fullPuzzle);
    act(() => {
      view.result.current.setTileRainbow("y1", true);
      view.result.current.setTileColor("y1", "green");
    });
    expect(view.result.current.tileColors.y1).toBe("green");
    act(() => view.result.current.setTileColor("y1", "blue"));
    expect(view.result.current.tileColors.y1).toBe("blue");
    expect(view.result.current.tileRainbowMarks.y1).toBe(true);
  });

  it("removing the Rainbow mark retains the regular color", () => {
    const view = mount(fullPuzzle);
    act(() => {
      view.result.current.setTileRainbow("y1", true);
      view.result.current.setTileColor("y1", "red");
    });
    act(() => view.result.current.setTileRainbow("y1", false));
    expect(view.result.current.tileRainbowMarks.y1).toBe(false);
    expect(view.result.current.tileColors.y1).toBe("red");
  });

  it("clearAllColors (Clear Colors) resets both dimensions for every word", () => {
    const view = mount(fullPuzzle);
    act(() => {
      view.result.current.setTileRainbow("y1", true);
      view.result.current.setTileColor("y1", "yellow");
      view.result.current.setTileColor("g1", "green");
      view.result.current.setTileRainbow("b1", true);
    });
    expect(view.result.current.hasAnyColor).toBe(true);
    act(() => view.result.current.clearAllColors());
    expect(view.result.current.tileColors).toEqual({});
    expect(view.result.current.tileRainbowMarks).toEqual({});
    expect(view.result.current.hasAnyColor).toBe(false);
  });

  it("hasAnyColor is true from a Rainbow mark alone, with no regular color anywhere", () => {
    const view = mount(fullPuzzle);
    expect(view.result.current.hasAnyColor).toBe(false);
    act(() => view.result.current.setTileRainbow("y1", true));
    expect(view.result.current.hasAnyColor).toBe(true);
  });
});

describe("refresh/restoration compatibility", () => {
  it("both annotations survive an unmount + remount (refresh)", () => {
    const first = mount(fullPuzzle);
    act(() => {
      first.result.current.setTileRainbow("y1", true);
      first.result.current.setTileColor("y1", "yellow");
      first.result.current.setTileColor("g1", "green");
    });
    first.unmount();

    const second = mount(fullPuzzle);
    expect(second.result.current.tileRainbowMarks.y1).toBe(true);
    expect(second.result.current.tileColors.y1).toBe("yellow");
    expect(second.result.current.tileColors.g1).toBe("green");
  });

  it("a legacy saved blob with no tileRainbowMarks field restores as nothing marked", () => {
    // Simulates a progress row saved by a build before this feature existed:
    // tileColors present, tileRainbowMarks entirely absent.
    const storageId = progressStorageId(PUZZLE_ID, FULL_FORMAT, "custom");
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
        // tileRainbowMarks intentionally omitted.
      })
    );
    const view = mount(fullPuzzle);
    expect(view.result.current.tileColors.y1).toBe("yellow");
    expect(view.result.current.tileRainbowMarks).toEqual({});
    expect(view.result.current.hasAnyColor).toBe(true);

    // Also verify the raw persisted blob itself doesn't error/lose data.
    const saved = loadProgress(storageId);
    expect(saved?.tileColors?.y1).toBe("yellow");
  });
});

// ── GameBoard UI, through the real palette row (Full + Mini) ────────────────
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

describe("GameBoard palette row drives both annotations (Full)", () => {
  it("Rainbow paint alone renders the gradient with no ring", () => {
    const { container } = renderBoard(fullPuzzle);
    fireEvent.click(screen.getByLabelText("Rainbow paint"));
    fireEvent.click(tileButton(container, "y1"));
    const btn = tileButton(container, "y1");
    expect(btn.className).toContain("rainbow-tile");
    expect(ring(container, "y1")).toBeNull();
  });

  it("Rainbow then a category color adds a matching ring, keeping the gradient", () => {
    const { container } = renderBoard(fullPuzzle);
    fireEvent.click(screen.getByLabelText("Rainbow paint"));
    fireEvent.click(tileButton(container, "y1"));
    fireEvent.click(screen.getByLabelText("Yellow paint"));
    fireEvent.click(tileButton(container, "y1"));

    const btn = tileButton(container, "y1");
    expect(btn.className).toContain("rainbow-tile");
    const r = ring(container, "y1");
    expect(r).not.toBeNull();
    expect(r!.className).toContain("border-group-1");
  });

  it("the Eraser clears both a Rainbow mark and a category color together", () => {
    const { container } = renderBoard(fullPuzzle);
    fireEvent.click(screen.getByLabelText("Rainbow paint"));
    fireEvent.click(tileButton(container, "y1"));
    fireEvent.click(screen.getByLabelText("Yellow paint"));
    fireEvent.click(tileButton(container, "y1"));
    expect(ring(container, "y1")).not.toBeNull();

    fireEvent.click(screen.getByLabelText("Eraser"));
    fireEvent.click(tileButton(container, "y1"));

    const btn = tileButton(container, "y1");
    expect(btn.className).not.toContain("rainbow-tile");
    expect(ring(container, "y1")).toBeNull();
  });

  it("Clear Colors removes a Rainbow+color combo entirely", () => {
    const { container } = renderBoard(fullPuzzle);
    fireEvent.click(screen.getByLabelText("Rainbow paint"));
    fireEvent.click(tileButton(container, "y1"));
    fireEvent.click(screen.getByLabelText("Blue paint"));
    fireEvent.click(tileButton(container, "y1"));
    expect(ring(container, "y1")).not.toBeNull();

    fireEvent.click(screen.getByRole("button", { name: /clear colors/i }));

    const btn = tileButton(container, "y1");
    expect(btn.className).not.toContain("rainbow-tile");
    expect(ring(container, "y1")).toBeNull();
  });

  it("selecting a Rainbow+color tile shows the selection border alongside the still-visible ring", () => {
    const { container } = renderBoard(fullPuzzle);
    fireEvent.click(screen.getByLabelText("Rainbow paint"));
    fireEvent.click(tileButton(container, "y1"));
    fireEvent.click(screen.getByLabelText("Green paint"));
    fireEvent.click(tileButton(container, "y1"));

    // Back to Select mode, then select the tile (toggles selection, not paint).
    fireEvent.click(screen.getByLabelText("Select mode"));
    fireEvent.click(tileButton(container, "y1"));

    const btn = tileButton(container, "y1");
    expect(btn.getAttribute("aria-pressed")).toBe("true");
    expect(btn.className).toContain("border-foreground");
    const r = ring(container, "y1");
    expect(r).not.toBeNull();
    expect(r!.className).toContain("border-group-2");
  });
});

describe("GameBoard palette row drives both annotations (Mini)", () => {
  it("Rainbow + a category color renders both the gradient and the ring on a Mini board", () => {
    const { container } = renderBoard(miniPuzzle);
    fireEvent.click(screen.getByLabelText("Rainbow paint"));
    fireEvent.click(tileButton(container, "mg1"));
    fireEvent.click(screen.getByLabelText("Red paint"));
    fireEvent.click(tileButton(container, "mg1"));

    const btn = tileButton(container, "mg1");
    expect(btn.className).toContain("rainbow-tile");
    const r = ring(container, "mg1");
    expect(r).not.toBeNull();
    expect(r!.className).toContain("border-group-4");
  });

  it("the Eraser clears both annotations on a Mini board too", () => {
    const { container } = renderBoard(miniPuzzle);
    fireEvent.click(screen.getByLabelText("Rainbow paint"));
    fireEvent.click(tileButton(container, "mb1"));
    fireEvent.click(screen.getByLabelText("Blue paint"));
    fireEvent.click(tileButton(container, "mb1"));
    fireEvent.click(screen.getByLabelText("Eraser"));
    fireEvent.click(tileButton(container, "mb1"));

    const btn = tileButton(container, "mb1");
    expect(btn.className).not.toContain("rainbow-tile");
    expect(ring(container, "mb1")).toBeNull();
  });
});
