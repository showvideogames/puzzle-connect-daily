/**
 * Durable session + live gameplay events — the network layer.
 *
 * Conceptual model:
 *
 *   PLAYER/IDENTITY -> GAME SESSION -+-> GUESS EVENTS
 *                                    +-> HINT EVENTS
 *
 * Before this existed, the database only learned a game had happened when it
 * reached formal completion. A player who played for eight minutes, used both
 * hints and solved three groups before giving up left no durable trace, which
 * made abandonment, frustration and hint timing entirely invisible.
 *
 * Deliberately NOT a generic event-sourcing framework. Three specific writes
 * (create session, record guess, record hint) plus a finalize, each with a
 * real idempotency key, and nothing else.
 *
 * Every function here is best-effort: a failed telemetry write logs and
 * returns, and never throws into the game loop. Gameplay must not break
 * because a session row could not be written.
 *
 * This module holds no React state and does no localStorage work — the
 * resume/persistence orchestration lives in hooks/useGameSession.ts, and the
 * local progress blob in lib/gameProgress.ts.
 */
import { supabase } from "@/integrations/supabase/client";
import type { EntryContext } from "./entryContext";
import { getDeviceId, getDeviceToken } from "./gameStats";

/** Postgres: insert or update violates a foreign key constraint. */
const FK_VIOLATION = "23503";
/** Postgres: column does not exist (i.e. the schema migration has not run). */
const UNDEFINED_COLUMN = "42703";
/** Postgres: relation does not exist (i.e. hint_events has not been created). */
const UNDEFINED_TABLE = "42P01";

export function isMissingSessionError(error: { code?: string } | null): boolean {
  return error?.code === FK_VIOLATION;
}

export function isMissingSchemaError(error: { code?: string } | null): boolean {
  return error?.code === UNDEFINED_COLUMN || error?.code === UNDEFINED_TABLE;
}

/**
 * The identity model as it exists today: the authenticated user id when there
 * is one, plus the anonymous device id otherwise.
 *
 * Known limitation, accepted and documented rather than solved here: an
 * anonymous player who clears all site data loses their device identity, and
 * the server has no way to recognise them again. A `players` table, a public
 * Player ID and device/account merging are separate, later pieces of work.
 *
 * getDeviceId() returns the literal string "unknown" when localStorage is
 * unavailable (private browsing, some in-app browsers, storage blocked by
 * policy), so every such player shares one device_id. This module does not
 * worsen that — but it is why the partial unique indexes in the migration
 * exclude 'unknown', and it is flagged for the later identity work.
 */
export async function getIdentity(): Promise<{
  userId: string | null;
  deviceId: string;
  deviceToken: string | null;
}> {
  const deviceId = getDeviceId();
  const deviceToken = getDeviceToken();
  try {
    const { data: { user } } = await supabase.auth.getUser();
    return { userId: user?.id ?? null, deviceId, deviceToken };
  } catch {
    return { userId: null, deviceId, deviceToken };
  }
}

/** Game state at the moment a durable event happened. */
export interface EventSnapshot {
  /** Cumulative ACTIVE play seconds (background-tab time already excluded). */
  activeTimeSeconds: number;
  /** Normal categories solved so far (0-4). */
  groupsSolved: number;
  /** Mistakes made so far (0-4). */
  mistakes: number;
}

/**
 * Create the durable session row for a game whose first meaningful action just
 * happened.
 *
 * Called ONLY from the first submitted guess or the first actually-revealed
 * hint. A page view creates nothing: a player who opens a puzzle, looks at it
 * and leaves must leave no gameplay session behind.
 *
 * The row is created as `in_progress` with `completed_at: null` — set
 * explicitly, because the column's database default is now(), and taking that
 * default would immediately mark a just-started game as finished.
 *
 * `is_official` is left to its database default of false. Whether a session
 * owns the permanent official result is only knowable at completion (it
 * depends on whether one already existed then), so it is decided in
 * finalizeGameSession, not here.
 */
export async function createGameSession(params: {
  puzzleId: string;
  /**
   * The puzzle_versions snapshot the player's board was actually built from,
   * or null when nothing is pinned (a database without the versioning
   * migration).
   *
   * Supplied by the client on purpose, and NOT read server-side as
   * "whatever is current now". Consider the race this exists for: the player
   * opens Version 1, an admin publishes Version 2, and only then does the
   * player make their first meaningful action. Their board still shows
   * Version 1 and their next guess will be judged against Version 1, so a
   * Version 1 session is the only truthful thing to create.
   *
   * Supplying it is not being trusted with it: create_game_session verifies
   * the version belongs to THIS puzzle before storing it, so a session can
   * never be attached to another puzzle's snapshot.
   */
  puzzleVersionId: string | null;
  entryContext: EntryContext;
  snapshot: EventSnapshot;
}): Promise<string | null> {
  const { puzzleId, puzzleVersionId, entryContext, snapshot } = params;
  try {
    const { deviceId, deviceToken } = await getIdentity();

    // Goes through the create_game_session RPC rather than a direct insert,
    // for two reasons.
    //
    // Necessity: anonymous clients no longer have SELECT on game_sessions
    // (see section 6 of the migration), and INSERT ... RETURNING is subject
    // to the SELECT policy — so a direct insert would succeed but fail to
    // hand back the id, leaving this session unable to attach any events.
    //
    // Hardening: the function stamps user_id from auth.uid() internally, so
    // the client cannot claim someone else's account.
    //
    // The row it creates is strictly in_progress: won and completed_at are
    // NULL because the outcome is not knowable yet, and this path has no way
    // to complete a game.
    const { data, error } = await supabase.rpc("create_game_session", {
      _puzzle_id: puzzleId,
      _device_id: deviceId,
      _device_token: deviceToken,
      _entry_context: entryContext,
      _active_time_seconds: snapshot.activeTimeSeconds,
      _mistakes: snapshot.mistakes,
      // Added as a DEFAULTed argument on the one existing function rather
      // than as a second overload — PostgREST cannot distinguish same-name
      // same-arity overloads from the wire format, and we have already had
      // one such conflict make an RPC completely uncallable in production.
      _puzzle_version_id: puzzleVersionId,
    });

    if (error || !data) {
      console.error("createGameSession failed:", error);
      return null;
    }
    return data as unknown as string;
  } catch (err) {
    console.error("createGameSession error:", err);
    return null;
  }
}

/**
 * The live session counters, as they stand AFTER the action being recorded.
 *
 * Deliberately a separate type from EventSnapshot, which describes the state a
 * guess was made AGAINST (i.e. before it resolved). Conflating the two is what
 * previously left game_sessions.mistakes trailing the real count by one after
 * every wrong guess.
 */
export interface SessionActivity {
  /** Cumulative ACTIVE play seconds (background-tab time already excluded). */
  activeTimeSeconds: number;
  /**
   * The player's CURRENT real mistake count, including the guess just
   * recorded. 0 on a fresh session, 2 after two wrong guesses, 4 at a formal
   * loss — truthful at every point, not a placeholder that only becomes real
   * at completion. This is what makes an abandoned session say how badly it
   * was going when the player walked away.
   */
  mistakes: number;
}

/**
 * Touch a session's activity heartbeat and live counters.
 *
 * Called only at meaningful moments — session creation, a guess, a hint,
 * completion — never from timer ticks, tile selections, shuffles, hovers or
 * visibility changes. `last_activity_at` is what later lets analysis classify
 * a sufficiently stale `in_progress` session as abandoned, without anyone
 * pretending to know the exact moment a player gave up (which is also why
 * there is deliberately no beforeunload handler anywhere in this module).
 *
 * Carrying active_time_seconds and the live mistake count on the same write
 * means an abandoned session reports both how long it was played and how it
 * was going, for free — no extra round trip.
 */
export async function touchSession(
  sessionId: string,
  activity: SessionActivity
): Promise<void> {
  try {
    const { deviceId, deviceToken } = await getIdentity();
    // Through a function, not an UPDATE: game_sessions has no update policy
    // at all any more. The function verifies this session against the device
    // capability before touching anything, and can only write these three
    // columns on a still-in-progress session.
    const { error } = await supabase.rpc("touch_game_session", {
      _session_id: sessionId,
      _device_id: deviceId,
      _device_token: deviceToken,
      _active_time_seconds: activity.activeTimeSeconds,
      _mistakes: activity.mistakes,
    });
    // The "only while in_progress" guard moved INTO the function, where a
    // caller cannot omit it: a late in-flight touch arriving after completion
    // is discarded rather than reopening a finished game or inflating its
    // recorded solve time.
    if (error) console.error("touchSession failed:", error);
  } catch (err) {
    console.error("touchSession error:", err);
  }
}

/**
 * What KIND of submission a guess event was.
 *
 *   "normal"        - an ordinary in-game guess. Includes one that happens to
 *                     be Rainbow-SHAPED, and the in-game find where the player
 *                     submits the herring set as a normal guess. In both the
 *                     player was playing the board, not invoking a Rainbow flow.
 *   "bonus_rainbow" - an EXPLICIT submission of the post-completion "Spot the
 *                     Rainbow" modal, correct or not.
 *
 * This is the field that carries player INTENT. isRainbowAttempt cannot: it is
 * a shape heuristic that a player can satisfy by accident.
 */
export type GuessAttemptType = "normal" | "bonus_rainbow";

export interface GuessEventInput {
  guessNumber: number;
  words: string[];
  correct: boolean;
  groupName: string | null;
  /**
   * Real submission time, captured by the caller at the moment the player
   * actually submitted — not when this row is written.
   *
   * null means genuinely unknown: a guess restored from a legacy local
   * progress blob saved before GuessAttempt carried a timestamp. Written as
   * NULL rather than back-filled with "now", because a fabricated time is
   * worse than an admitted gap.
   */
  guessedAt: string | null;
  /**
   * HEURISTIC. True when the guess was SHAPED like a Rainbow attempt — one
   * word from each of the four normal categories, or a submission from the
   * post-completion "Spot the Rainbow" bonus modal.
   *
   * This does NOT prove the player consciously intended a Rainbow guess; a
   * player idly picking four unrelated words can produce that shape by
   * accident. The name and behavior are preserved for compatibility with
   * existing rows, but the metric should be read as a shape signal, never as
   * explicit user intent — attemptType below is what does that.
   */
  isRainbowAttempt: boolean;
  /**
   * The authoritative intent signal: was this an explicit post-completion
   * "Spot the Rainbow" submission, or an ordinary in-game guess?
   *
   * Every guess written through this module is "normal". Only the bonus
   * modal path (recordBonusRainbowAttempt in gameStats.ts) writes
   * "bonus_rainbow", which is why a Rainbow-shaped ordinary guess can never
   * be misread as the player having tried the bonus flow.
   */
  attemptType: GuessAttemptType;
  isOneAway: boolean | null;
  isAlmostRainbow: boolean | null;
  snapshot: EventSnapshot;
}

/**
 * Persist one actually-submitted guess, as it happens.
 *
 * Only real submitted guesses are events. Individual tile selections,
 * deselections and shuffles are not persisted — they are UI, not gameplay
 * decisions, and writing them would multiply write volume for no analytical
 * gain.
 *
 * IDEMPOTENCY. `guess_number` is derived from the player's own restored guess
 * history, so the same guess always computes the same number no matter how
 * many times the page reloads. Combined with the unique index on
 * (game_session_id, guess_number) and this ON CONFLICT DO NOTHING upsert, a
 * repeated write is discarded by the database rather than duplicated. This
 * does not depend on the client "probably not calling twice": refresh, resume
 * and retry are all safe by construction.
 *
 * Returns "missing_session" when the referenced session no longer exists, so
 * the caller can recover (see useGameSession) rather than silently dropping
 * every subsequent event.
 */
/**
 * Shapes one guess for the record_guess_events function.
 *
 * attemptType is deliberately NOT sent: that function forces 'normal' for
 * everything it writes, so a client cannot claim 'bonus_rainbow' through this
 * path. That is what makes attempt_type trustworthy as an intent signal —
 * the only producer of 'bonus_rainbow' anywhere is the bonus function itself.
 */
function toGuessPayload(guess: GuessEventInput) {
  return {
    guess_number: guess.guessNumber,
    words: guess.words,
    correct: guess.correct,
    group_name: guess.groupName,
    guessed_at: guess.guessedAt,
    is_rainbow_attempt: guess.isRainbowAttempt,
    is_one_away: guess.isOneAway,
    is_almost_rainbow: guess.isAlmostRainbow,
    active_time_seconds: guess.snapshot.activeTimeSeconds,
    groups_solved: guess.snapshot.groupsSolved,
  };
}

export async function recordGuessEvent(
  sessionId: string,
  guess: GuessEventInput
): Promise<"ok" | "missing_session" | "error"> {
  try {
    const { deviceId, deviceToken } = await getIdentity();
    // Through the function rather than a table insert: guess_events has no
    // insert policy any more. The function verifies the session capability
    // first, so possession of a session id alone cannot inject events into
    // someone else's game.
    //
    // Idempotency is unchanged — it moved into the function's
    // ON CONFLICT DO NOTHING, keyed on (game_session_id, guess_number) exactly
    // as before.
    const { data, error } = await supabase.rpc("record_guess_events", {
      _session_id: sessionId,
      _device_id: deviceId,
      _device_token: deviceToken,
      _events: [toGuessPayload(guess)],
    });

    if (isMissingSessionError(error)) return "missing_session";
    if (error) {
      console.error("recordGuessEvent failed:", error);
      return "error";
    }
    // null means the capability check failed, which for a client that holds
    // the session id means the session itself is gone — the same recovery
    // case a foreign-key violation used to signal.
    if (data === null) return "missing_session";
    return "ok";
  } catch (err) {
    console.error("recordGuessEvent error:", err);
    return "error";
  }
}

/**
 * Backfill guesses that were made before this session had a durable row.
 *
 * The only case this covers is a legacy local progress blob: a game already
 * underway when this feature shipped, whose earlier guesses were never
 * written live. Those guesses genuinely happened and the local history
 * records their words and outcomes faithfully, so writing them is truthful
 * history, not invented history — with one deliberate exception: a guess
 * whose real `guessedAt` was never captured (a blob older still) is written
 * with guessed_at NULL rather than a plausible-looking fabricated timestamp.
 *
 * Uses the same idempotent upsert as the live path, so a guess already
 * written live is simply left alone.
 */
export async function backfillGuessEvents(
  sessionId: string,
  guesses: GuessEventInput[]
): Promise<void> {
  if (guesses.length === 0) return;
  try {
    const { deviceId, deviceToken } = await getIdentity();
    // Same function as the live path, given the whole array at once — one
    // code path, one set of rules, one idempotency key. Guesses already
    // written live collide on (game_session_id, guess_number) and are
    // discarded; only the ones that never reached the server are added.
    const { error } = await supabase.rpc("record_guess_events", {
      _session_id: sessionId,
      _device_id: deviceId,
      _device_token: deviceToken,
      _events: guesses.map(toGuessPayload),
    });
    if (error) console.error("backfillGuessEvents failed:", error);
  } catch (err) {
    console.error("backfillGuessEvents error:", err);
  }
}

export interface HintEventInput {
  hintType: "small" | "full";
  /** Real reveal time, captured by the caller at the moment of the reveal. */
  revealedAt: string;
  /** Guesses already submitted; the next guess is therefore this + 1. */
  guessCount: number;
  /** null when the puzzle has no Rainbow at all — never recorded as false. */
  rainbowFound: boolean | null;
  snapshot: EventSnapshot;
}

/**
 * Persist a hint that was ACTUALLY REVEALED.
 *
 * Opening the hint modal and viewing the available options are deliberately
 * NOT events: they record a player considering a hint, not consuming one, and
 * conflating the two would make every later "did hints help?" analysis wrong.
 * This is called from the false->true transition of the page's hint state,
 * which only happens when the player clicks the specific hint.
 *
 * IDEMPOTENCY. Each hint type can be consumed at most once per game, so
 * (game_session_id, hint_type) is the natural key. There are two independent
 * guards: the client only fires on a real reveal transition (a resumed page
 * restores hint state without re-firing it — see useGame's
 * restoredSmallHintUsedRef), and the unique constraint discards a duplicate
 * outright if anything ever slips past that.
 *
 * game_sessions.hints_used remains the convenient session-level summary
 * boolean; this table adds the WHICH and the WHEN that a boolean cannot
 * carry.
 */
export async function recordHintEvent(
  sessionId: string,
  hint: HintEventInput
): Promise<"ok" | "missing_session" | "error"> {
  try {
    const { deviceId, deviceToken } = await getIdentity();
    // Through the function: hint_events has no insert policy any more, and
    // the session capability is checked before anything is written.
    // Idempotency on (game_session_id, hint_type) moved into the function's
    // ON CONFLICT DO NOTHING and is otherwise unchanged.
    const { data, error } = await supabase.rpc("record_hint_event", {
      _session_id: sessionId,
      _device_id: deviceId,
      _device_token: deviceToken,
      _hint_type: hint.hintType,
      _revealed_at: hint.revealedAt,
      _active_time_seconds: hint.snapshot.activeTimeSeconds,
      _guess_count: hint.guessCount,
      _mistakes: hint.snapshot.mistakes,
      _groups_solved: hint.snapshot.groupsSolved,
      _rainbow_found: hint.rainbowFound,
    });

    if (isMissingSessionError(error)) return "missing_session";
    if (error) {
      console.error("recordHintEvent failed:", error);
      return "error";
    }
    // false means the capability check failed; for a client holding the
    // session id that means the session is gone, so the caller recovers by
    // starting a fresh one.
    if (data === false) return "missing_session";
    return "ok";
  } catch (err) {
    console.error("recordHintEvent error:", err);
    return "error";
  }
}
