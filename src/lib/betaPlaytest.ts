/**
 * Beta playtest tracking — the network layer.
 *
 * Deliberately the small sibling of lib/gameSession.ts + lib/gameStats.ts's
 * finalizeGameSession, not a reuse of them: a beta playtest never touches
 * game_sessions/guess_events/hint_events/game_results/user_streaks/
 * puzzle_aggregates, so every write here goes through its own
 * beta_playtests-only RPCs (see the 20260918020000 migration). Reuses the
 * SAME device identity as official play (ensureDeviceIdentity), because that
 * identity already exists for any browser that has played anything, and
 * minting a second one for Beta would just be more state to lose.
 *
 * Like lib/gameSession.ts, every function here is best-effort: a failed
 * write logs and returns, and never throws into the game loop.
 */
import { supabase } from "@/integrations/supabase/client";
import { ensureDeviceIdentity } from "./gameStats";

/**
 * Create the playtest row for a Beta game whose first meaningful action just
 * happened. Called only from useGameSession's beta-mode ensureSession — a
 * page view creates nothing, exactly like the official path.
 */
export async function startBetaPlaytest(
  puzzleId: string,
  puzzleVersionId: string | null
): Promise<string | null> {
  if (!puzzleVersionId) return null;
  try {
    const identity = await ensureDeviceIdentity();
    if (!identity) return null;

    const { data, error } = await supabase.rpc("start_beta_playtest", {
      _puzzle_id: puzzleId,
      _puzzle_version_id: puzzleVersionId,
      _device_id: identity.deviceId,
      _device_token: identity.deviceToken,
    });

    if (error || !data) {
      console.error("startBetaPlaytest failed:", error);
      return null;
    }
    return data as unknown as string;
  } catch (err) {
    console.error("startBetaPlaytest error:", err);
    return null;
  }
}

export interface FinalizeBetaPlaytestParams {
  puzzleId: string;
  puzzleVersionId: string | null;
  /** The playtest this game has been attached to, or null if creation never succeeded/completed. */
  playtestId: string | null;
  won: boolean;
  mistakes: number;
  hintsUsed: boolean;
}

/**
 * Formal win/loss for a playtest. Mirrors finalizeGameSession's fallback:
 * if no playtest id exists yet (a race between the fire-and-forget
 * recordGuess/recordHint call and this one), one is created now and
 * completed immediately.
 */
export async function finalizeBetaPlaytest(params: FinalizeBetaPlaytestParams): Promise<void> {
  const { puzzleId, puzzleVersionId, won, mistakes, hintsUsed } = params;
  try {
    const identity = await ensureDeviceIdentity();
    if (!identity) return;

    const playtestId = params.playtestId ?? (await startBetaPlaytest(puzzleId, puzzleVersionId));
    if (!playtestId) return;

    const { error } = await supabase.rpc("complete_beta_playtest", {
      _playtest_id: playtestId,
      _device_id: identity.deviceId,
      _device_token: identity.deviceToken,
      _won: won,
      _mistakes: mistakes,
      _hints_used: hintsUsed,
    });
    if (error) console.error("finalizeBetaPlaytest failed:", error);
  } catch (err) {
    console.error("finalizeBetaPlaytest error:", err);
  }
}

/**
 * Reset Puzzle: ends this device's most recent playtest for this puzzle (if
 * any) and records it as a reset. The server finds the row itself — the
 * caller only needs to know the puzzle, not any particular playtest id,
 * which is what lets the Reset button work identically whether or not the
 * current mount ever created one.
 */
export async function resetBetaPlaytest(puzzleId: string): Promise<void> {
  try {
    const identity = await ensureDeviceIdentity();
    if (!identity) return;

    const { error } = await supabase.rpc("reset_beta_playtest", {
      _puzzle_id: puzzleId,
      _device_id: identity.deviceId,
      _device_token: identity.deviceToken,
    });
    if (error) console.error("resetBetaPlaytest failed:", error);
  } catch (err) {
    console.error("resetBetaPlaytest error:", err);
  }
}

export interface SubmitBetaFeedbackParams {
  puzzleId: string;
  puzzleVersionId: string;
  playtestId: string | null;
  testerName: string;
  funRating: number;
  difficultyRating: number;
  /** Only sent for puzzles that actually have a Rainbow. */
  rainbowFairnessRating: number | null;
  confusingOrIncorrect: string;
  additionalComments: string;
  wouldPlayAgain: boolean;
}

/** Returns whether the submission succeeded, so the modal can show an error rather than a false "Thanks!". */
export async function submitBetaFeedback(params: SubmitBetaFeedbackParams): Promise<boolean> {
  try {
    const { error } = await supabase.rpc("submit_beta_feedback", {
      _puzzle_id: params.puzzleId,
      _puzzle_version_id: params.puzzleVersionId,
      _playtest_id: params.playtestId,
      _tester_name: params.testerName.trim() || null,
      _fun_rating: params.funRating,
      _difficulty_rating: params.difficultyRating,
      _rainbow_fairness_rating: params.rainbowFairnessRating,
      _confusing_or_incorrect: params.confusingOrIncorrect.trim() || null,
      _additional_comments: params.additionalComments.trim() || null,
      _would_play_again: params.wouldPlayAgain,
    });
    if (error) {
      console.error("submitBetaFeedback failed:", error);
      return false;
    }
    return true;
  } catch (err) {
    console.error("submitBetaFeedback error:", err);
    return false;
  }
}
