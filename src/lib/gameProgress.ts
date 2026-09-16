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
 * no progress row" invariant that Archive's "in progress" calendar status and
 * useGame's tileColors mount-guard both rely on: none of these checkpoints can
 * turn a merely-opened puzzle into one that looks started.
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
