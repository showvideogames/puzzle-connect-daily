import { supabase } from "@/integrations/supabase/client";
import { GameStats } from "./types";
import type { EntryContext } from "./entryContext";
import {
  backfillGuessEvents,
  getIdentity,
  isMissingSchemaError,
  type GuessEventInput,
} from "./gameSession";

// Gets or creates a stable device ID for anonymous players
export function getDeviceId(): string {
  const key = "rc-device-id";
  try {
    const existing = localStorage.getItem(key);
    if (existing) return existing;
    const newId = crypto.randomUUID();
    localStorage.setItem(key, newId);
    return newId;
  } catch {
    return "unknown";
  }
}

/**
 * Statuses that represent a formally COMPLETED game.
 *
 * Sessions are now created on the first meaningful gameplay action, so the
 * existence of a game_sessions row NO LONGER implies "Played". Every
 * player-facing stat, and every "has this been finished?" check, must filter
 * on these values — that assumption is false everywhere it is left implicit.
 */
export const COMPLETED_STATUSES = ["won", "lost"] as const;

/**
 * Flips found_rainbow (and the solve position it implies) on the session the
 * post-completion "Spot the Rainbow" bonus belongs to.
 *
 * Targets the session BY ID rather than re-deriving it from
 * puzzle_id + identity as the previous implementation did. That lookup can
 * now match the wrong row, because a puzzle+identity may legitimately have
 * more than one session (a completed official one plus a later in-progress
 * replay); an id cannot be ambiguous.
 *
 * The bonus prompt only ever appears once all 4 categories are solved, so a
 * find via this path is always at position 4 — the one value this path can
 * produce, not a recalculation.
 */
export async function markRainbowFoundInSession(sessionId: string): Promise<void> {
  try {
    const { error } = await supabase
      .from("game_sessions")
      .update({ found_rainbow: true, rainbow_solve_index: 4 })
      .eq("id", sessionId);
    if (error) console.error("Failed to mark rainbow found:", error);
  } catch (err) {
    console.error("markRainbowFoundInSession error:", err);
  }
}

/**
 * Records one Rainbow-attempt guess event from the post-completion "Spot the
 * Rainbow" bonus modal — success or failure alike, since a failed bonus
 * attempt would otherwise vanish entirely.
 *
 * guessNumber is supplied by the caller from the same guess history the live
 * path uses, so this shares the (game_session_id, guess_number) idempotency
 * key with every other guess instead of deriving a number from a non-atomic
 * COUNT(*) as the previous implementation did.
 *
 * Active time is snapshotted as-is: the solve timer has already stopped at
 * formal completion, so a bonus attempt records the final solve time and
 * cannot inflate it.
 */
export async function recordRainbowAttempt(params: {
  sessionId: string;
  guessNumber: number;
  words: string[];
  correct: boolean;
  guessedAt: string;
  activeTimeSeconds: number;
  groupsSolved: number;
}): Promise<void> {
  try {
    const { error } = await supabase.from("guess_events").upsert(
      {
        game_session_id: params.sessionId,
        guess_number: params.guessNumber,
        words: params.words,
        correct: params.correct,
        group_name: null,
        is_rainbow_attempt: true,
        guessed_at: params.guessedAt,
        active_time_seconds: params.activeTimeSeconds,
        groups_solved: params.groupsSolved,
      },
      { onConflict: "game_session_id,guess_number", ignoreDuplicates: true }
    );
    if (error) console.error("Failed to record rainbow attempt:", error);
  } catch (err) {
    console.error("recordRainbowAttempt error:", err);
  }
}

/**
 * Does a COMPLETED, OFFICIAL result already exist for this puzzle + identity?
 *
 * This replaces the old hasExistingSession(), and the distinction is the most
 * important correctness point of the durable-session work. "A session row
 * exists" and "this puzzle has been officially completed" used to be the same
 * fact; they are not any more. Conflating them would mean a player's own
 * unfinished session locked them out of finishing that puzzle and
 * permanently blocked their real result from being saved.
 *
 * Used for two things: locking a board that has already been officially
 * finished, and enforcing the rule that the FIRST completed official attempt
 * is the permanent one.
 */
export async function hasOfficialResult(puzzleId: string): Promise<boolean> {
  try {
    const { userId, deviceId } = await getIdentity();

    const build = (withLifecycle: boolean) => {
      let q = supabase.from("game_sessions").select("id").eq("puzzle_id", puzzleId);
      if (withLifecycle) {
        q = q
          .in("status", COMPLETED_STATUSES as unknown as string[])
          .eq("is_official", true);
      }
      return userId
        ? q.or(`user_id.eq.${userId},device_id.eq.${deviceId}`)
        : q.eq("device_id", deviceId);
    };

    const { data, error } = await build(true).limit(1).maybeSingle();

    // Deploy-order insurance. This code REQUIRES the durable-session
    // migration, but if it ever runs against a database that has not had it
    // applied, the lifecycle columns are missing and this query fails with
    // 42703. Silently returning false there would be the dangerous direction:
    // every completion would look like a first attempt, so replays would
    // duplicate Played and re-run the streak. Falling back to the
    // pre-migration semantics — where any row DID mean an official completed
    // result — preserves the old, correct behavior instead.
    if (isMissingSchemaError(error)) {
      const legacy = await build(false).limit(1).maybeSingle();
      return !!legacy.data;
    }

    return !!data;
  } catch {
    // Network failure. Returning false preserves the existing behavior: a
    // real result is still saved rather than dropped because a check could
    // not be reached.
    return false;
  }
}

export interface FinalizeGameSessionParams {
  puzzleId: string;
  /**
   * The durable session this game has been writing to, or null when there is
   * none — a legacy local progress blob from before durable sessions, or a
   * session whose creation failed. A null id is handled by inserting a
   * completed row directly, which is exactly the pre-durable-session
   * behavior.
   */
  sessionId: string | null;
  entryContext: EntryContext;
  /**
   * Whether this session owns the permanent official result. False for a
   * replay that completed after an official result already existed: its own
   * row is still finalized truthfully (it really did finish), but it must not
   * create a second Played, must not re-run the streak, and must not
   * increment puzzle aggregates.
   */
  isOfficial: boolean;
  won: boolean;
  mistakes: number;
  activeTimeSeconds: number;
  foundRainbow: boolean;
  /**
   * How many categories were already solved when the Rainbow was found (0-4),
   * or null if it wasn't found this game — see the doc comment on
   * game_sessions.rainbow_solve_index in the migration file. Never
   * recalculated here; passed straight through from useGame.ts's
   * authoritative GameState.rainbowSolveIndex.
   */
  rainbowSolveIndex: number | null;
  solveOrder: string[];
  guessHistory: GuessEventInput[];
  skipStreak?: boolean;
  hintsUsed?: boolean;
  shareGrid?: string;
}

/**
 * Formal win/loss: finalize the game.
 *
 * UPDATEs the session that has been accumulating events all along, rather
 * than inserting a second row at the end. The session summary fields
 * (won / mistakes / active_time_seconds / found_rainbow / solve_order /
 * completed_at / hints_used / share_grid / rainbow_solve_index) carry exactly
 * what they did before, joined by the new lifecycle fields.
 *
 * Streak and puzzle-aggregate side effects still happen exactly once, at
 * official completion only — never at session start, and never for a replay.
 */
export async function finalizeGameSession(params: FinalizeGameSessionParams): Promise<void> {
  const {
    puzzleId,
    entryContext,
    isOfficial,
    won,
    mistakes,
    activeTimeSeconds,
    foundRainbow,
    rainbowSolveIndex,
    solveOrder,
    guessHistory,
    skipStreak = false,
    hintsUsed = false,
    shareGrid = "",
  } = params;

  try {
    const { userId, deviceId } = await getIdentity();
    const completedAt = new Date().toISOString();

    const summary = {
      status: won ? "won" : "lost",
      is_official: isOfficial,
      won,
      mistakes,
      active_time_seconds: activeTimeSeconds,
      found_rainbow: foundRainbow,
      rainbow_solve_index: rainbowSolveIndex,
      solve_order: solveOrder,
      hints_used: hintsUsed,
      share_grid: shareGrid,
      completed_at: completedAt,
      last_activity_at: completedAt,
    };

    let sessionId = params.sessionId;

    if (sessionId) {
      const { error } = await supabase
        .from("game_sessions")
        .update(summary)
        .eq("id", sessionId)
        // Only an unfinished session may be finalized. This is what enforces
        // "the first completed official attempt is permanent" at the row
        // level: a session that already completed can never be rewritten by a
        // later pass — not with a better result, a worse one, fewer mistakes,
        // a no-hint result, or a Rainbow.
        .eq("status", "in_progress");
      if (error) {
        console.error("Failed to finalize game session:", error);
        return;
      }
    } else {
      // No durable session: a legacy in-flight game, or one whose session
      // creation failed. Insert the completed row directly — the
      // pre-durable-session behavior, unchanged. started_at is explicitly
      // null because this game's real start time was never captured, and a
      // fabricated one would be worse than an admitted gap.
      const { data, error } = await supabase
        .from("game_sessions")
        .insert({
          puzzle_id: puzzleId,
          user_id: userId,
          device_id: deviceId,
          entry_context: entryContext,
          started_at: null,
          ...summary,
        })
        .select("id")
        .single();
      if (error || !data) {
        console.error("Failed to save game session:", error);
        return;
      }
      sessionId = data.id;
    }

    // Idempotent: guesses already written live are left untouched, and only
    // the ones this session never managed to write (a legacy local history,
    // or a live write that failed) get added.
    await backfillGuessEvents(sessionId, guessHistory);

    if (!isOfficial) return;

    // Community aggregates count official completions only. A session merely
    // starting must never increment them, or "total plays" would silently
    // change meaning from "finished" to "opened". If we later want "puzzle
    // started" or an abandonment rate, that comes from sessions/events — not
    // from redefining this counter.
    const firstSolve = solveOrder[0] ?? null;
    const { error: rpcError } = await supabase.rpc("increment_puzzle_aggregate", {
      _puzzle_id: puzzleId,
      _won: won,
      _mistakes: mistakes,
      _time_seconds: activeTimeSeconds,
      _first_solve: firstSolve,
    });
    if (rpcError) console.error("Failed to update puzzle aggregates:", rpcError);

    if (!skipStreak) {
      await updateStreak(userId, deviceId, won);
    }
  } catch (err) {
    console.error("finalizeGameSession error:", err);
  }
}

export async function loadStatsFromSupabase(): Promise<GameStats> {
  const empty: GameStats = {
    gamesPlayed: 0,
    gamesWon: 0,
    currentStreak: 0,
    maxStreak: 0,
    lastPlayedDate: null,
    guessDistribution: [0, 0, 0, 0, 0],
    rainbowSpotRate: null,
    rainbowSpottedCount: 0,
    hardestFirstCount: 0,
    perfectGamesCount: 0,
    noHintsUsedCount: 0,
    inOrderCount: 0,
    reverseRainbowCount: 0,
    averageMistakes: 0,
  };

  try {
    const deviceId = getDeviceId();
    const { data: { user } } = await supabase.auth.getUser();
    const userId = user?.id ?? null;

    const streakQuery = userId
      ? supabase.from("user_streaks").select("current_streak, longest_streak, last_played_date, user_id").or(`user_id.eq.${userId},device_id.eq.${deviceId}`)
      : supabase.from("user_streaks").select("current_streak, longest_streak, last_played_date, user_id").eq("device_id", deviceId);
    const { data: streakRows } = await streakQuery;
    // Prefer the row tied to the logged-in user; tiebreak on longest streak
    const streak = (streakRows ?? []).slice().sort((a, b) => {
      if (a.user_id && !b.user_id) return -1;
      if (!a.user_id && b.user_id) return 1;
      return (b.longest_streak ?? 0) - (a.longest_streak ?? 0);
    })[0] ?? null;

    // EVERY player-facing stat below is derived from `rows`, so this single
    // filter is what keeps all of them — Played, Win %, Mistake Distribution,
    // Rainbows Spotted, Hardest Category First, Perfect Games, No Hints Used,
    // In Order, Reverse Rainbow, Average Mistakes — describing COMPLETED
    // OFFICIAL games only.
    //
    //   status in (won, lost) excludes sessions still in progress, which is
    //     newly necessary: a row existing no longer means a game was played.
    //   is_official excludes a replay that completed after the permanent
    //     result already existed, so a later replay can never add a Played,
    //     change Win %, or contribute a better or worse outcome.
    //
    // (Current Streak / Max Streak come from user_streaks above, which is
    // only ever written at official completion — see finalizeGameSession.)
    const SESSION_FIELDS = "puzzle_id, won, mistakes, found_rainbow, solve_order, hints_used, rainbow_solve_index";
    const baseSessions = supabase
      .from("game_sessions")
      .select(SESSION_FIELDS)
      .in("status", COMPLETED_STATUSES as unknown as string[])
      .eq("is_official", true);
    const sessionsQuery = userId
      ? baseSessions.or(`user_id.eq.${userId},device_id.eq.${deviceId}`)
      : baseSessions.eq("device_id", deviceId);
    const { data: sessions } = await sessionsQuery;

    const rows = sessions ?? [];

    // Separate query: which of these puzzles actually had a rainbow herring?
    const puzzleIds = Array.from(new Set(rows.map((r) => r.puzzle_id).filter(Boolean)));
    const rainbowPuzzleIds = new Set<string>();
    if (puzzleIds.length > 0) {
      const { data: puzzleRows } = await supabase
        .from("puzzles")
        .select("id, rainbow_herring")
        .in("id", puzzleIds);
      for (const p of puzzleRows ?? []) {
        const herring = (p as any).rainbow_herring;
        if (Array.isArray(herring) && herring.length === 4) {
          rainbowPuzzleIds.add(p.id);
        }
      }
    }

    // Ascending/descending-difficulty solve order ("Yellow -> Green -> Blue
    // -> Red" and its reverse, in player-facing terms). getSolveOrder()
    // (useGame.ts) names difficulty-1 "orange" internally — an existing
    // naming quirk, not something this file invents — so these are the
    // literal arrays it writes when the 4 categories are solved in order.
    const ASCENDING_ORDER = ["orange", "green", "blue", "red"];
    const DESCENDING_ORDER = ["red", "blue", "green", "orange"];

    const arraysEqual = (a: unknown, b: string[]): boolean =>
      Array.isArray(a) && a.length === b.length && a.every((v, i) => v === b[i]);

    const guessDistribution: number[] = [0, 0, 0, 0, 0];
    let gamesWon = 0;
    let rainbowEligible = 0;
    let rainbowFound = 0;
    let hardestFirstCount = 0;
    let perfectGamesCount = 0;
    let noHintsUsedCount = 0;
    let inOrderCount = 0;
    let reverseRainbowCount = 0;
    let totalMistakes = 0;
    // Denominator for Average Mistakes — counts only rows that actually
    // contributed to totalMistakes below, NOT rows.length. A row with a
    // null/undefined/non-integer/out-of-range mistakes value means
    // "unknown," not "zero mistakes," so it must be excluded from both the
    // numerator and this denominator rather than silently averaged in as a
    // 0 (the previous `?? 0` behavior did exactly that, understating the
    // average). This has no effect on Played — gamesPlayed below still
    // counts every row in `rows` regardless of its mistakes value.
    let mistakesKnownCount = 0;
    for (const r of rows) {
      if (Number.isInteger(r.mistakes) && (r.mistakes as number) >= 0 && (r.mistakes as number) <= 4) {
        totalMistakes += r.mistakes as number;
        mistakesKnownCount++;
      }
      const isRainbowEligible = !!r.puzzle_id && rainbowPuzzleIds.has(r.puzzle_id);

      // Mistake Distribution: every completed official session (win OR
      // formal loss), bucketed by its own mistake count. A formal loss
      // always has mistakes === 4 (the game ends the instant the 4th
      // mistake is made — see MAX_MISTAKES in useGame.ts), so this is what
      // actually lets bucket 4 populate. Previously this increment lived
      // inside the `if (r.won)` block below, which made bucket 4
      // structurally impossible: a win can never reach 4 mistakes (that's a
      // loss), so every loss — the only rows that ever have mistakes === 4
      // — was silently excluded from the distribution entirely.
      //
      // Unfinished sessions cannot reach here at all: the query above
      // filters them out, so an abandoned game with 2 mistakes so far never
      // pollutes bucket 2.
      //
      // A row with a null/undefined/non-integer/out-of-range mistakes value
      // is deliberately EXCLUDED from the distribution rather than folded
      // into bucket 0 — unknown is not the same fact as zero, and treating
      // it as zero would misrepresent a genuine "no mistakes" game. This
      // row is still counted everywhere else (Played, totalMistakes for
      // Average Mistakes, etc. below) exactly as before; only this one
      // bucketing decision excludes it.
      if (Number.isInteger(r.mistakes) && (r.mistakes as number) >= 0 && (r.mistakes as number) <= 4) {
        guessDistribution[r.mistakes as number]++;
      }

      if (r.won) {
        gamesWon++;
        if ((r.mistakes ?? 0) === 0) perfectGamesCount++;
        if (r.hints_used === false) noHintsUsedCount++;

        // "In Order" / "Reverse Rainbow" — see the doc comments on
        // GameStats.inOrderCount/reverseRainbowCount in types.ts.
        // rainbow_solve_index is only ever 0 or 4 here to count as "at one
        // end"; null (unknown/historical) or 1-3 (found in the middle)
        // never qualify — never guessed at, never treated as a known miss.
        const rsi = (r as { rainbow_solve_index?: number | null }).rainbow_solve_index ?? null;
        const rainbowAtEnd = rsi === 0 || rsi === 4;
        if (isRainbowEligible) {
          if (arraysEqual(r.solve_order, ASCENDING_ORDER) && rainbowAtEnd) inOrderCount++;
          if (arraysEqual(r.solve_order, DESCENDING_ORDER) && rainbowAtEnd) reverseRainbowCount++;
        } else if (arraysEqual(r.solve_order, ASCENDING_ORDER)) {
          inOrderCount++;
        }
      }
      if (isRainbowEligible) {
        rainbowEligible++;
        if (r.found_rainbow) rainbowFound++;
      }
      if (Array.isArray(r.solve_order) && r.solve_order[0] === "red") hardestFirstCount++;
    }

    return {
      gamesPlayed: rows.length,
      gamesWon,
      currentStreak: streak?.current_streak ?? 0,
      maxStreak: streak?.longest_streak ?? 0,
      lastPlayedDate: streak?.last_played_date ?? null,
      guessDistribution,
      rainbowSpotRate: rainbowEligible > 0 ? Math.round((rainbowFound / rainbowEligible) * 100) : null,
      rainbowSpottedCount: rainbowFound,
      hardestFirstCount,
      perfectGamesCount,
      noHintsUsedCount,
      inOrderCount,
      reverseRainbowCount,
      averageMistakes: mistakesKnownCount > 0 ? totalMistakes / mistakesKnownCount : 0,
    };
  } catch (err) {
    console.error("loadStatsFromSupabase error:", err);
    return empty;
  }
}

async function updateStreak(userId: string | null, deviceId: string, won: boolean): Promise<void> {
  try {
    const today = new Date().toLocaleDateString("en-CA");
    let existing: any = null;
    if (userId) {
      const r1 = await supabase.from("user_streaks").select("*").eq("user_id", userId).maybeSingle();
      existing = r1.data;
      if (!existing) {
        const r2 = await supabase.from("user_streaks").select("*").eq("device_id", deviceId).maybeSingle();
        existing = r2.data;
        // Claim orphaned anonymous row for this user
        if (existing && !existing.user_id) {
          await supabase.from("user_streaks").update({ user_id: userId }).eq("id", existing.id);
          existing.user_id = userId;
        }
      }
    } else {
      const r = await supabase.from("user_streaks").select("*").eq("device_id", deviceId).maybeSingle();
      existing = r.data;
    }

    if (!existing) {
      await supabase.from("user_streaks").insert({
        user_id: userId,
        device_id: deviceId,
        current_streak: 1,
        longest_streak: 1,
        last_played_date: today,
      });
      return;
    }

    const lastPlayed = existing.last_played_date;
    const yesterday = new Date();
    yesterday.setDate(yesterday.getDate() - 1);
    const yesterdayStr = yesterday.toLocaleDateString("en-CA");

    if (lastPlayed === today) return;
    const newStreak = won
      ? (lastPlayed === yesterdayStr ? existing.current_streak + 1 : 1)
      : 0;

    const newLongest = Math.max(newStreak, existing.longest_streak);

    await supabase.from("user_streaks").update({
      current_streak: newStreak,
      longest_streak: newLongest,
      last_played_date: today,
      updated_at: new Date().toISOString(),
    }).eq("id", existing.id);

  } catch (err) {
    console.error("updateStreak error:", err);
  }
}
