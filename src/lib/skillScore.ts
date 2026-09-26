/**
 * Lucky Bot skill score — the browser-side copy of the formula.
 *
 * The SAME formula lives in SQL as public.skill_score (migration
 * 20260927000000_puzzle_report.sql), where it is applied to every OTHER
 * player's finished session so the report can say "better than 62% of
 * players" using one definition of "better". This file computes the
 * current player's own score, with a line-by-line breakdown for the UI.
 * Change one copy, change both; src/test/skillScore.test.ts and the PGlite
 * check in e2e/scripts/verify-db.ts pin the same fixtures on each side.
 *
 * The formula (min 50, max 99):
 *   Won:   90 − 10 × mistakes            → 90 / 80 / 70 / 60
 *   Lost:  50 + 4 × groups solved        → 50 / 54 / 58 / 62
 *   + 4    Rainbow spotted mid-game
 *   + 1    Rainbow spotted after the game, through the bonus prompt
 *   + 2    the hardest category was solved first
 *   + 3    every category solved hardest→easiest (a "reverse rainbow")
 * 90 + 4 + 2 + 3 = 99 is the ceiling: perfect, hardest first, fully reversed,
 * Rainbow spotted mid-game.
 */

import type { GameState, Puzzle } from "@/lib/types";
import {
  DIFFICULTY_COLOR_NAME,
  formatOf,
  type Difficulty,
  type PuzzleFormat,
} from "@/lib/puzzleFormat";

export const MIN_SKILL_SCORE = 50;
export const MAX_SKILL_SCORE = 99;

/** Where the Rainbow was found, matching game_sessions.rainbow_source. */
export type RainbowSource = "in_game" | "post_game" | null;

export interface SkillScoreInput {
  won: boolean;
  mistakes: number;
  /** Difficulties of the solved categories, in the order they were solved. */
  solveOrder: readonly Difficulty[];
  rainbowFound: boolean;
  /** Null when the Rainbow was not found, or on a legacy row that never
   *  recorded a source — treated as mid-game, as the SQL copy does. */
  rainbowSource: RainbowSource;
  format: PuzzleFormat;
}

export interface SkillScoreLine {
  label: string;
  points: number;
}

export interface SkillScoreResult {
  score: number;
  /** The base line first, then each bonus that applied, then any cap. */
  lines: SkillScoreLine[];
}

function capitalise(word: string): string {
  return word.charAt(0).toUpperCase() + word.slice(1);
}

export function computeSkillScore(input: SkillScoreInput): SkillScoreResult {
  const { won, mistakes, solveOrder, rainbowFound, rainbowSource, format } = input;
  const lines: SkillScoreLine[] = [];
  const solved = solveOrder.length;
  const groupCount = format.difficultyOrder.length;
  const hardest = format.difficultyOrder[format.difficultyOrder.length - 1];
  const hardestName = capitalise(DIFFICULTY_COLOR_NAME[hardest]);
  const reverse = [...format.difficultyOrder].reverse();

  let score: number;
  if (won) {
    const m = Math.min(Math.max(mistakes, 0), 3);
    score = 90 - 10 * m;
    lines.push({
      label: m === 0 ? "Solved with no mistakes" : `Solved with ${m} mistake${m === 1 ? "" : "s"}`,
      points: score,
    });
  } else {
    const n = Math.min(solved, 3);
    score = 50 + 4 * n;
    lines.push({ label: `Found ${n} of ${groupCount} categories`, points: score });
  }

  if (rainbowFound) {
    if (rainbowSource === "post_game") {
      score += 1;
      lines.push({ label: "Spotted the Rainbow after the game", points: 1 });
    } else {
      score += 4;
      lines.push({ label: "Spotted the Rainbow mid-game", points: 4 });
    }
  }

  if (solved > 0 && solveOrder[0] === hardest) {
    score += 2;
    lines.push({ label: `${hardestName} category first`, points: 2 });
  }

  const isReverse =
    solveOrder.length === reverse.length && solveOrder.every((d, i) => d === reverse[i]);
  if (isReverse) {
    score += 3;
    lines.push({ label: "Solved hardest to easiest", points: 3 });
  }

  if (score > MAX_SKILL_SCORE) {
    lines.push({ label: `Capped at ${MAX_SKILL_SCORE}`, points: MAX_SKILL_SCORE - score });
    score = MAX_SKILL_SCORE;
  }
  if (score < MIN_SKILL_SCORE) score = MIN_SKILL_SCORE;

  return { score, lines };
}

/**
 * The solved categories' difficulties in solve order, read off the board
 * state. `solvedGroups` holds group indices in the order they were solved.
 */
export function solveOrderOf(state: Pick<GameState, "solvedGroups">, puzzle: Puzzle): Difficulty[] {
  return state.solvedGroups
    .map((i) => puzzle.groups[i]?.difficulty)
    .filter((d): d is Difficulty => d !== undefined);
}

/**
 * Whether the Rainbow was spotted mid-game or through the post-game bonus
 * prompt. The board records rainbowSolveIndex as "how many categories were
 * already solved when the Rainbow was found"; a value equal to the number
 * of categories means the game was already over, so it came from the bonus
 * prompt. A restored legacy game with no index recorded counts as mid-game,
 * matching how the SQL copy treats a row with no rainbow_source.
 */
export function rainbowSourceOf(
  state: Pick<GameState, "gotRainbow" | "rainbowSolveIndex">,
  puzzle: Puzzle
): RainbowSource {
  if (!state.gotRainbow) return null;
  const groupCount = formatOf(puzzle).difficultyOrder.length;
  if (state.rainbowSolveIndex !== null && state.rainbowSolveIndex >= groupCount) return "post_game";
  return "in_game";
}

/** The player's own score for a finished board. */
export function skillScoreForGame(state: GameState, puzzle: Puzzle): SkillScoreResult {
  return computeSkillScore({
    won: state.isWon,
    mistakes: state.mistakes,
    solveOrder: solveOrderOf(state, puzzle),
    rainbowFound: state.gotRainbow,
    rainbowSource: rainbowSourceOf(state, puzzle),
    format: formatOf(puzzle),
  });
}
