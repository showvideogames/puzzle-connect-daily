/**
 * Showing a finished game this browser has no copy of.
 *
 * A player who finished a puzzle on another device, or cleared this
 * browser, used to get a locked, empty board: the app asked the server only
 * "has this been finished?" and never for the game itself. The server has
 * always kept the game — the outcome on game_sessions, every guess on
 * guess_events, every hint on hint_events — and a signed-in player is
 * allowed to read their own rows. This file reads them back.
 *
 * TWO LEVELS OF DETAIL, NEVER MORE THAN WAS SAVED
 *
 *   "full"     the guess-by-guess history is rebuilt from the saved guesses
 *              and hints, then checked against the share grid saved the
 *              moment the game ended. Only an exact match is used: the board,
 *              results, Share and Lucky Bot then work exactly as they do for
 *              a game finished in this browser.
 *   "summary"  anything less — guesses missing, a puzzle edited since, an
 *              older record without a saved grid, or a guest (who can only
 *              read the outcome). Shows what the record says for certain:
 *              won or lost, mistakes, the Rainbow, whether hints were used.
 *              No result rows and no Share, because nothing is invented.
 *
 * Reading never writes. The restored game is never saved to this browser
 * either (useGame skips every progress write for it), so it can only ever be
 * what the server says.
 */
import { supabase } from "@/integrations/supabase/client";
import type { GuessAttempt, Puzzle } from "./types";
import { COMPLETED_STATUSES, getDeviceToken } from "./gameStats";
import { SOLVE_ORDER_NAME, formatOf, rainbowHerringFor } from "./puzzleFormat";
import { buildShareGrid } from "./shareGrid";
import type { ProgressOwner } from "./progressOwner";

export interface RestoredGame {
  /** See the file comment. */
  detail: "full" | "summary";
  /**
   * The official session, so an unused post-game Rainbow answer can still be
   * saved against it. null for a guest, who cannot read session ids.
   */
  sessionId: string | null;
  isWon: boolean;
  mistakes: number;
  /** Every category, in the order the finished board shows them. */
  solvedGroups: number[];
  /** Empty for a summary: no history is made up. */
  guessHistory: GuessAttempt[];
  gotRainbow: boolean;
  rainbowSolveIndex: number | null;
  /** Where the Rainbow was found, when the record says. */
  rainbowSource: "in_game" | "post_game" | null;
  /** Whether the post-game Rainbow question has already been answered. */
  bonusRainbowAttempted: boolean;
  hintsUsed: boolean;
  smallHintUsed: boolean;
  fullHintUsed: boolean;
  activeTimeSeconds: number;
  /** The highest guess number saved, so a later answer is numbered after it. */
  lastGuessNumber: number;
}

export type FinishedGameLookup = { status: "none" } | { status: "found"; game: RestoredGame };

/** The fields of a game_sessions row this file reads. */
export interface FinishedSessionRow {
  id: string | null;
  won: boolean | null;
  mistakes: number | null;
  solve_order: unknown;
  found_rainbow: boolean | null;
  rainbow_solve_index: number | null;
  rainbow_source: string | null;
  bonus_rainbow_attempted: boolean | null;
  hints_used: boolean | null;
  share_grid: string | null;
  active_time_seconds: number | null;
}

export interface SavedGuessRow {
  guess_number: number;
  words: unknown;
  correct: boolean;
  is_rainbow_attempt: boolean | null;
  is_one_away: boolean | null;
  is_almost_rainbow: boolean | null;
  attempt_type: string | null;
  guessed_at: string | null;
}

export interface SavedHintRow {
  hint_type: string;
  guess_count: number | null;
  revealed_at: string | null;
}

/**
 * Ask the server whether this player has an official finished game for the
 * puzzle, and if so, what it was.
 *
 * Throws when the server cannot be asked or does not answer properly: the
 * caller shows Retry, never a fresh board, because "we don't know" is not
 * "you haven't played".
 */
export async function lookupFinishedGame(puzzle: Puzzle, owner: ProgressOwner): Promise<FinishedGameLookup> {
  return owner.kind === "account" ? lookupForAccount(puzzle, owner.userId) : lookupForGuest(puzzle, owner.deviceId);
}

async function lookupForAccount(puzzle: Puzzle, userId: string): Promise<FinishedGameLookup> {
  // Filtered to this account explicitly, not left to the row policy alone:
  // an admin's policy can read every player's sessions.
  const { data, error } = await supabase
    .from("game_sessions")
    .select(
      "id, won, mistakes, solve_order, found_rainbow, rainbow_solve_index, rainbow_source, bonus_rainbow_attempted, hints_used, share_grid, active_time_seconds"
    )
    .eq("puzzle_id", puzzle.id)
    .eq("user_id", userId)
    .eq("is_official", true)
    .in("status", [...COMPLETED_STATUSES])
    .limit(1);
  if (error) throw new Error(`Could not read the finished game: ${error.message}`);
  const row = (data?.[0] ?? null) as FinishedSessionRow | null;
  if (!row || !row.id) return { status: "none" };

  const [guesses, hints] = await Promise.all([
    supabase
      .from("guess_events")
      .select("guess_number, words, correct, is_rainbow_attempt, is_one_away, is_almost_rainbow, attempt_type, guessed_at")
      .eq("game_session_id", row.id)
      .order("guess_number", { ascending: true }),
    supabase
      .from("hint_events")
      .select("hint_type, guess_count, revealed_at")
      .eq("game_session_id", row.id),
  ]);
  if (guesses.error) throw new Error(`Could not read the saved guesses: ${guesses.error.message}`);
  if (hints.error) throw new Error(`Could not read the saved hints: ${hints.error.message}`);

  return {
    status: "found",
    game: buildRestoredGame(
      puzzle,
      row,
      (guesses.data ?? []) as SavedGuessRow[],
      (hints.data ?? []) as SavedHintRow[]
    ),
  };
}

async function lookupForGuest(puzzle: Puzzle, deviceId: string): Promise<FinishedGameLookup> {
  // A browser with no usable identity has no saved games to find.
  const deviceToken = getDeviceToken();
  if (!deviceToken || deviceId === "unknown") return { status: "none" };
  const { data, error } = await supabase.rpc("get_own_completed_sessions", {
    _device_id: deviceId,
    _device_token: deviceToken,
    _format: formatOf(puzzle).id,
  });
  if (error || !Array.isArray(data)) throw new Error(`Could not read the finished game: ${error?.message ?? "no answer"}`);
  const found = (data as Array<Omit<FinishedSessionRow, "id" | "share_grid" | "active_time_seconds"> & { puzzle_id: string }>)
    .find((r) => r.puzzle_id === puzzle.id);
  if (!found) return { status: "none" };
  // A guest can read the outcome only: no session id, guesses or grid.
  return {
    status: "found",
    game: buildRestoredGame(puzzle, { ...found, id: null, share_grid: null, active_time_seconds: null }, [], []),
  };
}

const norm = (w: string) => w.trim().toUpperCase();

/** The finished board's category order for a game with no usable history. */
function boardOrderFromSolveOrder(puzzle: Puzzle, solveOrder: unknown): number[] {
  const order: number[] = [];
  for (const name of Array.isArray(solveOrder) ? solveOrder : []) {
    const idx = puzzle.groups.findIndex((g) => SOLVE_ORDER_NAME[g.difficulty] === name);
    if (idx !== -1 && !order.includes(idx)) order.push(idx);
  }
  return withRemaining(puzzle, order);
}

/** The categories not yet listed, easiest first — as a lost board reveals them. */
function withRemaining(puzzle: Puzzle, solved: number[]): number[] {
  const rest = puzzle.groups
    .map((g, idx) => ({ idx, diff: g.difficulty }))
    .sort((a, b) => a.diff - b.diff)
    .map((x) => x.idx)
    .filter((idx) => !solved.includes(idx));
  return [...solved, ...rest];
}

/**
 * Turn the saved rows into a game the board can show. Pure: everything it
 * knows comes from its arguments. See the file comment for the two levels.
 */
export function buildRestoredGame(
  puzzle: Puzzle,
  row: FinishedSessionRow,
  guesses: SavedGuessRow[],
  hints: SavedHintRow[]
): RestoredGame {
  const source = row.rainbow_source === "in_game" || row.rainbow_source === "post_game" ? row.rainbow_source : null;
  const hintTypes = new Set(hints.map((h) => h.hint_type));
  const summary: RestoredGame = {
    detail: "summary",
    sessionId: row.id,
    isWon: row.won === true,
    mistakes: row.mistakes ?? 0,
    solvedGroups: boardOrderFromSolveOrder(puzzle, row.solve_order),
    guessHistory: [],
    gotRainbow: row.found_rainbow === true,
    rainbowSolveIndex: row.rainbow_solve_index ?? null,
    rainbowSource: source,
    bonusRainbowAttempted: row.bonus_rainbow_attempted === true,
    hintsUsed: row.hints_used === true,
    smallHintUsed: hintTypes.has("small"),
    fullHintUsed: hintTypes.has("full"),
    activeTimeSeconds: row.active_time_seconds ?? 0,
    lastGuessNumber: guesses.reduce((max, g) => Math.max(max, g.guess_number), 0),
  };
  const rebuilt = rebuildHistory(puzzle, row, guesses, hints);
  return rebuilt ? { ...summary, detail: "full", ...rebuilt } : summary;
}

/**
 * The guess-by-guess history, or null unless it reproduces the saved game
 * exactly: the same share grid, outcome, mistakes and Rainbow.
 */
function rebuildHistory(
  puzzle: Puzzle,
  row: FinishedSessionRow,
  guesses: SavedGuessRow[],
  hints: SavedHintRow[]
): Pick<RestoredGame, "guessHistory" | "solvedGroups" | "rainbowSolveIndex"> | null {
  const savedGrid = (row.share_grid ?? "").trim();
  if (!savedGrid) return null;

  const format = formatOf(puzzle);
  const herring = rainbowHerringFor(puzzle);
  const herringSet = herring ? new Set(herring.map(norm)) : null;
  const groupOf = new Map<string, number>();
  puzzle.groups.forEach((g, idx) => g.words.forEach((w) => groupOf.set(norm(w), idx)));

  // The in-game guesses must be complete: numbered 1, 2, 3… with no gap.
  const board = guesses.filter((g) => g.attempt_type !== "bonus_rainbow").sort((a, b) => a.guess_number - b.guess_number);
  if (board.length === 0 || board.some((g, i) => g.guess_number !== i + 1)) return null;

  const attempts: GuessAttempt[] = [];
  const solved: number[] = [];
  let misses = 0;
  let rainbowAt: number | null = null;
  for (const g of board) {
    const words = Array.isArray(g.words) ? g.words.map(String) : [];
    if (words.length !== format.answersPerCategory) return null;
    const groupIndices = words.map((w) => groupOf.get(norm(w)));
    if (groupIndices.some((gi) => gi === undefined)) return null;
    const indices = groupIndices as number[];
    const guessedAt = g.guessed_at ?? undefined;
    const isRainbowFind =
      !g.correct && rainbowAt === null && !!herringSet && words.every((w) => herringSet.has(norm(w)));
    if (isRainbowFind) {
      rainbowAt = solved.length;
      attempts.push({ words, groupIndices: indices, isCorrect: false, isRainbow: true, isRainbowAttempt: true, guessedAt });
    } else if (g.correct) {
      const groupIdx = indices[0];
      if (indices.some((gi) => gi !== groupIdx) || solved.includes(groupIdx)) return null;
      solved.push(groupIdx);
      attempts.push({ words, groupIndices: indices, isCorrect: true, isRainbowAttempt: g.is_rainbow_attempt === true, guessedAt });
    } else {
      misses += 1;
      attempts.push({
        words,
        groupIndices: indices,
        isCorrect: false,
        isOneAway: g.is_one_away === true,
        isAlmostRainbow: g.is_almost_rainbow === true,
        isRainbowAttempt: g.is_rainbow_attempt === true,
        guessedAt,
      });
    }
  }

  // The same outcome the record states.
  const won = solved.length === format.categoryCount;
  if (won !== (row.won === true)) return null;
  if (misses !== (row.mistakes ?? -1)) return null;
  const foundInGame = rainbowAt !== null;
  if (foundInGame && (row.found_rainbow !== true || row.rainbow_source === "post_game")) return null;

  // Hints go back where they were revealed: after the number of guesses
  // submitted at the time. One per type, the earliest if repeated.
  const byType = new Map<string, SavedHintRow>();
  for (const h of [...hints].sort((a, b) => (a.revealed_at ?? "").localeCompare(b.revealed_at ?? ""))) {
    if ((h.hint_type === "small" || h.hint_type === "full") && !byType.has(h.hint_type)) byType.set(h.hint_type, h);
  }
  const hintsAt = (count: number) =>
    [...byType.values()]
      .filter((h) => (h.guess_count ?? 0) === count)
      .map((h): GuessAttempt => ({ words: [], groupIndices: [], isCorrect: false, isHintMarker: true, hintType: h.hint_type as "small" | "full" }));
  if ([...byType.values()].some((h) => (h.guess_count ?? 0) > attempts.length)) return null;

  const completed: GuessAttempt[] = [];
  attempts.forEach((a, i) => {
    completed.push(...hintsAt(i), a);
  });
  if (buildShareGrid(completed, puzzle) !== savedGrid) return null;

  // After the game: hints revealed then, and a Rainbow found through the
  // post-game question (a wrong answer leaves no row, as in the live game).
  const history = [...completed, ...hintsAt(attempts.length)];
  const postGameFind = guesses.find((g) => g.attempt_type === "bonus_rainbow" && g.correct);
  if (row.rainbow_source === "post_game") {
    if (!postGameFind || foundInGame) return null;
    const words = Array.isArray(postGameFind.words) ? postGameFind.words.map(String) : [];
    history.push({
      words,
      groupIndices: [],
      isCorrect: false,
      isRainbow: true,
      isRainbowAttempt: true,
      guessedAt: postGameFind.guessed_at ?? undefined,
    });
  } else if (row.found_rainbow === true && !foundInGame) {
    return null;
  }

  return {
    guessHistory: history,
    solvedGroups: won ? solved : withRemaining(puzzle, solved),
    rainbowSolveIndex: row.rainbow_solve_index ?? rainbowAt,
  };
}
