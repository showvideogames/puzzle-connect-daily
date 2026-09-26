/**
 * The Lucky Bot card and its full report, rendered against a canned
 * get_puzzle_report answer.
 */
import { describe, it, expect, beforeEach, vi } from "vitest";
import { act, fireEvent, render, screen, within } from "@testing-library/react";

const rpc = vi.fn();
vi.mock("@/integrations/supabase/client", () => ({
  supabase: { rpc: (name: string, args: Record<string, unknown>) => rpc(name, args) },
}));
vi.mock("@/lib/analytics", () => ({ trackEvent: () => {} }));

import { LuckyBot } from "@/components/LuckyBot";
import type { GameState, Puzzle } from "@/lib/types";

const puzzle: Puzzle = {
  id: "puzzle-1",
  date: "2026-09-24",
  groups: [
    { category: "MLB Teams Singular", words: ["ANGEL", "BRAVE", "BREWER", "CUB"], difficulty: 1 },
    { category: "Parts of the Leg", words: ["CALF", "FOOT", "HIP", "QUAD"], difficulty: 2 },
    { category: "Ugly ___", words: ["CRY", "DUCKLING", "SWEATER", "TRUTH"], difficulty: 3 },
    { category: "Adore", words: ["FANCY", "FAWN", "GUSH", "TREASURE"], difficulty: 4 },
  ],
  rainbowHerring: ["CUB", "CALF", "DUCKLING", "FAWN"],
} as Puzzle;

function finished(overrides: Partial<GameState> = {}): GameState {
  return {
    puzzleId: puzzle.id,
    solvedGroups: [0, 1, 2, 3],
    mistakes: 1,
    maxMistakes: 4,
    selectedWords: [],
    isComplete: true,
    isWon: true,
    guessHistory: [],
    gotRainbow: true,
    rainbowSolveIndex: 2,
    ...overrides,
  };
}

const REPORT = {
  total_players: 5,
  wins: 4,
  perfect: 1,
  players_with_wrong_guess: 4,
  rainbow_in_game: 2,
  rainbow_post_game: 1,
  first_solved: { orange: 3, red: 2 },
  // Me on 84, two below, two above.
  score_counts: { "70": 1, "80": 1, "84": 1, "90": 1, "95": 1 },
  common_wrong_guesses: [
    { words: ["CALF", "FANCY", "FOOT", "HIP"], players: 3, one_away: true, rainbow_attempt: false, almost_rainbow: false },
    { words: ["CALF", "CUB", "DUCKLING", "FAWN"], players: 2, one_away: false, rainbow_attempt: true, almost_rainbow: false },
  ],
};

beforeEach(() => {
  vi.useFakeTimers();
  rpc.mockReset();
  rpc.mockResolvedValue({ data: REPORT, error: null });
});

describe("LuckyBot", () => {
  it("renders nothing until the game is complete", () => {
    render(<LuckyBot puzzle={puzzle} state={finished({ isComplete: false })} />);
    expect(screen.queryByTestId("lucky-bot-card")).toBeNull();
    expect(rpc).not.toHaveBeenCalled();
  });

  it("shows the player's score and standing once the report arrives", async () => {
    render(<LuckyBot puzzle={puzzle} state={finished()} />);
    expect(screen.getByTestId("lucky-bot-card").textContent).toContain("Lucky Bot");
    // One mistake (80) + Rainbow mid-game (+4).
    expect(screen.getByTestId("skill-score").textContent).toBe("84");
    expect(screen.getByTestId("skill-standing").textContent).toMatch(/Comparing/);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(1500);
    });
    expect(rpc).toHaveBeenCalledWith("get_puzzle_report", { _puzzle_id: "puzzle-1" });
    expect(screen.getByTestId("skill-standing").textContent).toBe("Better than 50% of 4 other players");
  });

  it("tells a solo player there is nobody to compare against yet, without claiming they're first", async () => {
    // total_players: 1 here means the report has already caught up to this
    // player's own just-finalized session — a real, honest count, not a
    // guess about being first.
    rpc.mockResolvedValue({ data: { ...REPORT, total_players: 1, score_counts: { "84": 1 }, common_wrong_guesses: [] }, error: null });
    render(<LuckyBot puzzle={puzzle} state={finished()} />);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1500);
    });
    expect(screen.getByTestId("skill-standing").textContent).toBe("No comparison yet — check back once others have played.");

    fireEvent.click(screen.getByRole("button", { name: "Full report" }));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(within(screen.getByRole("dialog")).getByText("1 player finished this puzzle so far.")).toBeTruthy();
  });

  it("says nobody else has finished when the report genuinely counts zero sessions", async () => {
    rpc.mockResolvedValue({ data: { ...REPORT, total_players: 0, wins: 0, perfect: 0, players_with_wrong_guess: 0, first_solved: {}, score_counts: {}, common_wrong_guesses: [] }, error: null });
    render(<LuckyBot puzzle={puzzle} state={finished()} />);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1500);
    });
    expect(screen.getByTestId("skill-standing").textContent).toBe("No comparison yet — check back once others have played.");

    fireEvent.click(screen.getByRole("button", { name: "Full report" }));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(within(screen.getByRole("dialog")).getByText("No one else has finished this puzzle yet.")).toBeTruthy();
  });

  it("opens the full report with the score breakdown and the common wrong guesses", async () => {
    render(<LuckyBot puzzle={puzzle} state={finished()} />);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1500);
    });
    fireEvent.click(screen.getByRole("button", { name: "Full report" }));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });
    const dialog = screen.getByRole("dialog");
    expect(within(dialog).getByText("Lucky Bot")).toBeTruthy();
    expect(within(dialog).getByText("Solved with 1 mistake")).toBeTruthy();
    expect(within(dialog).getByText("Spotted the Rainbow mid-game")).toBeTruthy();
    expect(within(dialog).getByText(/5 players finished/)).toBeTruthy();

    const list = within(dialog).getByTestId("wrong-guess-list");
    expect(within(list).getByText("3 players: 3 from Parts of the Leg and 1 from Adore. One away.")).toBeTruthy();
    expect(within(list).getByText(/2 players submitted the Rainbow words as a normal category/)).toBeTruthy();

    expect(within(dialog).getByText(/80% of players made at least one wrong guess/)).toBeTruthy();
    expect(within(dialog).getByText(/40% spotted it mid-game/)).toBeTruthy();

    fireEvent.click(within(dialog).getByRole("button", { name: "Close report" }));
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("survives a missing report without crashing, and never claims the player is first", async () => {
    // This is what production looks like before the get_puzzle_report
    // migration is applied: the RPC doesn't exist yet, so every fetch
    // errors and report stays null. The player is very unlikely to
    // actually be first, so the copy must not say so.
    rpc.mockResolvedValue({ data: null, error: { message: "boom" } });
    render(<LuckyBot puzzle={puzzle} state={finished()} />);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1500);
    });
    expect(screen.getByTestId("skill-score").textContent).toBe("84");
    expect(screen.getByTestId("skill-standing").textContent).toBe("Comparison isn't available right now.");
    expect(screen.getByTestId("skill-standing").textContent).not.toMatch(/first/i);

    fireEvent.click(screen.getByRole("button", { name: "Full report" }));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });
    const dialog = screen.getByRole("dialog");
    expect(within(dialog).getByText("Comparison isn't available right now.")).toBeTruthy();
    // The report-dependent sections (wrong guesses, first solved, Rainbow
    // split) must not render at all when there is no report to draw them
    // from — showing zeros there would be its own false claim.
    expect(within(dialog).queryByText(/Most common wrong guess/)).toBeNull();
    expect(within(dialog).queryByText(/First category solved/)).toBeNull();
  });
});
