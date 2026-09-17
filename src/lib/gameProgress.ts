/**
 * Local resumable progress — the fast, offline-capable resume mechanism.
 *
 * localStorage remains the source of truth for restoring a board instantly on
 * refresh; the durable server session (see lib/gameSession.ts) exists
 * alongside it for analysis and official results, not as a replacement. The
 * one new link between them is `gameSessionId` below, which is what lets a
 * resumed game keep APPENDING to the session it already started instead of
 * beginning a second one.
 *
 * Extracted verbatim from useGame.ts (the behavior is unchanged) so that both
 * the game hook and the session layer can read and write the same blob without
 * an import cycle between them.
 */
import { GuessAttempt } from "./types";
import type { PinnedPuzzleContent } from "./puzzleVersion";

export interface SavedProgress {
  solvedGroups: number[];
  mistakes: number;
  guessHistory: GuessAttempt[];
  gotRainbow: boolean;
  shuffledWords: string[];
  rainbowWords: string[];
  isComplete?: boolean;
  isWon?: boolean;
  finalSolvedGroups?: number[];
  tileColors?: Record<string, string | null>;
  rainbowSolveIndex?: number | null;
  // Whether Small/Full Hint had been revealed at any point in this puzzle
  // session. Persisted alongside the rest of progress so a refresh/resume
  // doesn't lose it — see the effectiveSmallHintUsed/effectiveFullHintUsed
  // restoration in useGame(), which is what actually keeps
  // game_sessions.hints_used correct. Absent on progress blobs saved before
  // this field existed (see hintUsedInHistory for the legacy fallback).
  smallHintUsed?: boolean;
  fullHintUsed?: boolean;
  // Cumulative ACTIVE play seconds accumulated so far this puzzle attempt
  // (background-tab time already excluded — see activeSecondsRef/isVisibleRef
  // in useGame). Persisted so a refresh/resume continues counting from here
  // instead of restarting at 0. Absent on progress blobs saved before this
  // field existed; that earlier time cannot be reconstructed and is not
  // guessed at — see the activeSecondsRef initializer.
  activeTimeSeconds?: number;
  /**
   * The durable server `game_sessions.id` this local attempt belongs to.
   *
   * Written once, when the session is created on the first meaningful
   * gameplay action, and read on every subsequent mount so that refresh, SPA
   * navigation away and back, and browser close/reopen all continue appending
   * events to the SAME server session rather than starting a new one.
   *
   * Absent in two legitimate cases, which are handled identically (create the
   * session on the next meaningful action — see useGameSession):
   *   - a legacy progress blob saved before this field existed;
   *   - a genuinely new attempt whose first meaningful action hasn't happened
   *     yet.
   */
  gameSessionId?: string | null;
  /**
   * The exact puzzle content this attempt is being played against, captured
   * once the game became real.
   *
   * This is what makes an edited puzzle safe for someone already playing it.
   * Without it, a refresh re-fetched the NEW definition while this blob
   * restored the OLD board, leaving words on screen that belonged to no
   * group and correct answers that could never be submitted.
   *
   * Absent in the same two legitimate cases as gameSessionId above (a legacy
   * blob, or an attempt whose first meaningful action hasn't happened yet)
   * and on a database without the versioning migration. All three resolve
   * identically: play the current version. See lib/puzzleVersion.ts.
   */
  puzzleSnapshot?: PinnedPuzzleContent | null;
}

export function progressKey(puzzleId: string) {
  return `connections-progress-${puzzleId}`;
}

export function hasInProgressGame(puzzleId: string): boolean {
  try {
    return localStorage.getItem(progressKey(puzzleId)) !== null;
  } catch {
    return false;
  }
}

/**
 * Did this puzzle attempt reach a point actually worth calling "in
 * progress" — as opposed to merely having a progress ROW at all?
 *
 * Narrower than hasInProgressGame() above, and for a real reason: a progress
 * blob, once written, is never deleted just because its content later goes
 * back to empty. useGame.ts's tileColors-triggered save effect writes on
 * EVERY color change with no "is there anything worth keeping" guard — so a
 * player who opens a puzzle, paints one tile out of curiosity, then erases
 * it, leaves a blob behind whose solvedGroups/mistakes/guessHistory are all
 * still empty but which nonetheless EXISTS, and hasInProgressGame() can only
 * answer "does a blob exist", not "does it actually say anything happened".
 *
 * "Meaningful" is deliberately narrow, matching exactly the two things a
 * player can point to as real progress: a solved category, or a tile that
 * is STILL carrying a color mark right now. A selected-but-unsubmitted word
 * or a mistake with no solve doesn't count, because the calendar cell has no
 * way to show either of those if the player reopens it — only a solved
 * group or a surviving paint mark is actually visible proof of progress.
 */
export function hasMeaningfulProgress(puzzleId: string): boolean {
  const saved = loadProgress(puzzleId);
  if (!saved) return false;
  if (saved.solvedGroups.length > 0) return true;
  return Object.values(saved.tileColors ?? {}).some(Boolean);
}

export function saveProgress(puzzleId: string, data: SavedProgress) {
  try {
    localStorage.setItem(progressKey(puzzleId), JSON.stringify(data));
  } catch {}
}

export function loadProgress(puzzleId: string): SavedProgress | null {
  try {
    const raw = localStorage.getItem(progressKey(puzzleId));
    if (!raw) return null;
    return JSON.parse(raw) as SavedProgress;
  } catch {
    return null;
  }
}

export function clearProgress(puzzleId: string) {
  try {
    localStorage.removeItem(progressKey(puzzleId));
  } catch {}
}

/**
 * Read-modify-write a single field on an ALREADY-existing progress blob,
 * never creating one.
 *
 * Returning early when no blob exists preserves the "an untouched puzzle has
 * no progress row" invariant that useGame's tileColors mount-guard relies on:
 * none of these checkpoints can turn a merely-opened puzzle into one that
 * looks started. (Archive's "in progress" calendar status no longer relies on
 * this invariant alone — see hasMeaningfulProgress, which checks what a blob
 * actually contains rather than whether one merely exists — but the
 * mount-guard still does, so this early return still matters.)
 */
function checkpointField<K extends keyof SavedProgress>(
  puzzleId: string,
  field: K,
  value: SavedProgress[K]
) {
  try {
    const raw = localStorage.getItem(progressKey(puzzleId));
    if (!raw) return;
    const existing = JSON.parse(raw) as SavedProgress;
    existing[field] = value;
    localStorage.setItem(progressKey(puzzleId), JSON.stringify(existing));
  } catch {}
}

/**
 * Lightweight active-time checkpoint.
 *
 * The full saveProgress() call sites already carry activeTimeSeconds on every
 * real state change (guess, hint, tile color), which covers most of the time;
 * this fills the gap where a player spends a long stretch just thinking — no
 * guess, no hint — and then refreshes, closes, or backgrounds the tab before
 * any of those fire.
 */
export function checkpointActiveTime(puzzleId: string, activeTimeSeconds: number) {
  checkpointField(puzzleId, "activeTimeSeconds", activeTimeSeconds);
}

/**
 * Persist the durable server session id as soon as it is known.
 *
 * Written through this read-modify-write checkpoint rather than a full
 * saveProgress() because session creation resolves asynchronously, after the
 * gameplay state change that triggered it has already been saved. A full
 * write here would race that state and could clobber it with a stale
 * snapshot; touching exactly one field cannot.
 */
export function checkpointGameSessionId(puzzleId: string, gameSessionId: string | null) {
  checkpointField(puzzleId, "gameSessionId", gameSessionId);
}
