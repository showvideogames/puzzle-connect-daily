/**
 * Verification suite for the /beta playtesting area, cases A-J.
 *
 * Drives the REAL code paths — useGame -> useGameSession -> lib/betaPlaytest,
 * lib/puzzles' getBetaPuzzles/getBetaPuzzleById, and the admin_save_puzzle
 * status workflow — against the in-memory fake Supabase (see
 * src/test/fakeSupabase.ts), which mirrors the 20260918020000 migration:
 * the puzzles.is_beta column, the mutual-exclusion CHECK, the widened RLS,
 * and the beta-only RPCs. Production is never touched.
 *
 * The property under test throughout: a Beta puzzle plays on the real game
 * engine, but NOTHING it does can ever create, mutate or count toward an
 * official game_sessions / guess_events / hint_events / game_results /
 * user_streaks / puzzle_aggregates row.
 */
import { describe, it, expect, beforeEach, vi } from "vitest";
import { act, renderHook } from "@testing-library/react";
import { FakeSupabase, type FakeRow } from "./fakeSupabase";
import type { Puzzle } from "@/lib/types";

const db = new FakeSupabase();

vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    from: (t: string) => db.from(t),
    rpc: (n: string, a: Record<string, unknown>) => db.rpc(n, a),
    auth: {
      getUser: () => db.auth.getUser(),
      onAuthStateChange: () => ({
        data: { subscription: { unsubscribe: () => {} } },
      }),
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
import { getBetaPuzzles, getBetaPuzzleById, resolveDesignerName } from "@/lib/puzzles";
import { resetBetaPlaytest, submitBetaFeedback } from "@/lib/betaPlaytest";
import { loadProgress, clearProgress } from "@/lib/gameProgress";

const ADMIN_ID = "admin-user";

const versions = () => db.tables.puzzle_versions;
const groups = () => db.tables.puzzle_groups;
const playtests = () => db.tables.beta_playtests;
const feedback = () => db.tables.beta_feedback;

const V1_CONTENT = {
  groups: [
    { category: "Yellow", words: ["y1", "y2", "y3", "y4"], difficulty: 1, hint_word: null },
    { category: "Green", words: ["g1", "g2", "g3", "g4"], difficulty: 2, hint_word: null },
    { category: "Blue", words: ["b1", "b2", "b3", "b4"], difficulty: 3, hint_word: null },
    { category: "Red", words: ["r1", "r2", "r3", "r4"], difficulty: 4, hint_word: null },
  ],
  word_order: null,
  rainbow_herring: ["y1", "g1", "b1", "r1"],
  rainbow_category_name: "Rainbow",
  rainbow_hint_word: null,
  theme: null,
  is_emoji_puzzle: false,
};

const V2_CONTENT = {
  ...V1_CONTENT,
  groups: [
    { category: "Yellow", words: ["y1", "y2", "y3", "y9"], difficulty: 1, hint_word: null },
    ...V1_CONTENT.groups.slice(1),
  ],
};

async function adminSave(
  puzzleId: string | null,
  content: unknown,
  metadata: Record<string, unknown>
) {
  const previousUser = db.currentUserId();
  const previousAdmin = db.isAdmin;
  db.signIn(ADMIN_ID, { admin: true });
  const { data, error } = await db.rpc("admin_save_puzzle", {
    _puzzle_id: puzzleId,
    _metadata: metadata,
    _content: content,
  });
  db.signIn(previousUser, { admin: previousAdmin });
  return { data: data as FakeRow | null, error };
}

function currentPuzzle(puzzleId: string): Puzzle {
  const row = db.tables.puzzles.find((p) => p.id === puzzleId)!;
  const rows = [...groups().filter((g) => g.puzzle_id === puzzleId)].sort(
    (a, b) => (a.sort_order as number) - (b.sort_order as number)
  );
  return {
    id: puzzleId,
    date: row.date as string,
    title: (row.title as string) ?? null,
    designerName: resolveDesignerName(row.designer_name as string | undefined),
    groups: rows.map((g) => ({
      category: g.category as string,
      words: g.words as string[],
      difficulty: g.difficulty as 1 | 2 | 3 | 4,
      hintWord: (g.hint_word as string) ?? null,
    })),
    wordOrder: (row.word_order as string[]) ?? null,
    rainbowHerring: (row.rainbow_herring as string[]) ?? null,
    rainbowCategoryName: (row.rainbow_category_name as string) ?? null,
    rainbowHintWord: (row.rainbow_hint_word as string) ?? null,
    isEmojiPuzzle: (row.is_emoji_puzzle as boolean) ?? false,
    // Same read as the real loader (src/lib/puzzles.ts): the column decides,
    // and a row that predates it defaults to sorted.
    alphabetizeCompleted: (row.alphabetize_completed as boolean) ?? true,
    theme: (row.theme as string) ?? null,
    versionId: (row.current_version_id as string) ?? null,
  };
}

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
    for (let i = 0; i < 25; i++) {
      await new Promise((r) => setTimeout(r, 0));
    }
  });
}

function mount(p: Puzzle, opts: Record<string, unknown> = {}) {
  return renderHook(({ o }) => useGame(p, o as never), {
    initialProps: { o: opts },
  });
}

async function guess(view: ReturnType<typeof mount>, words: string[]) {
  await act(async () => {
    view.result.current.deselectAll();
  });
  await act(async () => {
    for (const w of words) view.result.current.toggleWord(w);
  });
  await act(async () => {
    view.result.current.submitGuess();
  });
  await settle();
}

async function winGame(view: ReturnType<typeof mount>, p: Puzzle) {
  for (const g of p.groups) await guess(view, g.words);
}

/**
 * Four distinct, genuinely wrong guesses (one word per category — never a
 * full category match) that DELIBERATELY avoid the fixture's Rainbow answer
 * (index 0 of each group, ["y1","g1","b1","r1"]), so none of them is
 * mistaken for finding the Rainbow or repeats an earlier guess.
 */
async function loseGame(view: ReturnType<typeof mount>, p: Puzzle) {
  const sets = [
    p.groups.map((g) => g.words[1]),
    p.groups.map((g) => g.words[2]),
    p.groups.map((g) => g.words[3]),
    [p.groups[0].words[1], p.groups[1].words[2], p.groups[2].words[3], p.groups[3].words[1]],
  ];
  for (const words of sets) await guess(view, words);
}

async function mintDeviceIdentity() {
  const { data } = await db.rpc("create_device_identity");
  return (Array.isArray(data) ? data[0] : data) as {
    device_id: string;
    device_token: string;
  };
}

beforeEach(async () => {
  reduceMotion();

  for (let i = 0; i < 5; i++) {
    await new Promise((r) => setTimeout(r, 10));
  }

  db.tables.game_sessions = [];
  db.tables.guess_events = [];
  db.tables.hint_events = [];
  db.tables.game_results = [];
  db.tables.user_streaks = [];
  db.tables.device_identities = [];
  db.tables.account_onboarding = [];
  db.tables.puzzle_aggregates = [];
  db.tables.puzzles = [];
  db.tables.puzzle_groups = [];
  db.tables.puzzle_versions = [];
  db.tables.beta_playtests = [];
  db.tables.beta_feedback = [];
  db.failAggregateWrites = 0;
  db.rpcUnavailable = false;

  const identity = await mintDeviceIdentity();

  localStorage.clear();
  sessionStorage.clear();
  localStorage.setItem("rc-device-id", identity.device_id);
  localStorage.setItem("rc-device-token", identity.device_token);

  db.signIn(null);
  db.writeLog = [];
  db.rpcLog = [];
});

// ── A/B/C. /beta visibility ────────────────────────────────────────────────
describe("A/B/C. /beta puzzle visibility", () => {
  it("excludes a Draft puzzle, excludes a Published puzzle, and includes a Beta puzzle — anonymously", async () => {
    const { data: draft } = await adminSave(null, V1_CONTENT, {
      date: "2026-10-01",
      is_published: false,
      is_beta: false,
    });
    const { data: published } = await adminSave(null, V1_CONTENT, {
      date: "2026-10-02",
      is_published: true,
      is_beta: false,
    });
    const { data: beta } = await adminSave(null, V1_CONTENT, {
      date: "2026-10-03",
      is_published: false,
      is_beta: true,
    });

    // Anonymous caller — no sign-in at all.
    db.signIn(null);

    const list = await getBetaPuzzles();
    const listIds = list.map((p) => p.id);
    expect(listIds).toContain(beta!.puzzle_id);
    expect(listIds).not.toContain(draft!.puzzle_id);
    expect(listIds).not.toContain(published!.puzzle_id);

    expect(await getBetaPuzzleById(beta!.puzzle_id as string)).not.toBeNull();
    expect(await getBetaPuzzleById(draft!.puzzle_id as string)).toBeNull();
    expect(await getBetaPuzzleById(published!.puzzle_id as string)).toBeNull();
  });
});

// ── D/E. Beta play writes only beta tracking ───────────────────────────────
describe("D/E. a completed Beta game writes only Beta-specific tracking", () => {
  it("wins without touching any official table, and records exactly one completed beta_playtests row", async () => {
    const { data } = await adminSave(null, V1_CONTENT, {
      date: "2026-10-04",
      is_published: false,
      is_beta: true,
    });
    const puzzleId = data!.puzzle_id as string;
    const puzzle = currentPuzzle(puzzleId);

    // Isolate the assertion below to what GAMEPLAY writes, not the admin
    // setup that created the puzzle.
    db.writeLog = [];

    const view = mount(puzzle, { mode: "beta" });
    await winGame(view, puzzle);

    expect(db.tables.game_sessions).toHaveLength(0);
    expect(db.tables.guess_events).toHaveLength(0);
    expect(db.tables.hint_events).toHaveLength(0);
    expect(db.tables.game_results).toHaveLength(0);
    expect(db.tables.user_streaks).toHaveLength(0);
    expect(db.tables.puzzle_aggregates).toHaveLength(0);

    const runs = playtests().filter((r) => r.puzzle_id === puzzleId);
    expect(runs).toHaveLength(1);
    expect(runs[0].status).toBe("completed");
    expect(runs[0].won).toBe(true);
    expect(runs[0].puzzle_version_id).toBe(puzzle.versionId);

    // Every write this game made landed only in beta_playtests.
    const tablesWritten = new Set(db.writeLog.map((w) => w.table));
    expect(tablesWritten).toEqual(new Set(["beta_playtests"]));
  });

  it("loses without touching any official table", async () => {
    const { data } = await adminSave(null, V1_CONTENT, {
      date: "2026-10-05",
      is_published: false,
      is_beta: true,
    });
    const puzzle = currentPuzzle(data!.puzzle_id as string);

    const view = mount(puzzle, { mode: "beta" });
    await loseGame(view, puzzle);

    expect(db.tables.game_sessions).toHaveLength(0);
    const run = playtests().find((r) => r.puzzle_id === puzzle.id)!;
    expect(run.status).toBe("completed");
    expect(run.won).toBe(false);
  });

  it("a page view alone creates no beta_playtests row (lazy start on first meaningful action)", async () => {
    const { data } = await adminSave(null, V1_CONTENT, {
      date: "2026-10-06",
      is_published: false,
      is_beta: true,
    });
    const puzzle = currentPuzzle(data!.puzzle_id as string);

    mount(puzzle, { mode: "beta" });
    await settle();

    expect(playtests()).toHaveLength(0);
  });
});

// ── F. Reset clears Beta progress and starts fresh on the newest version ──
describe("F. Reset Puzzle", () => {
  it("ends the in-progress playtest, flags it reset, and a fresh mount with cleared storage starts clean on the current version", async () => {
    const { data } = await adminSave(null, V1_CONTENT, {
      date: "2026-10-07",
      is_published: false,
      is_beta: true,
    });
    const puzzleId = data!.puzzle_id as string;
    const v1 = currentPuzzle(puzzleId);
    const storageKey = `beta:${puzzleId}`;

    const view = mount(v1, { mode: "beta" });
    // One guess (avoiding the Rainbow answer at index 0) — enough to start
    // the playtest and leave real progress.
    await guess(view, v1.groups.map((g) => g.words[1]));

    expect(playtests().filter((r) => r.puzzle_id === puzzleId)).toHaveLength(1);
    expect(loadProgress(storageKey)).not.toBeNull();

    await resetBetaPlaytest(puzzleId);
    clearProgress(storageKey);

    const run = playtests().find((r) => r.puzzle_id === puzzleId)!;
    expect(run.status).toBe("abandoned");
    expect(run.is_reset).toBe(true);
    expect(loadProgress(storageKey)).toBeNull();

    // The admin ships a content edit while the puzzle stays in Beta —
    // "reload the newest current version" means a player who resets now
    // gets V2, exactly like an Archive resume would.
    await adminSave(puzzleId, V2_CONTENT, {
      date: "2026-10-07",
      is_published: false,
      is_beta: true,
    });
    const v2 = currentPuzzle(puzzleId);
    expect(v2.versionId).not.toBe(v1.versionId);

    const freshView = mount(v2, { mode: "beta" });
    expect(freshView.result.current.state.solvedGroups).toEqual([]);
    expect(freshView.result.current.state.guessHistory).toEqual([]);
    expect(freshView.result.current.state.isComplete).toBe(false);
  });

  it("resetting after a completed game keeps the real result but still counts as a reset", async () => {
    const { data } = await adminSave(null, V1_CONTENT, {
      date: "2026-10-08",
      is_published: false,
      is_beta: true,
    });
    const puzzle = currentPuzzle(data!.puzzle_id as string);
    const view = mount(puzzle, { mode: "beta" });
    await winGame(view, puzzle);

    await resetBetaPlaytest(puzzle.id);

    const run = playtests().find((r) => r.puzzle_id === puzzle.id)!;
    // The real completed result is preserved — a reset must never erase it.
    expect(run.status).toBe("completed");
    expect(run.won).toBe(true);
    expect(run.is_reset).toBe(true);
  });
});

// ── G. Feedback is attached to the exact puzzle version ────────────────────
describe("G. feedback pins the exact version", () => {
  it("keeps the version it was submitted against even after the puzzle is edited again", async () => {
    const { data } = await adminSave(null, V1_CONTENT, {
      date: "2026-10-09",
      is_published: false,
      is_beta: true,
    });
    const puzzleId = data!.puzzle_id as string;
    const v1 = currentPuzzle(puzzleId);

    const ok = await submitBetaFeedback({
      puzzleId,
      puzzleVersionId: v1.versionId!,
      playtestId: null,
      testerName: "Casey",
      funRating: 4,
      difficultyRating: 3,
      rainbowFairnessRating: 5,
      confusingOrIncorrect: "",
      additionalComments: "Fun!",
      wouldPlayAgain: true,
    });
    expect(ok).toBe(true);

    await adminSave(puzzleId, V2_CONTENT, {
      date: "2026-10-09",
      is_published: false,
      is_beta: true,
    });
    const v2 = currentPuzzle(puzzleId);
    expect(v2.versionId).not.toBe(v1.versionId);

    const row = feedback().find((f) => f.puzzle_id === puzzleId)!;
    expect(row.puzzle_version_id).toBe(v1.versionId);
    expect(row.puzzle_version_id).not.toBe(v2.versionId);
  });
});

// ── H. Status changes never create a content version ───────────────────────
describe("H. Draft/Beta/Published transitions are metadata-only", () => {
  it("cycling through every status keeps exactly one version", async () => {
    const { data } = await adminSave(null, V1_CONTENT, {
      date: "2026-10-10",
      is_published: false,
      is_beta: false,
    });
    const puzzleId = data!.puzzle_id as string;
    expect(versions().filter((v) => v.puzzle_id === puzzleId)).toHaveLength(1);

    await adminSave(puzzleId, V1_CONTENT, { date: "2026-10-10", is_published: false, is_beta: true });
    await adminSave(puzzleId, V1_CONTENT, { date: "2026-10-10", is_published: true, is_beta: false });
    await adminSave(puzzleId, V1_CONTENT, { date: "2026-10-10", is_published: false, is_beta: false });

    expect(versions().filter((v) => v.puzzle_id === puzzleId)).toHaveLength(1);
  });

  it("refuses to save a puzzle as both Beta and Published", async () => {
    const { error } = await adminSave(null, V1_CONTENT, {
      date: "2026-10-11",
      is_published: true,
      is_beta: true,
    });
    expect(error).toBeTruthy();
  });
});

// ── I. Promotion: Beta -> Published ─────────────────────────────────────────
describe("I. promoting a Beta puzzle to Published", () => {
  it("removes it from /beta, keeps its content, and starts with zero official plays despite prior Beta plays", async () => {
    const { data } = await adminSave(null, V1_CONTENT, {
      date: "2026-10-12",
      is_published: false,
      is_beta: true,
    });
    const puzzleId = data!.puzzle_id as string;
    const puzzle = currentPuzzle(puzzleId);

    // Play it as Beta first.
    const view = mount(puzzle, { mode: "beta" });
    await winGame(view, puzzle);
    expect(playtests().filter((r) => r.puzzle_id === puzzleId)).toHaveLength(1);
    expect(db.tables.game_sessions.filter((s) => s.puzzle_id === puzzleId)).toHaveLength(0);

    // Promote — same id, same content, status flips.
    await adminSave(puzzleId, V1_CONTENT, { date: "2026-10-12", is_published: true, is_beta: false });

    db.signIn(null);
    const betaList = await getBetaPuzzles();
    expect(betaList.map((p) => p.id)).not.toContain(puzzleId);

    const promoted = db.tables.puzzles.find((p) => p.id === puzzleId)!;
    expect(promoted.is_published).toBe(true);
    expect(promoted.is_beta).toBe(false);
    expect(groups().filter((g) => g.puzzle_id === puzzleId)).toHaveLength(4);

    // Beta plays never became official plays.
    expect(db.tables.game_sessions.filter((s) => s.puzzle_id === puzzleId)).toHaveLength(0);
  });
});

// ── J. Existing Published gameplay is unaffected ───────────────────────────
describe("J. official Published gameplay still works exactly as before", () => {
  it("a normal (non-beta) win writes the official session, result and streak", async () => {
    const { data } = await adminSave(null, V1_CONTENT, {
      date: "2026-10-13",
      is_published: true,
      is_beta: false,
    });
    const puzzle = currentPuzzle(data!.puzzle_id as string);

    const view = mount(puzzle);
    await winGame(view, puzzle);

    expect(db.tables.game_sessions.filter((s) => s.puzzle_id === puzzle.id)).toHaveLength(1);
    expect(db.tables.game_sessions[0].is_official).toBe(true);
    expect(db.tables.user_streaks).toHaveLength(1);
    expect(playtests()).toHaveLength(0);
  });
});

// ── K. Structural isolation is enforced by the DATABASE, not the frontend ──
//
// These call create_game_session directly, the way any client that knew (or
// enumerated) a puzzle id could — never through useGame/useGameSession, and
// never relying on the app only ever asking for the RPC it "should". This is
// what 20260918030000 actually fixed: create_game_session previously had no
// puzzle-status check at all and was, as of 20260917000000, the ONLY insert
// path into game_sessions for anon/authenticated.
describe("K. create_game_session refuses a puzzle that is not currently Published", () => {
  async function tryCreateOfficialSession(puzzleId: string, puzzleVersionId: string | null) {
    const identity = await mintDeviceIdentity();
    localStorage.setItem("rc-device-id", identity.device_id);
    localStorage.setItem("rc-device-token", identity.device_token);
    return db.rpc("create_game_session", {
      _puzzle_id: puzzleId,
      _device_id: identity.device_id,
      _device_token: identity.device_token,
      _entry_context: "daily_home",
      _active_time_seconds: 0,
      _mistakes: 0,
      _puzzle_version_id: puzzleVersionId,
    });
  }

  it("refuses a Draft puzzle (creates no game_sessions row)", async () => {
    const { data } = await adminSave(null, V1_CONTENT, {
      date: "2026-10-14",
      is_published: false,
      is_beta: false,
    });
    const puzzleId = data!.puzzle_id as string;
    const puzzle = currentPuzzle(puzzleId);

    const { data: sessionId, error } = await tryCreateOfficialSession(puzzleId, puzzle.versionId);

    expect(error).toBeNull();
    expect(sessionId).toBeNull();
    expect(db.tables.game_sessions.filter((s) => s.puzzle_id === puzzleId)).toHaveLength(0);
  });

  it("refuses a Beta puzzle (creates no game_sessions row) even called directly, bypassing the frontend entirely", async () => {
    const { data } = await adminSave(null, V1_CONTENT, {
      date: "2026-10-15",
      is_published: false,
      is_beta: true,
    });
    const puzzleId = data!.puzzle_id as string;
    const puzzle = currentPuzzle(puzzleId);

    const { data: sessionId, error } = await tryCreateOfficialSession(puzzleId, puzzle.versionId);

    expect(error).toBeNull();
    expect(sessionId).toBeNull();
    expect(db.tables.game_sessions.filter((s) => s.puzzle_id === puzzleId)).toHaveLength(0);
  });

  it("still succeeds for a Published puzzle", async () => {
    const { data } = await adminSave(null, V1_CONTENT, {
      date: "2026-10-16",
      is_published: true,
      is_beta: false,
    });
    const puzzleId = data!.puzzle_id as string;
    const puzzle = currentPuzzle(puzzleId);

    const { data: sessionId, error } = await tryCreateOfficialSession(puzzleId, puzzle.versionId);

    expect(error).toBeNull();
    expect(sessionId).not.toBeNull();
    expect(db.tables.game_sessions.filter((s) => s.puzzle_id === puzzleId)).toHaveLength(1);
  });

  it("does not strand an already-valid official session when an admin later changes the puzzle's status", async () => {
    const { data } = await adminSave(null, V1_CONTENT, {
      date: "2026-10-17",
      is_published: true,
      is_beta: false,
    });
    const puzzleId = data!.puzzle_id as string;
    const puzzle = currentPuzzle(puzzleId);

    const { data: sessionId } = await tryCreateOfficialSession(puzzleId, puzzle.versionId);
    expect(sessionId).not.toBeNull();

    // The admin un-publishes it (a real workflow: pulling a puzzle back to
    // Draft, or — if it were ever a valid transition — Beta) AFTER this
    // player already has a live session.
    await adminSave(puzzleId, V1_CONTENT, { date: "2026-10-17", is_published: false, is_beta: false });
    expect(db.tables.puzzles.find((p) => p.id === puzzleId)!.is_published).toBe(false);

    // touch_game_session and finalize_game_session authorize purely by
    // session_capability_ok (ownership of the EXISTING row) — never by
    // re-checking the puzzle's current status — so this player's game is
    // completely unaffected by the status change. Same device/localStorage
    // identity tryCreateOfficialSession minted and stored above.
    const touchResult = await db.rpc("touch_game_session", {
      _session_id: sessionId,
      _device_id: localStorage.getItem("rc-device-id"),
      _device_token: localStorage.getItem("rc-device-token"),
      _active_time_seconds: 10,
      _mistakes: 1,
    });
    expect(touchResult.data).toBe(true);

    const finalizeResult = await db.rpc("finalize_game_session", {
      _session_id: sessionId,
      _device_id: localStorage.getItem("rc-device-id"),
      _device_token: localStorage.getItem("rc-device-token"),
      _won: true,
      _mistakes: 1,
      _active_time_seconds: 10,
      _found_rainbow: false,
      _rainbow_solve_index: null,
      _solve_order: ["orange", "green", "blue", "red"],
      _hints_used: false,
      _share_grid: "",
      _skip_streak: false,
      _local_date: "2026-10-17",
    });
    expect(finalizeResult.data).toBe(true);

    const session = db.tables.game_sessions.find((s) => s.id === sessionId)!;
    expect(session.status).toBe("won");
    expect(session.is_official).toBe(true);
  });
});

// ── Beta table access requires the device credential, never direct table access ──
describe("device credential + direct-table-access guards on beta tables", () => {
  it("start_beta_playtest refuses an unproven device", async () => {
    const { data } = await adminSave(null, V1_CONTENT, {
      date: "2026-10-18",
      is_published: false,
      is_beta: true,
    });
    const puzzleId = data!.puzzle_id as string;
    const puzzle = currentPuzzle(puzzleId);

    const { data: playtestId, error } = await db.rpc("start_beta_playtest", {
      _puzzle_id: puzzleId,
      _puzzle_version_id: puzzle.versionId,
      _device_id: "someone-elses-device",
      _device_token: "wrong-token",
    });
    expect(error).toBeNull();
    expect(playtestId).toBeNull();
    expect(playtests()).toHaveLength(0);
  });

  it("reset_beta_playtest and complete_beta_playtest refuse an unproven device", async () => {
    const { data } = await adminSave(null, V1_CONTENT, {
      date: "2026-10-19",
      is_published: false,
      is_beta: true,
    });
    const puzzle = currentPuzzle(data!.puzzle_id as string);
    const view = mount(puzzle, { mode: "beta" });
    await guess(view, puzzle.groups.map((g) => g.words[1]));
    const run = playtests().find((r) => r.puzzle_id === puzzle.id)!;

    const reset = await db.rpc("reset_beta_playtest", {
      _puzzle_id: puzzle.id,
      _device_id: "someone-elses-device",
      _device_token: "wrong-token",
    });
    expect(reset.data).toBe(false);
    expect(playtests().find((r) => r.id === run.id)!.is_reset).toBe(false);

    const complete = await db.rpc("complete_beta_playtest", {
      _playtest_id: run.id,
      _device_id: "someone-elses-device",
      _device_token: "wrong-token",
      _won: true,
      _mistakes: 0,
      _hints_used: false,
    });
    expect(complete.data).toBe(false);
    expect(playtests().find((r) => r.id === run.id)!.status).toBe("in_progress");
  });

  it("an anonymous (non-admin) caller cannot read, write or delete beta_playtests/beta_feedback directly", async () => {
    const { data } = await adminSave(null, V1_CONTENT, {
      date: "2026-10-20",
      is_published: false,
      is_beta: true,
    });
    const puzzleId = data!.puzzle_id as string;
    const puzzle = currentPuzzle(puzzleId);
    const view = mount(puzzle, { mode: "beta" });
    await winGame(view, puzzle);
    expect(playtests()).toHaveLength(1);

    db.signIn(null); // anonymous, no admin flag

    const selectResult = await db.from("beta_playtests").select("*");
    expect(selectResult.data).toEqual([]);

    const insertResult = await db.from("beta_playtests").insert({
      puzzle_id: puzzleId,
      puzzle_version_id: puzzle.versionId,
      device_id: "forged-device",
    });
    expect(insertResult.error).toBeTruthy();

    const updateResult = await db.from("beta_playtests").update({ won: true }).eq("puzzle_id", puzzleId);
    expect(updateResult.error).toBeTruthy();

    const feedbackSelect = await db.from("beta_feedback").select("*");
    expect(feedbackSelect.data).toEqual([]);
  });

  it("an admin CAN read beta_playtests/beta_feedback directly (the intended path for the Admin panel)", async () => {
    const { data } = await adminSave(null, V1_CONTENT, {
      date: "2026-10-21",
      is_published: false,
      is_beta: true,
    });
    const puzzleId = data!.puzzle_id as string;
    const puzzle = currentPuzzle(puzzleId);
    const view = mount(puzzle, { mode: "beta" });
    await winGame(view, puzzle);

    db.signIn(ADMIN_ID, { admin: true });
    const result = await db.from("beta_playtests").select("*");
    expect(result.data).toHaveLength(1);
    db.signIn(null);
  });
});
