/**
 * Three categories solved is never a loss.
 *
 * With three categories solved, the only words left on the board are the
 * last category, so the next submission is necessarily correct. Leaving at
 * that point is an UNFINISHED game; pressing Submit on the last four is a
 * WIN. A genuine loss therefore solves zero, one or two categories, and the
 * Lucky Bot loss formula only ever sees those.
 *
 * Runs the REAL useGame hook (and, for the locked board, GameBoard) against
 * the in-memory Supabase fake, the same way durableSession.test.ts does.
 */
import { describe, it, expect, beforeEach, vi } from "vitest";
import { act, render, renderHook, screen } from "@testing-library/react";
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
import { loadProgress, clearProgress } from "@/lib/gameProgress";
import { skillScoreForGame } from "@/lib/skillScore";

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
const [Y, G, B, R] = puzzle.groups.map((g) => g.words);

const sessions = () => db.tables.game_sessions;
const finalizeCalls = () => db.rpcLog.filter((name) => name === "finalize_game_session");

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

function mount() {
  return renderHook(() => useGame(puzzle, {}));
}

async function guess(view: ReturnType<typeof mount>, words: string[]) {
  await act(async () => view.result.current.deselectAll());
  await act(async () => {
    for (const w of words) view.result.current.toggleWord(w);
  });
  await act(async () => view.result.current.submitGuess());
  await settle();
  // GameBoard releases a solved category's tiles once its animation ends;
  // with no board mounted, do it here.
  await act(async () => view.result.current.releaseRevealHold());
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

describe("three categories solved is never a loss", () => {
  it("leaving after three categories is unfinished; submitting the last four is a win", async () => {
    const first = mount();
    await settle();
    await guess(first, ["y1", "g2", "b3", "r4"]); // one mistake
    await guess(first, Y);
    await guess(first, G);
    await guess(first, B);

    const s = first.result.current.state;
    expect(s.solvedGroups).toHaveLength(3);
    expect(s.mistakes).toBe(1);
    expect(s.isComplete).toBe(false);
    expect(s.isWon).toBe(false);
    // Only the last category's words are left.
    expect([...first.result.current.remainingWords].sort()).toEqual(R);

    // Leave.
    const storageId = first.result.current.storageId;
    first.unmount();
    await settle();

    expect(sessions()).toHaveLength(1);
    expect(sessions()[0].status).toBe("in_progress");
    expect(sessions()[0].won).toBeNull();
    expect(finalizeCalls()).toHaveLength(0);
    expect(loadProgress(storageId)?.isComplete).toBe(false);

    // Come back: still unfinished, still waiting for the last four.
    const again = mount();
    await settle();
    expect(again.result.current.state.isComplete).toBe(false);
    expect(again.result.current.state.solvedGroups).toHaveLength(3);
    expect([...again.result.current.remainingWords].sort()).toEqual(R);
    expect(finalizeCalls()).toHaveLength(0);

    // The last category still has to be submitted — and it wins.
    await guess(again, R);
    expect(again.result.current.state.isComplete).toBe(true);
    expect(again.result.current.state.isWon).toBe(true);
    expect(again.result.current.state.mistakes).toBe(1);
    await settle();
    expect(finalizeCalls()).toHaveLength(1);
    expect(sessions()[0].status).toBe("won");
    expect(sessions()[0].won).toBe(true);
    expect(sessions()[0].solve_order).toEqual(["orange", "green", "blue", "red"]);
  });

  it("does not complete the game until Submit is pressed on the last four", async () => {
    const view = mount();
    await settle();
    for (const g of [Y, G, B]) await guess(view, g);
    await act(async () => {
      for (const w of R) view.result.current.toggleWord(w);
    });
    await settle();
    expect(view.result.current.state.selectedWords).toHaveLength(4);
    expect(view.result.current.state.isComplete).toBe(false);
    expect(finalizeCalls()).toHaveLength(0);
  });

  it("on the real board, three solved leaves only the last four tiles, even with three mistakes", async () => {
    const { container } = render(
      <MemoryRouter>
        <GameBoard puzzle={puzzle} settings={{} as never} showModeBadge={false} />
      </MemoryRouter>
    );
    await settle();
    const tile = (w: string) => container.querySelector(`[data-word="${w}"] button`) as HTMLButtonElement | null;
    const submit = () => screen.getByRole("button", { name: "Submit" });
    async function play(words: string[]) {
      // A wrong guess stays selected on the board, so clear it first.
      const deselect = screen.getByRole("button", { name: "Deselect All" });
      if (!deselect.hasAttribute("disabled")) {
        await act(async () => {
          deselect.click();
        });
      }
      for (const w of words) {
        await act(async () => {
          tile(w)!.click();
        });
      }
      await act(async () => {
        submit().click();
      });
      await settle();
    }

    await play(["y1", "g2", "b3", "r4"]);
    await play(["y2", "g3", "b4", "r1"]);
    await play(["y3", "g4", "b1", "r2"]);
    for (const g of [Y, G, B]) await play(g);

    // Only the last category's tiles are on the board: no other four words
    // exist to make a fourth mistake with.
    const onBoard = [...container.querySelectorAll("[data-word]")].map((el) => el.getAttribute("data-word")).sort();
    expect(onBoard).toEqual(R);
    expect(screen.queryByText(/Valiant effort/)).toBeNull();
    expect(finalizeCalls()).toHaveLength(0);
    expect(sessions()[0].status).toBe("in_progress");

    // Pressing Submit on the last four is a win with three mistakes.
    await play(R);
    await settle();
    expect(sessions()[0].status).toBe("won");
    expect(sessions()[0].mistakes).toBe(3);
  }, 30000);

  it("a genuine loss keeps only the categories actually solved, not the ones revealed after", async () => {
    const view = mount();
    await settle();
    await guess(view, Y);
    await guess(view, G);
    for (const w of [["b1", "b2", "r1", "r2"], ["b1", "b3", "r1", "r3"], ["b1", "b4", "r1", "r4"], ["b2", "b3", "r2", "r3"]]) {
      await guess(view, w);
    }
    expect(view.result.current.state.isComplete).toBe(true);
    expect(view.result.current.state.isWon).toBe(false);
    await settle();
    expect(sessions()[0].status).toBe("lost");
    expect(sessions()[0].solve_order).toEqual(["orange", "green"]);

    // The board then reveals Blue and Red into solvedGroups on a timer.
    await act(async () => {
      await new Promise((r) => setTimeout(r, 2600));
    });
    expect(view.result.current.state.solvedGroups).toHaveLength(4);
    // Skill still counts only Yellow and Green: 50 + 4 + 6.
    const skill = skillScoreForGame(view.result.current.state, puzzle);
    expect(skill.score).toBe(60);
    expect(skill.lines.map((l) => l.label)).toEqual(["Didn't finish the board", "Solved Yellow", "Solved Green"]);
  }, 10000);

  it("a board locked by a result this browser has no copy of is not shown as a loss", async () => {
    // Win the puzzle officially, then lose the local copy (a cleared
    // browser that still holds the same identity).
    const played = mount();
    await settle();
    for (const g of [Y, G, B, R]) await guess(played, g);
    await settle();
    expect(sessions()[0].status).toBe("won");
    const storageId = played.result.current.storageId;
    played.unmount();
    clearProgress(storageId);

    render(
      <MemoryRouter>
        <GameBoard puzzle={puzzle} settings={{} as never} showModeBadge={false} />
      </MemoryRouter>
    );
    await settle();

    expect(screen.getByTestId("already-finished").textContent).toBe(
      "You've already finished this puzzle. Come back tomorrow!"
    );
    expect(screen.queryByText(/Valiant effort/)).toBeNull();
    expect(screen.queryByText(/Almost had it/)).toBeNull();
    expect(screen.queryByText("Find one word from each group")).toBeNull();
    expect(screen.queryByTestId("lucky-bot-card")).toBeNull();
  });
});
