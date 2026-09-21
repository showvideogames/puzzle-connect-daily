/**
 * Routes: the Mini pages exist and serve Mini content, and every existing
 * Full route still loads exactly what it always did (test 20).
 *
 * Renders the REAL page components through the real router, against the
 * in-memory Supabase fake. The board itself is stubbed to report the puzzle
 * identity and format it was handed — gameplay is covered by
 * miniFormat.test.tsx; what matters here is that each route resolves to the
 * right puzzle.
 */
import { describe, it, expect, beforeEach, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
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

// The board reports the identity and shape it was handed; gameplay itself is
// covered elsewhere.
vi.mock("@/components/GameBoard", () => ({
  GameBoard: ({ puzzle }: { puzzle: { id: string; format?: string | null; groups: unknown[] } }) => (
    <div
      data-testid="board"
      data-puzzle-id={puzzle.id}
      data-format={puzzle.format ?? "full"}
      data-groups={puzzle.groups.length}
    />
  ),
}));

import Index from "@/pages/Index";
import ArchivePuzzlePage from "@/pages/ArchivePuzzle";
import MiniArchive from "@/pages/MiniArchive";
import { MiniDaily, MiniArchivePuzzle } from "@/pages/Mini";
import { MINI_FORMAT, FULL_FORMAT } from "@/lib/puzzleFormat";

const TODAY = new Date().toLocaleDateString("en-CA");
const YESTERDAY = (() => {
  const d = new Date();
  d.setDate(d.getDate() - 1);
  return d.toLocaleDateString("en-CA");
})();

const FULL_ID = "11111111-1111-4111-8111-111111111111";
const MINI_ID = "22222222-2222-4222-8222-222222222222";
const FULL_OLD_ID = "33333333-3333-4333-8333-333333333333";
const MINI_OLD_ID = "44444444-4444-4444-8444-444444444444";

function seedPuzzles() {
  db.tables.puzzles = [
    // Today's Full — deliberately with NO format column, the way every
    // existing production row looks.
    { id: FULL_ID, date: TODAY, title: "Full Today", is_published: true, is_beta: false, designer_name: "Sam West" },
    { id: MINI_ID, date: TODAY, format: "mini", title: "Mini Today", is_published: true, is_beta: false, designer_name: "Sam West" },
    { id: FULL_OLD_ID, date: YESTERDAY, title: "Full Old", is_published: true, is_beta: false, designer_name: "Sam West" },
    { id: MINI_OLD_ID, date: YESTERDAY, format: "mini", title: "Mini Old", is_published: true, is_beta: false, designer_name: "Sam West" },
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
    ...["y", "gg", "bb", "rr"].map((p, i) => ({
      puzzle_id: FULL_OLD_ID, category: `C${i}`, words: [`o${p}1`, `o${p}2`, `o${p}3`, `o${p}4`],
      difficulty: i + 1, sort_order: i, hint_word: null,
    })),
    ...["g", "b", "r"].map((p, i) => ({
      puzzle_id: MINI_OLD_ID, category: `C${i}`, words: [`o${p}1`, `o${p}2`, `o${p}3`],
      difficulty: i + 2, sort_order: i, hint_word: null,
    })),
  ];
}

function renderAt(path: string, element: React.ReactNode, routePath: string) {
  return render(
    <HelmetProvider>
      <MemoryRouter initialEntries={[path]}>
        <Routes>
          <Route path={routePath} element={element} />
        </Routes>
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
  // The landing screen is shown once per date; skipping it puts the board on
  // screen directly, which is what these assertions are about.
  localStorage.setItem(`landing-seen-${TODAY}`, "1");
  localStorage.setItem(`landing-seen-${TODAY}-mini`, "1");
});

describe("Mini routes", () => {
  it("/mini serves today's MINI puzzle", async () => {
    renderAt("/mini", <MiniDaily />, "/mini");
    const board = await screen.findByTestId("board");
    expect(board.getAttribute("data-puzzle-id")).toBe(MINI_ID);
    expect(board.getAttribute("data-format")).toBe("mini");
    expect(board.getAttribute("data-groups")).toBe("3");
  });

  it("/mini/archive/:id serves one archived MINI puzzle", async () => {
    renderAt(`/mini/archive/${MINI_OLD_ID}`, <MiniArchivePuzzle />, "/mini/archive/:puzzleId");
    const board = await screen.findByTestId("board");
    expect(board.getAttribute("data-puzzle-id")).toBe(MINI_OLD_ID);
    expect(board.getAttribute("data-groups")).toBe("3");
  });

  it("/mini/archive renders the shared calendar with no Rainbow legend", async () => {
    renderAt("/mini/archive", <MiniArchive />, "/mini/archive");
    await waitFor(() => expect(screen.getByText("Mini Archive")).toBeInTheDocument());
    expect(screen.getByText(MINI_FORMAT.sizeLabel)).toBeInTheDocument();
    // The shared calendar's legend, minus the entry a Mini can never reach.
    expect(screen.getByText("Completed")).toBeInTheDocument();
    expect(screen.getByText("In progress")).toBeInTheDocument();
    expect(screen.queryByText("Rainbow")).toBeNull();
  });

  it("/mini/archive/:id refuses a FULL puzzle id rather than showing the wrong board", async () => {
    renderAt(`/mini/archive/${FULL_OLD_ID}`, <MiniArchivePuzzle />, "/mini/archive/:puzzleId");
    await waitFor(() => expect(screen.getByText("Puzzle not found.")).toBeInTheDocument());
  });

  it("shows a clear empty state instead of crashing when no Mini exists", async () => {
    db.tables.puzzles = db.tables.puzzles.filter((p) => p.format !== "mini");
    renderAt("/mini", <MiniDaily />, "/mini");
    // The sentence is assembled from several JSX expressions, so it is matched
    // against the element's whole text rather than a single text node.
    await waitFor(() =>
      expect(
        screen.getByText((_t, el) => el?.textContent === "No Mini 3×3 puzzle available today.")
      ).toBeInTheDocument()
    );
    // And it offers the Full game rather than leaving a dead end.
    expect(screen.getByText(/Play today's Full 4×4 puzzle/)).toBeInTheDocument();
  });

  it("shows an honest empty archive when no Mini has been published", async () => {
    db.tables.puzzles = db.tables.puzzles.filter((p) => p.format !== "mini");
    renderAt("/mini/archive", <MiniArchive />, "/mini/archive");
    await waitFor(() =>
      expect(
        screen.getByText(
          (_t, el) => el?.textContent === "No Mini 3×3 puzzles have been published yet."
        )
      ).toBeInTheDocument()
    );
  });
});

describe("20. existing Full routes still load", () => {
  it("/ serves today's FULL puzzle, not the Mini", async () => {
    renderAt("/", <Index />, "/");
    const board = await screen.findByTestId("board");
    expect(board.getAttribute("data-puzzle-id")).toBe(FULL_ID);
    expect(board.getAttribute("data-format")).toBe("full");
    expect(board.getAttribute("data-groups")).toBe("4");
  });

  it("/archive/:id still serves an archived Full puzzle", async () => {
    renderAt(`/archive/${FULL_OLD_ID}`, <ArchivePuzzlePage />, "/archive/:puzzleId");
    const board = await screen.findByTestId("board");
    expect(board.getAttribute("data-puzzle-id")).toBe(FULL_OLD_ID);
    expect(board.getAttribute("data-groups")).toBe("4");
  });

  it("/archive/:id refuses a MINI id — the Full archive serves Full only", async () => {
    renderAt(`/archive/${MINI_OLD_ID}`, <ArchivePuzzlePage />, "/archive/:puzzleId");
    await waitFor(() => expect(screen.getByText("Puzzle not found.")).toBeInTheDocument());
  });

  it("keeps the Full route constants unchanged", () => {
    expect(FULL_FORMAT.dailyPath).toBe("/");
    expect(FULL_FORMAT.archivePath).toBe("/archive");
    expect(FULL_FORMAT.archivePuzzlePath("abc")).toBe("/archive/abc");
    expect(MINI_FORMAT.dailyPath).toBe("/mini");
    expect(MINI_FORMAT.archivePath).toBe("/mini/archive");
    expect(MINI_FORMAT.archivePuzzlePath("abc")).toBe("/mini/archive/abc");
  });
});
