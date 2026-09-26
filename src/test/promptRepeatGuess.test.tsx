/**
 * The post-game "Spot the Rainbow" prompt refuses a repeated answer, the
 * same way the board refuses a repeated guess — including after a refresh.
 *
 * Within one visit the prompt closes after a single answer; the repeat can
 * only arise when a refresh brings the prompt back. The same words in any
 * order must then show "You already guessed these four words", save no new
 * try, and leave Lucky Bot's path unchanged. Different words still count.
 *
 * Runs the REAL GameBoard against the in-memory Supabase fake.
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
import { samePromptWords } from "@/lib/gameProgress";

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

function renderBoard() {
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

async function winOnTheBoard(container: HTMLElement) {
  for (const g of puzzle.groups) {
    for (const w of g.words) await click(container.querySelector(`[data-word="${w}"] button`) as HTMLElement);
    await click(screen.getByRole("button", { name: "Submit" }));
    await settle();
  }
}

/** Opens the prompt, picks words (in the given order), presses Submit. */
async function answerPrompt(words: string[]) {
  await click(screen.getByText("Find one word from each group"));
  const dialog = screen.getByRole("dialog");
  for (const w of words) await click(within(dialog).getByRole("button", { name: w }));
  await click(within(dialog).getByRole("button", { name: "Submit" }));
  // The board's shake/reveal delay, then the save.
  await settle(700);
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

describe("the post-game Rainbow prompt refuses a repeated answer", () => {
  it("after a refresh, the same words in any order are refused and not saved; different words still count", async () => {
    const first = renderBoard();
    await settle();
    await winOnTheBoard(first.container);
    await settle(300);

    await answerPrompt(["y2", "g2", "b2", "r2"]);
    expect(promptRows()).toHaveLength(1);
    // Within the visit the prompt is answered: the Rainbow is shown instead.
    expect(screen.queryByText("Find one word from each group")).toBeNull();
    first.unmount();

    // Refresh: the prompt comes back.
    renderBoard();
    await settle(300);
    const savesBefore = promptSaves();

    // Same four words, chosen in a different order.
    await click(screen.getByText("Find one word from each group"));
    const dialog = screen.getByRole("dialog");
    for (const w of ["r2", "b2", "y2", "g2"]) await click(within(dialog).getByRole("button", { name: w }));
    await click(within(dialog).getByRole("button", { name: "Submit" }));
    await settle(700);

    expect(within(dialog).getByTestId("prompt-already-guessed").textContent).toBe(
      "You already guessed these four words."
    );
    // Nothing was sent or saved, and the prompt is still open to try again.
    expect(promptSaves()).toBe(savesBefore);
    expect(promptRows()).toHaveLength(1);
    expect(screen.getByRole("dialog")).toBeTruthy();

    // Changing a word clears the message, and a different answer is saved.
    await click(within(dialog).getByRole("button", { name: "y3" }));
    expect(within(dialog).getByTestId("prompt-already-guessed").textContent).toBe("");
    await click(within(dialog).getByRole("button", { name: "Submit" }));
    await settle(700);
    expect(promptRows()).toHaveLength(2);
    expect((promptRows()[1].words as string[]).includes("y3")).toBe(true);
  }, 30000);
});

describe("samePromptWords", () => {
  it("ignores order, case and spaces, but not a different word", () => {
    expect(samePromptWords(["y2", "g2", "b2", "r2"], ["R2", " b2", "g2 ", "Y2"])).toBe(true);
    expect(samePromptWords(["y2", "g2", "b2", "r2"], ["y3", "g2", "b2", "r2"])).toBe(false);
    expect(samePromptWords(["y2", "g2", "b2"], ["y2", "g2", "b2", "r2"])).toBe(false);
  });
});
