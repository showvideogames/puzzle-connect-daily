/**
 * Gameplay polish: stable palette position, once-only hints (with view-only
 * hints after the puzzle is resolved) and solid text on coloured backgrounds.
 *
 * Runs the REAL useGame hook and GameBoard against the in-memory Supabase
 * fake, the same way durableSession.test.ts does.
 */
import { describe, it, expect, beforeEach, vi } from "vitest";
import { act, fireEvent, render, renderHook, screen } from "@testing-library/react";
import fs from "node:fs";
import path from "node:path";
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
import { SolvedGroup } from "@/components/SolvedGroup";
import { HintModal } from "@/components/HintModal";
import { dedupeHintMarkers } from "@/lib/hints";
import { loadProgress, progressKey, saveProgress } from "@/lib/gameProgress";

const PUZZLE_ID = "puzzle-1";
const puzzle: Puzzle = {
  id: PUZZLE_ID,
  date: "2026-09-16",
  designerName: "Sam West",
  alphabetizeCompleted: true,
  groups: [
    { category: "Yellow Things", words: ["y1", "y2", "y3", "y4"], difficulty: 1, hintWord: "yh" },
    { category: "Green Things", words: ["g1", "g2", "g3", "g4"], difficulty: 2, hintWord: "gh" },
    { category: "Blue Things", words: ["b1", "b2", "b3", "b4"], difficulty: 3, hintWord: "bh" },
    { category: "Red Things", words: ["r1", "r2", "r3", "r4"], difficulty: 4, hintWord: "rh" },
  ],
  rainbowHerring: ["y1", "g1", "b1", "r1"],
  rainbowCategoryName: "Rainbow",
};

const hints = () => db.tables.hint_events;
const sessions = () => db.tables.game_sessions;

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

function mount(p: Puzzle = puzzle, opts: Record<string, unknown> = {}) {
  return renderHook(({ o }) => useGame(p, o as never), { initialProps: { o: opts } });
}

async function guess(view: ReturnType<typeof mount>, words: string[]) {
  await act(async () => view.result.current.deselectAll());
  await act(async () => {
    for (const w of words) view.result.current.toggleWord(w);
  });
  await act(async () => view.result.current.submitGuess());
  await settle();
}

async function solveAllFour(view: ReturnType<typeof mount>) {
  for (const g of puzzle.groups) await guess(view, g.words);
}

beforeEach(async () => {
  reduceMotion();
  for (let i = 0; i < 5; i++) await new Promise((r) => setTimeout(r, 10));
  for (const t of ["game_sessions", "guess_events", "hint_events", "game_results", "user_streaks", "device_identities", "account_onboarding", "puzzle_aggregates"]) {
    db.tables[t] = [];
  }
  db.failAggregateWrites = 0;
  db.rpcUnavailable = false;
  const { data } = await db.rpc("create_device_identity");
  const id = (Array.isArray(data) ? data[0] : data) as { device_id: string; device_token: string };
  localStorage.clear();
  sessionStorage.clear();
  localStorage.setItem("rc-device-id", id.device_id);
  localStorage.setItem("rc-device-token", id.device_token);
  db.tables.puzzles = [{ id: PUZZLE_ID, rainbow_herring: puzzle.rainbowHerring, is_published: true }];
  db.signIn(null);
  db.writeLog = [];
  db.rpcLog = [];
});

const markers = (view: ReturnType<typeof mount>, type: "small" | "full") =>
  view.result.current.state.guessHistory.filter((g) => g.isHintMarker && g.hintType === type);

// ── 2. HINTS: ONCE PER RUN ─────────────────────────────────────────────────
describe("each hint type affects a run only once", () => {
  it("reopening a puzzle and clicking a used hint again adds no second marker or event", async () => {
    for (const type of ["small", "full"] as const) {
      const flag = type === "small" ? "smallHintUsed" : "fullHintUsed";
      db.tables.hint_events = [];
      localStorage.removeItem(progressKey(PUZZLE_ID));
      const first = mount(puzzle, { [flag]: false });
      await act(async () => first.rerender({ o: { [flag]: true } }));
      await settle();
      expect(markers(first, type)).toHaveLength(1);
      first.unmount();

      // Reopen: the page's flag starts false again, then the player clicks the hint again.
      const second = mount(puzzle, { [flag]: false });
      await settle();
      expect(markers(second, type)).toHaveLength(1); // hydrated, not re-added
      await act(async () => second.rerender({ o: { [flag]: true } }));
      await settle();
      expect(markers(second, type)).toHaveLength(1);
      expect(hints().filter((h) => h.hint_type === type)).toHaveLength(1);
      second.unmount();
    }
  });

  it("repeated clicks in one mount add exactly one marker", async () => {
    const view = mount(puzzle, { smallHintUsed: false, fullHintUsed: false });
    for (let i = 0; i < 3; i++) {
      await act(async () => view.rerender({ o: { smallHintUsed: false, fullHintUsed: false } }));
      await act(async () => view.rerender({ o: { smallHintUsed: true, fullHintUsed: true } }));
    }
    await settle();
    expect(markers(view, "small")).toHaveLength(1);
    expect(markers(view, "full")).toHaveLength(1);
    expect(hints()).toHaveLength(2);
  });

  it("a restored blob that already holds duplicate markers is healed on load", async () => {
    const view = mount(puzzle, { smallHintUsed: true });
    await settle();
    view.unmount();
    const saved = loadProgress(PUZZLE_ID)!;
    const marker = saved.guessHistory.find((g) => g.isHintMarker)!;
    saveProgress(PUZZLE_ID, { ...saved, guessHistory: [marker, marker, marker] });

    const restored = mount(puzzle, {});
    await settle();
    expect(markers(restored, "small")).toHaveLength(1);
  });

  it("dedupeHintMarkers keeps the first of each type and never touches guesses", () => {
    const g = { words: ["a"], groupIndices: [0], isCorrect: true };
    const s = { words: [], groupIndices: [], isCorrect: false, isHintMarker: true, hintType: "small" as const };
    const f = { ...s, hintType: "full" as const };
    expect(dedupeHintMarkers([s, g, s, f, f, g, s])).toEqual([s, g, f, g]);
    const clean = [g, s, f];
    expect(dedupeHintMarkers(clean)).toBe(clean);
  });
});

// ── 2b. POST-COMPLETION HINTS ARE VIEW-ONLY ────────────────────────────────
describe("after the puzzle is fully resolved, hints are view-only", () => {
  async function resolvedGame() {
    const view = mount(puzzle, { smallHintUsed: false, fullHintUsed: false });
    await solveAllFour(view);
    // Rainbow resolved (won or failed) is what unlocks view-only hints.
    await act(async () => view.rerender({ o: { smallHintUsed: false, fullHintUsed: false, rainbowResolved: true } }));
    await settle();
    return view;
  }

  it("shows the hint but writes nothing and changes nothing about the result", async () => {
    const view = await resolvedGame();
    expect(view.result.current.hintsViewOnly).toBe(true);
    const historyBefore = JSON.stringify(view.result.current.state.guessHistory);
    const stateBefore = { ...view.result.current.state, guessHistory: undefined };
    const progressBefore = localStorage.getItem(progressKey(PUZZLE_ID));
    const hintEventsBefore = hints().length;
    const sessionsBefore = JSON.stringify(sessions());
    const writesBefore = db.writeLog.length;
    const rpcsBefore = db.rpcLog.length;

    await act(async () =>
      view.rerender({ o: { smallHintUsed: true, fullHintUsed: true, rainbowResolved: true } })
    );
    await settle();

    // The hint is shown...
    expect(view.result.current.smallHintVisible).toBe(true);
    expect(view.result.current.fullHintVisible).toBe(true);
    // ...but it is not recorded as used anywhere.
    expect(view.result.current.effectiveSmallHintUsed).toBe(false);
    expect(view.result.current.effectiveFullHintUsed).toBe(false);
    expect(JSON.stringify(view.result.current.state.guessHistory)).toBe(historyBefore);
    expect({ ...view.result.current.state, guessHistory: undefined }).toEqual(stateBefore);
    expect(localStorage.getItem(progressKey(PUZZLE_ID))).toBe(progressBefore);
    expect(hints()).toHaveLength(hintEventsBefore);
    expect(JSON.stringify(sessions())).toBe(sessionsBefore);
    expect(db.writeLog.length).toBe(writesBefore);
    expect(db.rpcLog.length).toBe(rpcsBefore);
    const s = sessions()[0];
    expect(s.hints_used).toBe(false);
    expect(loadProgress(PUZZLE_ID)!.smallHintUsed).toBeFalsy();
    expect(loadProgress(PUZZLE_ID)!.fullHintUsed).toBeFalsy();
  });

  it("a completed board with the Rainbow still to play is NOT yet view-only", async () => {
    const view = mount(puzzle, {});
    await solveAllFour(view);
    expect(view.result.current.state.isComplete).toBe(true);
    expect(view.result.current.state.gotRainbow).toBe(false);
    expect(view.result.current.hintsViewOnly).toBe(false);
  });

  it("a puzzle with no Rainbow is view-only as soon as the board is complete", async () => {
    const plain: Puzzle = { ...puzzle, id: "puzzle-plain", rainbowHerring: null };
    db.tables.puzzles.push({ id: "puzzle-plain", rainbow_herring: null, is_published: true });
    const view = mount(plain, {});
    for (const g of plain.groups) await guess(view, g.words);
    expect(view.result.current.hintsViewOnly).toBe(true);
  });

  it("hints used BEFORE completion stay recorded and shown", async () => {
    const view = mount(puzzle, { smallHintUsed: false });
    await act(async () => view.rerender({ o: { smallHintUsed: true } }));
    await settle();
    await solveAllFour(view);
    expect(view.result.current.effectiveSmallHintUsed).toBe(true);
    expect(markers(view, "small")).toHaveLength(1);
    expect(hints()).toHaveLength(1);
  });

  it("the modal says it is just a look and no longer shows the goose block", () => {
    render(
      <HintModal open onClose={() => {}} onSmallHint={() => {}} onFullHint={() => {}} puzzle={puzzle} viewOnly />
    );
    expect(screen.getByText(/won't change your result/i)).toBeTruthy();
    expect(screen.queryByText(/silly goose/i)).toBeNull();
  });
});

// ── 1. PALETTE POSITION (real GameBoard) ───────────────────────────────────
describe("colour palette stays put as categories are solved", () => {
  const settings = { colorPaletteMode: true } as never;

  function renderBoard() {
    return render(
      <MemoryRouter>
        <GameBoard puzzle={puzzle} settings={settings} customMode showModeBadge={false} />
      </MemoryRouter>
    );
  }

  const tileButton = (container: HTMLElement, word: string) =>
    container.querySelector(`[data-word="${word}"] button`) as HTMLButtonElement;

  async function solveGroup(container: HTMLElement, words: string[]) {
    for (const w of words) await act(async () => { fireEvent.click(tileButton(container, w)); });
    await act(async () => { fireEvent.click(screen.getByRole("button", { name: /^submit$/i })); });
    await settle();
  }

  const before = (a: Element, b: Element) => !!(a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING);

  it("keeps instruction, palette, solved bars, board in that order after every solve", async () => {
    const { container } = renderBoard();
    await settle();

    const instruction = () => screen.getByText(/select four words that share a connection/i);
    const palette = () => screen.getByLabelText("Select mode").parentElement as HTMLElement;
    const paletteTop = () => palette().getBoundingClientRect().top;

    expect(before(instruction(), palette())).toBe(true);
    expect(before(palette(), tileButton(container, "y1"))).toBe(true);

    for (const [i, g] of puzzle.groups.slice(0, 3).entries()) {
      const paletteNodeBefore = palette();
      await solveGroup(container, g.words);
      // The very same node, still directly after the instruction...
      expect(palette()).toBe(paletteNodeBefore);
      expect(before(instruction(), palette())).toBe(true);
      // ...and before every solved bar and before the remaining board.
      const bar = screen.getByText(g.category.toUpperCase(), { exact: false });
      expect(before(palette(), bar)).toBe(true);
      const remaining = puzzle.groups[i + 1].words[0];
      expect(before(bar, tileButton(container, remaining))).toBe(true);
      expect(before(palette(), tileButton(container, remaining))).toBe(true);
      void paletteTop;
    }
  });
});

// ── 3. SOLID TEXT ON COLOURED BACKGROUNDS ──────────────────────────────────
describe("text on coloured backgrounds is solid Ink", () => {
  const css = fs.readFileSync(path.resolve(__dirname, "../index.css"), "utf8");

  it("all four category text tokens are exactly Ink #292825 and are not redefined for dark mode", () => {
    const root = css.slice(css.indexOf(":root"), css.indexOf(".dark"));
    const dark = css.slice(css.indexOf(".dark"));
    for (const n of [1, 2, 3, 4]) {
      expect(root).toMatch(new RegExp(`--group-${n}-fg:\\s*45 5\\.128% 15\\.294%;`));
      expect(dark).not.toMatch(new RegExp(`--group-${n}-fg:`));
    }
    // hsl(45 5.128% 15.294%) == #292825
    const [h, s, l] = [45, 0.05128, 0.15294];
    const a = s * Math.min(l, 1 - l);
    const f = (n: number) => {
      const k = (n + h / 30) % 12;
      return Math.round(255 * (l - a * Math.max(-1, Math.min(k - 3, 9 - k, 1))));
    };
    const hex = [f(0), f(8), f(4)].map((v) => v.toString(16).padStart(2, "0")).join("");
    expect(hex).toBe("292825");
  });

  it("a solved category bar puts no opacity on any element that holds text", () => {
    const { container } = render(<SolvedGroup group={puzzle.groups[0]} />);
    const bar = container.firstElementChild as HTMLElement;
    expect(bar.className).toContain("text-group-1-fg");
    for (const el of [bar, ...Array.from(bar.querySelectorAll("*"))]) {
      expect(String((el as HTMLElement).className)).not.toMatch(/(^|\s)opacity-/);
      expect((el as HTMLElement).style.opacity).toBe("");
    }
  });

  it("a hand-painted tile uses the pastel group wash and Ink, with no opacity class", () => {
    const { container } = render(
      <MemoryRouter>
        <GameBoard puzzle={puzzle} settings={{ colorPaletteMode: true } as never} customMode showModeBadge={false} />
      </MemoryRouter>
    );
    fireEvent.click(screen.getByLabelText("Yellow paint"));
    const btn = container.querySelector('[data-word="y1"] button') as HTMLButtonElement;
    fireEvent.click(btn);
    expect(btn.className).toContain("tile-paint-1");
    expect(btn.className).toContain("text-group-1-fg");
    expect(btn.className).not.toMatch(/(^|\s)opacity-/);
    // The softness is a lighter colour, not a translucent or opacity class.
    expect(btn.className).not.toMatch(/bg-group-1/);
    expect(btn.className).not.toMatch(/tile-paint-1\//);
  });
});
