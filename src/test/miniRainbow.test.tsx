/**
 * Mini 3×3 — the OPTIONAL Rainbow category.
 *
 * A Mini is Classic (three categories) or Rainbow (three categories plus a
 * hidden bonus made of one answer from each). This suite proves that the
 * same shared engine runs both, that a Rainbow Mini expects THREE answers
 * while a Full still expects four, and that nothing about a Classic Mini or
 * any Full puzzle changed.
 *
 * Everything drives the REAL code: useGame, the real progress layer, the real
 * builder hook and payload builders, and the same in-memory fake Supabase the
 * durable-session suite uses (whose validation mirrors the migrations).
 */
import { describe, it, expect, beforeEach, vi } from "vitest";
import { act, renderHook } from "@testing-library/react";
import { FakeSupabase } from "./fakeSupabase";
import type { Puzzle } from "@/lib/types";

vi.setConfig({ testTimeout: 20000 });

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
import { useBuilderForm } from "@/hooks/useBuilderForm";
import { loadProgress, progressKey } from "@/lib/gameProgress";
import { MINI_FORMAT, FULL_FORMAT, progressStorageId, rainbowHerringFor } from "@/lib/puzzleFormat";
import { buildContentPayload, builderContentInput } from "@/lib/builder/contentPayload";

const RAINBOW_MINI_ID = "mini-rainbow-1";
const CLASSIC_MINI_ID = "mini-classic-1";
const FULL_ID = "full-rainbow-1";

/** A Rainbow Mini: g1 (Green), b1 (Blue), r1 (Red) are the bonus category. */
const rainbowMini: Puzzle = {
  id: RAINBOW_MINI_ID,
  format: "mini",
  date: "2026-09-21",
  title: "Mini #7",
  designerName: "Sam West",
  alphabetizeCompleted: true,
  groups: [
    { category: "Green", words: ["g1", "g2", "g3"], difficulty: 2 },
    { category: "Blue", words: ["b1", "b2", "b3"], difficulty: 3 },
    { category: "Red", words: ["r1", "r2", "r3"], difficulty: 4 },
  ],
  rainbowHerring: ["g1", "b1", "r1"],
  rainbowCategoryName: "Hidden Trio",
  rainbowHintWord: "clue",
};

const classicMini: Puzzle = {
  ...rainbowMini,
  id: CLASSIC_MINI_ID,
  title: "Mini #8",
  rainbowHerring: null,
  rainbowCategoryName: null,
  rainbowHintWord: null,
};

const fullRainbow: Puzzle = {
  id: FULL_ID,
  date: "2026-09-21",
  title: "#500",
  designerName: "Sam West",
  alphabetizeCompleted: true,
  groups: [
    { category: "Yellow", words: ["y1", "y2", "y3", "y4"], difficulty: 1 },
    { category: "Green", words: ["gg1", "gg2", "gg3", "gg4"], difficulty: 2 },
    { category: "Blue", words: ["bb1", "bb2", "bb3", "bb4"], difficulty: 3 },
    { category: "Red", words: ["rr1", "rr2", "rr3", "rr4"], difficulty: 4 },
  ],
  rainbowHerring: ["y1", "gg1", "bb1", "rr1"],
  rainbowCategoryName: "Rainbow",
};

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

function mount(p: Puzzle, opts: Record<string, unknown> = {}) {
  return renderHook(() => useGame(p, opts as never));
}

async function guess(view: ReturnType<typeof mount>, words: string[]) {
  await act(async () => { view.result.current.deselectAll(); });
  await act(async () => { for (const w of words) view.result.current.toggleWord(w); });
  await act(async () => { view.result.current.submitGuess(); });
  await settle();
  await act(async () => { view.result.current.releaseRevealHold(); });
  await settle();
}

async function mintDeviceIdentity() {
  const { data } = await db.rpc("create_device_identity");
  return (Array.isArray(data) ? data[0] : data) as { device_id: string; device_token: string };
}

beforeEach(async () => {
  reduceMotion();
  for (let i = 0; i < 5; i++) await new Promise((r) => setTimeout(r, 10));
  const identity = await mintDeviceIdentity();

  db.tables.game_sessions = [];
  db.tables.guess_events = [];
  db.tables.hint_events = [];
  db.tables.game_results = [];
  db.tables.user_streaks = [];
  db.tables.account_onboarding = [];
  db.tables.puzzle_aggregates = [];
  db.tables.puzzle_versions = [];
  db.tables.puzzle_groups = [];
  db.tables.custom_puzzles = [];

  localStorage.clear();
  sessionStorage.clear();
  localStorage.setItem("rc-device-id", identity.device_id);
  localStorage.setItem("rc-device-token", identity.device_token);

  db.tables.puzzles = [
    { id: RAINBOW_MINI_ID, format: "mini", date: "2026-09-21", rainbow_herring: ["g1", "b1", "r1"], is_published: true },
    { id: CLASSIC_MINI_ID, format: "mini", date: "2026-09-20", rainbow_herring: null, is_published: true },
    { id: FULL_ID, date: "2026-09-21", rainbow_herring: fullRainbow.rainbowHerring, is_published: true },
  ];
  db.signIn(null);
  db.writeLog = [];
  db.rpcLog = [];
});

// ───────────────────────────────────────────────────────────────────────────
// The Rainbow is optional, per puzzle, and sized to the format
// ───────────────────────────────────────────────────────────────────────────

describe("a Mini Rainbow is optional and three answers wide", () => {
  it("a Classic Mini carries no Rainbow", () => {
    expect(rainbowHerringFor(classicMini)).toBeNull();
  });

  it("a Rainbow Mini carries exactly three — one per category", () => {
    const herring = rainbowHerringFor(rainbowMini);
    expect(herring).toEqual(["g1", "b1", "r1"]);
    expect(herring).toHaveLength(MINI_FORMAT.categoryCount);
    // One answer from each of Green, Blue and Red.
    for (const group of rainbowMini.groups) {
      expect(group.words.filter((w) => herring!.includes(w))).toHaveLength(1);
    }
  });

  it("a Full Rainbow still carries four", () => {
    expect(rainbowHerringFor(fullRainbow)).toHaveLength(FULL_FORMAT.categoryCount);
    expect(rainbowHerringFor(fullRainbow)).toHaveLength(4);
  });
});

// ───────────────────────────────────────────────────────────────────────────
// Gameplay
// ───────────────────────────────────────────────────────────────────────────

describe("Rainbow Mini gameplay", () => {
  it("finds the Rainbow from three answers, one per category, without a mistake", async () => {
    const view = mount(rainbowMini);
    await guess(view, ["g1", "b1", "r1"]);
    expect(view.result.current.state.gotRainbow).toBe(true);
    expect(view.result.current.state.mistakes).toBe(0);
    const attempt = view.result.current.state.guessHistory[0];
    expect(attempt.isRainbow).toBe(true);
    // Found before anything else was solved.
    expect(view.result.current.state.rainbowSolveIndex).toBe(0);
  });

  it("records the Rainbow at the position it was actually found", async () => {
    const view = mount(rainbowMini);
    await guess(view, ["g1", "g2", "g3"]);
    await guess(view, ["b1", "b2", "b3"]);
    await guess(view, ["g1", "b1", "r1"]);
    expect(view.result.current.state.gotRainbow).toBe(true);
    // Two categories were already solved when it was spotted.
    expect(view.result.current.state.rainbowSolveIndex).toBe(2);
  });

  it("does NOT finalize while the Rainbow is still unresolved", async () => {
    const view = mount(rainbowMini);
    await guess(view, ["g1", "g2", "g3"]);
    await guess(view, ["b1", "b2", "b3"]);
    await guess(view, ["r1", "r2", "r3"]);
    await settle();
    // The board is finished and won...
    expect(view.result.current.state.isComplete).toBe(true);
    expect(view.result.current.state.isWon).toBe(true);
    expect(view.result.current.state.gotRainbow).toBe(false);
    // ...but the run is NOT fully resolved: the Rainbow bonus is still to
    // come, so hints must stay live rather than flipping to view-only.
    expect(view.result.current.hintsViewOnly).toBe(false);
  });

  it("treats the run as resolved once the Rainbow result is known", async () => {
    const view = mount(rainbowMini, { rainbowResolved: true });
    await guess(view, ["g1", "g2", "g3"]);
    await guess(view, ["b1", "b2", "b3"]);
    await guess(view, ["r1", "r2", "r3"]);
    await settle();
    expect(view.result.current.state.isComplete).toBe(true);
    expect(view.result.current.hintsViewOnly).toBe(true);
  });

  it("a WON Rainbow is recorded through the shared result model", async () => {
    const view = mount(rainbowMini);
    await guess(view, ["g1", "b1", "r1"]);
    await guess(view, ["g1", "g2", "g3"]);
    await guess(view, ["b1", "b2", "b3"]);
    await guess(view, ["r1", "r2", "r3"]);
    await settle();
    expect(view.result.current.state.isWon).toBe(true);
    const session = db.tables.game_sessions.find((s) => s.puzzle_id === RAINBOW_MINI_ID);
    expect(session?.found_rainbow).toBe(true);
    expect(session?.format).toBe("mini");
    expect(session?.won).toBe(true);
  });

  it("a FAILED Rainbow leaves the win intact and records found_rainbow false", async () => {
    // Board solved normally, Rainbow never spotted.
    const view = mount(rainbowMini);
    await guess(view, ["g1", "g2", "g3"]);
    await guess(view, ["b1", "b2", "b3"]);
    await guess(view, ["r1", "r2", "r3"]);
    await settle();
    const session = db.tables.game_sessions.find((s) => s.puzzle_id === RAINBOW_MINI_ID);
    expect(session?.won).toBe(true);
    expect(session?.found_rainbow).toBeFalsy();
    expect(view.result.current.state.gotRainbow).toBe(false);
  });

  it("a Classic Mini ends as soon as its three categories are solved", async () => {
    const view = mount(classicMini);
    await guess(view, ["g1", "g2", "g3"]);
    await guess(view, ["b1", "b2", "b3"]);
    await guess(view, ["r1", "r2", "r3"]);
    await settle();
    expect(view.result.current.state.isComplete).toBe(true);
    expect(view.result.current.state.isWon).toBe(true);
    // Nothing left to resolve — hints are view-only immediately.
    expect(view.result.current.hintsViewOnly).toBe(true);
  });

  it("an ALMOST Rainbow near-miss fires on a Mini", async () => {
    const view = mount(rainbowMini);
    // Two of the three Rainbow answers, plus a third that is not one.
    await act(async () => { view.result.current.deselectAll(); });
    await act(async () => { ["g1", "b1", "r2"].forEach((w) => view.result.current.toggleWord(w)); });
    await act(async () => { view.result.current.submitGuess(); });
    await settle();
    expect(view.result.current.almostRainbow).toBe(true);
  });
});

// ───────────────────────────────────────────────────────────────────────────
// Restore / idempotency
// ───────────────────────────────────────────────────────────────────────────

describe("restored Rainbow Mini state", () => {
  it("resumes a found Rainbow after a refresh without re-recording it", async () => {
    const first = mount(rainbowMini);
    await guess(first, ["g1", "b1", "r1"]);
    await guess(first, ["g1", "g2", "g3"]);
    expect(first.result.current.state.gotRainbow).toBe(true);
    first.unmount();
    await settle();

    const saved = loadProgress(progressStorageId(RAINBOW_MINI_ID, MINI_FORMAT));
    expect(saved?.gotRainbow).toBe(true);
    expect(saved?.rainbowSolveIndex).toBe(0);

    const resumed = mount(rainbowMini);
    await settle();
    expect(resumed.result.current.state.gotRainbow).toBe(true);
    expect(resumed.result.current.state.rainbowSolveIndex).toBe(0);
    // Exactly ONE Rainbow row in the history — the refresh added none.
    const rainbowRows = resumed.result.current.state.guessHistory.filter((g) => g.isRainbow);
    expect(rainbowRows).toHaveLength(1);
  });

  it("does not create a second session or duplicate results across a remount", async () => {
    const first = mount(rainbowMini);
    await guess(first, ["g1", "b1", "r1"]);
    await guess(first, ["g1", "g2", "g3"]);
    await guess(first, ["b1", "b2", "b3"]);
    await guess(first, ["r1", "r2", "r3"]);
    await settle();
    first.unmount();
    await settle();

    const before = db.tables.game_sessions.filter((s) => s.puzzle_id === RAINBOW_MINI_ID).length;
    expect(before).toBe(1);

    const resumed = mount(rainbowMini);
    await settle();
    expect(resumed.result.current.state.isComplete).toBe(true);
    expect(resumed.result.current.state.gotRainbow).toBe(true);
    expect(db.tables.game_sessions.filter((s) => s.puzzle_id === RAINBOW_MINI_ID)).toHaveLength(1);
  });

  it("a hint revealed before a refresh is not counted twice afterwards", async () => {
    const first = mount(rainbowMini, { smallHintUsed: true });
    await settle();
    await guess(first, ["g1", "g2", "g3"]);
    const hintsAfterFirst = db.tables.hint_events.length;
    expect(hintsAfterFirst).toBe(1);
    first.unmount();
    await settle();

    const resumed = mount(rainbowMini, { smallHintUsed: true });
    await settle();
    await guess(resumed, ["b1", "b2", "b3"]);
    expect(db.tables.hint_events).toHaveLength(1);
    // And exactly one marker in the share history.
    const markers = resumed.result.current.state.guessHistory.filter(
      (g) => g.isHintMarker && g.hintType === "small"
    );
    expect(markers).toHaveLength(1);
  });
});

// ───────────────────────────────────────────────────────────────────────────
// Streaks stay per-format even with a Rainbow in play
// ───────────────────────────────────────────────────────────────────────────

describe("statistics", () => {
  it("a Rainbow Mini completion touches only the Mini streak", async () => {
    const view = mount(rainbowMini);
    await guess(view, ["g1", "b1", "r1"]);
    await guess(view, ["g1", "g2", "g3"]);
    await guess(view, ["b1", "b2", "b3"]);
    await guess(view, ["r1", "r2", "r3"]);
    await settle();

    const streaks = db.tables.user_streaks;
    expect(streaks.every((s) => s.format === "mini")).toBe(true);
    expect(streaks.some((s) => s.format === "full")).toBe(false);
  });
});

// ───────────────────────────────────────────────────────────────────────────
// The builder + save path
// ───────────────────────────────────────────────────────────────────────────

const MINI_ANSWERS = [
  ["Hood", "Tire", "Trunk"],
  ["Mars", "Mercury", "Swift"],
  ["Bird", "Dog", "White"],
];

function fillMini(result: { current: ReturnType<typeof useBuilderForm> }) {
  act(() => {
    MINI_ANSWERS.forEach((words, i) => {
      result.current.updateCategoryName(i, `Cat ${i + 1}`);
      result.current.updateAnswersRaw(i, words.join(", "));
    });
  });
}

/** Picks the first answer of each category as the Rainbow. */
function pickRainbow(result: { current: ReturnType<typeof useBuilderForm> }) {
  act(() => {
    result.current.groups.forEach((g, i) => {
      result.current.selectRainbowAnswer(i, g.answers[0].id);
    });
  });
}

describe("the Admin builder builds a Rainbow Mini", () => {
  // admin_save_puzzle requires the admin role — these tests exercise the real
  // save path, so they sign in as one.
  beforeEach(() => {
    db.signIn("admin-user", { admin: true });
  });

  it("a new Mini starts CLASSIC — Rainbow is opt-in, not the default", () => {
    const { result } = renderHook(() => useBuilderForm("mini"));
    expect(result.current.style).toBe("classic");
    expect(result.current.rainbowComplete).toBe(false);
  });

  it("a new Full still starts on Rainbow", () => {
    const { result } = renderHook(() => useBuilderForm("full"));
    expect(result.current.style).toBe("rainbow");
  });

  it("offers exactly three Rainbow slots and completes when all three are picked", () => {
    const { result } = renderHook(() => useBuilderForm("mini"));
    fillMini(result);
    expect(result.current.rainbowHerringIds).toHaveLength(3);
    expect(result.current.rainbowComplete).toBe(false);

    act(() => { result.current.selectRainbowAnswer(0, result.current.groups[0].answers[0].id); });
    act(() => { result.current.selectRainbowAnswer(1, result.current.groups[1].answers[0].id); });
    expect(result.current.rainbowComplete).toBe(false);
    act(() => { result.current.selectRainbowAnswer(2, result.current.groups[2].answers[0].id); });
    expect(result.current.rainbowComplete).toBe(true);
  });

  it("builds a payload carrying three Rainbow answers, normalized", () => {
    const { result } = renderHook(() => useBuilderForm("mini"));
    fillMini(result);
    pickRainbow(result);
    act(() => { result.current.setRainbowCategoryName("Hidden Trio"); });
    act(() => { result.current.setRainbowHintWord("clue"); });
    act(() => { result.current.setRainbowCategoryEmoji("🌈"); });

    const payload = buildContentPayload(builderContentInput(result.current, false));
    expect(payload.format).toBe("mini");
    // Uppercased by the shared normalizer, exactly like the group words —
    // this is the bug class that used to make a retyped mixed-case answer
    // fail validation as "not one of this puzzle's words".
    expect(payload.rainbow_herring).toEqual(["HOOD", "MARS", "BIRD"]);
    expect(payload.rainbow_category_name).toBe("Hidden Trio");
    expect(payload.rainbow_hint_word).toBe("clue");
    expect(payload.rainbow_category_emoji).toBe("🌈");
  });

  it("keeps the Rainbow selection through a trailing-comma edit", () => {
    const { result } = renderHook(() => useBuilderForm("mini"));
    fillMini(result);
    pickRainbow(result);
    expect(result.current.rainbowComplete).toBe(true);

    // The classic identity hazard: a trailing comma makes a new blank slot.
    act(() => { result.current.updateAnswersRaw(0, "Hood, Tire, Trunk,"); });
    act(() => { result.current.updateAnswersRaw(0, "Hood, Tire, Trunk"); });

    expect(result.current.rainbowComplete).toBe(true);
    const payload = buildContentPayload(builderContentInput(result.current, false));
    expect(payload.rainbow_herring).toEqual(["HOOD", "MARS", "BIRD"]);
  });

  it("follows a Rainbow answer when its word is retyped", () => {
    const { result } = renderHook(() => useBuilderForm("mini"));
    fillMini(result);
    pickRainbow(result);
    // Rename the FIRST Green answer; the Rainbow selection is by id, so it
    // must follow the slot rather than point at a word that no longer exists.
    act(() => { result.current.updateAnswersRaw(0, "Bonnet, Tire, Trunk"); });
    expect(result.current.rainbowComplete).toBe(true);
    const payload = buildContentPayload(builderContentInput(result.current, false));
    expect(payload.rainbow_herring).toEqual(["BONNET", "MARS", "BIRD"]);
  });

  it("switching format clears the Rainbow to the new size", () => {
    const { result } = renderHook(() => useBuilderForm("mini"));
    fillMini(result);
    pickRainbow(result);
    act(() => { result.current.changeFormat("full"); });
    expect(result.current.format.id).toBe("full");
    expect(result.current.rainbowHerringIds).toHaveLength(4);
    expect(result.current.rainbowComplete).toBe(false);
  });

  it("saves, reloads and re-saves a Rainbow Mini without drift", async () => {
    const { result } = renderHook(() => useBuilderForm("mini"));
    fillMini(result);
    pickRainbow(result);
    act(() => { result.current.setRainbowCategoryName("Hidden Trio"); });
    const payload = buildContentPayload(builderContentInput(result.current, false));

    const saved = await db.rpc("admin_save_puzzle", {
      _puzzle_id: null,
      _metadata: { date: "2026-11-01", title: "Mini #9", is_published: true },
      _content: payload,
    });
    expect(saved.error).toBeNull();
    const puzzleId = (saved.data as { puzzle_id: string }).puzzle_id;
    const row = db.tables.puzzles.find((p) => p.id === puzzleId);
    expect(row?.format).toBe("mini");
    expect(row?.rainbow_herring).toEqual(["HOOD", "MARS", "BIRD"]);

    // Reload into a fresh builder, exactly as Admin's loadPuzzle does.
    const reopened = renderHook(() => useBuilderForm());
    act(() => {
      reopened.result.current.load({
        format: "mini",
        groups: MINI_ANSWERS.map((words, i) => ({
          category: `Cat ${i + 1}`,
          words: words.map((w) => w.toUpperCase()),
          difficulty: (i + 2) as 2 | 3 | 4,
          hintWord: null,
        })),
        wordOrder: (row?.word_order as string[]) ?? null,
        rainbowHerring: row?.rainbow_herring as string[],
        rainbowCategoryName: "Hidden Trio",
        rainbowHintWord: "",
        theme: "",
        alphabetizeCompleted: true,
        style: "rainbow",
      });
    });
    expect(reopened.result.current.format.id).toBe("mini");
    expect(reopened.result.current.style).toBe("rainbow");
    expect(reopened.result.current.rainbowComplete).toBe(true);

    // Re-saving the reloaded content creates NO new version.
    const again = await db.rpc("admin_save_puzzle", {
      _puzzle_id: puzzleId,
      _metadata: { date: "2026-11-01", title: "Mini #9", is_published: true },
      _content: buildContentPayload(builderContentInput(reopened.result.current, false)),
    });
    expect(again.error).toBeNull();
    expect((again.data as { created_version: boolean }).created_version).toBe(false);
  });

  it("refuses a Mini Rainbow with two answers from the same category", async () => {
    const { result } = renderHook(() => useBuilderForm("mini"));
    fillMini(result);
    const payload = buildContentPayload(builderContentInput(result.current, false));
    // Bypass the builder (which cannot express this) to prove the SAVE PATH
    // rejects it — the rule must live in the database, not only the form.
    const bad = { ...payload, rainbow_herring: ["HOOD", "TIRE", "MARS"] };
    const { error } = await db.rpc("admin_save_puzzle", {
      _puzzle_id: null,
      _metadata: { date: "2026-11-02", title: "Bad Mini" },
      _content: bad,
    });
    expect(error?.message).toMatch(/exactly one Rainbow answer/);
  });

  it("refuses a Mini Rainbow of four answers", async () => {
    const { result } = renderHook(() => useBuilderForm("mini"));
    fillMini(result);
    const payload = buildContentPayload(builderContentInput(result.current, false));
    const bad = { ...payload, rainbow_herring: ["HOOD", "MARS", "BIRD", "DOG"] };
    const { error } = await db.rpc("admin_save_puzzle", {
      _puzzle_id: null,
      _metadata: { date: "2026-11-03", title: "Bad Mini" },
      _content: bad,
    });
    expect(error?.message).toMatch(/exactly 3 words/);
  });

  it("a Classic Mini saves with no Rainbow fields required", async () => {
    const { result } = renderHook(() => useBuilderForm("mini"));
    fillMini(result);
    const payload = buildContentPayload(builderContentInput(result.current, false));
    expect(payload.rainbow_herring).toBeNull();
    expect(payload.rainbow_category_name).toBeNull();
    const { error, data } = await db.rpc("admin_save_puzzle", {
      _puzzle_id: null,
      _metadata: { date: "2026-11-04", title: "Mini #10", is_published: true },
      _content: payload,
    });
    expect(error).toBeNull();
    const row = db.tables.puzzles.find((p) => p.id === (data as { puzzle_id: string }).puzzle_id);
    expect(row?.rainbow_herring).toBeNull();
  });

  it("a FULL Rainbow still needs four answers, unchanged", async () => {
    const { result } = renderHook(() => useBuilderForm("full"));
    act(() => {
      [
        ["Blue", "Green", "Red", "Yellow"],
        ["Battery", "Hood", "Tire", "Trunk"],
        ["Houston", "Mars", "Mercury", "Swift"],
        ["Bird", "Dog", "Tree", "White"],
      ].forEach((words, i) => {
        result.current.updateCategoryName(i, `Cat ${i + 1}`);
        result.current.updateAnswersRaw(i, words.join(", "));
      });
    });
    expect(result.current.rainbowHerringIds).toHaveLength(4);
    act(() => {
      result.current.groups.forEach((g, i) => {
        result.current.selectRainbowAnswer(i, g.answers[0].id);
      });
    });
    expect(result.current.rainbowComplete).toBe(true);
    const payload = buildContentPayload(builderContentInput(result.current, false));
    expect(payload.rainbow_herring).toHaveLength(4);
    // Full emits no format key — the byte-identical-content contract.
    expect(payload.format).toBeUndefined();
    const { error } = await db.rpc("admin_save_puzzle", {
      _puzzle_id: null,
      _metadata: { date: "2026-11-05", title: "#501", is_published: true },
      _content: payload,
    });
    expect(error).toBeNull();
  });
});
