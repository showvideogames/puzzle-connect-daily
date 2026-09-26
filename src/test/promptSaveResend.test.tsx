/**
 * A post-game Rainbow answer whose save never reached the server — the page
 * was closed or refreshed during the reveal, or while the save was in
 * flight — is delivered the next time that browser opens the puzzle.
 *
 * "The page went away before the save got through" is modelled by making
 * the server unreachable from Submit until the page is gone and any in-page
 * retries have run out; the next visit then has a working connection.
 *
 * Runs the REAL GameBoard against the in-memory Supabase fake (no network,
 * no production data).
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

const PROMPT = "Find one word from each group";
const sessions = () => db.tables.game_sessions;
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
      <GameBoard puzzle={FULL} settings={{} as never} showModeBadge={false} />
    </MemoryRouter>
  );
}

async function click(el: HTMLElement) {
  await act(async () => {
    el.click();
  });
}

async function winOnTheBoard(container: HTMLElement) {
  for (const g of FULL.groups) {
    for (const w of g.words) await click(container.querySelector(`[data-word="${w}"] button`) as HTMLElement);
    await click(screen.getByRole("button", { name: "Submit" }));
    await settle();
  }
  await settle(300);
}

async function submitPrompt(words: string[]) {
  await click(screen.getByText(PROMPT));
  const dialog = screen.getByRole("dialog");
  for (const w of words) await click(within(dialog).getByRole("button", { name: w }));
  await click(within(dialog).getByRole("button", { name: "Submit" }));
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
  db.tables.puzzles = [{ id: FULL.id, rainbow_herring: FULL.rainbowHerring, is_published: true }];
  db.signIn(null);
  db.writeLog = [];
  db.rpcLog = [];
});

describe("an interrupted post-game Rainbow save is delivered on the next visit", () => {
  it("a right answer that never reached the server is saved when the browser returns", async () => {
    const first = renderBoard();
    await settle();
    await winOnTheBoard(first.container);

    // The page goes away during the reveal: nothing gets through.
    db.rpcUnavailable = true;
    await submitPrompt(["y1", "g1", "b1", "r1"]);
    first.unmount();
    await settle(4600);
    expect(promptRows()).toHaveLength(0);
    expect(sessions()[0].found_rainbow).toBe(false);

    // The same browser comes back.
    db.rpcUnavailable = false;
    renderBoard();
    await settle(500);
    expect(promptRows().map((g) => g.correct)).toEqual([true]);
    expect(sessions()[0].found_rainbow).toBe(true);
    expect(sessions()[0].rainbow_source).toBe("post_game");
    expect(screen.queryByText(PROMPT)).toBeNull();
    expect(screen.getByTestId("skill-score").textContent).toBe("96");
  }, 30000);

  it("a wrong answer is delivered too, and a delivered answer is never sent again", async () => {
    const first = renderBoard();
    await settle();
    await winOnTheBoard(first.container);

    db.rpcUnavailable = true;
    await submitPrompt(["y2", "g2", "b2", "r2"]);
    first.unmount();
    await settle(4600);
    expect(promptRows()).toHaveLength(0);

    db.rpcUnavailable = false;
    const second = renderBoard();
    await settle(500);
    expect(promptRows().map((g) => g.correct)).toEqual([false]);
    expect(sessions()[0].found_rainbow).toBe(false);
    const saves = promptSaves();
    second.unmount();

    // Once delivered, a further visit sends nothing.
    renderBoard();
    await settle(500);
    expect(promptSaves()).toBe(saves);
    expect(promptRows()).toHaveLength(1);
    expect(screen.queryByText(PROMPT)).toBeNull();
  }, 30000);

  it("an answer saved normally is sent once, and not again on the next visit", async () => {
    const first = renderBoard();
    await settle();
    await winOnTheBoard(first.container);
    await submitPrompt(["y2", "g2", "b2", "r2"]);
    await settle(700);
    expect(promptSaves()).toBe(1);
    first.unmount();

    renderBoard();
    await settle(500);
    expect(promptSaves()).toBe(1);
    expect(promptRows()).toHaveLength(1);
  }, 30000);
});
