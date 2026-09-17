import { useCallback, useRef } from "react";
import type { EntryContext } from "@/lib/entryContext";
import { checkpointGameSessionId, loadProgress } from "@/lib/gameProgress";
import {
  createGameSession,
  recordGuessEvent,
  recordHintEvent,
  touchSession,
  type EventSnapshot,
  type SessionActivity,
  type GuessEventInput,
  type HintEventInput,
} from "@/lib/gameSession";

/**
 * Owns the durable server session for one puzzle attempt: when it is created,
 * how it survives refresh and resume, and how it recovers if it goes missing.
 *
 * The network calls themselves live in lib/gameSession.ts; this hook is the
 * React-side orchestration that decides WHEN to make them.
 *
 * Nothing here is called on mount. The session is created strictly on the
 * first meaningful gameplay action, which is what keeps a player who opens a
 * puzzle, looks at it and leaves from creating any gameplay session at all.
 */
export function useGameSession(puzzleId: string, entryContext: EntryContext) {
  /**
   * The durable session id for this attempt.
   *
   * Seeded synchronously from the saved progress blob so that a refresh, an
   * SPA navigation away and back, or a browser close and reopen all resume
   * the SAME server session and merely append new events to it. A fresh mount
   * therefore never creates a second session for a game already underway.
   */
  const sessionIdRef = useRef<string | null>(loadProgress(puzzleId)?.gameSessionId ?? null);

  /**
   * In-flight creation, so that two meaningful actions landing at nearly the
   * same moment (a hint revealed while the first guess is still being
   * written) share one insert instead of racing to create two sessions. This
   * is a real guard, not an assumption that it cannot happen.
   */
  const creatingRef = useRef<Promise<string | null> | null>(null);

  /**
   * Set once a session could not be created for this game, so the rest of it
   * is not half-recorded. Scoped to this mount: a later game, or a reload,
   * gets a fresh attempt at saving.
   */
  const unavailableRef = useRef(false);

  const persistSessionId = useCallback(
    (id: string | null) => {
      sessionIdRef.current = id;
      checkpointGameSessionId(puzzleId, id);
    },
    [puzzleId]
  );

  const ensureSession = useCallback(
    async (snapshot: EventSnapshot): Promise<string | null> => {
      if (sessionIdRef.current) return sessionIdRef.current;
      // Once this game has started unsaved, it stays unsaved.
      //
      // If saving came back mid-game we could create a session now, but it
      // would hold only the guesses from this point on — a partial record
      // that reads as a real one. Recovering the earlier moves safely is not
      // something we can do honestly, so the deliberate choice is to leave
      // THIS game unsaved and let saving resume with the next one.
      if (unavailableRef.current) return null;
      if (creatingRef.current) return creatingRef.current;

      const pending = (async () => {
        const id = await createGameSession({ puzzleId, entryContext, snapshot });
        if (id) persistSessionId(id);
        else unavailableRef.current = true;
        return id;
      })();

      creatingRef.current = pending;
      try {
        return await pending;
      } finally {
        creatingRef.current = null;
      }
    },
    [puzzleId, entryContext, persistSessionId]
  );

  /**
   * Runs a durable event write, recovering once if the session it referenced
   * has gone.
   *
   * A stored session id can legitimately reference a row that no longer
   * exists — a session deleted server-side, or a progress blob carried across
   * to a different environment. Rather than silently dropping every event
   * from then on, or cross-linking this game onto some unrelated row, the
   * dead id is discarded and one fresh session is created for the remainder
   * of the attempt. Events already written to the old session stay with it;
   * this attempt simply continues on a new one, which is truthful about what
   * is actually known.
   */
  const withSession = useCallback(
    async (
      snapshot: EventSnapshot,
      write: (sessionId: string) => Promise<"ok" | "missing_session" | "error">
    ): Promise<string | null> => {
      const sessionId = await ensureSession(snapshot);
      if (!sessionId) return null;

      const result = await write(sessionId);
      if (result !== "missing_session") return sessionId;

      console.warn(
        "Durable game session no longer exists; starting a fresh one for the rest of this attempt."
      );
      persistSessionId(null);
      const replacement = await ensureSession(snapshot);
      if (!replacement) return null;
      await write(replacement);
      return replacement;
    },
    [ensureSession, persistSessionId]
  );

  /**
   * Persist one actually-submitted guess as it happens, then update the
   * session's activity heartbeat.
   *
   * Only real submitted guesses reach here — tile selections, deselections
   * and shuffles are UI, not gameplay decisions, and are never persisted.
   */
  const recordGuess = useCallback(
    async (guess: GuessEventInput, activity: SessionActivity) => {
      const sessionId = await withSession(guess.snapshot, (id) => recordGuessEvent(id, guess));
      // `activity`, not `guess.snapshot`: the event records the state the
      // guess was made AGAINST, while the session must carry the state that
      // now holds. Passing the snapshot here left game_sessions.mistakes one
      // behind the real count after every wrong guess.
      if (sessionId) await touchSession(sessionId, activity);
    },
    [withSession]
  );

  /**
   * Persist a hint that was actually revealed, then update the heartbeat.
   *
   * This is also a valid first meaningful action: a player who reveals a hint
   * before guessing gets a session and a hint event, and no fabricated guess.
   */
  const recordHint = useCallback(
    async (hint: HintEventInput) => {
      const sessionId = await withSession(hint.snapshot, (id) => recordHintEvent(id, hint));
      // A hint reveal changes neither the mistake count nor the solved count,
      // so the state it was revealed against IS the state that now holds.
      if (sessionId) await touchSession(sessionId, hint.snapshot);
    },
    [withSession]
  );

  return { sessionIdRef, ensureSession, recordGuess, recordHint };
}
