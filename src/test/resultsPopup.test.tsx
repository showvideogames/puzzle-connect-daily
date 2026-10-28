/**
 * The end-of-game results popup, View Results, and where a post-game
 * Rainbow goes.
 *
 *  - The popup opens by itself once, when the game ends in front of the
 *    player, after the board has settled. Closing, reopening (View Results)
 *    and refreshing never save another completion, never touch the streak
 *    again, and never replay the streak count-up.
 *  - Only a live, official Daily win counts up the flame. Archive and Beta
 *    play never show it, and never gain Daily credit.
 *  - A Rainbow found during play keeps the top slot. A game that ends
 *    without it folds that slot away; Spot the Rainbow's result then goes
 *    below the categories, updates the share squares, and never turns a
 *    loss into a win.
 *
 * Runs the REAL GameBoard against the in-memory Supabase fake, with reduced
 * motion (the solve animation is skipped; the loss cascade's timing is not).
 */
import { describe, it, expect, beforeEach, vi } from "vitest";
import { act, render, screen, waitFor, within } from "@testing-library/react";
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
import { loadProgress } from "@/lib/gameProgress";

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
const finalizes = () => db.rpcLog.filter((n) => n === "finalize_game_session").length;
const streakRows = () => db.tables.user_streaks;

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

type BoardProps = Partial<Parameters<typeof GameBoard>[0]>;
function renderBoard(props: BoardProps = {}) {
  return render(
    <MemoryRouter>
      <GameBoard puzzle={FULL} settings={{} as never} showModeBadge={false} {...props} />
    </MemoryRouter>
  );
}

async function click(el: HTMLElement) {
  await act(async () => {
    el.click();
  });
}

const tileButton = (container: HTMLElement, w: string) =>
  container.querySelector(`[data-word="${w}"] button`) as HTMLElement;

async function guess(container: HTMLElement, words: string[]) {
  for (const w of words) await click(tileButton(container, w));
  await click(screen.getByRole("button", { name: "Submit" }));
  await settle();
  const deselect = screen.queryByRole("button", { name: "Deselect All" });
  if (deselect && !(deselect as HTMLButtonElement).disabled) await click(deselect);
}

async function win(container: HTMLElement) {
  for (const g of FULL.groups) await guess(container, g.words);
}

/** Four wrong guesses, none of them one away and none the Rainbow. */
async function lose(container: HTMLElement) {
  for (const set of [
    ["y2", "g2", "b2", "r2"],
    ["y3", "g3", "b3", "r3"],
    ["y4", "g4", "b4", "r4"],
    ["y2", "g3", "b4", "r3"],
  ]) {
    await guess(container, set);
  }
}

const popup = (timeout = 10_000) => screen.findByTestId("results-dialog", {}, { timeout });
const popupOrNull = () => screen.queryByTestId("results-dialog");

async function closePopup() {
  await click(screen.getByRole("button", { name: "Close results" }));
  await settle();
  expect(popupOrNull()).toBeNull();
}

async function viewResults() {
  await click(screen.getByRole("button", { name: "View Results" }));
  await settle();
  return popup(1_000);
}

const statValue = (dialog: HTMLElement, label: string) =>
  within(within(dialog).getByTestId("results-stats")).getByText(label).parentElement!.querySelector("dd")!.textContent;

/** How many rainbow squares the popup's share grid draws. */
const rainbowSquares = (dialog: HTMLElement) =>
  dialog.querySelectorAll('[data-cell="rainbow"]').length;

/** The top Rainbow/instruction space has folded away (or already left). */
const slotFolded = () => {
  const slot = screen.queryByTestId("rainbow-slot");
  return !slot || slot.closest(".rainbow-slot-fold")!.classList.contains("is-folded");
};

beforeEach(async () => {
  reduceMotion();
  for (let i = 0; i < 5; i++) await new Promise((r) => setTimeout(r, 10));
  for (const t of ["game_sessions", "guess_events", "hint_events", "game_results", "user_streaks", "device_identities", "accounts", "puzzle_aggregates", "beta_playtests"]) {
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
  db.tables.puzzles = [{ id: FULL.id, rainbow_herring: FULL.rainbowHerring, is_published: true, is_beta: false }];
  db.signIn(null);
  db.writeLog = [];
  db.rpcLog = [];
});

describe("Daily win", () => {
  it("opens once the board settles; reopening and a refresh never save again or replay the streak", async () => {
    const first = renderBoard();
    await settle();
    await win(first.container);

    const d = await popup();
    expect(within(d).getByRole("heading").textContent).toBe("Perfect!");
    // One word, no supporting sentence.
    expect(d.textContent).not.toMatch(/Come back tomorrow/);
    // Stats, read after the completion was saved, so they include it.
    await waitFor(() => expect(statValue(d, "Played")).toBe("1"));
    expect(statValue(d, "Played")).toBe("1");
    expect(statValue(d, "Win %")).toBe("100");
    // The flame: a newly earned streak day, counted up this once.
    const flame = await within(d).findByTestId("streak-flame");
    expect(flame.dataset.earned).toBe("true");
    expect(flame.textContent).toContain("1 day streak");
    expect(finalizes()).toBe(1);
    expect(streakRows()).toHaveLength(1);
    expect(streakRows()[0].current_streak).toBe(1);
    const writes = db.writeLog.length;

    // Close, then reopen from View Results: same results, flame shown still.
    await closePopup();
    let again = await viewResults();
    expect(within(again).getByRole("heading").textContent).toBe("Perfect!");
    expect((await within(again).findByTestId("streak-flame")).dataset.earned).toBe("false");
    await closePopup();
    again = await viewResults();
    expect((await within(again).findByTestId("streak-flame")).dataset.earned).toBe("false");
    await closePopup();
    expect(finalizes()).toBe(1);
    expect(db.writeLog.length).toBe(writes);
    expect(streakRows()[0].current_streak).toBe(1);
    first.unmount();

    // Refresh: the finished board, no popup until asked, nothing saved.
    const second = renderBoard();
    await settle(400);
    expect(popupOrNull()).toBeNull();
    expect(screen.queryByRole("button", { name: "Submit" })).toBeNull();
    again = await viewResults();
    expect(within(again).getByRole("heading").textContent).toBe("Perfect!");
    const flameAfter = await within(again).findByTestId("streak-flame");
    expect(flameAfter.dataset.earned).toBe("false");
    expect(flameAfter.textContent).toContain("1 day streak");
    expect(finalizes()).toBe(1);
    expect(db.writeLog.length).toBe(writes);
    expect(streakRows()[0].current_streak).toBe(1);
    second.unmount();
  }, 30_000);

  it("a Rainbow found during play keeps its place at the top", async () => {
    const view = renderBoard();
    await settle();
    await guess(view.container, FULL.rainbowHerring!);
    await win(view.container);
    const d = await popup();
    expect(rainbowSquares(d)).toBe(4);
    expect(within(d).queryByText(PROMPT)).toBeNull();
    await closePopup();
    expect(slotFolded()).toBe(false);
    expect(within(screen.getByTestId("rainbow-slot")).getByText("Hidden Link")).toBeTruthy();
    expect(screen.queryByTestId("late-rainbow")).toBeNull();
  }, 30_000);

  it("without the Rainbow, the top space folds and the Spot the Rainbow result lands below the categories", async () => {
    const view = renderBoard();
    await settle();
    await win(view.container);
    const d = await popup();
    expect(rainbowSquares(d)).toBe(0);
    expect(slotFolded()).toBe(true);
    // The board's own prompt, below the solved categories.
    const late = screen.getByTestId("late-rainbow");
    expect(within(late).getByText(PROMPT)).toBeTruthy();
    const bars = screen.getByTestId("solved-bars");
    expect(bars.compareDocumentPosition(late) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();

    // The popup's invitation hands over to the real challenge.
    await click(within(d).getByText(PROMPT));
    await settle();
    expect(popupOrNull()).toBeNull();
    const challenge = screen.getByRole("dialog");
    for (const w of FULL.rainbowHerring!) await click(within(challenge).getByRole("button", { name: w }));
    await click(within(challenge).getByRole("button", { name: "Submit" }));
    await settle(1200);

    // Found: below the categories, never in the folded top slot.
    expect(within(screen.getByTestId("late-rainbow")).getByText("Hidden Link")).toBeTruthy();
    expect(slotFolded()).toBe(true);
    // View Results now carries the Rainbow row; the outcome and streak don't change.
    const after = await viewResults();
    expect(rainbowSquares(after)).toBe(4);
    expect(within(after).getByRole("heading").textContent).toBe("Perfect!");
    expect(within(after).queryByText(PROMPT)).toBeNull();
    expect(finalizes()).toBe(1);
    expect(streakRows()[0].current_streak).toBe(1);
  }, 30_000);
});

describe("the result word follows the mistake count", () => {
  // Wrong guesses that are never one away and never the Rainbow.
  const misses = [
    ["y2", "g2", "b2", "r2"],
    ["y3", "g3", "b3", "r3"],
    ["y4", "g4", "b4", "r4"],
  ];
  it.each([
    [1, "Excellent!"],
    [2, "Nice!"],
    [3, "Clutch!"],
  ])("a win with %i mistake(s) says %s, and nothing else", async (mistakes, word) => {
    const view = renderBoard();
    await settle();
    for (const set of misses.slice(0, mistakes)) await guess(view.container, set);
    await win(view.container);
    const d = await popup();
    expect(within(d).getByRole("heading").textContent).toBe(word);
    expect(d.textContent).not.toMatch(/Come back tomorrow/);
  }, 30_000);
});

describe("Daily loss", () => {
  it("opens the loss results after the cascade; a post-game Rainbow never makes it a win", async () => {
    const view = renderBoard();
    await settle();
    await lose(view.container);
    // Not while the remaining categories are still being revealed.
    expect(popupOrNull()).toBeNull();
    const d = await popup(12_000);
    expect(within(d).getByRole("heading").textContent).toBe("Onward!");
    // A loss is never celebrated with the flame.
    await waitFor(() => expect(statValue(d, "Played")).toBe("1"));
    expect(statValue(d, "Win %")).toBe("0");
    expect(within(d).queryByTestId("streak-flame")).toBeNull();
    expect(slotFolded()).toBe(true);
    const streaksAtLoss = JSON.stringify(streakRows());

    await click(within(d).getByText(PROMPT));
    await settle();
    const challenge = screen.getByRole("dialog");
    for (const w of FULL.rainbowHerring!) await click(within(challenge).getByRole("button", { name: w }));
    await click(within(challenge).getByRole("button", { name: "Submit" }));
    await settle(1200);

    expect(within(screen.getByTestId("late-rainbow")).getByText("Hidden Link")).toBeTruthy();
    const after = await viewResults();
    expect(within(after).getByRole("heading").textContent).toBe("Onward!");
    expect(rainbowSquares(after)).toBe(4);
    expect(loadProgress(FULL.id)?.isWon).toBe(false);
    expect(finalizes()).toBe(1);
    // The post-game Rainbow left the streak exactly as the loss did.
    expect(JSON.stringify(streakRows())).toBe(streaksAtLoss);
    expect(within(after).queryByTestId("streak-flame")).toBeNull();
  }, 40_000);
});

describe("modes without Daily credit", () => {
  it("Archive shows stats but never the flame, and never touches the streak", async () => {
    const view = renderBoard({ isArchive: true, entryContext: "archive_calendar" });
    await settle();
    await win(view.container);
    const d = await popup();
    await waitFor(() => expect(statValue(d, "Played")).toBe("1"));
    expect(statValue(d, "Played")).toBe("1");
    expect(within(d).queryByTestId("streak-flame")).toBeNull();
    await closePopup();
    await viewResults();
    expect(within(screen.getByTestId("results-dialog")).queryByTestId("streak-flame")).toBeNull();
    expect(streakRows()).toHaveLength(0);
  }, 30_000);

  it("Beta shows neither personal stats nor the flame, and writes no official result", async () => {
    const view = renderBoard({ betaMode: true });
    await settle();
    await win(view.container);
    const d = await popup();
    await settle(200);
    expect(within(d).queryByTestId("results-stats")).toBeNull();
    expect(within(d).queryByTestId("streak-flame")).toBeNull();
    await closePopup();
    await viewResults();
    expect(finalizes()).toBe(0);
    expect(streakRows()).toHaveLength(0);
    expect(db.tables.game_sessions).toHaveLength(0);
  }, 30_000);
});
