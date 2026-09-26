/**
 * Every post-game "Spot the Rainbow" submission is kept.
 *
 * Submissions are part of a player's Luck path, so none may vanish. The
 * browser forgets a WRONG attempt when the page reloads (it has no share-grid
 * row), so after a refresh it proposes the same guess number again; the
 * database used to discard the second submission on that clash. Since
 * migration 20260928000000 the database numbers each submission itself and
 * stores a genuine retry of the SAME submission only once — the in-memory
 * fake mirrors that, and e2e/scripts/verify-db.ts pins it on real Postgres.
 *
 * Runs the REAL useGame hook and lib/gameStats against the in-memory
 * Supabase fake, the same way durableSession.test.ts does.
 */
import { describe, it, expect, beforeEach, vi } from "vitest";
import { act, renderHook } from "@testing-library/react";
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
import { recordBonusRainbowAttempt } from "@/lib/gameStats";

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

const sessions = () => db.tables.game_sessions;
const bonusEvents = () =>
  db.tables.guess_events
    .filter((g) => g.attempt_type === "bonus_rainbow")
    .sort((a, b) => (a.guess_number as number) - (b.guess_number as number));

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
  await act(async () => view.result.current.releaseRevealHold());
}

/** Submits the prompt exactly as GameBoard's handleSpotResult does. */
async function submitPrompt(
  view: ReturnType<typeof mount>,
  words: string[],
  correct: boolean,
  failedThisPage: number,
  guessedAt = new Date().toISOString()
) {
  await recordBonusRainbowAttempt({
    sessionId: sessions()[0].id as string,
    guessNumber: view.result.current.nextGuessNumber(failedThisPage),
    words,
    correct,
    guessedAt,
    activeTimeSeconds: view.result.current.activeSecondsRef.current,
    groupsSolved: 4,
  });
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

async function winTheBoard() {
  const view = mount();
  await settle();
  for (const g of puzzle.groups) await guess(view, g.words);
  await settle();
  expect(sessions()[0].status).toBe("won");
  return view;
}

describe("post-game Rainbow submissions all persist", () => {
  it("keeps a wrong try, a second wrong try after a refresh, and the right answer after another refresh", async () => {
    const first = await winTheBoard();
    await submitPrompt(first, ["y2", "g2", "b2", "r2"], false, 0);
    first.unmount();

    // Refresh: the page has forgotten the wrong try, so it proposes the same
    // number as before. The second wrong try must still be kept.
    const second = mount();
    await settle();
    expect(second.result.current.nextGuessNumber(0)).toBe(5);
    await submitPrompt(second, ["y3", "g3", "b3", "r3"], false, 0);
    second.unmount();

    const third = mount();
    await settle();
    await submitPrompt(third, ["y1", "g1", "b1", "r1"], true, 0);

    const saved = bonusEvents();
    expect(saved.map((g) => g.guess_number)).toEqual([5, 6, 7]);
    expect(saved.map((g) => g.correct)).toEqual([false, false, true]);
    expect(saved.map((g) => (g.words as string[])[0])).toEqual(["y2", "y3", "y1"]);
    expect(saved.every((g) => g.server_numbered === true)).toBe(true);
    expect(sessions()[0].found_rainbow).toBe(true);
    expect(sessions()[0].rainbow_source).toBe("post_game");
  });

  it("stores a repeated save of the SAME submission only once", async () => {
    const view = await winTheBoard();
    const at = new Date().toISOString();
    await submitPrompt(view, ["y2", "g2", "b2", "r2"], false, 0, at);
    await submitPrompt(view, ["y2", "g2", "b2", "r2"], false, 0, at);
    expect(bonusEvents()).toHaveLength(1);
    // A different submission a moment later is a new try, and is kept.
    await submitPrompt(view, ["y2", "g2", "b2", "r2"], false, 1, new Date(Date.parse(at) + 5000).toISOString());
    expect(bonusEvents()).toHaveLength(2);
  });

  it("retries a save that failed on a brief network error", async () => {
    const view = await winTheBoard();
    db.rpcUnavailable = true;
    setTimeout(() => {
      db.rpcUnavailable = false;
    }, 300);
    await submitPrompt(view, ["y2", "g2", "b2", "r2"], false, 0);
    expect(bonusEvents()).toHaveLength(1);
    expect(sessions()[0].bonus_rainbow_attempted).toBe(true);
  }, 10000);
});
