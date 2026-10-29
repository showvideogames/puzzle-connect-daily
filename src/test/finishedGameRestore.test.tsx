/**
 * Finished games across devices, and each player's own progress.
 *
 *   1. A properly saved finished game is rebuilt from the server exactly —
 *      the same guesses, hints, Rainbow and share grid — and anything less
 *      falls back to the outcome alone, never to invented history.
 *   2. The board never shows a playable puzzle while it is asking, offers
 *      Retry when it cannot ask, ignores answers that arrive too late, and
 *      reopening a result never saves, submits or celebrates anything.
 *   3. The post-game Rainbow question and Lucky Bot survive a change of
 *      device where the saved data supports them; a second answer never.
 *   4. Browser progress belongs to one player: another account or a guest on
 *      the same browser never sees it, old unlabelled saves are shown to
 *      nobody, and a guest's boards move to an account only on "yes".
 *
 * Runs the REAL hooks and GameBoard against the in-memory Supabase fake.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { act, render, renderHook, screen, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { FakeSupabase } from "./fakeSupabase";
import type { Puzzle } from "@/lib/types";

const db = new FakeSupabase();

// Auth as the app sees it, with two things a test can steer: a listener to
// fire sign-in/sign-out events through, and a gate that holds getUser so a
// check can be caught half-way.
const auth = vi.hoisted(() => ({
  listener: null as null | ((event: string, session: unknown) => void),
  gate: null as null | Promise<void>,
}));
const analytics = vi.hoisted(() => ({ events: [] as string[] }));

vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    from: (t: string) => db.from(t),
    rpc: (n: string, a: Record<string, unknown>) => db.rpc(n, a),
    auth: {
      getUser: async () => {
        // Who the server would have said, at the moment it was asked.
        const answer = await db.auth.getUser();
        if (auth.gate) await auth.gate;
        return answer;
      },
      getSession: async () => {
        const id = db.currentUserId();
        return { data: { session: id ? { user: { id } } : null } };
      },
      onAuthStateChange: (cb: (event: string, session: unknown) => void) => {
        auth.listener = cb;
        return { data: { subscription: { unsubscribe: () => {} } } };
      },
      signOut: async () => ({ error: null }),
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
vi.mock("@/lib/analytics", () => ({ trackEvent: (name: string) => analytics.events.push(name) }));

import { useGame } from "@/hooks/useGame";
import { useAccountOnboarding } from "@/hooks/useAccountOnboarding";
import { GameBoard } from "@/components/GameBoard";
import { lookupFinishedGame, type RestoredGame } from "@/lib/finishedGame";
import { loadProgress, progressKey, promptAnswerKey, saveProgress } from "@/lib/gameProgress";
import { FULL_FORMAT, progressStorageId } from "@/lib/puzzleFormat";
import { getDeviceId, recordBonusRainbowAttempt } from "@/lib/gameStats";
import {
  ProgressOwnerContext,
  copyGuestProgressToAccount,
  type ProgressOwner,
} from "@/lib/progressOwner";

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
const [Y, G, B, R] = FULL.groups.map((g) => g.words);

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
const RAINBOW = FULL.rainbowHerring!;
const PROMPT = "Find one word from each group";

const ALICE: ProgressOwner = { kind: "account", userId: "user-alice" };
const BOB: ProgressOwner = { kind: "account", userId: "user-bob" };
const guestOwner = (): ProgressOwner => ({ kind: "guest", deviceId: getDeviceId() });

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

async function settle(ms = 0) {
  await act(async () => {
    if (ms) await new Promise((r) => setTimeout(r, ms));
    for (let i = 0; i < 25; i++) await new Promise((r) => setTimeout(r, 0));
  });
}

async function click(el: HTMLElement) {
  await act(async () => {
    el.click();
  });
}

type Step = string[] | "small" | "full";

/**
 * Plays on "another device": the real hook, saving under the player's own
 * key, every guess and hint written to the server as it happens.
 */
async function playOnAnotherDevice(owner: ProgressOwner, steps: Step[], puzzle: Puzzle = FULL) {
  let opts: Record<string, unknown> = { owner };
  const view = renderHook(({ o }) => useGame(puzzle, o as never), { initialProps: { o: opts } });
  await settle();
  for (const step of steps) {
    if (step === "small" || step === "full") {
      opts = { ...opts, [step === "small" ? "smallHintUsed" : "fullHintUsed"]: true };
      view.rerender({ o: opts });
      await settle();
      continue;
    }
    await act(async () => view.result.current.deselectAll());
    await act(async () => {
      for (const w of step) view.result.current.toggleWord(w);
    });
    await act(async () => view.result.current.submitGuess());
    await settle();
    await act(async () => view.result.current.releaseRevealHold());
  }
  await settle();
  const played = view.result.current.state;
  const storageId = view.result.current.storageId;
  view.unmount();
  return { played, storageId };
}

/** This browser, for a player with nothing saved here. */
function forgetThisBrowser(storageId: string) {
  localStorage.removeItem(progressKey(storageId));
  localStorage.removeItem(promptAnswerKey(storageId));
}

function renderBoard(owner: ProgressOwner | null, puzzle: Puzzle = FULL) {
  const tree = (o: ProgressOwner | null) => (
    <MemoryRouter>
      <ProgressOwnerContext.Provider value={o}>
        <GameBoard puzzle={puzzle} settings={{} as never} showModeBadge={false} />
      </ProgressOwnerContext.Provider>
    </MemoryRouter>
  );
  const view = render(tree(owner));
  return { ...view, switchTo: (o: ProgressOwner | null) => view.rerender(tree(o)) };
}

/** The parts of a history entry the board and results read. */
const shape = (history: RestoredGame["guessHistory"]) =>
  history.map((g) => ({
    words: g.words,
    groupIndices: g.groupIndices,
    isCorrect: g.isCorrect,
    isRainbow: !!g.isRainbow,
    isHintMarker: !!g.isHintMarker,
    hintType: g.hintType ?? null,
    isOneAway: !!g.isOneAway,
  }));

const tile = (word: string) => document.querySelector(`[data-word="${word}"]`);
const progressKeys = () => Object.keys(localStorage).filter((k) => k.startsWith("connections-progress-"));

beforeEach(async () => {
  reduceMotion();
  for (let i = 0; i < 5; i++) await new Promise((r) => setTimeout(r, 10));
  for (const t of ["game_sessions", "guess_events", "hint_events", "game_results", "user_streaks", "device_identities", "accounts", "puzzle_aggregates"]) {
    db.tables[t] = [];
  }
  db.rpcUnavailable = false;
  auth.gate = null;
  auth.listener = null;
  analytics.events.length = 0;
  const { data } = await db.rpc("create_device_identity");
  const id = (Array.isArray(data) ? data[0] : data) as { device_id: string; device_token: string };
  localStorage.clear();
  sessionStorage.clear();
  localStorage.setItem("rc-device-id", id.device_id);
  localStorage.setItem("rc-device-token", id.device_token);
  db.tables.puzzles = [
    { id: FULL.id, rainbow_herring: FULL.rainbowHerring, is_published: true },
    { id: MINI.id, format: "mini", rainbow_herring: MINI.rainbowHerring, is_published: true },
  ];
  db.signIn(null);
  db.writeLog = [];
  db.rpcLog = [];
});

afterEach(() => {
  vi.restoreAllMocks();
  auth.gate = null;
});

// ── 1. REBUILDING FROM THE SERVER ──────────────────────────────────────────
describe("rebuilding a finished game from the server", () => {
  it("a properly saved game comes back exactly: guesses, hints, Rainbow and outcome", async () => {
    db.signIn(ALICE.kind === "account" ? ALICE.userId : null);
    const { played } = await playOnAnotherDevice(ALICE, [
      "small",
      ["y1", "y2", "y3", "g1"], // one away
      RAINBOW, // found during play
      Y,
      G,
      B,
      R,
    ]);
    expect(played.isWon).toBe(true);

    const found = await lookupFinishedGame(FULL, ALICE);
    expect(found.status).toBe("found");
    const game = (found as { game: RestoredGame }).game;
    expect(game.detail).toBe("full");
    expect(shape(game.guessHistory)).toEqual(shape(played.guessHistory));
    expect(game.solvedGroups).toEqual(played.solvedGroups);
    expect(game.mistakes).toBe(1);
    expect(game.gotRainbow).toBe(true);
    expect(game.rainbowSolveIndex).toBe(played.rainbowSolveIndex);
    expect(game.smallHintUsed).toBe(true);
    expect(game.sessionId).toBe(sessions()[0].id);
  });

  it("a lost game comes back with the unsolved categories revealed, as the board shows them", async () => {
    db.signIn("user-alice");
    const { played } = await playOnAnotherDevice(ALICE, [
      Y,
      ["g1", "g2", "b1", "b2"],
      ["g1", "g3", "b1", "b3"],
      ["g2", "g4", "r1", "r2"],
      ["b4", "g4", "r3", "r4"],
    ]);
    expect(played.isComplete).toBe(true);
    expect(played.isWon).toBe(false);

    const game = ((await lookupFinishedGame(FULL, ALICE)) as { game: RestoredGame }).game;
    expect(game.detail).toBe("full");
    expect(game.isWon).toBe(false);
    expect(game.mistakes).toBe(4);
    expect(game.solvedGroups).toEqual([0, 1, 2, 3]);
    expect(shape(game.guessHistory)).toEqual(shape(played.guessHistory));
  });

  it("a Rainbow found through the post-game question comes back below the categories", async () => {
    db.signIn("user-alice");
    await playOnAnotherDevice(ALICE, [Y, G, B, R]);
    await recordBonusRainbowAttempt({
      sessionId: sessions()[0].id as string,
      guessNumber: 5,
      words: RAINBOW,
      correct: true,
      guessedAt: new Date().toISOString(),
      activeTimeSeconds: 10,
      groupsSolved: 4,
    });

    const game = ((await lookupFinishedGame(FULL, ALICE)) as { game: RestoredGame }).game;
    expect(game.detail).toBe("full");
    expect(game.rainbowSource).toBe("post_game");
    expect(game.bonusRainbowAttempted).toBe(true);
    expect(game.guessHistory.at(-1)?.isRainbow).toBe(true);
  });

  it("a Mini comes back the same way, three to a row", async () => {
    db.signIn("user-alice");
    const { played } = await playOnAnotherDevice(
      ALICE,
      [["g1", "g2", "b1"], ["g1", "b1", "r1"], ...MINI.groups.map((g) => g.words)],
      MINI
    );
    expect(played.isWon).toBe(true);

    const game = ((await lookupFinishedGame(MINI, ALICE)) as { game: RestoredGame }).game;
    expect(game.detail).toBe("full");
    expect(shape(game.guessHistory)).toEqual(shape(played.guessHistory));
    expect(game.gotRainbow).toBe(true);
    expect(game.mistakes).toBe(1);
  });

  it("with a saved guess missing, only the outcome comes back — no history is made up", async () => {
    db.signIn("user-alice");
    await playOnAnotherDevice(ALICE, [["y1", "y2", "y3", "g1"], Y, G, B, R]);
    db.tables.guess_events = db.tables.guess_events.filter((g) => g.guess_number !== 2);

    const game = ((await lookupFinishedGame(FULL, ALICE)) as { game: RestoredGame }).game;
    expect(game.detail).toBe("summary");
    expect(game.guessHistory).toEqual([]);
    expect(game.isWon).toBe(true);
    expect(game.mistakes).toBe(1);
    expect(game.solvedGroups).toEqual([0, 1, 2, 3]);
  });

  it("when the puzzle has changed since, the saved grid no longer matches and only the outcome comes back", async () => {
    db.signIn("user-alice");
    await playOnAnotherDevice(ALICE, [Y, G, B, R]);
    const edited: Puzzle = {
      ...FULL,
      groups: FULL.groups.map((g, i) => ({ ...g, difficulty: ([2, 1, 3, 4] as const)[i] })),
    };
    const game = ((await lookupFinishedGame(edited, ALICE)) as { game: RestoredGame }).game;
    expect(game.detail).toBe("summary");
  });

  it("an older record with no saved grid shows only its outcome", async () => {
    db.signIn("user-alice");
    await playOnAnotherDevice(ALICE, [Y, G, B, R]);
    sessions()[0].share_grid = null;
    const game = ((await lookupFinishedGame(FULL, ALICE)) as { game: RestoredGame }).game;
    expect(game.detail).toBe("summary");
    expect(game.isWon).toBe(true);
  });

  it("reads only the asking account's own game — never another player's, even for an admin", async () => {
    db.signIn("user-alice");
    await playOnAnotherDevice(ALICE, [Y, G, B, R]);

    db.signIn("user-bob");
    expect(await lookupFinishedGame(FULL, BOB)).toEqual({ status: "none" });
    db.signIn("user-bob", { admin: true });
    expect(await lookupFinishedGame(FULL, BOB)).toEqual({ status: "none" });
  });

  it("a guest gets the outcome only, through the same function the server already offers", async () => {
    const { storageId } = await playOnAnotherDevice(guestOwner(), [Y, G, B, R]);
    forgetThisBrowser(storageId);
    db.rpcLog = [];
    const found = await lookupFinishedGame(FULL, guestOwner());
    expect(db.rpcLog).toContain("get_own_completed_sessions");
    const game = (found as { game: RestoredGame }).game;
    expect(game.detail).toBe("summary");
    expect(game.sessionId).toBeNull();
  });
});

// ── 2. THE BOARD WHILE ASKING, AND AFTER ───────────────────────────────────
describe("the board for a finished game this browser has no copy of", () => {
  it("shows a neutral loading state — never a playable puzzle — until the server answers", async () => {
    const { storageId } = await playOnAnotherDevice(guestOwner(), [Y, G, B, R]);
    forgetThisBrowser(storageId);

    let release!: () => void;
    const held = new Promise<void>((r) => (release = r));
    const rpc = db.rpc;
    db.rpc = async (name, args) => {
      if (name === "get_own_completed_sessions") await held;
      return rpc(name, args);
    };
    try {
      renderBoard(guestOwner());
      await settle();
      expect(screen.getByTestId("finished-check-loading")).toBeTruthy();
      expect(tile("y1")).toBeNull();
      expect(screen.queryByRole("button", { name: "Submit" })).toBeNull();

      await act(async () => release());
      await settle();
      expect(screen.queryByTestId("finished-check-loading")).toBeNull();
      expect(screen.getByRole("button", { name: "View Results" })).toBeTruthy();
      expect(tile("y1")).toBeNull();
    } finally {
      db.rpc = rpc;
    }
  });

  it("offers Retry when the server cannot be asked, and no way to a fresh board past it", async () => {
    const { storageId } = await playOnAnotherDevice(guestOwner(), [Y, G, B, R]);
    forgetThisBrowser(storageId);

    db.rpcUnavailable = true;
    renderBoard(guestOwner());
    await settle();
    const failed = screen.getByTestId("finished-check-failed");
    expect(failed.textContent).toContain("We couldn't load your result for this puzzle.");
    expect(tile("y1")).toBeNull();

    db.rpcUnavailable = false;
    await click(within(failed).getByRole("button", { name: "Retry" }));
    await settle();
    expect(screen.getByRole("button", { name: "View Results" })).toBeTruthy();
  });

  it("a fresh board when there is no finished game", async () => {
    renderBoard(guestOwner());
    await settle();
    expect(tile("y1")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Submit" })).toBeTruthy();
  });

  it("an answer that arrives after the player changed is ignored", async () => {
    const { storageId } = await playOnAnotherDevice(guestOwner(), [Y, G, B, R]);
    forgetThisBrowser(storageId);

    // Both answers are held: the guest's (an RPC) and Bob's (a table read).
    let releaseGuest!: () => void;
    const guestHeld = new Promise<void>((r) => (releaseGuest = r));
    let releaseBob!: () => void;
    const bobHeld = new Promise<void>((r) => (releaseBob = r));
    const rpc = db.rpc;
    const from = db.from.bind(db);
    db.rpc = async (name, args) => {
      if (name === "get_own_completed_sessions") await guestHeld;
      return rpc(name, args);
    };
    db.from = ((table: string) => {
      const query = from(table);
      if (table !== "game_sessions") return query;
      const then = query.then.bind(query);
      query.then = ((ok: never, fail: never) => bobHeld.then(() => then(ok, fail))) as typeof query.then;
      return query;
    }) as typeof db.from;
    try {
      const view = renderBoard(guestOwner());
      await settle();
      expect(screen.getByTestId("finished-check-loading")).toBeTruthy();

      // Bob signs in on this browser before the guest's answer arrives.
      db.signIn("user-bob");
      view.switchTo(BOB);
      await settle();
      expect(screen.getByTestId("finished-check-loading")).toBeTruthy();

      // The guest's finished game arrives — too late, and for someone else.
      await act(async () => releaseGuest());
      await settle();
      expect(screen.queryByRole("button", { name: "View Results" })).toBeNull();
      expect(screen.getByTestId("finished-check-loading")).toBeTruthy();

      // Bob's own answer: nothing finished, so his fresh board.
      await act(async () => releaseBob());
      await settle();
      expect(tile("y1")).toBeTruthy();
      expect(screen.queryByRole("button", { name: "View Results" })).toBeNull();
    } finally {
      db.rpc = rpc;
      db.from = from;
    }
  });

  it("reopening a result submits nothing, saves nothing here, and celebrates nothing", async () => {
    db.signIn("user-alice");
    const { storageId } = await playOnAnotherDevice(ALICE, [["y1", "y2", "y3", "g1"], Y, G, B, R]);
    forgetThisBrowser(storageId);
    const before = { sessions: sessions().length, guesses: db.tables.guess_events.length };
    db.rpcLog = [];
    analytics.events.length = 0;

    renderBoard(ALICE);
    await settle(400);

    expect(screen.getByRole("button", { name: "View Results" })).toBeTruthy();
    // The results popup does not open by itself, as for any reopened game.
    expect(screen.queryByTestId("results-dialog")).toBeNull();
    expect(db.rpcLog).not.toContain("finalize_game_session");
    expect(db.rpcLog).not.toContain("create_game_session");
    expect(sessions()).toHaveLength(before.sessions);
    expect(db.tables.guess_events).toHaveLength(before.guesses);
    expect(sessions()[0].status).toBe("won");
    expect(analytics.events).not.toContain("puzzle_completed");
    expect(localStorage.getItem(progressKey(storageId))).toBeNull();

    // The full results: the real rows and Share.
    await click(screen.getByRole("button", { name: "View Results" }));
    await settle();
    const dialog = screen.getByTestId("results-dialog");
    expect(within(dialog).getByRole("button", { name: /Share Score/ })).toBeTruthy();
    expect(within(dialog).queryByTestId("results-summary")).toBeNull();
    // The one-word message for a win with one mistake, and nothing under it.
    expect(within(dialog).getByRole("heading").textContent).toBe("Excellent!");
    expect(dialog.textContent).not.toMatch(/Come back tomorrow|Well done/);
    expect(localStorage.getItem(progressKey(storageId))).toBeNull();
    expect(db.rpcLog).not.toContain("finalize_game_session");
  });

  it("an outcome-only record says so plainly, with no rows and no Share", async () => {
    const { storageId } = await playOnAnotherDevice(guestOwner(), [Y, G, B, R]);
    forgetThisBrowser(storageId);
    renderBoard(guestOwner());
    await settle();

    await click(screen.getByRole("button", { name: "View Results" }));
    await settle();
    const dialog = screen.getByTestId("results-dialog");
    expect(within(dialog).getByRole("heading").textContent).toBe("Perfect!");
    const summary = within(dialog).getByTestId("results-summary");
    expect(summary.textContent).toContain("Rainbow not found · No hints used");
    expect(summary.textContent).toContain("Detailed results aren't available for this game.");
    expect(within(dialog).queryByRole("button", { name: /Share Score/ })).toBeNull();
    expect(screen.queryByTestId("lucky-bot-card")).toBeNull();
  });
});

// ── 3. THE RAINBOW QUESTION AND LUCKY BOT ──────────────────────────────────
describe("what stays available on a restored game", () => {
  it("Lucky Bot is there when the full history came back", async () => {
    db.signIn("user-alice");
    const { storageId } = await playOnAnotherDevice(ALICE, [Y, G, B, R]);
    forgetThisBrowser(storageId);
    renderBoard(ALICE);
    await settle();
    expect(screen.getByTestId("lucky-bot-card")).toBeTruthy();
  });

  it("an unanswered post-game question is still offered, and answered onto the same game once", async () => {
    db.signIn("user-alice");
    const { storageId } = await playOnAnotherDevice(ALICE, [Y, G, B, R]);
    forgetThisBrowser(storageId);
    const officialId = sessions()[0].id;

    renderBoard(ALICE);
    await settle();
    await click(screen.getByRole("button", { name: "View Results" }));
    await settle();
    await click(within(screen.getByTestId("results-dialog")).getByText(PROMPT));
    await settle();
    const dialog = screen.getByRole("dialog");
    for (const w of RAINBOW) await click(within(dialog).getByRole("button", { name: w }));
    await click(within(dialog).getByRole("button", { name: "Submit" }));
    await settle(1200);

    const bonus = db.tables.guess_events.filter((g) => g.attempt_type === "bonus_rainbow");
    expect(bonus).toHaveLength(1);
    expect(bonus[0].game_session_id).toBe(officialId);
    expect(sessions()).toHaveLength(1);
    expect(sessions()[0].found_rainbow).toBe(true);
    expect(screen.queryByTestId("spot-rainbow-prompt")).toBeNull();
  });

  it("a question already answered on another device is never offered again", async () => {
    db.signIn("user-alice");
    const { storageId } = await playOnAnotherDevice(ALICE, [Y, G, B, R]);
    await recordBonusRainbowAttempt({
      sessionId: sessions()[0].id as string,
      guessNumber: 5,
      words: ["y2", "g2", "b2", "r2"],
      correct: false,
      guessedAt: new Date().toISOString(),
      activeTimeSeconds: 10,
      groupsSolved: 4,
    });
    forgetThisBrowser(storageId);

    renderBoard(ALICE);
    await settle(400);
    expect(screen.queryByTestId("spot-rainbow-prompt")).toBeNull();
    await click(screen.getByRole("button", { name: "View Results" }));
    await settle();
    expect(within(screen.getByTestId("results-dialog")).queryByText(PROMPT)).toBeNull();
    // The revealed Rainbow, as on the device it was answered on.
    expect(screen.getAllByText("Hidden Link").length).toBeGreaterThan(0);
  });

  it("a guest's outcome-only game offers no question it could not save", async () => {
    const { storageId } = await playOnAnotherDevice(guestOwner(), [Y, G, B, R]);
    forgetThisBrowser(storageId);
    renderBoard(guestOwner());
    await settle();
    expect(screen.queryByTestId("spot-rainbow-prompt")).toBeNull();
    expect(screen.queryByText(PROMPT)).toBeNull();
  });
});

// ── 4. EACH PLAYER'S OWN PROGRESS ──────────────────────────────────────────
describe("browser progress belongs to one player", () => {
  it("every player's save has its own key", () => {
    const ids = [ALICE, BOB, guestOwner()].map((o) => progressStorageId("p", FULL_FORMAT, "official", o));
    expect(new Set(ids).size).toBe(3);
    expect(progressStorageId("p", FULL_FORMAT)).toBe("p");
  });

  it("another account or a guest on the same browser never sees a signed-in player's board", async () => {
    db.signIn("user-alice");
    const { storageId } = await playOnAnotherDevice(ALICE, [Y]);
    expect(loadProgress(storageId)?.solvedGroups).toEqual([0]);

    db.signIn("user-bob");
    const bob = renderBoard(BOB);
    await settle();
    expect(tile("y1")).toBeTruthy();
    expect(screen.queryByText("Yellow Things")).toBeNull();
    bob.unmount();

    db.signIn(null);
    renderBoard(guestOwner());
    await settle();
    expect(tile("y1")).toBeTruthy();
    expect(screen.queryByText("Yellow Things")).toBeNull();

    // Alice's own board is still exactly where she left it.
    expect(loadProgress(storageId)?.solvedGroups).toEqual([0]);
  });

  it("an old unlabelled save is shown to no one, and left untouched", async () => {
    const legacy = {
      solvedGroups: [0],
      mistakes: 0,
      guessHistory: [{ words: Y, groupIndices: [0, 0, 0, 0], isCorrect: true }],
      gotRainbow: false,
      shuffledWords: [...G, ...B, ...R],
      rainbowWords: [],
    };
    saveProgress(FULL.id, legacy);
    const raw = localStorage.getItem(progressKey(FULL.id));

    db.signIn("user-alice");
    const alice = renderBoard(ALICE);
    await settle();
    expect(screen.queryByText("Yellow Things")).toBeNull();
    alice.unmount();

    db.signIn(null);
    renderBoard(guestOwner());
    await settle();
    expect(screen.queryByText("Yellow Things")).toBeNull();
    expect(localStorage.getItem(progressKey(FULL.id))).toBe(raw);
  });

  it("a guest's boards are copied to an account without overwriting what the account has", () => {
    const device = "device-1";
    const guestId = progressStorageId("p1", FULL_FORMAT, "official", { kind: "guest", deviceId: device });
    const guestId2 = progressStorageId("p2", FULL_FORMAT, "official", { kind: "guest", deviceId: device });
    const otherGuest = progressStorageId("p3", FULL_FORMAT, "official", { kind: "guest", deviceId: "device-2" });
    const accountId2 = progressStorageId("p2", FULL_FORMAT, "official", ALICE);
    localStorage.setItem(progressKey(guestId), "guest-p1");
    localStorage.setItem(progressKey(guestId2), "guest-p2");
    localStorage.setItem(progressKey(otherGuest), "other-guest");
    localStorage.setItem(progressKey(accountId2), "alice-p2");

    copyGuestProgressToAccount(device, "user-alice");

    expect(localStorage.getItem(progressKey(progressStorageId("p1", FULL_FORMAT, "official", ALICE)))).toBe("guest-p1");
    expect(localStorage.getItem(progressKey(accountId2))).toBe("alice-p2");
    expect(localStorage.getItem(progressKey(progressStorageId("p3", FULL_FORMAT, "official", ALICE)))).toBeNull();
    // Copied, not moved.
    expect(localStorage.getItem(progressKey(guestId))).toBe("guest-p1");
  });
});

// ── 5. WHO IS PLAYING ──────────────────────────────────────────────────────
describe("the player the app shows progress for", () => {
  it("is this browser's guest when signed out, and the account when signed in", async () => {
    const guest = renderHook(() => useAccountOnboarding());
    await settle();
    expect(guest.result.current.owner).toEqual({ kind: "guest", deviceId: getDeviceId() });
    guest.unmount();

    db.signIn("user-alice");
    const signedIn = renderHook(() => useAccountOnboarding());
    await settle();
    expect(signedIn.result.current.owner).toEqual(ALICE);
  });

  it("re-checking for the same player changes nothing pages depend on", async () => {
    db.signIn("user-alice");
    const hook = renderHook(() => useAccountOnboarding());
    await settle();
    const before = hook.result.current.owner;
    expect(before).toEqual(ALICE);

    // The check runs again on every focus; the player is the same object.
    act(() => {
      window.dispatchEvent(new Event("focus"));
    });
    await settle();
    expect(hook.result.current.owner).toBe(before);
  });

  it("a different player signing in takes the previous one's view away at once", async () => {
    const hook = renderHook(() => useAccountOnboarding());
    await settle();
    expect(hook.result.current.state.phase).toBe("ready");

    let release!: () => void;
    auth.gate = new Promise<void>((r) => (release = r));
    db.signIn("user-alice");
    act(() => auth.listener?.("SIGNED_IN", { user: { id: "user-alice" } }));
    expect(hook.result.current.state.phase).toBe("checking");
    expect(hook.result.current.owner).toBeNull();

    auth.gate = null;
    await act(async () => release());
    await settle();
    expect(hook.result.current.owner).toEqual(ALICE);
  });

  it("a check for the previous player that finishes late is thrown away", async () => {
    // Every player the app was ever told about, render by render — so even a
    // momentary wrong answer is caught.
    const seen: Array<ProgressOwner | null> = [];
    const hook = renderHook(() => {
      const result = useAccountOnboarding();
      seen.push(result.owner);
      return result;
    });
    await settle();
    const firstGuest = getDeviceId();

    let release!: () => void;
    auth.gate = new Promise<void>((r) => (release = r));
    db.signIn("user-alice");
    act(() => auth.listener?.("SIGNED_IN", { user: { id: "user-alice" } }));
    // Her check has asked who is signed in (Alice) and is held there…
    await settle();
    // …when she signs straight back out. The check that sign-out asks for is
    // held too, so whatever Alice's late check does is left on screen.
    let releaseSecond!: () => void;
    auth.gate = new Promise<void>((r) => (releaseSecond = r));
    db.signIn(null);
    act(() => auth.listener?.("SIGNED_OUT", null));

    await act(async () => release());
    await settle();
    expect(hook.result.current.owner).toBeNull();
    expect(hook.result.current.state.phase).toBe("checking");

    auth.gate = null;
    await act(async () => releaseSecond());
    await settle();
    expect(seen).not.toContainEqual(ALICE);
    const owner = hook.result.current.owner;
    expect(owner?.kind).toBe("guest");
    // Signing out starts a new guest, not the one before.
    expect(owner && owner.kind === "guest" ? owner.deviceId : null).not.toBe(firstGuest);
  });

  it("a guest's boards come along only when the player says yes to bringing their progress", async () => {
    const { storageId } = await playOnAnotherDevice(guestOwner(), [Y]);
    const guestSave = localStorage.getItem(progressKey(storageId));
    expect(guestSave).not.toBeNull();

    db.signIn("user-alice");
    const hook = renderHook(() => useAccountOnboarding());
    await settle();
    expect(hook.result.current.state.phase).toBe("decision");
    await act(async () => hook.result.current.addMyProgress());
    await settle();

    const aliceId = progressStorageId(FULL.id, FULL_FORMAT, "official", ALICE);
    expect(localStorage.getItem(progressKey(aliceId))).toBe(guestSave);
    expect(hook.result.current.owner).toEqual(ALICE);
  });

  it("starting fresh brings no guest boards along", async () => {
    await playOnAnotherDevice(guestOwner(), [Y]);

    db.signIn("user-alice");
    const hook = renderHook(() => useAccountOnboarding());
    await settle();
    expect(hook.result.current.state.phase).toBe("decision");
    await act(async () => hook.result.current.startFresh());
    await settle();

    expect(progressKeys().some((k) => k.includes("acct:user-alice/"))).toBe(false);
  });
});


describe("pending guest decisions stay with the player who made them", () => {
  it("a late import never copies Alice's guest boards into Bob's account", async () => {
    const { storageId } = await playOnAnotherDevice(guestOwner(), [Y]);
    const guestSave = localStorage.getItem(progressKey(storageId));
    db.signIn("user-alice");
    const hook = renderHook(() => useAccountOnboarding());
    await settle();
    expect(hook.result.current.state.phase).toBe("decision");

    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    const rpc = db.rpc.bind(db);
    vi.spyOn(db, "rpc").mockImplementation(async (name, args) => {
      const answer = await rpc(name, args);
      if (name === "import_guest_history") await gate;
      return answer;
    });
    let pending!: Promise<void>;
    act(() => { pending = hook.result.current.addMyProgress(); });
    await settle();
    db.signIn("user-bob");
    act(() => auth.listener?.("SIGNED_IN", { user: { id: "user-bob" } }));
    await settle();
    expect(hook.result.current.owner).toEqual(BOB);
    const deviceBefore = getDeviceId();
    await act(async () => { release(); await pending; });

    expect(localStorage.getItem(progressKey(progressStorageId(FULL.id, FULL_FORMAT, "official", BOB)))).toBeNull();
    expect(localStorage.getItem(progressKey(storageId))).toBe(guestSave);
    expect(getDeviceId()).toBe(deviceBefore);
    expect(hook.result.current.owner).toEqual(BOB);
  });

  it.each(["addMyProgress", "startFresh"] as const)("a late %s does not resolve the next player's pending check", async (decision) => {
    await playOnAnotherDevice(guestOwner(), [Y]);
    db.signIn("user-alice");
    const hook = renderHook(() => useAccountOnboarding());
    await settle();
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    const rpc = db.rpc.bind(db);
    vi.spyOn(db, "rpc").mockImplementation(async (name, args) => {
      const answer = await rpc(name, args);
      if (name === "import_guest_history" || name === "decline_guest_history") await gate;
      return answer;
    });
    let pending!: Promise<void>;
    act(() => { pending = hook.result.current[decision](); });
    await settle();
    let releaseAuth!: () => void;
    auth.gate = new Promise<void>((r) => (releaseAuth = r));
    db.signIn(null);
    act(() => auth.listener?.("SIGNED_OUT", null));
    await settle();
    const deviceBefore = getDeviceId();
    await act(async () => { release(); await pending; });
    expect(hook.result.current.state.phase).toBe("checking");
    expect(hook.result.current.owner).toBeNull();
    expect(getDeviceId()).toBe(deviceBefore);
    auth.gate = null;
    await act(async () => releaseAuth());
    await settle();
  });
});


it("a loss saves its final board before revealing it and never rewrites storage after unmount", async () => {
  db.signIn("user-alice");
  const { storageId } = await playOnAnotherDevice(ALICE, [
    Y, ["g1", "g2", "b1", "b2"], ["g1", "g3", "b1", "b3"],
    ["g2", "g4", "r1", "r2"], ["b4", "g4", "r3", "r4"],
  ]);
  expect(loadProgress(storageId)?.finalSolvedGroups).toEqual([0, 1, 2, 3]);
  const reopened = renderHook(() => useGame(FULL, { owner: ALICE }));
  expect(reopened.result.current.state.isComplete).toBe(true);
  expect(reopened.result.current.remainingWords).toEqual([]);
  reopened.unmount();
  forgetThisBrowser(storageId);
  const finalizeCount = db.rpcLog.filter((n) => n === "finalize_game_session").length;
  await settle(4000);
  expect(localStorage.getItem(progressKey(storageId))).toBeNull();
  expect(db.rpcLog.filter((n) => n === "finalize_game_session")).toHaveLength(finalizeCount);
});


describe("guest decision recovery", () => {
  it("serializes competing clicks so only the first decision is sent", async () => {
    await playOnAnotherDevice(guestOwner(), [Y]);
    db.signIn("user-alice");
    const hook = renderHook(() => useAccountOnboarding());
    await settle();
    const rpc = db.rpc.bind(db);
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    vi.spyOn(db, "rpc").mockImplementation(async (name, args) => {
      if (name === "import_guest_history") await gate;
      return rpc(name, args);
    });
    let pending!: Promise<void>;
    act(() => { pending = hook.result.current.addMyProgress(); });
    await act(async () => {
      await hook.result.current.addMyProgress();
      await hook.result.current.startFresh();
    });
    await act(async () => { release(); await pending; });
    expect(db.rpcLog.filter((n) => n === "import_guest_history")).toHaveLength(1);
    expect(db.rpcLog).not.toContain("decline_guest_history");
    expect(hook.result.current.state.phase).toBe("ready");
  });

  it("a failed request keeps the decision recoverable", async () => {
    await playOnAnotherDevice(guestOwner(), [Y]);
    db.signIn("user-alice");
    const hook = renderHook(() => useAccountOnboarding());
    await settle();
    const rpc = db.rpc.bind(db);
    const spy = vi.spyOn(db, "rpc").mockImplementation(async (name, args) => {
      if (name === "import_guest_history") throw new Error("offline");
      return rpc(name, args);
    });
    await act(async () => hook.result.current.addMyProgress());
    expect(hook.result.current.state.phase).toBe("decision");
    expect(progressKeys().some((k) => k.includes("acct:user-alice/"))).toBe(false);
    spy.mockRestore();
    await act(async () => hook.result.current.addMyProgress());
    expect(hook.result.current.state.phase).toBe("ready");
  });

  it("an identity mint finishing after sign-out cannot replace the new guest's identity", async () => {
    await playOnAnotherDevice(guestOwner(), [Y]);
    db.signIn("user-alice");
    const hook = renderHook(() => useAccountOnboarding());
    await settle();
    const rpc = db.rpc.bind(db);
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    let held = false;
    vi.spyOn(db, "rpc").mockImplementation(async (name, args) => {
      const answer = await rpc(name, args);
      if (name === "create_device_identity" && !held) {
        held = true;
        await gate;
      }
      return answer;
    });
    let pending!: Promise<void>;
    act(() => { pending = hook.result.current.startFresh(); });
    await settle();
    expect(held).toBe(true);
    db.signIn(null);
    act(() => auth.listener?.("SIGNED_OUT", null));
    await settle();
    const deviceBefore = getDeviceId();
    expect(hook.result.current.owner).toEqual({ kind: "guest", deviceId: deviceBefore });
    await act(async () => { release(); await pending; });
    expect(getDeviceId()).toBe(deviceBefore);
    expect(hook.result.current.owner).toEqual({ kind: "guest", deviceId: deviceBefore });
  });
});
