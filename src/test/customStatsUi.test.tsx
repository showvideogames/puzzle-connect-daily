/**
 * Custom puzzle stats access, the redesigned modal, and Replay, driven through
 * the real /custom/:shareId page, board and header against the Supabase fake.
 */
import { describe, it, expect, beforeEach, vi } from "vitest";
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { HelmetProvider } from "react-helmet-async";
import { FakeSupabase } from "./fakeSupabase";

vi.setConfig({ testTimeout: 30000 });

const db = new FakeSupabase();

vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    from: (t: string) => db.from(t),
    rpc: (n: string, a: Record<string, unknown>) => db.rpc(n, a),
    auth: {
      getUser: () => db.auth.getUser(),
      getSession: async () => ({ data: { session: null } }),
      onAuthStateChange: () => ({ data: { subscription: { unsubscribe: () => {} } } }),
      signOut: async () => {},
    },
  },
}));
vi.mock("canvas-confetti", () => ({ default: () => {} }));
vi.mock("@/lib/sounds", () => ({ playRainbowSound: () => {}, playGiftOpenSound: () => {} }));
vi.mock("@/lib/haptics", () => ({ vibrateSuccess: () => {}, vibrateError: () => {}, vibrateCelebration: () => {} }));
vi.mock("@/lib/analytics", () => ({ trackEvent: () => {} }));

import { createCustomPuzzle, type CreateCustomPuzzleInput } from "@/lib/customPuzzles";
import { loadProgress } from "@/lib/gameProgress";
import { CustomStatsModal } from "@/components/CustomStatsModal";
import CustomPuzzle from "@/pages/CustomPuzzle";

const GROUPS = [
  ["BLUE", "GREEN", "RED", "YELLOW"],
  ["BATTERY", "HOOD", "TIRE", "TRUNK"],
  ["HOUSTON", "MARS", "MERCURY", "SWIFT"],
  ["BIRD", "DOG", "TREE", "WHITE"],
];
const INPUT: CreateCustomPuzzleInput = {
  creatorName: "Sam West",
  title: "Golf Words",
  visibility: "public",
  content: {
    mode: "classic",
    groups: GROUPS.map((words, i) => ({ category: `Cat ${i}`, words, hintWord: null })),
    wordOrder: GROUPS.flat(),
    rainbowHerring: null,
    rainbowCategoryName: null,
    rainbowHintWord: null,
    alphabetizeCompleted: true,
  },
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

async function mintIdentity() {
  const { data } = await db.rpc("create_device_identity");
  const id = (Array.isArray(data) ? data[0] : data) as { device_id: string; device_token: string };
  localStorage.setItem("rc-device-id", id.device_id);
  localStorage.setItem("rc-device-token", id.device_token);
}

beforeEach(async () => {
  reduceMotion();
  for (const t of ["custom_puzzles", "custom_puzzle_results", "custom_puzzle_stats", "device_identities"]) db.tables[t] = [];
  localStorage.clear();
  sessionStorage.clear();
  db.signIn(null);
  await mintIdentity();
  db.writeLog = [];
  window.scrollTo = () => {};
});

async function renderPage() {
  const { shareId } = await createCustomPuzzle(INPUT);
  const view = render(
    <HelmetProvider>
      <MemoryRouter initialEntries={[`/custom/${shareId}`]}>
        <Routes>
          <Route path="/custom/:shareId" element={<CustomPuzzle />} />
        </Routes>
      </MemoryRouter>
    </HelmetProvider>
  );
  await screen.findByText("Select four words that share a connection!");
  return { shareId, view };
}

const tile = (word: string) => document.querySelector(`[data-word="${word}"] button`) as HTMLButtonElement;

async function playGroups(words: string[][]) {
  for (const g of words) {
    for (const w of g) await act(async () => { fireEvent.click(tile(w)); });
    await act(async () => { fireEvent.click(screen.getByRole("button", { name: /^submit$/i })); });
    await settle();
  }
}

async function loseByGuessing() {
  const wrong = [
    [GROUPS[0][0], GROUPS[1][0], GROUPS[2][0], GROUPS[3][0]],
    [GROUPS[0][1], GROUPS[1][1], GROUPS[2][1], GROUPS[3][1]],
    [GROUPS[0][2], GROUPS[1][2], GROUPS[2][2], GROUPS[3][2]],
    [GROUPS[0][3], GROUPS[1][3], GROUPS[2][3], GROUPS[3][3]],
  ];
  for (const g of wrong) {
    for (const w of g) await act(async () => { fireEvent.click(tile(w)); });
    await act(async () => { fireEvent.click(screen.getByRole("button", { name: /^submit$/i })); });
    await settle();
    // an incorrect guess leaves its tiles selected; clear before the next one
    const deselect = screen.queryByRole("button", { name: /deselect all/i });
    if (deselect) await act(async () => { fireEvent.click(deselect); });
  }
}

const dialog = () => screen.getByRole("dialog", { name: "Puzzle stats" });
const bucketRow = (b: string) => within(dialog()).getByTestId(`bucket-${b}`);

describe("stats are reachable before, during and after play", () => {
  it("the header Stats button opens custom stats on a fresh puzzle, showing the empty state and all five buckets", async () => {
    await renderPage();
    fireEvent.click(screen.getByRole("button", { name: "My stats" }));
    await waitFor(() => expect(screen.getByRole("dialog", { name: "Puzzle stats" })).toBeTruthy());
    await within(dialog()).findByText("No completed plays yet. Be the first!");
    for (const [b, label] of [["4", "4 guesses"], ["5", "5 guesses"], ["6", "6 guesses"], ["7", "7 guesses"], ["8+", "8+ guesses"]]) {
      const row = bucketRow(b);
      expect(within(row).getByText(label)).toBeTruthy();
      // zero bucket: label, neutral empty track, and an explicit 0
      expect(within(row).getByText("0")).toBeTruthy();
      expect(row.querySelector(".bg-primary")).toBeNull();
    }
  });

  it("works mid-game, and never shows a confusing 1/1 tile", async () => {
    await renderPage();
    await playGroups([GROUPS[0]]); // one group solved, game in progress
    fireEvent.click(screen.getByRole("button", { name: "My stats" }));
    await within(await screen.findByRole("dialog", { name: "Puzzle stats" })).findByText("No completed plays yet. Be the first!");
    fireEvent.click(screen.getByRole("button", { name: "Close" }));
    expect(screen.queryByRole("dialog", { name: "Puzzle stats" })).toBeNull();
  });

  it("after completion the Results and Replay buttons appear, and Results shows the full summary", async () => {
    await renderPage();
    await playGroups(GROUPS);
    const results = await screen.findByRole("button", { name: /^results$/i });
    expect(screen.getByRole("button", { name: /^replay$/i })).toBeTruthy();
    // No "Play Another": there is no discovery destination to send players to yet.
    expect(screen.queryByRole("button", { name: /play another/i })).toBeNull();

    fireEvent.click(results);
    const d = await screen.findByRole("dialog", { name: "Puzzle stats" });
    await within(d).findByTestId("stat-plays");
    expect(within(within(d).getByTestId("stat-plays")).getByText("1")).toBeTruthy();
    expect(within(d).getByText("Completed Plays")).toBeTruthy();
    expect(within(within(d).getByTestId("stat-wins")).getByText("1")).toBeTruthy();
    expect(within(within(d).getByTestId("stat-losses")).getByText("0")).toBeTruthy();
    expect(within(d).getByText("Win Rate")).toBeTruthy();
    expect(within(within(d).getByTestId("stat-winrate")).getByText("100%")).toBeTruthy();
    expect(within(d).getByText("Avg Guesses to Solve")).toBeTruthy();
    expect(within(within(d).getByTestId("stat-avg")).getByText("4")).toBeTruthy();
    expect(d.textContent).not.toMatch(/1\/1/);
    expect(d.textContent).not.toMatch(/Players|Unique/);
    // The winning run's own bucket is populated; all five rows are still there.
    expect(within(bucketRow("4")).getByText("1")).toBeTruthy();
    for (const b of ["5", "6", "7", "8+"]) expect(within(bucketRow(b)).getByText("0")).toBeTruthy();
  });
});

describe("Replay", () => {
  it("resets local progress, keeps the puzzle, and a completed replay counts as another play", async () => {
    const { shareId } = await renderPage();
    await playGroups(GROUPS);
    const firstRun = loadProgress(`custom:${shareId}`)!;
    expect(firstRun.isComplete).toBe(true);
    const writesAfterFirst = db.writeLog.length;

    fireEvent.click(await screen.findByRole("button", { name: /^replay$/i }));
    await settle();

    // Clean board: all 16 tiles back, no result buttons, progress wiped.
    expect(document.querySelectorAll("[data-word]")).toHaveLength(16);
    expect(screen.queryByRole("button", { name: /^results$/i })).toBeNull();
    expect(loadProgress(`custom:${shareId}`)).toBeNull();
    // Clicking Replay alone counts nothing.
    expect(db.writeLog.length).toBe(writesAfterFirst);
    expect(db.tables.custom_puzzle_stats[0].wins + db.tables.custom_puzzle_stats[0].losses).toBe(1);
    // The puzzle itself (title, designer) is untouched.
    expect(screen.getByText("Golf Words")).toBeTruthy();

    // Lose the replay: another completed play, with its own outcome.
    await loseByGuessing();
    await screen.findByRole("button", { name: /^results$/i });
    const st = db.tables.custom_puzzle_stats[0];
    expect(st.wins).toBe(1);
    expect(st.losses).toBe(1);
    // The replay is a NEW run.
    expect(loadProgress(`custom:${shareId}`)!.runId).not.toBe(firstRun.runId);
    // ...and it can produce its own share grid.
    expect(document.body.textContent).toContain("Share Score");

    // Refreshing the completed replay does not record it again.
    const writes = db.writeLog.length;
    fireEvent.click(screen.getByRole("button", { name: /^results$/i }));
    await settle();
    expect(db.writeLog.length).toBe(writes);
    expect(st.wins + st.losses).toBe(2);
  });

  it("starting a replay and abandoning it counts nothing", async () => {
    const { shareId } = await renderPage();
    await playGroups(GROUPS);
    fireEvent.click(await screen.findByRole("button", { name: /^replay$/i }));
    await settle();
    await playGroups([GROUPS[0]]);
    expect(loadProgress(`custom:${shareId}`)!.isComplete).toBeFalsy();
    const st = db.tables.custom_puzzle_stats[0];
    expect(st.wins + st.losses).toBe(1);
  });
});

describe("CustomStatsModal numbers", () => {
  const seed = async (over: Record<string, number>) => {
    const { shareId } = await createCustomPuzzle(INPUT);
    const pid = db.tables.custom_puzzles.find((p) => p.share_id === shareId)!.id;
    db.tables.custom_puzzle_stats.push({
      custom_puzzle_id: pid, wins: 0, losses: 0, guesses_4: 0, guesses_5: 0, guesses_6: 0,
      guesses_7: 0, guesses_8_plus: 0, win_guess_total: 0, ...over,
    });
    return shareId;
  };

  it("shows wins, losses, win rate and the average over wins only; populated buckets get bars, others stay empty", async () => {
    const shareId = await seed({ wins: 3, losses: 1, guesses_4: 2, guesses_8_plus: 1, win_guess_total: 4 + 4 + 9 });
    render(<CustomStatsModal shareId={shareId} open onClose={() => {}} />);
    const d = await screen.findByRole("dialog", { name: "Puzzle stats" });
    await within(d).findByTestId("stat-plays");
    expect(within(within(d).getByTestId("stat-plays")).getByText("4")).toBeTruthy();
    expect(within(within(d).getByTestId("stat-wins")).getByText("3")).toBeTruthy();
    expect(within(within(d).getByTestId("stat-losses")).getByText("1")).toBeTruthy();
    expect(within(within(d).getByTestId("stat-winrate")).getByText("75%")).toBeTruthy();
    expect(within(within(d).getByTestId("stat-avg")).getByText("5.67")).toBeTruthy();
    expect(bucketRow("4").querySelector(".bg-primary")).not.toBeNull();
    expect(bucketRow("8+").querySelector(".bg-primary")).not.toBeNull();
    for (const b of ["5", "6", "7"]) {
      expect(bucketRow(b).querySelector(".bg-primary")).toBeNull();
      expect(within(bucketRow(b)).getByText("0")).toBeTruthy();
    }
  });

  it("with losses only there is no average to show", async () => {
    const shareId = await seed({ losses: 2 });
    render(<CustomStatsModal shareId={shareId} open onClose={() => {}} />);
    const d = await screen.findByRole("dialog", { name: "Puzzle stats" });
    await within(d).findByTestId("stat-plays");
    expect(within(within(d).getByTestId("stat-avg")).getByText("–")).toBeTruthy();
    expect(within(within(d).getByTestId("stat-winrate")).getByText("0%")).toBeTruthy();
    // every bucket present and empty
    for (const b of ["4", "5", "6", "7", "8+"]) expect(within(bucketRow(b)).getByText("0")).toBeTruthy();
  });
});
