import { supabase } from "@/integrations/supabase/client";
import { GameStats } from "./types";
import type { EntryContext } from "./entryContext";
import {
  FULL_FORMAT,
  SOLVE_ORDER_NAME,
  ascendingSolveOrder,
  descendingSolveOrder,
  type PuzzleFormat,
} from "./puzzleFormat";
import {
  backfillGuessEvents,
  createGameSession,
  getIdentity,
  isMissingSchemaError,
  type GuessEventInput,
} from "./gameSession";

// Gets or creates a stable device ID for anonymous players
const DEVICE_ID_KEY = "rc-device-id";
const DEVICE_TOKEN_KEY = "rc-device-token";

/**
 * How many times to retry a finalize that failed with an ERROR.
 *
 * Safe only because finalize_game_session is atomic and guarded by the
 * in_progress -> won/lost transition: a failed attempt changed nothing, and a
 * successful one cannot be repeated.
 */
const FINALIZE_ATTEMPTS = 3;

/**
 * The guest identity for this browser: a public id plus a PRIVATE token.
 *
 * Splitting these is the whole point. The id is written onto every gameplay
 * row for provenance and travels in plain sight; the token is what actually
 * proves the caller is this device, and it is minted server-side, returned
 * exactly once, and stored only here. It must never be logged, rendered,
 * put in a URL, or sent anywhere except an RPC body.
 *
 * Both live in localStorage only. Clearing site data loses the identity for
 * good — creating an account is how a player makes their history durable.
 */
export interface DeviceIdentity {
  deviceId: string;
  deviceToken: string;
}

/**
 * The stored id, or "unknown" when localStorage is unavailable (private
 * browsing, blocked storage). "unknown" is never a usable identity: it is the
 * one value every storage-blocked browser shares, so the database refuses it
 * everywhere.
 */
export function getDeviceId(): string {
  try {
    return localStorage.getItem(DEVICE_ID_KEY) ?? "unknown";
  } catch {
    return "unknown";
  }
}

export function getDeviceToken(): string | null {
  try {
    return localStorage.getItem(DEVICE_TOKEN_KEY);
  } catch {
    return null;
  }
}

/** The pair, or null when this browser has no usable identity yet. */
export function getDeviceIdentity(): DeviceIdentity | null {
  const deviceId = getDeviceId();
  const deviceToken = getDeviceToken();
  if (!deviceToken || deviceId === "unknown") return null;
  return { deviceId, deviceToken };
}

/**
 * Mint a brand-new identity, discarding whatever was stored before.
 *
 * Used on sign-out (so post-logout play is a genuinely separate guest, not a
 * continuation of the account holder's browser) and to replace a pre-cutover
 * id that has no token and can never be verified again.
 */
export async function createDeviceIdentity(): Promise<DeviceIdentity | null> {
  const { data, error } = await supabase.rpc("create_device_identity");
  if (error) throw error;
  const row = Array.isArray(data) ? data[0] : data;
  const deviceId = (row as { device_id?: string } | null)?.device_id;
  const deviceToken = (row as { device_token?: string } | null)?.device_token;
  if (!deviceId || !deviceToken) return null;
  try {
    localStorage.setItem(DEVICE_ID_KEY, deviceId);
    localStorage.setItem(DEVICE_TOKEN_KEY, deviceToken);
  } catch {
    // Storage blocked: this identity cannot survive the page, and without a
    // token nothing will accept it. The player stays effectively "unknown",
    // exactly as they did before.
    return null;
  }
  return { deviceId, deviceToken };
}

/**
 * The identity for this browser, creating one if needed.
 *
 * A stored id with no token is a pre-cutover ("legacy") browser: that id was
 * retired by the migration and can never be verified, so it is replaced
 * rather than retried. The old gameplay rows it refers to are left exactly
 * where they are — never claimed, never deleted, still counted in site-wide
 * analytics.
 */
export async function ensureDeviceIdentity(): Promise<DeviceIdentity | null> {
  const existing = getDeviceIdentity();
  if (existing) return existing;
  return createDeviceIdentity();
}

/** Discard this browser's identity so the next play starts a new guest. */
export function resetDeviceIdentity(): void {
  try {
    localStorage.removeItem(DEVICE_ID_KEY);
    localStorage.removeItem(DEVICE_TOKEN_KEY);
  } catch {
    // nothing stored, nothing to clear
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
 * One row as returned by the get_own_completed_sessions RPC: the caller's own
 * completed official sessions, already filtered server-side for both
 * completion and ownership.
 */
export interface OwnCompletedSession {
  puzzle_id: string;
  won: boolean | null;
  mistakes: number | null;
  found_rainbow: boolean | null;
  solve_order: unknown;
  hints_used: boolean | null;
  rainbow_solve_index: number | null;
  rainbow_source: string | null;
  bonus_rainbow_attempted: boolean | null;
  status: string;
}

/**
 * Records ONE explicit post-completion "Spot the Rainbow" submission —
 * success or failure alike.
 *
 * This is the single write path for the bonus flow, and the only place in the
 * codebase that produces `attempt_type = 'bonus_rainbow'`. That matters: it
 * is what makes "did the player explicitly try Spot the Rainbow?" answerable
 * from intent rather than from the is_rainbow_attempt SHAPE heuristic, which
 * an ordinary in-game guess can satisfy by accident.
 *
 * Writes two things, both idempotent:
 *
 *   1. the guess event, carrying attempt_type = 'bonus_rainbow'. guessNumber
 *      comes from the caller's own guess history, so it shares the
 *      (game_session_id, guess_number) key with every other guess rather than
 *      deriving a number from a non-atomic COUNT(*) as the previous
 *      implementation did;
 *   2. the session summary — bonus_rainbow_attempted always, plus the
 *      found_rainbow / rainbow_source / rainbow_solve_index trio when the
 *      attempt was correct.
 *
 * PRODUCT RULE (firm): this counts after a formal LOSS as much as after a
 * win. The post-game prompt is shown on both outcomes on purpose — failing
 * the main puzzle does not forfeit the Rainbow — so nothing here is gated on
 * the session having been won.
 *
 * Targets the session BY ID rather than re-deriving it from
 * puzzle_id + identity as the previous implementation did. That lookup can
 * now match the wrong row, because a puzzle+identity may legitimately have
 * more than one session (a completed official one plus a later in-progress
 * replay); an id cannot be ambiguous.
 *
 * Active time is snapshotted as-is: the solve timer has already stopped at
 * formal completion, so a bonus attempt records the final solve time and
 * cannot inflate it.
 */
export async function recordBonusRainbowAttempt(params: {
  sessionId: string;
  guessNumber: number;
  words: string[];
  correct: boolean;
  guessedAt: string;
  activeTimeSeconds: number;
  groupsSolved: number;
}): Promise<void> {
  try {
    const { deviceId, deviceToken } = await getIdentity();
    // One function call does both writes: the bonus guess event and the
    // session summary. It is the ONLY producer of
    // attempt_type = 'bonus_rainbow' in the system, and record_guess_events
    // forces 'normal' for everything else, so that value is a trustworthy
    // record of explicit intent rather than something a client can assert.
    //
    // The function also enforces what the client used to be trusted with:
    // the session must be COMPLETED (the prompt only exists after the board
    // finishes), and a Rainbow already found in normal play cannot have its
    // rainbow_source rewritten to post_game.
    const { error } = await supabase.rpc("record_bonus_rainbow", {
      _session_id: params.sessionId,
      _device_id: deviceId,
      _device_token: deviceToken,
      _guess_number: params.guessNumber,
      _words: params.words,
      _correct: params.correct,
      _guessed_at: params.guessedAt,
      _active_time_seconds: params.activeTimeSeconds,
      _groups_solved: params.groupsSolved,
    });
    if (error) console.error("Failed to record bonus Rainbow attempt:", error);
  } catch (err) {
    console.error("recordBonusRainbowAttempt error:", err);
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
    const { deviceId, deviceToken } = await getIdentity();

    // Answered by an RPC rather than a table read. game_sessions is no longer
    // directly readable by anonymous clients (see section 6 of the
    // migration), and this function returns a bare boolean — it cannot be
    // used to page through the table or to discover a device_id the caller
    // does not already hold. The signed-in half of ownership is resolved
    // inside the function from auth.uid(), so it is not something the client
    // can assert.
    const { data, error } = await supabase.rpc("has_official_result", {
      _puzzle_id: puzzleId,
      _device_id: deviceId,
      _device_token: deviceToken,
    });

    // Deploy-order insurance. This code REQUIRES the durable-session
    // migration; if it ever runs against a database that has not had it
    // applied, the function does not exist. Silently returning false there
    // would be the dangerous direction: every completion would look like a
    // first attempt, so replays would duplicate Played and re-run the streak.
    // Falling back to the pre-migration semantics — where any session row DID
    // mean an official completed result — preserves the old, correct
    // behavior instead.
    if (isMissingSchemaError(error)) {
      const { data: { user } } = await supabase.auth.getUser();
      const userId = user?.id ?? null;
      const legacy = userId
        ? await supabase.from("game_sessions").select("id").eq("puzzle_id", puzzleId)
            .or(`user_id.eq.${userId},device_id.eq.${deviceId}`).limit(1).maybeSingle()
        : await supabase.from("game_sessions").select("id").eq("puzzle_id", puzzleId)
            .eq("device_id", deviceId).limit(1).maybeSingle();
      return !!legacy.data;
    }

    if (error) {
      console.error("hasOfficialResult failed:", error);
      return false;
    }

    return data === true;
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
  /**
   * The puzzle version this game was played against, used only by the rare
   * fallback below that has to create the session at completion time. When a
   * session already exists it was pinned at creation and is never re-stamped
   * — an edit that lands mid-game must not move a session onto a version its
   * player never saw.
   */
  puzzleVersionId?: string | null;
  entryContext: EntryContext;
  // NOTE: there is deliberately no `isOfficial` parameter. Whether a session
  // owns the permanent official result is decided by finalize_game_session
  // from the session's OWN stored identity, and returned to the caller. A
  // replay that completes after an official result already exists is still
  // finalized truthfully (it really did finish) but comes back
  // is_official = false, so it adds no Played, re-runs no streak, and
  // increments no aggregate.
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
 * Completes the session that has been accumulating events all along, rather
 * than inserting a second row at the end. The summary fields
 * (won / mistakes / active_time_seconds / found_rainbow / solve_order /
 * completed_at / hints_used / share_grid / rainbow_solve_index /
 * rainbow_source) carry exactly what they did before.
 *
 * Returns whether THIS completion became the official one — decided by the
 * database, not asserted by the client. That matters twice over: "the first
 * completed official attempt is permanent" is a product rule, and a rule
 * enforced by whatever the client happens to send is not enforced at all; and
 * computing it inside the same statement closes the read-then-write race that
 * an application-level check cannot.
 *
 * Streak and puzzle-aggregate side effects still happen exactly once, at
 * official completion only — never at session start, and never for a replay.
 */
export async function finalizeGameSession(
  params: FinalizeGameSessionParams
): Promise<boolean> {
  const {
    puzzleId,
    entryContext,
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
    const { deviceId, deviceToken } = await getIdentity();
    if (!deviceToken) {
      console.error("No verified device identity; cannot finalize");
      return false;
    }

    // A session to finalize. Normally the one this game has been writing to;
    // otherwise (a legacy local progress blob, or a creation that failed) one
    // is created now and completed immediately. Two writes on that rare
    // fallback buys a single completion code path — and is now the only way it
    // can work at all, since a direct insert cannot return its own id to an
    // anonymous client.
    const sessionId =
      params.sessionId ??
      (await createGameSession({
        puzzleId,
        // The version this completed game was actually played against, which
        // the caller carries because it is the board it rendered. It is not
        // re-read as "current" here: a puzzle edited during this player's
        // game would otherwise stamp their finished session with a version
        // they never saw.
        puzzleVersionId: params.puzzleVersionId ?? null,
        entryContext,
        snapshot: { activeTimeSeconds, groupsSolved: solveOrder.length, mistakes },
      }));

    if (!sessionId) {
      console.error("Failed to obtain a session to finalize");
      return false;
    }

    // One trusted transaction. The aggregate increment, the game_results row
    // and the streak update all happen inside this call now, behind the same
    // one-shot in_progress -> won/lost transition. If any of them fails, the
    // completion itself rolls back and the session stays in_progress, so the
    // player's finished game and their statistics can never disagree.
    //
    // That is what makes retrying safe, and worth doing: a rolled-back
    // attempt left the session retryable, and an attempt that did commit
    // makes every later one a no-op. Exactly one play gets counted — never
    // none because a write failed, never two because we tried again.
    //
    // Only a transport/database ERROR is retried. A null or false RESULT is
    // a definite answer from the server (already finished, or not official),
    // and repeating the call would not change it.
    //
    // _local_date carries the PLAYER'S calendar date, because streaks have
    // always been measured in local time and computing them from the server's
    // clock would move every boundary to UTC.
    const finalizeArgs = {
      _session_id: sessionId,
      _device_id: deviceId,
      _device_token: deviceToken,
      _won: won,
      _mistakes: mistakes,
      _active_time_seconds: activeTimeSeconds,
      _found_rainbow: foundRainbow,
      _rainbow_solve_index: rainbowSolveIndex,
      _solve_order: solveOrder,
      _hints_used: hintsUsed,
      _share_grid: shareGrid,
      _skip_streak: skipStreak,
      _local_date: new Date().toLocaleDateString("en-CA"),
    };

    let isOfficial: boolean | null = null;
    let lastError: unknown = null;
    for (let attempt = 0; attempt < FINALIZE_ATTEMPTS; attempt++) {
      const { data, error } = await supabase.rpc("finalize_game_session", finalizeArgs);
      if (!error) {
        isOfficial = data as boolean | null;
        lastError = null;
        break;
      }
      lastError = error;
      if (attempt < FINALIZE_ATTEMPTS - 1) {
        await new Promise((resolve) => setTimeout(resolve, 150 * 2 ** attempt));
      }
    }

    if (lastError) {
      // The session is still in_progress, and the completed game is still in
      // the local progress blob, so a later mount can finalize it again.
      console.error("Failed to finalize game session:", lastError);
      return false;
    }

    // Idempotent: guesses already written live are left untouched, and only
    // the ones this session never managed to write (a legacy local history, or
    // a live write that failed) get added.
    await backfillGuessEvents(sessionId, guessHistory);

    // null means the session was already finished, or the capability check
    // failed; false means this playthrough completed but was not the official
    // result. Either way it owns no side effects — and the server has already
    // decided that, so there is nothing left for the client to run.
    return isOfficial === true;
  } catch (err) {
    console.error("finalizeGameSession error:", err);
    return false;
  }
}

/**
 * A player's personal statistics FOR ONE FORMAT.
 *
 * Full and Mini are sibling games with sibling records: playing one must never
 * add a Played to the other, extend or break the other's streak, or land in
 * the other's mistake distribution. That isolation is enforced server-side —
 * `game_sessions.format` and `user_streaks.format` (see the Mini migration) —
 * and this function simply asks for one format's rows.
 *
 * `format` defaults to Full, so every existing caller keeps its exact current
 * meaning, and a Full request sends exactly the request it always has (see
 * formatRpcArgs: `_format` is only added for a non-Full format).
 */
export async function loadStatsFromSupabase(format: PuzzleFormat = FULL_FORMAT): Promise<GameStats> {
  // One bucket per possible mistake count, 0..maxMistakes inclusive.
  const emptyDistribution = () => Array<number>(format.maxMistakes + 1).fill(0);

  const empty: GameStats = {
    gamesPlayed: 0,
    gamesWon: 0,
    currentStreak: 0,
    maxStreak: 0,
    lastPlayedDate: null,
    guessDistribution: emptyDistribution(),
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

    // Through an RPC, not a table query: user_streaks has no policies or
    // grants for ordinary clients any more. The function answers for the
    // account when there is one and for the proven device otherwise, and it
    // does the "prefer the account's own row" selection server-side.
    const { data: streakRows, error: streakError } = await supabase.rpc("get_own_streak", {
      _device_id: deviceId,
      _device_token: getDeviceToken(),
      _format: format.statsNamespace,
    });
    if (streakError) {
      console.error("get_own_streak failed:", streakError);
    }
    const streak = (Array.isArray(streakRows) ? streakRows[0] : streakRows) ?? null;

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
    // Fetched through the get_own_completed_sessions RPC rather than a table
    // query. game_sessions is no longer directly readable by anonymous
    // clients (migration section 6), and the function applies BOTH the
    // completed-official filter and the ownership predicate server-side, so
    // there is no query shape a caller could vary to widen the result set.
    const { data: sessions } = await supabase.rpc("get_own_completed_sessions", {
      _device_id: deviceId,
      _device_token: getDeviceToken(),
      _format: format.statsNamespace,
    });

    const rows = (sessions ?? []) as unknown as OwnCompletedSession[];

    // Separate query: which of these puzzles actually had a rainbow herring?
    // Skipped entirely for a format with no bonus category — there is nothing
    // to be eligible for, so Rainbows Spotted stays null rather than 0%.
    const puzzleIds = format.hasRainbow
      ? Array.from(new Set(rows.map((r) => r.puzzle_id).filter(Boolean)))
      : [];
    const rainbowPuzzleIds = new Set<string>();
    if (puzzleIds.length > 0) {
      const { data: puzzleRows } = await supabase
        .from("puzzles")
        .select("id, rainbow_herring")
        .in("id", puzzleIds);
      for (const p of puzzleRows ?? []) {
        const herring = (p as any).rainbow_herring;
        if (Array.isArray(herring) && herring.length === format.categoryCount) {
          rainbowPuzzleIds.add(p.id);
        }
      }
    }

    // Ascending/descending-difficulty solve order ("Yellow -> Green -> Blue
    // -> Red" and its reverse, in player-facing terms; Mini's is
    // "Green -> Blue -> Red"). getSolveOrder() (useGame.ts) names
    // difficulty-1 "orange" internally — an existing naming quirk preserved
    // in SOLVE_ORDER_NAME, not something this file invents — so these are the
    // literal arrays it writes when a format's categories are solved in order.
    const ASCENDING_ORDER = ascendingSolveOrder(format);
    const DESCENDING_ORDER = descendingSolveOrder(format);
    // The name the HARDEST category writes — "red" for both formats today,
    // read from the format rather than assumed.
    const HARDEST_NAME = SOLVE_ORDER_NAME[format.difficultyOrder[format.difficultyOrder.length - 1]];

    const arraysEqual = (a: unknown, b: string[]): boolean =>
      Array.isArray(a) && a.length === b.length && a.every((v, i) => v === b[i]);

    const guessDistribution: number[] = emptyDistribution();
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
      if (Number.isInteger(r.mistakes) && (r.mistakes as number) >= 0 && (r.mistakes as number) <= format.maxMistakes) {
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
      if (Number.isInteger(r.mistakes) && (r.mistakes as number) >= 0 && (r.mistakes as number) <= format.maxMistakes) {
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
        const rainbowAtEnd = rsi === 0 || rsi === format.categoryCount;
        if (isRainbowEligible) {
          if (arraysEqual(r.solve_order, ASCENDING_ORDER) && rainbowAtEnd) inOrderCount++;
          if (arraysEqual(r.solve_order, DESCENDING_ORDER) && rainbowAtEnd) reverseRainbowCount++;
        } else if (arraysEqual(r.solve_order, ASCENDING_ORDER)) {
          inOrderCount++;
        }
      }
      // Rainbows Spotted counts ANY completed official session with
      // found_rainbow = true. Deliberately OUTSIDE the `if (r.won)` block
      // above, and deliberately indifferent to rainbow_source: a Rainbow
      // found in normal play, one found through the post-game "Spot the
      // Rainbow" prompt after a win, and one found through that same prompt
      // after a FORMAL LOSS all count equally.
      //
      // The post-loss case is a firm product rule, not an oversight: the
      // bonus prompt is shown after a loss on purpose (see showEndState in
      // GameBoard.tsx) so that failing the main puzzle does not forfeit the
      // Rainbow. Do not add a win requirement here.
      if (isRainbowEligible) {
        rainbowEligible++;
        if (r.found_rainbow) rainbowFound++;
      }
      if (Array.isArray(r.solve_order) && r.solve_order[0] === HARDEST_NAME) hardestFirstCount++;
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
