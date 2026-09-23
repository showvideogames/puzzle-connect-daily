/**
 * ARCHIVE ISOLATION — the two archives cannot see each other's puzzles.
 *
 * /archive is Full only. /mini/archive is Mini only. That has to hold even
 * though both formats publish a puzzle for the SAME DATE, share one `puzzles`
 * table, share one calendar component and share one progress/session layer.
 *
 * Renders the REAL pages through the real router against the in-memory
 * Supabase fake, and inspects the QUERIES each page actually issued — so a
 * page that merely happens to render nothing wrong, while asking for the
 * other format's rows, still fails.
 */
import { describe, it, expect, beforeEach, vi } from "vitest";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter, Route, Routes, useLocation } from "react-router-dom";
import { HelmetProvider } from "react-helmet-async";
import { FakeSupabase } from "./fakeSupabase";

const db = new FakeSupabase();

vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    from: (t: string) => db.from(t),
    rpc: (n: string, a: Record<string, unknown>) => db.rpc(n, a),
    auth: {
      getUser: () => db.auth.getUser(),
      getSession: async () => {
        const id = db.currentUserId();
        return { data: { session: id ? { user: { id } } : null } };
      },
      onAuthStateChange: () => ({ data: { subscription: { unsubscribe: () => {} } } }),
      signOut: async () => {},
    },
  },
}));
vi.mock("@/lib/analytics", () => ({ trackEvent: () => {} }));
vi.mock("canvas-confetti", () => ({ default: () => {} }));
vi.mock("@/components/GameBoard", () => ({
  GameBoard: ({ puzzle }: { puzzle: { id: string; format?: string | null } }) => (
    <div data-testid="board" data-puzzle-id={puzzle.id} data-format={puzzle.format ?? "full"} />
  ),
}));

import Archive from "@/pages/Archive";
import MiniArchive from "@/pages/MiniArchive";
import ArchivePuzzlePage from "@/pages/ArchivePuzzle";
import { MiniArchivePuzzle } from "@/pages/Mini";
import { MINI_FORMAT, FULL_FORMAT, progressStorageId } from "@/lib/puzzleFormat";
import { saveProgress } from "@/lib/gameProgress";
import { getPuzzleById, isPuzzleId } from "@/lib/puzzles";

const TODAY = new Date().toLocaleDateString("en-CA");
const daysAgo = (n: number) => {
  const d = new Date();
  d.setDate(d.getDate() - n);
  return d.toLocaleDateString("en-CA");
};
const YESTERDAY = daysAgo(1);
const TWO_DAYS_AGO = daysAgo(2);

/**
 * The day-of-month a calendar cell shows for a YYYY-MM-DD date.
 *
 * Read off the STRING, not via `new Date(str).getDate()` — that parses a bare
 * date as UTC midnight, which in any negative-offset timezone is the previous
 * day locally, so the test would click the wrong cell. The calendar itself
 * builds its cells from local date parts, which is what this matches.
 */
/**
 * A calendar cell's accessible name.
 *
 * The cell SHOWS a bare day number, which is all it has room for, but its
 * accessible name is the full date plus its status — a bare "12" says
 * nothing about which month, and nothing about the state the cell's colour
 * is communicating. Matching on the date prefix is also what keeps these
 * queries unambiguous when a month happens to render two cells whose
 * numbers would otherwise collide with something else on the page.
 */
const cellNamed = (isoDate: string) => new RegExp(`^${isoDate}\\b`);

/**
 * Is this calendar cell showing the Rainbow treatment?
 *
 * Detected from the cell's MARKUP, not its inline style. The gradient is
 * written as `hsl(48 89% 60% / 0.40)`, and jsdom's CSS parser does not
 * understand that slash-alpha syntax — it drops the whole declaration, so
 * `getAttribute("style")` reads empty here even though a real browser paints
 * it. What IS observable is the dark-mode gradient overlay, which
 * ArchiveCalendar renders only for a Rainbow cell (and which carries the
 * `border-border`-only cell class, no bg-* tint).
 */
function isRainbowCell(isoDate: string): boolean {
  const cell = screen.getByRole("button", { name: cellNamed(isoDate) });
  return cell.querySelector('span[aria-hidden="true"]') !== null;
}

const FULL_ID = "11111111-1111-4111-8111-111111111111";
const MINI_ID = "22222222-2222-4222-8222-222222222222";
const MINI_RAINBOW_ID = "33333333-3333-4333-8333-333333333333";
const FULL_OLD_ID = "44444444-4444-4444-8444-444444444444";

/** Both formats publish on the SAME dates — the hard case for isolation. */
function seedPuzzles() {
  db.tables.puzzles = [
    // No format column, exactly as a pre-Mini production row looks.
    { id: FULL_OLD_ID, date: TWO_DAYS_AGO, title: "Full Old", is_published: true, is_free_puzzle: true, free_puzzle_order: 1, is_emoji_puzzle: true, designer_name: "Sam West" },
    { id: FULL_ID, date: YESTERDAY, title: "Full Yesterday", is_published: true, designer_name: "Sam West" },
    { id: MINI_ID, date: YESTERDAY, format: "mini", title: "Mini Yesterday", is_published: true, rainbow_herring: null, designer_name: "Sam West" },
    // A Mini flagged free AND emoji — it must NOT leak into the Full
    // archive's Free Puzzles or Emoji Puzzles collections, whose cards link
    // to /archive/:id.
    { id: MINI_RAINBOW_ID, date: TWO_DAYS_AGO, format: "mini", title: "Mini Rainbow", is_published: true, rainbow_herring: ["g1", "b1", "r1"], is_free_puzzle: true, free_puzzle_order: 2, is_emoji_puzzle: true, designer_name: "Sam West" },
  ];
  db.tables.puzzle_groups = [
    ...["y", "gg", "bb", "rr"].map((p, i) => ({
      puzzle_id: FULL_ID, category: `C${i}`, words: [`${p}1`, `${p}2`, `${p}3`, `${p}4`],
      difficulty: i + 1, sort_order: i, hint_word: null,
    })),
    ...["g", "b", "r"].map((p, i) => ({
      puzzle_id: MINI_ID, category: `C${i}`, words: [`${p}1`, `${p}2`, `${p}3`],
      difficulty: i + 2, sort_order: i, hint_word: null,
    })),
    ...["g", "b", "r"].map((p, i) => ({
      puzzle_id: MINI_RAINBOW_ID, category: `C${i}`, words: [`${p}1`, `${p}2`, `${p}3`],
      difficulty: i + 2, sort_order: i, hint_word: null,
    })),
  ];
}

/** Shows the current path, so navigation can be asserted. */
function PathProbe() {
  const loc = useLocation();
  return <div data-testid="path">{loc.pathname + loc.search}</div>;
}

function renderAt(path: string, routes: React.ReactNode) {
  return render(
    <HelmetProvider>
      <MemoryRouter initialEntries={[path]}>
        <PathProbe />
        <Routes>{routes}</Routes>
      </MemoryRouter>
    </HelmetProvider>
  );
}

beforeEach(() => {
  localStorage.clear();
  sessionStorage.clear();
  db.tables.game_sessions = [];
  db.tables.user_streaks = [];
  db.signIn(null);
  seedPuzzles();
  db.readLog = [];
  db.rpcCallLog = [];
  db.rpcLog = [];
});

// ───────────────────────────────────────────────────────────────────────────
// Query-level isolation
// ───────────────────────────────────────────────────────────────────────────

describe("each archive asks only for its own format", () => {
  it("the MINI archive queries puzzles with format = mini, always", async () => {
    renderAt("/mini/archive", <Route path="/mini/archive" element={<MiniArchive />} />);
    await screen.findByText(/Mini Archive/i);

    const puzzleReads = db.readLog.filter((r) => r.table === "puzzles");
    expect(puzzleReads.length).toBeGreaterThan(0);
    for (const read of puzzleReads) {
      expect(read.filters).toMatchObject({ format: "mini" });
    }
  });

  it("the FULL archive queries puzzles with format = full, always", async () => {
    renderAt("/archive", <Route path="/archive" element={<Archive />} />);
    await waitFor(() => expect(db.readLog.some((r) => r.table === "puzzles")).toBe(true));
    await waitFor(() => {
      const reads = db.readLog.filter((r) => r.table === "puzzles");
      // Calendar + free puzzles + total count + emoji puzzles.
      expect(reads.length).toBeGreaterThanOrEqual(3);
    });

    const puzzleReads = db.readLog.filter((r) => r.table === "puzzles");
    for (const read of puzzleReads) {
      expect(read.filters).toMatchObject({ format: "full" });
    }
  });

  it("the MINI archive asks for MINI sessions", async () => {
    renderAt("/mini/archive", <Route path="/mini/archive" element={<MiniArchive />} />);
    await screen.findByText(/Mini Archive/i);
    const call = db.rpcCallLog.find((c) => c.name === "get_own_completed_sessions");
    expect(call?.args._format).toBe("mini");
  });

  it("the FULL archive asks for FULL sessions (the RPC default)", async () => {
    renderAt("/archive", <Route path="/archive" element={<Archive />} />);
    await waitFor(() =>
      expect(db.rpcCallLog.some((c) => c.name === "get_own_completed_sessions")).toBe(true)
    );
    const call = db.rpcCallLog.find((c) => c.name === "get_own_completed_sessions");
    // Either omitted (the SQL default is 'full') or explicitly full — never mini.
    expect(call?.args._format ?? "full").toBe("full");
  });
});

// ───────────────────────────────────────────────────────────────────────────
// Rendered content
// ───────────────────────────────────────────────────────────────────────────

describe("no cross-contamination in what is rendered", () => {
  it("a Mini never appears in the Full archive's Free Puzzles or Emoji Puzzles", async () => {
    renderAt("/archive", <Route path="/archive" element={<Archive />} />);
    await waitFor(() => expect(db.readLog.filter((r) => r.table === "puzzles").length).toBeGreaterThanOrEqual(3));

    // Both collections are FULL-scoped, so the Mini flagged free+emoji is
    // absent from every row they returned.
    const collectionReads = db.readLog.filter(
      (r) =>
        r.table === "puzzles" &&
        (r.filters?.is_free_puzzle === true || r.filters?.is_emoji_puzzle === true)
    );
    expect(collectionReads.length).toBeGreaterThanOrEqual(2);
    for (const read of collectionReads) {
      expect(read.filters).toMatchObject({ format: "full" });
      for (const row of read.rows ?? []) {
        expect(row.id).not.toBe(MINI_RAINBOW_ID);
        expect(row.id).not.toBe(MINI_ID);
      }
    }
  });

  it("the published-puzzle COUNT on the Full archive counts Full only", async () => {
    renderAt("/archive", <Route path="/archive" element={<Archive />} />);
    await waitFor(() => expect(db.readLog.filter((r) => r.table === "puzzles").length).toBeGreaterThanOrEqual(3));
    const countRead = db.readLog.find((r) => r.table === "puzzles" && r.isCount);
    expect(countRead?.filters).toMatchObject({ format: "full" });
  });

  it("the Mini archive lists its own puzzles and no Full ones", async () => {
    renderAt("/mini/archive", <Route path="/mini/archive" element={<MiniArchive />} />);
    await screen.findByText(/Mini Archive/i);
    const calendarRead = db.readLog.find(
      (r) => r.table === "puzzles" && r.filters?.format === "mini" && !r.isCount
    );
    const ids = (calendarRead?.rows ?? []).map((r) => r.id);
    expect(ids).toContain(MINI_ID);
    expect(ids).toContain(MINI_RAINBOW_ID);
    expect(ids).not.toContain(FULL_ID);
    expect(ids).not.toContain(FULL_OLD_ID);
  });

  it("shows an honest empty state when no Mini is published", async () => {
    db.tables.puzzles = db.tables.puzzles.filter((p) => p.format !== "mini");
    renderAt("/mini/archive", <Route path="/mini/archive" element={<MiniArchive />} />);
    expect(await screen.findByText(/No Mini 3×3 puzzles have been published yet/i)).toBeTruthy();
  });
});

// ───────────────────────────────────────────────────────────────────────────
// Routing
// ───────────────────────────────────────────────────────────────────────────

describe("archive navigation stays inside its own format", () => {
  it("clicking a Mini date opens that date's MINI puzzle", async () => {
    renderAt(
      "/mini/archive",
      <>
        <Route path="/mini/archive" element={<MiniArchive />} />
        <Route path="/mini/archive/:puzzleId" element={<MiniArchivePuzzle />} />
      </>
    );
    await screen.findByText(/Mini Archive/i);

    const cell = await screen.findByRole("button", { name: cellNamed(YESTERDAY) });
    fireEvent.click(cell);

    await waitFor(() =>
      expect(screen.getByTestId("path").textContent).toBe(`/mini/archive/${MINI_ID}`)
    );
    const board = await screen.findByTestId("board");
    // The MINI puzzle for that date, not the Full one published the same day.
    expect(board.getAttribute("data-puzzle-id")).toBe(MINI_ID);
    expect(board.getAttribute("data-format")).toBe("mini");
  });

  it("the Mini archive's Today action goes to /mini, not /", async () => {
    renderAt("/mini/archive", <Route path="/mini/archive" element={<MiniArchive />} />);
    await screen.findByText(/Mini Archive/i);

    fireEvent.click(screen.getByRole("button", { name: /Play Today's Mini/i }));
    await waitFor(() => expect(screen.getByTestId("path").textContent).toBe("/mini"));
  });

  it("an old Mini puzzle's Archive link stays in the Mini archive", async () => {
    renderAt(
      `/mini/archive/${MINI_ID}`,
      <>
        <Route path="/mini/archive/:puzzleId" element={<MiniArchivePuzzle />} />
        <Route path="/mini/archive" element={<MiniArchive />} />
      </>
    );
    await screen.findByTestId("board");
    fireEvent.click(screen.getByRole("button", { name: /archive/i }));
    await waitFor(() =>
      expect(screen.getByTestId("path").textContent).toMatch(/^\/mini\/archive/)
    );
  });

  it("the Full archive's calendar still routes to /archive/:id", async () => {
    renderAt(
      "/archive",
      <>
        <Route path="/archive" element={<Archive />} />
        <Route path="/archive/:puzzleId" element={<ArchivePuzzlePage />} />
      </>
    );
    await waitFor(() => expect(db.readLog.some((r) => r.table === "puzzles")).toBe(true));
    const cell = await screen.findByRole("button", { name: cellNamed(YESTERDAY) });
    fireEvent.click(cell);
    await waitFor(() =>
      expect(screen.getByTestId("path").textContent).toBe(`/archive/${FULL_ID}`)
    );
    const board = await screen.findByTestId("board");
    expect(board.getAttribute("data-puzzle-id")).toBe(FULL_ID);
  });
});

// ───────────────────────────────────────────────────────────────────────────
// The Rainbow badge
// ───────────────────────────────────────────────────────────────────────────

describe("the Rainbow indicator on the Mini calendar", () => {
  it("is offered in the legend once a Rainbow Mini exists", async () => {
    renderAt("/mini/archive", <Route path="/mini/archive" element={<MiniArchive />} />);
    await screen.findByText(/Mini Archive/i);
    expect(screen.queryByText("Rainbow")).toBeTruthy();
  });

  it("is NOT offered when every Mini is Classic", async () => {
    db.tables.puzzles = db.tables.puzzles.map((p) =>
      p.format === "mini" ? { ...p, rainbow_herring: null } : p
    );
    renderAt("/mini/archive", <Route path="/mini/archive" element={<MiniArchive />} />);
    await screen.findByText(/Mini Archive/i);
    expect(screen.queryByText("Rainbow")).toBeNull();
  });

  it("marks a Rainbow Mini the player solved the Rainbow on", async () => {
    db.tables.game_sessions = [
      {
        id: "s1", puzzle_id: MINI_RAINBOW_ID, format: "mini", status: "won",
        is_official: true, won: true, found_rainbow: true, mistakes: 0,
        device_id: localStorage.getItem("rc-device-id") ?? "dev", user_id: null,
      },
    ];
    // The archive reads sessions through the RPC, which needs this identity.
    const { data } = await db.rpc("create_device_identity");
    const identity = (Array.isArray(data) ? data[0] : data) as { device_id: string; device_token: string };
    localStorage.setItem("rc-device-id", identity.device_id);
    localStorage.setItem("rc-device-token", identity.device_token);
    db.tables.game_sessions[0].device_id = identity.device_id;

    renderAt("/mini/archive", <Route path="/mini/archive" element={<MiniArchive />} />);
    await screen.findByText(/Mini Archive/i);

    await waitFor(() => expect(isRainbowCell(TWO_DAYS_AGO)).toBe(true));
  });

  it("never marks a CLASSIC Mini, even if a session somehow claims a Rainbow", async () => {
    const { data } = await db.rpc("create_device_identity");
    const identity = (Array.isArray(data) ? data[0] : data) as { device_id: string; device_token: string };
    localStorage.setItem("rc-device-id", identity.device_id);
    localStorage.setItem("rc-device-token", identity.device_token);
    db.tables.game_sessions = [
      {
        id: "s2", puzzle_id: MINI_ID, format: "mini", status: "won",
        is_official: true, won: true, found_rainbow: true, mistakes: 0,
        device_id: identity.device_id, user_id: null,
      },
    ];

    renderAt("/mini/archive", <Route path="/mini/archive" element={<MiniArchive />} />);
    await screen.findByText(/Mini Archive/i);

    await screen.findByRole("button", { name: cellNamed(YESTERDAY) });
    // Won, yes — but this Mini is Classic, so no Rainbow treatment.
    expect(isRainbowCell(YESTERDAY)).toBe(false);
  });
});

// ───────────────────────────────────────────────────────────────────────────
// Progress isolation on the calendars
// ───────────────────────────────────────────────────────────────────────────

describe("in-progress state is per format", () => {
  it("a Full game in progress does not light up the Mini calendar", async () => {
    // A Full board genuinely in progress on a date a Mini also exists for.
    saveProgress(progressStorageId(FULL_ID, FULL_FORMAT), {
      solvedGroups: [0], mistakes: 0, guessHistory: [], gotRainbow: false,
      shuffledWords: [], rainbowWords: [],
    });

    renderAt("/mini/archive", <Route path="/mini/archive" element={<MiniArchive />} />);
    await screen.findByText(/Mini Archive/i);
    const cell = await screen.findByRole("button", { name: cellNamed(YESTERDAY) });
    // The in-progress tint is a yellow background class; the Mini cell must
    // not have it.
    expect(cell.className).not.toMatch(/48_89%_60%/);
  });

  it("a Mini game in progress DOES light up the Mini calendar", async () => {
    saveProgress(progressStorageId(MINI_ID, MINI_FORMAT), {
      solvedGroups: [0], mistakes: 0, guessHistory: [], gotRainbow: false,
      shuffledWords: [], rainbowWords: [],
    });

    renderAt("/mini/archive", <Route path="/mini/archive" element={<MiniArchive />} />);
    await screen.findByText(/Mini Archive/i);
    const cell = await screen.findByRole("button", { name: cellNamed(YESTERDAY) });
    expect(cell.className).toMatch(/48_89%_60%/);
  });
});

// ───────────────────────────────────────────────────────────────────────────
// Bad input
// ───────────────────────────────────────────────────────────────────────────

describe("missing dates and invalid ids", () => {
  it("a date with no Mini puzzle is not clickable", async () => {
    renderAt("/mini/archive", <Route path="/mini/archive" element={<MiniArchive />} />);
    await screen.findByText(/Mini Archive/i);
    // Three days ago has no puzzle of any format.
    const cell = screen.getByRole("button", { name: cellNamed(daysAgo(3)) });
    expect(cell).toHaveProperty("disabled", true);
  });

  it("a malformed puzzle id never reaches the database", async () => {
    expect(isPuzzleId("banana")).toBe(false);
    expect(isPuzzleId("")).toBe(false);
    expect(isPuzzleId(MINI_ID)).toBe(true);

    db.readLog = [];
    const result = await getPuzzleById("banana", "mini");
    expect(result).toBeNull();
    // The whole point: no doomed uuid query was issued.
    expect(db.readLog.filter((r) => r.table === "puzzles")).toHaveLength(0);
  });

  it("an invalid Mini archive route shows the not-found state, not a crash", async () => {
    renderAt(
      "/mini/archive/banana",
      <Route path="/mini/archive/:puzzleId" element={<MiniArchivePuzzle />} />
    );
    await waitFor(() => expect(screen.queryByTestId("board")).toBeNull());
    expect(db.readLog.filter((r) => r.table === "puzzles")).toHaveLength(0);
  });

  it("a FULL puzzle id under a Mini route does not serve the Full board", async () => {
    renderAt(
      `/mini/archive/${FULL_ID}`,
      <Route path="/mini/archive/:puzzleId" element={<MiniArchivePuzzle />} />
    );
    await waitFor(() => expect(screen.queryByTestId("board")).toBeNull());
  });

  it("a MINI puzzle id under a Full route does not serve the Mini board", async () => {
    renderAt(
      `/archive/${MINI_ID}`,
      <Route path="/archive/:puzzleId" element={<ArchivePuzzlePage />} />
    );
    await waitFor(() => expect(screen.queryByTestId("board")).toBeNull());
  });
});
