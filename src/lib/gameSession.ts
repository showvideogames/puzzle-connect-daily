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
import { getDeviceId } from "./gameStats";

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
export async function getIdentity(): Promise<{ userId: string | null; deviceId: string }> {
  const deviceId = getDeviceId();
  try {
    const { data: { user } } = await supabase.auth.getUser();
    return { userId: user?.id ?? null, deviceId };
  } catch {
    return { userId: null, deviceId };
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
  entryContext: EntryContext;
  snapshot: EventSnapshot;
}): Promise<string | null> {
  const { puzzleId, entryContext, snapshot } = params;
  try {
    const { userId, deviceId } = await getIdentity();
    const now = new Date().toISOString();

    const { data, error } = await supabase
      .from("game_sessions")
      .insert({
        puzzle_id: puzzleId,
        user_id: userId,
        device_id: deviceId,
        status: "in_progress",
        entry_context: entryContext,
        started_at: now,
        last_activity_at: now,
        completed_at: null,
        // NOT NULL columns that only become meaningful at completion. These
        // are placeholders for an unfinished game, which is precisely why
        // `status` exists and why no player-facing stat may read them without
        // filtering on it first.
        won: false,
        mistakes: snapshot.mistakes,
        active_time_seconds: snapshot.activeTimeSeconds,
        found_rainbow: false,
        hints_used: false,
      })
      .select("id")
      .single();

    if (error || !data) {
      console.error("createGameSession failed:", error);
      return null;
    }
    return data.id;
  } catch (err) {
    console.error("createGameSession error:", err);
    return null;
  }
}

/**
 * Touch a session's activity heartbeat and running active-time total.
 *
 * Called only at meaningful moments — session creation, a guess, a hint,
 * completion — never from timer ticks, tile selections, shuffles, hovers or
 * visibility changes. `last_activity_at` is what later lets analysis classify
 * a sufficiently stale `in_progress` session as abandoned, without anyone
 * pretending to know the exact moment a player gave up (which is also why
 * there is deliberately no beforeunload handler anywhere in this module).
 *
 * Carrying active_time_seconds along on the same write means an abandoned
 * session still reports roughly how long it was played, for free.
 */
export async function touchSession(
  sessionId: string,
  snapshot: EventSnapshot
): Promise<void> {
  try {
    const { error } = await supabase
      .from("game_sessions")
      .update({
        last_activity_at: new Date().toISOString(),
        active_time_seconds: snapshot.activeTimeSeconds,
        mistakes: snapshot.mistakes,
      })
      .eq("id", sessionId)
      // Never resurrect or rewrite a finished game. Without this, a late
      // in-flight touch could reopen a session that completed in the
      // meantime, and the post-completion Rainbow bonus could inflate a
      // finished game's active time.
      .eq("status", "in_progress");
    if (error) console.error("touchSession failed:", error);
  } catch (err) {
    console.error("touchSession error:", err);
  }
}

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
   * explicit user intent.
   */
  isRainbowAttempt: boolean;
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
export async function recordGuessEvent(
  sessionId: string,
  guess: GuessEventInput
): Promise<"ok" | "missing_session" | "error"> {
  try {
    const { error } = await supabase
      .from("guess_events")
      .upsert(
        {
          game_session_id: sessionId,
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
        },
        { onConflict: "game_session_id,guess_number", ignoreDuplicates: true }
      );

    if (isMissingSessionError(error)) return "missing_session";
    if (error) {
      console.error("recordGuessEvent failed:", error);
      return "error";
    }
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
    const { error } = await supabase.from("guess_events").upsert(
      guesses.map((g) => ({
        game_session_id: sessionId,
        guess_number: g.guessNumber,
        words: g.words,
        correct: g.correct,
        group_name: g.groupName,
        guessed_at: g.guessedAt,
        is_rainbow_attempt: g.isRainbowAttempt,
        is_one_away: g.isOneAway,
        is_almost_rainbow: g.isAlmostRainbow,
        active_time_seconds: g.snapshot.activeTimeSeconds,
        groups_solved: g.snapshot.groupsSolved,
      })),
      { onConflict: "game_session_id,guess_number", ignoreDuplicates: true }
    );
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
    const { error } = await supabase
      .from("hint_events")
      .upsert(
        {
          game_session_id: sessionId,
          hint_type: hint.hintType,
          revealed_at: hint.revealedAt,
          active_time_seconds: hint.snapshot.activeTimeSeconds,
          guess_count: hint.guessCount,
          mistakes: hint.snapshot.mistakes,
          groups_solved: hint.snapshot.groupsSolved,
          rainbow_found: hint.rainbowFound,
        },
        { onConflict: "game_session_id,hint_type", ignoreDuplicates: true }
      );

    if (isMissingSessionError(error)) return "missing_session";
    if (error) {
      console.error("recordHintEvent failed:", error);
      return "error";
    }
    return "ok";
  } catch (err) {
    console.error("recordHintEvent error:", err);
    return "error";
  }
}
