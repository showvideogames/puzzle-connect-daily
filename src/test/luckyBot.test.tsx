/**
 * The Lucky Bot card and its full report, rendered against canned
 * get_puzzle_report and get_luck_report answers.
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

const miniPuzzle = {
  id: "mini-1",
  date: "2026-09-24",
  format: "mini",
  groups: [
    { category: "Leg", words: ["CALF", "FOOT", "HIP"], difficulty: 2 },
    { category: "Ugly", words: ["CRY", "DUCKLING", "SWEATER"], difficulty: 3 },
    { category: "Adore", words: ["FANCY", "FAWN", "GUSH"], difficulty: 4 },
  ],
  rainbowHerring: null,
} as unknown as Puzzle;

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
  score_counts: { "70": 1, "80": 1, "84": 1, "90": 1, "95": 1 },
  common_wrong_guesses: [
    { words: ["CALF", "FANCY", "FOOT", "HIP"], players: 3, one_away: true, rainbow_attempt: false, almost_rainbow: false },
    { words: ["CALF", "CUB", "DUCKLING", "FAWN"], players: 2, one_away: false, rainbow_attempt: true, almost_rainbow: false },
  ],
};

const luckOk = (eligible: number, same: number) => ({
  data: { status: "ok", eligible_players: eligible, same_path: same, ceiling: 5000, min_players: 500 },
  error: null,
});

let reportAnswer: { data: unknown; error: unknown };
let luckAnswers: { data: unknown; error: unknown }[];

beforeEach(() => {
  vi.useFakeTimers();
  rpc.mockReset();
  reportAnswer = { data: REPORT, error: null };
  luckAnswers = [luckOk(120, 4)];
  rpc.mockImplementation(async (name: string) => {
    if (name === "get_luck_report") return luckAnswers.length > 1 ? luckAnswers.shift()! : luckAnswers[0];
    return reportAnswer;
  });
});

async function settle(ms = 1500) {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(ms);
  });
}

const luckCalls = () => rpc.mock.calls.filter(([name]) => name === "get_luck_report");

describe("LuckyBot — Full game", () => {
  it("renders nothing until the game is complete", () => {
    render(<LuckyBot puzzle={puzzle} state={finished({ isComplete: false })} />);
    expect(screen.queryByTestId("lucky-bot-card")).toBeNull();
    expect(rpc).not.toHaveBeenCalled();
  });

  it("shows Skill above Luck, with Luck held back while results are collected", async () => {
    render(<LuckyBot puzzle={puzzle} state={finished()} />);
    const skill = screen.getByTestId("skill-row");
    const luck = screen.getByTestId("luck-row");
    expect(skill.compareDocumentPosition(luck) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    // One mistake (88), Yellow first (+0), Rainbow (+1).
    expect(screen.getByTestId("skill-score").textContent).toBe("89");
    expect(skill.textContent).toContain("/ 99 skill");
    expect(screen.getByTestId("luck-score").textContent).toBe("—");
    expect(screen.getByTestId("luck-line").textContent).toBe("Lucky Bot is checking your path…");

    await settle();
    expect(luckCalls()[0][1]).toMatchObject({ _puzzle_id: "puzzle-1" });
    expect(screen.getByTestId("luck-score").textContent).toBe("—");
    // The dash is hidden from screen readers, which hear words instead.
    expect(screen.getByTestId("luck-score").getAttribute("aria-hidden")).toBe("true");
    expect(screen.getByTestId("luck-row").textContent).toContain("No Luck Score yet");
    expect(screen.getByTestId("luck-line").textContent).toBe(
      "Lucky Bot is still collecting results. So far, 1 in 30 players took your path."
    );
    // The old "better than X%" line is not on the Full card.
    expect(screen.queryByTestId("skill-standing")).toBeNull();
  });

  it("shows the Luck number once 500 players have finished", async () => {
    luckAnswers = [luckOk(500, 1)];
    render(<LuckyBot puzzle={puzzle} state={finished()} />);
    await settle();
    expect(screen.getByTestId("luck-score").textContent).toBe("73");
    expect(screen.getByTestId("luck-row").textContent).toContain("/ 100 luck");
    expect(screen.getByTestId("luck-score").hasAttribute("aria-hidden")).toBe(false);
    expect(screen.getByTestId("luck-row").textContent).not.toContain("No Luck Score yet");
    expect(screen.getByTestId("luck-line").textContent).toBe("Nobody else took your exact path — 1 in 500.");
  });

  it("keeps the rainbow 100 / 99 treatment for a 100 only", () => {
    const { unmount } = render(
      <LuckyBot puzzle={puzzle} state={finished({ mistakes: 0, solvedGroups: [3, 2, 1, 0], gotRainbow: true })} />
    );
    expect(screen.getByTestId("skill-score").textContent).toBe("100");
    expect(screen.getByTestId("skill-score").getAttribute("data-perfect-plus")).toBe("true");
    expect(screen.getByTestId("skill-row").textContent).toContain("/ 99");
    unmount();

    render(<LuckyBot puzzle={puzzle} state={finished({ mistakes: 0, solvedGroups: [3, 2, 1, 0], gotRainbow: false })} />);
    expect(screen.getByTestId("skill-score").textContent).toBe("99");
    expect(screen.getByTestId("skill-score").getAttribute("data-perfect-plus")).toBeNull();
  });

  it("adds the Rainbow point and re-reads Luck when the Rainbow is found after the result appears", async () => {
    const before = finished({ gotRainbow: false, rainbowSolveIndex: null });
    luckAnswers = [luckOk(600, 3), luckOk(600, 1)];
    const { rerender } = render(<LuckyBot puzzle={puzzle} state={before} rainbowPromptResult={null} />);
    expect(screen.getByTestId("skill-score").textContent).toBe("88");
    await settle();
    expect(screen.getByTestId("luck-line").textContent).toBe("1 in 200 players took your path.");

    // What the board does on a correct post-game prompt: gotRainbow flips
    // (markRainbowFound), then the prompt's result lands.
    rerender(<LuckyBot puzzle={puzzle} state={{ ...before, gotRainbow: true, rainbowSolveIndex: 4 }} rainbowPromptResult={null} />);
    rerender(<LuckyBot puzzle={puzzle} state={{ ...before, gotRainbow: true, rainbowSolveIndex: 4 }} rainbowPromptResult={true} />);
    expect(screen.getByTestId("skill-score").textContent).toBe("89");
    await settle();
    expect(luckCalls().length).toBeGreaterThanOrEqual(2);
    expect(screen.getByTestId("luck-line").textContent).toBe("Nobody else took your exact path — 1 in 600.");
  });

  it("tries once more when the player's own result has not been saved yet", async () => {
    luckAnswers = [{ data: { status: "no_session" }, error: null }, luckOk(40, 2)];
    render(<LuckyBot puzzle={puzzle} state={finished()} />);
    await settle();
    expect(screen.getByTestId("luck-line").textContent).toBe("Luck Score only counts a saved first attempt.");
    await settle(4000);
    expect(screen.getByTestId("luck-line").textContent).toBe(
      "Lucky Bot is still collecting results. So far, 1 in 20 players took your path."
    );
  });

  it("says Luck isn't available when the function is missing, without touching Skill", async () => {
    // Production before the migration: both functions are missing.
    reportAnswer = { data: null, error: { message: "boom" } };
    luckAnswers = [{ data: null, error: { message: "boom" } }];
    render(<LuckyBot puzzle={puzzle} state={finished()} />);
    await settle();
    expect(screen.getByTestId("skill-score").textContent).toBe("89");
    expect(screen.getByTestId("luck-line").textContent).toBe("Luck Score isn't available right now.");
  });

  it("opens a full report with Skill and Luck in separate sections", async () => {
    luckAnswers = [luckOk(750, 3)];
    render(<LuckyBot puzzle={puzzle} state={finished()} />);
    await settle();
    fireEvent.click(screen.getByRole("button", { name: "Full Report" }));
    await settle(0);
    const dialog = screen.getByRole("dialog");

    const skill = within(dialog).getByTestId("report-skill");
    expect(within(skill).getByText("Skill Score")).toBeTruthy();
    expect(within(skill).getByText("Solved with 1 mistake")).toBeTruthy();
    expect(within(skill).getByText("Started with Yellow")).toBeTruthy();
    expect(within(skill).getByText("Found the Rainbow")).toBeTruthy();
    expect(within(skill).getByText("Based only on how you played.")).toBeTruthy();

    const luck = within(dialog).getByTestId("report-luck");
    expect(within(luck).getByText("Luck Score")).toBeTruthy();
    expect(within(luck).getByText("65")).toBeTruthy();
    expect(within(luck).getByText("1 in 250 players took your path.")).toBeTruthy();
    expect(within(luck).getByText(/3 of 750 players took this path/)).toBeTruthy();
    expect(within(luck).getByText(/not how well you\s+played/)).toBeTruthy();
    expect(skill.compareDocumentPosition(luck) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();

    // The crowd sections are unchanged.
    const list = within(dialog).getByTestId("wrong-guess-list");
    expect(within(list).getByText("3 players: 3 from Parts of the Leg and 1 from Adore. One away.")).toBeTruthy();
    expect(within(dialog).getByText(/40% spotted it mid-game/)).toBeTruthy();

    fireEvent.click(within(dialog).getByRole("button", { name: "Close report" }));
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("explains the threshold in the report while results are collected", async () => {
    render(<LuckyBot puzzle={puzzle} state={finished()} />);
    await settle();
    fireEvent.click(screen.getByRole("button", { name: "Full Report" }));
    await settle(0);
    const luck = within(screen.getByRole("dialog")).getByTestId("report-luck");
    expect(within(luck).getByText(/A number appears once 500 players have finished\.\s+120 so far\./)).toBeTruthy();
  });
});

describe("LuckyBot — Mini (unchanged)", () => {
  const miniState = (overrides: Partial<GameState> = {}) =>
    finished({ puzzleId: miniPuzzle.id, solvedGroups: [0, 1, 2], gotRainbow: false, rainbowSolveIndex: null, ...overrides });

  it("keeps the single skill score and the comparison line, and never asks for Luck", async () => {
    reportAnswer = { data: { ...REPORT, score_counts: { "70": 1, "80": 2, "90": 1 } }, error: null };
    render(<LuckyBot puzzle={miniPuzzle} state={miniState()} />);
    // Old Mini rules: one mistake, Green first → 80.
    expect(screen.getByTestId("skill-score").textContent).toBe("80");
    expect(screen.getByTestId("lucky-bot-card").textContent).toContain("/ 99 skill score");
    expect(screen.getByTestId("skill-standing").textContent).toMatch(/Comparing/);
    expect(screen.queryByTestId("luck-row")).toBeNull();

    await settle();
    expect(screen.getByTestId("skill-standing").textContent).toBe("Better than 33% of 3 other players");
    expect(luckCalls()).toHaveLength(0);
    expect(rpc).toHaveBeenCalledWith("get_puzzle_report", { _puzzle_id: "mini-1" });
  });

  it("still says nobody else has finished only when the report genuinely counts zero", async () => {
    reportAnswer = { data: { ...REPORT, total_players: 0, score_counts: {}, common_wrong_guesses: [] }, error: null };
    render(<LuckyBot puzzle={miniPuzzle} state={miniState()} />);
    await settle();
    expect(screen.getByTestId("skill-standing").textContent).toBe("No comparison yet — check back once others have played.");
    fireEvent.click(screen.getByRole("button", { name: "Full Report" }));
    await settle(0);
    const dialog = screen.getByRole("dialog");
    expect(within(dialog).getByText("No one else has finished this puzzle yet.")).toBeTruthy();
    expect(within(dialog).queryByTestId("report-luck")).toBeNull();
  });

  // The release boundary: once the migrations are applied, get_puzzle_report
  // answers a Mini with null (no error). The Mini card must look exactly as
  // it does on the live site today, where the function does not exist yet —
  // no comparison line, no crowd sections, and no Luck request.
  it("shows exactly today's live card when the database answers a Mini with no report", async () => {
    reportAnswer = { data: null, error: null };
    render(<LuckyBot puzzle={miniPuzzle} state={miniState()} />);
    await settle();
    expect(screen.getByTestId("skill-score").textContent).toBe("80");
    expect(screen.getByTestId("lucky-bot-card").textContent).toContain("/ 99 skill score");
    expect(screen.getByTestId("skill-standing").textContent).toBe("Comparison isn't available\nright now.");
    expect(screen.queryByTestId("luck-row")).toBeNull();
    expect(luckCalls()).toHaveLength(0);

    fireEvent.click(screen.getByRole("button", { name: "Full Report" }));
    await settle(0);
    const dialog = screen.getByRole("dialog");
    expect(within(dialog).getByText("Comparison isn't available right now.")).toBeTruthy();
    expect(within(dialog).queryByTestId("wrong-guess-list")).toBeNull();
    expect(within(dialog).queryByText(/First category solved/)).toBeNull();
    expect(within(dialog).queryByText(/The Rainbow/)).toBeNull();
    expect(within(dialog).queryByTestId("report-luck")).toBeNull();
  });

  it("survives a missing report without claiming the player is first", async () => {
    reportAnswer = { data: null, error: { message: "boom" } };
    render(<LuckyBot puzzle={miniPuzzle} state={miniState()} />);
    await settle();
    // The literal newline is deliberate — see standingLine in LuckyBot.tsx.
    expect(screen.getByTestId("skill-standing").textContent).toBe("Comparison isn't available\nright now.");
    fireEvent.click(screen.getByRole("button", { name: "Full Report" }));
    await settle(0);
    const dialog = screen.getByRole("dialog");
    expect(within(dialog).getByText("Comparison isn't available right now.")).toBeTruthy();
    expect(within(dialog).queryByText(/Most common wrong guess/)).toBeNull();
    expect(within(dialog).queryByText(/First category solved/)).toBeNull();
  });
});
