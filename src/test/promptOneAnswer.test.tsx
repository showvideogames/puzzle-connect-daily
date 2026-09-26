/**
 * The post-game "Spot the Rainbow" prompt: one answer per completed Full game.
 *
 * After a right or wrong answer, a refresh or a later visit shows the
 * outcome and never offers the prompt again. A wrong answer keeps revealing
 * the Rainbow, and re-entering that revealed answer can never earn the +1
 * Skill point. Mini keeps its original prompt behaviour.
 *
 * Runs the REAL GameBoard (with its Lucky Bot card) against the in-memory
 * Supabase fake. The database's own refusal of a second answer is pinned in
 * bonusRainbowPersistence.test.ts and e2e/scripts/verify-db.ts.
 */
import { describe, it, expect, beforeEach, vi } from "vitest";
import { act, render, screen, within } from "@testing-library/react";
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

import { GameBoard } from "@/components/GameBoard";
import { promptAnswerKey } from "@/lib/gameProgress";

const FULL: Puzzle = {
  id: "puzzle-1",
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
  rainbowCategoryName: "Hidden Link",
};

const MINI = {
  id: "mini-1",
  date: "2026-09-16",
  format: "mini",
  designerName: "Sam West",
  alphabetizeCompleted: true,
  groups: [
    { category: "Green Things", words: ["g1", "g2", "g3"], difficulty: 2, hintWord: "gh" },
    { category: "Blue Things", words: ["b1", "b2", "b3"], difficulty: 3, hintWord: "bh" },
    { category: "Red Things", words: ["r1", "r2", "r3"], difficulty: 4, hintWord: "rh" },
  ],
  rainbowHerring: ["g1", "b1", "r1"],
  rainbowCategoryName: "Hidden Link",
} as unknown as Puzzle;

const PROMPT = "Find one word from each group";
const promptRows = () => db.tables.guess_events.filter((g) => g.attempt_type === "bonus_rainbow");
const promptSaves = () => db.rpcLog.filter((name) => name === "record_bonus_rainbow").length;

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

async function settle(ms = 0) {
  await act(async () => {
    if (ms) await new Promise((r) => setTimeout(r, ms));
    for (let i = 0; i < 25; i++) await new Promise((r) => setTimeout(r, 0));
  });
}

function renderBoard(puzzle: Puzzle) {
  return render(
    <MemoryRouter>
      <GameBoard puzzle={puzzle} settings={{} as never} showModeBadge={false} />
    </MemoryRouter>
  );
}

async function click(el: HTMLElement) {
  await act(async () => {
    el.click();
  });
}

async function winOnTheBoard(container: HTMLElement, puzzle: Puzzle) {
  for (const g of puzzle.groups) {
    for (const w of g.words) await click(container.querySelector(`[data-word="${w}"] button`) as HTMLElement);
    await click(screen.getByRole("button", { name: "Submit" }));
    await settle();
  }
  await settle(300);
}

/** Opens the prompt, picks the words and presses Submit. */
async function submitPrompt(words: string[]) {
  await click(screen.getByText(PROMPT));
  const dialog = screen.getByRole("dialog");
  for (const w of words) await click(within(dialog).getByRole("button", { name: w }));
  await click(within(dialog).getByRole("button", { name: "Submit" }));
}

const skill = () => screen.getByTestId("skill-score").textContent;

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
  db.tables.puzzles = [
    { id: FULL.id, rainbow_herring: FULL.rainbowHerring, is_published: true },
    { id: MINI.id, rainbow_herring: MINI.rainbowHerring, is_published: true, format: "mini" },
  ];
  db.signIn(null);
  db.writeLog = [];
  db.rpcLog = [];
});

describe("Full: one post-game Rainbow answer per game", () => {
  it("a wrong answer reveals the Rainbow, and after a refresh the prompt is not offered again", async () => {
    const first = renderBoard(FULL);
    await settle();
    await winOnTheBoard(first.container, FULL);
    expect(skill()).toBe("95");

    await submitPrompt(["y2", "g2", "b2", "r2"]);
    await settle(700);
    expect(screen.queryByText(PROMPT)).toBeNull();
    expect(screen.getByText("Hidden Link")).toBeTruthy();
    expect(promptRows()).toHaveLength(1);
    expect(skill()).toBe("95");
    first.unmount();

    // Refresh.
    renderBoard(FULL);
    await settle(300);
    expect(screen.queryByText(PROMPT)).toBeNull();
    // The Rainbow stays revealed, as it was in the visit it was answered.
    expect(screen.getByText("Hidden Link")).toBeTruthy();
    expect(skill()).toBe("95");
    expect(promptRows()).toHaveLength(1);
  }, 30000);

  it("a right answer is found once, and after a refresh the prompt is not offered again", async () => {
    const first = renderBoard(FULL);
    await settle();
    await winOnTheBoard(first.container, FULL);

    await submitPrompt(["y1", "g1", "b1", "r1"]);
    await settle(1000);
    expect(screen.queryByText(PROMPT)).toBeNull();
    expect(skill()).toBe("96");
    first.unmount();

    renderBoard(FULL);
    await settle(300);
    expect(screen.queryByText(PROMPT)).toBeNull();
    expect(skill()).toBe("96");
    expect(promptRows().map((g) => g.correct)).toEqual([true]);
  }, 30000);

  it("a refresh in the moment right after a right answer still records the find, once", async () => {
    const first = renderBoard(FULL);
    await settle();
    await winOnTheBoard(first.container, FULL);

    await submitPrompt(["y1", "g1", "b1", "r1"]);
    // Leave before the answer reaches the board (it lands after ~0.4s).
    first.unmount();

    renderBoard(FULL);
    await settle(300);
    expect(screen.queryByText(PROMPT)).toBeNull();
    expect(skill()).toBe("96");
  }, 30000);

  it("a second press before the first answer's result appears opens nothing and saves nothing", async () => {
    const view = renderBoard(FULL);
    await settle();
    await winOnTheBoard(view.container, FULL);

    await submitPrompt(["y2", "g2", "b2", "r2"]);
    // The prompt button is still on screen for a moment; pressing it now
    // must not open a second prompt.
    const button = screen.getByText(PROMPT);
    await click(button);
    expect(screen.queryByRole("dialog")).toBeNull();
    await settle(700);
    expect(promptSaves()).toBe(1);
    expect(promptRows()).toHaveLength(1);
  }, 30000);
});

describe("Full: games answered by an older version of the app", () => {
  it("a game whose prompt was answered before this release is not offered the prompt again", async () => {
    const first = renderBoard(FULL);
    await settle();
    await winOnTheBoard(first.container, FULL);
    await submitPrompt(["y2", "g2", "b2", "r2"]);
    await settle(700);
    first.unmount();
    // The older app kept no record of the answer in the browser.
    localStorage.removeItem(promptAnswerKey(FULL.id));
    const saves = promptSaves();

    renderBoard(FULL);
    await settle(300);
    expect(screen.queryByText(PROMPT)).toBeNull();
    expect(screen.getByText("Hidden Link")).toBeTruthy();
    expect(skill()).toBe("95");
    expect(promptSaves()).toBe(saves);
  }, 30000);

  it("a finished game that never used its prompt still offers it when reopened", async () => {
    const first = renderBoard(FULL);
    await settle();
    await winOnTheBoard(first.container, FULL);
    first.unmount();

    renderBoard(FULL);
    await settle(300);
    expect(screen.getByText(PROMPT)).toBeTruthy();
  }, 30000);
});

describe("Mini keeps its original prompt behaviour", () => {
  it("offers the prompt again after a refresh", async () => {
    const first = renderBoard(MINI);
    await settle();
    await winOnTheBoard(first.container, MINI);
    await submitPrompt(["g2", "b2", "r2"]);
    await settle(700);
    expect(screen.queryByText(PROMPT)).toBeNull();
    first.unmount();

    renderBoard(MINI);
    await settle(300);
    expect(screen.getByText(PROMPT)).toBeTruthy();
  }, 30000);
});
