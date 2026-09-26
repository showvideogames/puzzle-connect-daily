/**
 * Lucky Bot skill score — the browser-side copy of the formula.
 *
 * The SAME formula lives in SQL as public.skill_score (migration
 * 20260928000000_lucky_bot_skill_and_luck.sql, first created by
 * 20260927000000_puzzle_report.sql), where it is applied to every OTHER
 * player's finished session for the report's score histogram. This file
 * computes the current player's own score, with a line-by-line breakdown
 * for the UI. Change one copy, change both; src/test/skillScore.test.ts and
 * the PGlite check in e2e/scripts/verify-db.ts pin the same fixtures on
 * each side.
 *
 * The score is about the player's own game only — never about how anyone
 * else did.
 *
 * FULL (four categories) — computeFullSkillScore:
 *   Won:  95 / 88 / 81 / 74 for 0 / 1 / 2 / 3 mistakes, plus the first
 *         category solved: Yellow +0, Green +1, Blue +2, Red +3 — or +4
 *         instead for the complete order Red → Blue → Green → Yellow.
 *   Lost: 50, plus each category actually solved: Yellow +4, Green +6,
 *         Blue +8, Red +10. No order bonus on a loss.
 *   Both: +1 for the Rainbow, found mid-game or after. Capped at 100; only
 *         a 100 is shown as "100 / 99".
 *
 * MINI — computeSkillScore, deliberately unchanged until Mini's own rules
 * are designed (min 50, max 99):
 *   Won:   90 − 10 × mistakes            → 90 / 80 / 70 / 60
 *   Lost:  50 + 4 × groups solved        → 50 / 54 / 58 / 62
 *   + 4    Rainbow spotted mid-game
 *   + 1    Rainbow spotted after the game, through the bonus prompt
 *   + 2    the hardest category was solved first
 *   + 3    every category solved hardest→easiest (a "reverse rainbow")
 */

import type { GameState, Puzzle } from "@/lib/types";
import {
  DIFFICULTY_COLOR_NAME,
  formatOf,
  type Difficulty,
  type PuzzleFormat,
} from "@/lib/puzzleFormat";

export const MIN_SKILL_SCORE = 50;
/** The "out of" number shown next to every skill score. */
export const MAX_SKILL_SCORE = 99;
/** A Full game can go one past the scale, shown as 100 / 99. */
export const FULL_SKILL_SCORE_CAP = 100;

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

/** The Mini formula (and, until this change, the Full one). Unchanged. */
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

export interface FullSkillScoreInput {
  won: boolean;
  mistakes: number;
  /** Difficulties of the categories the player actually submitted, in the
   *  order they submitted them. Never the categories revealed after a loss. */
  solveOrder: readonly Difficulty[];
  rainbowFound: boolean;
}

/** Base points for a win, by mistakes made. */
export const FULL_WIN_BASE: Record<0 | 1 | 2 | 3, number> = { 0: 95, 1: 88, 2: 81, 3: 74 };
/** Win bonus for the first category solved. */
export const FULL_FIRST_SOLVED_BONUS: Record<Difficulty, number> = { 1: 0, 2: 1, 3: 2, 4: 3 };
/** Win bonus instead of the above for the complete order Red → Blue → Green → Yellow. */
export const FULL_REVERSE_ORDER_BONUS = 4;
/** Loss points for each category actually solved. */
export const FULL_LOSS_CATEGORY_POINTS: Record<Difficulty, number> = { 1: 4, 2: 6, 3: 8, 4: 10 };
export const FULL_LOSS_BASE = 50;
export const FULL_RAINBOW_BONUS = 1;

const FULL_REVERSE: readonly Difficulty[] = [4, 3, 2, 1];

function colourName(d: Difficulty): string {
  return capitalise(DIFFICULTY_COLOR_NAME[d]);
}

/** The Full game's Skill Score. Mirrored by the Full branch of public.skill_score. */
export function computeFullSkillScore(input: FullSkillScoreInput): SkillScoreResult {
  const { won, mistakes, solveOrder, rainbowFound } = input;
  const lines: SkillScoreLine[] = [];
  let score: number;

  if (won) {
    const m = Math.min(Math.max(mistakes, 0), 3) as 0 | 1 | 2 | 3;
    score = FULL_WIN_BASE[m];
    lines.push({
      label: m === 0 ? "Solved with no mistakes" : `Solved with ${m} mistake${m === 1 ? "" : "s"}`,
      points: score,
    });
    const isReverse =
      solveOrder.length === FULL_REVERSE.length && solveOrder.every((d, i) => d === FULL_REVERSE[i]);
    if (isReverse) {
      score += FULL_REVERSE_ORDER_BONUS;
      lines.push({ label: "Full reverse order: Red → Blue → Green → Yellow", points: FULL_REVERSE_ORDER_BONUS });
    } else if (solveOrder.length > 0) {
      const bonus = FULL_FIRST_SOLVED_BONUS[solveOrder[0]];
      score += bonus;
      lines.push({ label: `Started with ${colourName(solveOrder[0])}`, points: bonus });
    }
  } else {
    score = FULL_LOSS_BASE;
    lines.push({ label: "Didn't finish the board", points: FULL_LOSS_BASE });
    for (const d of solveOrder) {
      const points = FULL_LOSS_CATEGORY_POINTS[d];
      score += points;
      lines.push({ label: `Solved ${colourName(d)}`, points });
    }
  }

  if (rainbowFound) {
    score += FULL_RAINBOW_BONUS;
    lines.push({ label: "Found the Rainbow", points: FULL_RAINBOW_BONUS });
  }

  if (score > FULL_SKILL_SCORE_CAP) {
    lines.push({ label: `Capped at ${FULL_SKILL_SCORE_CAP}`, points: FULL_SKILL_SCORE_CAP - score });
    score = FULL_SKILL_SCORE_CAP;
  }

  return { score, lines };
}

/**
 * The solved categories' difficulties in solve order, read off the board
 * state. `solvedGroups` holds group indices in the order they were solved.
 *
 * Used by the Mini score. NOTE: after a loss the board appends the
 * categories it REVEALS to solvedGroups too, so this over-counts a loss —
 * which is why the Full score uses {@link submittedSolveOrderOf} instead.
 */
export function solveOrderOf(state: Pick<GameState, "solvedGroups">, puzzle: Puzzle): Difficulty[] {
  return state.solvedGroups
    .map((i) => puzzle.groups[i]?.difficulty)
    .filter((d): d is Difficulty => d !== undefined);
}

/**
 * The categories the player actually SUBMITTED, in order, read from the
 * guess history — the same list the client writes into
 * game_sessions.solve_order at completion. Unlike solvedGroups, this never
 * includes categories the board revealed after a loss.
 *
 * Falls back to solvedGroups for a WIN whose history carries no correct
 * guesses (a very old saved game): on a win nothing is ever revealed, so
 * solvedGroups is exactly the submitted order there.
 */
export function submittedSolveOrderOf(
  state: Pick<GameState, "guessHistory" | "solvedGroups" | "isWon">,
  puzzle: Puzzle
): Difficulty[] {
  const norm = (w: string) => w.trim().toUpperCase();
  const order: Difficulty[] = [];
  for (const g of state.guessHistory) {
    if (!g.isCorrect || g.isHintMarker || g.isRainbow) continue;
    const words = new Set(g.words.map(norm));
    const group = puzzle.groups.find((pg) => pg.words.every((w) => words.has(norm(w))));
    if (group && !order.includes(group.difficulty)) order.push(group.difficulty);
  }
  if (order.length === 0 && state.isWon) return solveOrderOf(state, puzzle);
  return order;
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

/** The player's own score for a finished board: Full rules or Mini rules. */
export function skillScoreForGame(state: GameState, puzzle: Puzzle): SkillScoreResult {
  const format = formatOf(puzzle);
  if (format.id === "full") {
    return computeFullSkillScore({
      won: state.isWon,
      mistakes: state.mistakes,
      solveOrder: submittedSolveOrderOf(state, puzzle),
      rainbowFound: state.gotRainbow,
    });
  }
  return computeSkillScore({
    won: state.isWon,
    mistakes: state.mistakes,
    solveOrder: solveOrderOf(state, puzzle),
    rainbowFound: state.gotRainbow,
    rainbowSource: rainbowSourceOf(state, puzzle),
    format,
  });
}
