/**
 * DEV-ONLY preview of every Lucky Bot card state (routed only when
 * import.meta.env.DEV — not part of the production bundle).
 *
 * Renders the REAL LuckyBot component with canned report and Luck answers
 * passed in through its dataSource prop, so nothing here reads from or
 * writes to any database, and no game has to be played to see a card.
 *
 *   /__fixtures/lucky-bot          every state, stacked
 *   /__fixtures/lucky-bot?dark=1   the same, in dark mode
 */
import { useEffect } from "react";
import { useSearchParams } from "react-router-dom";
import { LuckyBot, type LuckyBotDataSource } from "@/components/LuckyBot";
import type { LuckReport } from "@/lib/luckScore";
import type { PuzzleReport } from "@/lib/puzzleReport";
import type { GameState, GuessAttempt, Puzzle } from "@/lib/types";

const FULL: Puzzle = {
  id: "fixture-full",
  date: "2026-09-24",
  groups: [
    { category: "MLB Teams Singular", words: ["ANGEL", "BRAVE", "BREWER", "CUB"], difficulty: 1 },
    { category: "Parts of the Leg", words: ["CALF", "FOOT", "HIP", "QUAD"], difficulty: 2 },
    { category: "Ugly ___", words: ["CRY", "DUCKLING", "SWEATER", "TRUTH"], difficulty: 3 },
    { category: "Adore", words: ["FANCY", "FAWN", "GUSH", "TREASURE"], difficulty: 4 },
  ],
  rainbowHerring: ["CUB", "CALF", "DUCKLING", "FAWN"],
} as Puzzle;

const MINI = {
  id: "fixture-mini",
  date: "2026-09-24",
  format: "mini",
  groups: [
    { category: "Parts of the Leg", words: ["CALF", "FOOT", "HIP"], difficulty: 2 },
    { category: "Ugly ___", words: ["CRY", "DUCKLING", "SWEATER"], difficulty: 3 },
    { category: "Adore", words: ["FANCY", "FAWN", "GUSH"], difficulty: 4 },
  ],
  rainbowHerring: null,
} as unknown as Puzzle;

const REPORT: PuzzleReport = {
  total_players: 1240,
  wins: 1010,
  perfect: 212,
  players_with_wrong_guess: 1028,
  rainbow_in_game: 390,
  rainbow_post_game: 140,
  first_solved: { orange: 610, green: 330, blue: 180, red: 120 },
  score_counts: { "74": 180, "81": 240, "88": 300, "89": 120, "95": 160, "96": 90, "99": 20, "100": 3, "60": 127 },
  common_wrong_guesses: [
    { words: ["CALF", "FANCY", "FOOT", "HIP"], players: 402, one_away: true, rainbow_attempt: false, almost_rainbow: false },
    { words: ["CALF", "CUB", "DUCKLING", "FAWN"], players: 288, one_away: false, rainbow_attempt: true, almost_rainbow: false },
  ],
};

const ok = (eligible: number, same: number): LuckReport => ({
  status: "ok",
  eligiblePlayers: eligible,
  samePath: same,
  ceiling: 5000,
  minPlayers: 500,
});

const source = (report: PuzzleReport | null, luck: LuckReport | null | "never"): LuckyBotDataSource => ({
  report: async () => report,
  luck: () => (luck === "never" ? new Promise<LuckReport | null>(() => {}) : Promise.resolve(luck)),
});

const correct = (words: string[]): GuessAttempt => ({ words, groupIndices: [], isCorrect: true });
const wrong = (words: string[]): GuessAttempt => ({ words, groupIndices: [], isCorrect: false });

function board(overrides: Partial<GameState>): GameState {
  return {
    puzzleId: FULL.id,
    solvedGroups: [0, 1, 2, 3],
    mistakes: 0,
    maxMistakes: 4,
    selectedWords: [],
    isComplete: true,
    isWon: true,
    guessHistory: [],
    gotRainbow: false,
    rainbowSolveIndex: null,
    ...overrides,
  };
}

interface Case {
  title: string;
  note: string;
  puzzle: Puzzle;
  state: GameState;
  data: LuckyBotDataSource;
}

const CASES: Case[] = [
  {
    title: "Fewer than 500 players",
    note: "One mistake, Yellow first, Rainbow found: 88 + 0 + 1 = 89. 120 players so far, 4 on this path.",
    puzzle: FULL,
    state: board({ mistakes: 1, gotRainbow: true, rainbowSolveIndex: 2 }),
    data: source(REPORT, ok(120, 4)),
  },
  {
    title: "500+ players: Luck Score shown",
    note: "Perfect, Green first, no Rainbow: 95 + 1 = 96. 1,240 players, 2 on this path (1 in 620).",
    puzzle: FULL,
    state: board({ solvedGroups: [1, 0, 2, 3] }),
    data: source(REPORT, ok(1240, 2)),
  },
  {
    title: "The 100 / 99 treatment",
    note: "Perfect full reverse with the Rainbow: 95 + 4 + 1 = 100. Only path of its kind among 3,100.",
    puzzle: FULL,
    state: board({ solvedGroups: [3, 2, 1, 0], gotRainbow: true, rainbowSolveIndex: 4 }),
    data: source(REPORT, ok(3100, 1)),
  },
  {
    title: "A loss",
    note: "Solved Red and Blue, then found the Rainbow afterwards: 50 + 10 + 8 + 1 = 69.",
    puzzle: FULL,
    state: board({
      isWon: false,
      mistakes: 4,
      gotRainbow: true,
      rainbowSolveIndex: 4,
      guessHistory: [
        correct(["FANCY", "FAWN", "GUSH", "TREASURE"]),
        wrong(["CALF", "FOOT", "HIP", "CUB"]),
        correct(["CRY", "DUCKLING", "SWEATER", "TRUTH"]),
        wrong(["ANGEL", "BRAVE", "QUAD", "CALF"]),
        wrong(["ANGEL", "CUB", "QUAD", "HIP"]),
        wrong(["BREWER", "BRAVE", "FOOT", "HIP"]),
      ],
    }),
    data: source(REPORT, ok(820, 37)),
  },
  {
    title: "Before the database update is applied",
    note: "What the live site shows until the migrations are applied: Skill works, Luck says it isn't available.",
    puzzle: FULL,
    state: board({ mistakes: 1, gotRainbow: true, rainbowSolveIndex: 2 }),
    data: source(null, null),
  },
  {
    title: "Still checking",
    note: "The moment after the result screen appears.",
    puzzle: FULL,
    state: board({ mistakes: 2, solvedGroups: [2, 0, 1, 3] }),
    data: source(REPORT, "never"),
  },
  {
    title: "Mini (unchanged)",
    note: "Mini keeps its current single score until its own rules are designed.",
    puzzle: MINI,
    state: board({ puzzleId: MINI.id, solvedGroups: [0, 1, 2], mistakes: 1 }),
    data: source(null, null),
  },
];

export default function LuckyBotFixtures() {
  const [params] = useSearchParams();
  const dark = params.get("dark") === "1";

  useEffect(() => {
    const root = document.documentElement;
    const had = root.classList.contains("dark");
    root.classList.toggle("dark", dark);
    return () => {
      root.classList.toggle("dark", had);
    };
  }, [dark]);

  return (
    <main className="min-h-screen bg-background text-foreground px-4 py-6">
      <h1 className="text-xl font-bold text-center mb-1">Lucky Bot card states</h1>
      <p className="text-center text-xs text-muted-foreground mb-6">Made-up numbers. Nothing here touches a database.</p>
      <div className="mx-auto max-w-md space-y-8">
        {CASES.map((c) => (
          <section key={c.title} data-fixture={c.title}>
            <h2 className="text-sm font-semibold mb-1 text-center">{c.title}</h2>
            <p className="text-xs text-muted-foreground mb-3 text-center">{c.note}</p>
            <LuckyBot puzzle={c.puzzle} state={c.state} dataSource={c.data} />
          </section>
        ))}
      </div>
    </main>
  );
}
