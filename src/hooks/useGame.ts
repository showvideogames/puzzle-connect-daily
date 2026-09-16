import { useState, useCallback, useMemo, useEffect, useRef } from "react";
import { Puzzle, GameState, GuessAttempt } from "@/lib/types";
import { vibrateSuccess, vibrateError, vibrateCelebration } from "@/lib/haptics";
import confetti from "canvas-confetti";
import { supabase } from "@/integrations/supabase/client";
import { finalizeGameSession, hasOfficialResult } from "@/lib/gameStats";
import { playRainbowSound } from "@/lib/sounds";
import { trackEvent } from "@/lib/analytics";
import type { EntryContext } from "@/lib/entryContext";
import type { EventSnapshot, GuessEventInput } from "@/lib/gameSession";
import { useGameSession } from "./useGameSession";
import {
  checkpointActiveTime,
  loadProgress,
  saveProgress,
  type SavedProgress,
} from "@/lib/gameProgress";

// Re-exported so existing importers (Index.tsx, Archive.tsx) keep working —
// the implementations moved to lib/gameProgress.ts so that both this hook and
// the durable-session layer can read and write the same blob without an
// import cycle.
export { progressKey, hasInProgressGame, clearProgress } from "@/lib/gameProgress";

function shuffleArray<T>(arr: T[]): T[] {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

const DIFFICULTY_SQUARE: Record<number, string> = {
  1: "🟨",
  2: "🟩",
  3: "🟦",
  4: "🟥",
};

function buildShareGrid(guessHistory: GuessAttempt[], puzzle: Puzzle): string {
  const lines: string[] = [];
  for (const attempt of guessHistory) {
    if (attempt.isHintMarker) {
      const emoji = attempt.hintType === "small" ? "💡" : "🔦";
      const last = lines[lines.length - 1];
      if (last === "💡" || last === "🔦" || last === "💡🔦" || last === "🔦💡") {
        lines[lines.length - 1] = last + emoji;
      } else {
        lines.push(emoji);
      }
    } else if (attempt.isRainbow) {
      lines.push("🌈🌈🌈🌈");
    } else {
      const row = attempt.groupIndices
        .map((gi) => {
          const diff = puzzle.groups[gi]?.difficulty;
          return DIFFICULTY_SQUARE[diff] || "⬜";
        })
        .join("");
      lines.push(row);
    }
  }
  return lines.join("\n");
}

// Legacy-progress fallback: does the restored guessHistory already contain a
// marker for this hint type? The only local evidence available for a
// progress blob saved before SavedProgress.smallHintUsed/fullHintUsed
// existed. Reflects an actual past hint reveal (addHintMarker below) —
// never inferred without that evidence.
function hintUsedInHistory(guessHistory: GuessAttempt[] | undefined, type: "small" | "full"): boolean {
  return (guessHistory ?? []).some((g) => g.isHintMarker && g.hintType === type);
}

function prefersReducedMotion(): boolean {
  try {
    return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  } catch {
    return false;
  }
}

export function useGame(
  puzzle: Puzzle,
  {
    isArchive = false,
    smallHintUsed = false,
    fullHintUsed = false,
    // How the player reached this game. Recorded once, on the durable
    // session, at creation — see lib/entryContext.ts. Defaults to the Daily
    // home route because that is the only caller that does not pass one.
    entryContext = "daily_home",
  }: {
    isArchive?: boolean;
    smallHintUsed?: boolean;
    fullHintUsed?: boolean;
    entryContext?: EntryContext;
  } = {}
) {
  const MAX_MISTAKES = 4;
  // Shared "checking guess" suspense: every submitted guess (correct OR
  // incorrect) first plays a staggered per-tile bounce, then holds a beat,
  // before the outcome is revealed — matching NYT Connections.
  //   CHECK_SUSPENSE_MS: covers the per-tile bounce + stagger (index.css
  //     .animate-tile-checking).
  //   CHECK_REVEAL_PAUSE_MS: a still hold AFTER the bounce so the result
  //     doesn't land the instant the movement stops.
  const CHECK_SUSPENSE_MS = 550;
  const CHECK_REVEAL_PAUSE_MS = 450;
  // Incorrect guess: how long the grid "reject" shake plays once the suspense
  // is over and the miss is revealed.
  const WRONG_SHAKE_MS = 400;

  const allWords = useMemo(
    () => puzzle.groups.flatMap((g) => g.words),
    [puzzle]
  );

  const saved = useMemo(() => {
    return loadProgress(puzzle.id);
  }, [puzzle.id]);

  // Authoritative "was a hint ever revealed this session" state. The
  // smallHintUsed/fullHintUsed PROPS above are owned by the page (Index.tsx/
  // ArchivePuzzle.tsx via HintModal) and reset to false on every remount —
  // they only signal "just clicked in THIS mount." Root cause of the
  // hints_used-goes-false-after-refresh bug: nothing previously restored
  // that signal from a prior mount. These refs seed it once from the
  // persisted progress blob (falling back to scanning guessHistory for
  // pre-migration blobs — see hintUsedInHistory) and never regress once
  // true, so effectiveSmallHintUsed/effectiveFullHintUsed below stay
  // correct across refresh/resume regardless of what the fresh page-level
  // state happens to be.
  const restoredSmallHintUsedRef = useRef(
    saved?.smallHintUsed ?? hintUsedInHistory(saved?.guessHistory, "small")
  );
  const restoredFullHintUsedRef = useRef(
    saved?.fullHintUsed ?? hintUsedInHistory(saved?.guessHistory, "full")
  );
  const effectiveSmallHintUsed = smallHintUsed || restoredSmallHintUsedRef.current;
  const effectiveFullHintUsed = fullHintUsed || restoredFullHintUsedRef.current;

  const [shuffledWords, setShuffledWords] = useState(() => {
    if (saved) return saved.shuffledWords;
    if (puzzle.wordOrder && puzzle.wordOrder.length > 0) {
      const wordSet = new Set(allWords);
      const isValid = puzzle.wordOrder.every(w => wordSet.has(w));
      if (isValid) return puzzle.wordOrder;
    }
    return shuffleArray(allWords);
  });

  const [tileColors, setTileColors] = useState<Record<string, string | null>>(() => {
    return saved?.tileColors ?? {};
  });

  const [state, setState] = useState<GameState>(() => {
    if (saved) {
      const solvedGroups = saved.finalSolvedGroups ?? saved.solvedGroups;
      return {
        puzzleId: puzzle.id,
        solvedGroups,
        mistakes: saved.mistakes,
        maxMistakes: MAX_MISTAKES,
        selectedWords: [],
        isComplete: saved.isComplete ?? false,
        isWon: saved.isWon ?? false,
        guessHistory: saved.guessHistory,
        gotRainbow: saved.gotRainbow,
        rainbowSolveIndex: saved.rainbowSolveIndex ?? null,
      };
    }

    return {
      puzzleId: puzzle.id,
      solvedGroups: [],
      mistakes: 0,
      maxMistakes: MAX_MISTAKES,
      selectedWords: [],
      isComplete: false,
      isWon: false,
      guessHistory: [],
      gotRainbow: false,
      rainbowSolveIndex: null,
    };
  });

  // Lock the board when this puzzle has already been OFFICIALLY COMPLETED by
  // this identity — most often a player who cleared localStorage but is still
  // signed in.
  //
  // hasOfficialResult(), not the old hasExistingSession(): now that a session
  // row is created on the first meaningful action, "a session exists" and
  // "this puzzle has been finished" are different facts. Checking mere
  // existence here would lock a player out of the game they are in the middle
  // of playing the moment they refreshed.
  useEffect(() => {
    if (saved) return;
    let cancelled = false;
    hasOfficialResult(puzzle.id).then((played) => {
      if (!cancelled && played) {
        setState((s) => ({ ...s, isComplete: true }));
      }
    });
    return () => { cancelled = true; };
  }, [puzzle.id, saved]);

  const [shaking, setShaking] = useState(false);
  const [lastRevealedGroup, setLastRevealedGroup] = useState<number | null>(null);
  // A group that's already in solvedGroups (for scoring/bar-rendering
  // purposes) but whose tiles should still show in the interactive grid —
  // GameBoard holds this while it runs its own clone-based reveal animation,
  // then calls releaseRevealHold() once that finishes. Scoring/stats timing
  // is unaffected: this only delays when the tiles visually leave the grid.
  const [revealHoldGroupIdx, setRevealHoldGroupIdx] = useState<number | null>(null);
  const releaseRevealHold = useCallback(() => {
    setRevealHoldGroupIdx((heldIdx) => {
      if (heldIdx !== null) {
        const words = puzzle.groups[heldIdx]?.words ?? [];
        setShuffledWords((prev) => prev.filter((w) => !words.includes(w)));
      }
      return null;
    });
  }, [puzzle]);
  // The 4 tiles currently mid "checking guess" suspense animation (shared by
  // correct and incorrect guesses). The ref mirrors it so the action guards
  // below stay correct without re-creating callbacks on every check.
  const [checkingWords, setCheckingWords] = useState<string[]>([]);
  const checkingRef = useRef(false);
  const [oneAway, setOneAway] = useState(false);
  const [almostRainbow, setAlmostRainbow] = useState(false);
  const [alreadyGuessed, setAlreadyGuessed] = useState<"plain" | "oneaway" | null>(null);
  const [rainbowWords, setRainbowWords] = useState<string[]>(saved?.rainbowWords ?? []);
  const [showRainbowPopup, setShowRainbowPopup] = useState(false);
  const [matchedWords, setMatchedWords] = useState<string[]>([]);
  const [draggedWord, setDraggedWord] = useState<string | null>(null);

  // Seeded from the restored progress blob (0 for a brand-new puzzle, or a
  // legacy blob saved before activeTimeSeconds existed — never guessed at,
  // never reconstructed). Every subsequent active second, in every mount,
  // adds onto this same ref, so the final value sent to finalizeGameSession is
  // genuinely cumulative across refresh/resume rather than resetting per
  // mount. This is the single timer for the puzzle attempt — nothing below
  // introduces a second one.
  const activeSecondsRef = useRef<number>(saved?.activeTimeSeconds ?? 0);
  const timerIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const isVisibleRef = useRef<boolean>(true);

  useEffect(() => {
    if (state.isComplete) {
      if (timerIntervalRef.current) clearInterval(timerIntervalRef.current);
      return;
    }

    // How often (in active seconds) the running total below is checkpointed
    // into localStorage, independent of the full saveProgress() writes that
    // already fire on every real state change (guess/hint/tile color — see
    // those call sites' own activeTimeSeconds field). Those cover most
    // cases; this only fills the gap where a player spends a long stretch
    // purely thinking — no guess, no hint — and then refreshes or closes
    // before any of those fire. Cheap (localStorage only, no network) and
    // infrequent enough not to be "excessive writes" even during a long
    // idle-but-focused stretch.
    const CHECKPOINT_INTERVAL_SECONDS = 10;
    let ticksSinceCheckpoint = 0;

    const handleVisibilityChange = () => {
      isVisibleRef.current = !document.hidden;
      // Checkpoint the instant the tab backgrounds — the moment most likely
      // to precede a refresh/close, and visibilitychange fires reliably for
      // that even when beforeunload/unload do not.
      if (document.hidden) {
        checkpointActiveTime(puzzle.id, activeSecondsRef.current);
      }
    };
    document.addEventListener("visibilitychange", handleVisibilityChange);

    timerIntervalRef.current = setInterval(() => {
      if (isVisibleRef.current) {
        activeSecondsRef.current += 1;
        ticksSinceCheckpoint += 1;
        if (ticksSinceCheckpoint >= CHECKPOINT_INTERVAL_SECONDS) {
          ticksSinceCheckpoint = 0;
          checkpointActiveTime(puzzle.id, activeSecondsRef.current);
        }
      }
    }, 1000);

    return () => {
      if (timerIntervalRef.current) clearInterval(timerIntervalRef.current);
      document.removeEventListener("visibilitychange", handleVisibilityChange);
      // Final checkpoint so the seconds since the last periodic/visibility
      // checkpoint aren't lost to a React-level unmount (e.g. SPA navigation
      // away) that never fires visibilitychange, and so a live completion
      // (isComplete just flipped true, tearing this effect down) leaves the
      // exact final total behind too.
      checkpointActiveTime(puzzle.id, activeSecondsRef.current);
    };
  }, [state.isComplete, puzzle.id]);

  // --- Durable session + live gameplay events ---
  // The session this attempt writes to. Resumed from the local progress blob
  // when one exists, and otherwise created lazily on the first meaningful
  // gameplay action. Nothing below runs on mount: merely opening a puzzle
  // must leave no gameplay session behind.
  const { sessionIdRef, recordGuess, recordHint } = useGameSession(puzzle.id, entryContext);

  /**
   * Game state at the moment a durable event happened.
   *
   * activeSecondsRef is the single resume-safe active-play timer, so a guess
   * and a hint recorded moments apart carry directly comparable times. No
   * idle detection, and nothing is written every second — this is only ever
   * read at the instant an event is already being persisted.
   */
  const eventSnapshot = useCallback(
    (overrides?: Partial<EventSnapshot>): EventSnapshot => ({
      activeTimeSeconds: activeSecondsRef.current,
      groupsSolved: state.solvedGroups.length,
      mistakes: state.mistakes,
      ...overrides,
    }),
    [state.solvedGroups.length, state.mistakes]
  );

  /**
   * How many real guesses have been submitted so far.
   *
   * Hint markers are synthetic guessHistory entries used for the share grid
   * and are never guess events, so they are excluded. Because this counts the
   * player's own restored history, it yields the SAME number for the same
   * guess on every mount — which is exactly what makes
   * (game_session_id, guess_number) a usable idempotency key across refresh
   * and resume.
   */
  const submittedGuessCount = useCallback(
    (history: GuessAttempt[]) => history.filter((g) => !g.isHintMarker).length,
    []
  );

  /**
   * The whole local guess history as durable guess events, for the
   * completion-time backfill.
   *
   * Numbering matches the live path exactly (position among non-hint-marker
   * entries, 1-based), so a guess already written live collides with itself
   * and is discarded rather than duplicated — the backfill only ever adds the
   * guesses that never made it to the server: a game already underway when
   * durable sessions shipped, or a live write that failed.
   *
   * `guessedAt: null` is deliberate for an entry whose real submission time
   * was never captured (a progress blob predating GuessAttempt.guessedAt).
   * The previous implementation substituted the save time there, which reads
   * as a real measurement but isn't one. An honest gap is better than an
   * invented timestamp; every other field of those guesses is genuine local
   * history and is preserved.
   *
   * groupsSolved/activeTimeSeconds cannot be reconstructed per historical
   * guess and are NOT guessed at either — the backfilled rows carry the
   * final-state snapshot only because that is the one value actually known at
   * write time, and live-written rows (the overwhelming majority) carry their
   * true per-guess snapshot.
   */
  const toGuessEventInputs = useCallback(
    (history: GuessAttempt[], snapshot: EventSnapshot): GuessEventInput[] =>
      history
        .filter((g) => !g.isHintMarker)
        .map((g, index) => ({
          guessNumber: index + 1,
          words: g.words,
          correct: g.isCorrect,
          groupName: g.isCorrect
            ? (["orange", "green", "blue", "red"][puzzle.groups[g.groupIndices?.[0]]?.difficulty - 1] ?? null)
            : null,
          guessedAt: g.guessedAt ?? null,
          isRainbowAttempt: g.isRainbowAttempt ?? false,
          isOneAway: g.isOneAway ?? null,
          isAlmostRainbow: g.isAlmostRainbow ?? null,
          snapshot,
        })),
    [puzzle]
  );

  // --- Hint marker injection ---
  // Track previous hint-boolean values so we can detect the false→true transition
  // and insert a synthetic marker into guessHistory at the right position.
  //
  // That same transition is the ONLY place a hint event is persisted, which
  // is what keeps "revealed" and "considered" distinct: the page's hint flag
  // flips when the player clicks a specific hint in HintModal, never when the
  // modal merely opens. A resumed page restores hint state through
  // restoredSmallHintUsedRef WITHOUT touching these props, so a refresh
  // cannot replay a reveal that already happened.
  const prevSmallHintRef = useRef(smallHintUsed);
  const prevFullHintRef = useRef(fullHintUsed);

  const addHintMarker = useCallback((type: "small" | "full") => {
    setState((s) => ({
      ...s,
      guessHistory: [
        ...s.guessHistory,
        { words: [], groupIndices: [], isCorrect: false, isHintMarker: true, hintType: type },
      ],
    }));
  }, []);

  /**
   * A hint reveal is a meaningful gameplay action in its own right: it
   * creates the durable session if this is the first one, so a player who
   * asks for a hint before guessing is recorded truthfully — one session, one
   * hint event, and no fabricated guess.
   */
  const persistHintReveal = useCallback(
    (type: "small" | "full") => {
      void recordHint({
        hintType: type,
        revealedAt: new Date().toISOString(),
        guessCount: submittedGuessCount(state.guessHistory),
        // null, not false, when the puzzle has no Rainbow at all — "there was
        // no Rainbow to find" must not be recorded as "hadn't found it yet".
        rainbowFound: puzzle.rainbowHerring ? state.gotRainbow : null,
        snapshot: eventSnapshot(),
      });
    },
    [recordHint, submittedGuessCount, state.guessHistory, state.gotRainbow, puzzle.rainbowHerring, eventSnapshot]
  );

  useEffect(() => {
    if (smallHintUsed && !prevSmallHintRef.current) {
      addHintMarker("small");
      persistHintReveal("small");
    }
    prevSmallHintRef.current = smallHintUsed;
  }, [smallHintUsed, addHintMarker, persistHintReveal]);

  useEffect(() => {
    if (fullHintUsed && !prevFullHintRef.current) {
      addHintMarker("full");
      persistHintReveal("full");
    }
    prevFullHintRef.current = fullHintUsed;
  }, [fullHintUsed, addHintMarker, persistHintReveal]);

  useEffect(() => {
    if (oneAway) setOneAway(false);
    if (almostRainbow) setAlmostRainbow(false);
  }, [state.selectedWords]);

  useEffect(() => {
    if (state.solvedGroups.length > 0 || state.mistakes > 0 || state.guessHistory.length > 0) {
      saveProgress(puzzle.id, {
        solvedGroups: state.solvedGroups,
        mistakes: state.mistakes,
        guessHistory: state.guessHistory,
        gotRainbow: state.gotRainbow,
        rainbowSolveIndex: state.rainbowSolveIndex,
        shuffledWords,
        rainbowWords,
        isComplete: state.isComplete,
        isWon: state.isWon,
        tileColors,
        smallHintUsed: effectiveSmallHintUsed,
        fullHintUsed: effectiveFullHintUsed,
        activeTimeSeconds: activeSecondsRef.current,
        gameSessionId: sessionIdRef.current,
      });
    }
  }, [state, shuffledWords, rainbowWords, tileColors, puzzle.id, effectiveSmallHintUsed, effectiveFullHintUsed]);

  // Skip the very first run (mount) — otherwise merely opening a puzzle
  // would immediately persist a progress row (tileColors' own useState
  // initializer always "changes" on mount, which fires this effect once
  // regardless of the dependency array), making an untouched archived
  // puzzle indistinguishable from one the player actually started. Archive's
  // "in progress" calendar status relies on hasInProgressGame/progressKey
  // below only appearing after real interaction.
  const tileColorsMountedRef = useRef(false);
  useEffect(() => {
    if (!tileColorsMountedRef.current) {
      tileColorsMountedRef.current = true;
      return;
    }
    const existing = loadProgress(puzzle.id);
    saveProgress(puzzle.id, {
      solvedGroups: state.solvedGroups,
      mistakes: state.mistakes,
      guessHistory: state.guessHistory,
      gotRainbow: state.gotRainbow,
      rainbowSolveIndex: state.rainbowSolveIndex,
      shuffledWords,
      rainbowWords,
      isComplete: state.isComplete,
      isWon: state.isWon,
      tileColors,
      smallHintUsed: effectiveSmallHintUsed,
      fullHintUsed: effectiveFullHintUsed,
      activeTimeSeconds: activeSecondsRef.current,
        gameSessionId: sessionIdRef.current,
      ...(existing?.finalSolvedGroups ? { finalSolvedGroups: existing.finalSolvedGroups } : {}),
    });
  }, [tileColors]);

  const saveResultToDb = useCallback(async (won: boolean, mistakes: number) => {
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return;
      const { error } = await supabase.from("game_results").upsert({
        user_id: user.id,
        puzzle_id: puzzle.id,
        won,
        mistakes,
      }, { onConflict: "user_id,puzzle_id" });
      if (error) throw error;
    } catch (err) {
      const reason = err instanceof Error ? err.message : String(err);
      console.error("saveResultToDb error:", err);
      trackEvent("save_stats_failed", { reason });
    }
  }, [puzzle.id]);

  // Whether THIS mount's completed playthrough owns the permanent official
  // result for this puzzle+identity (see commitOfficialResult below) — null
  // until that's determined, right after completion. Exposed so GameBoard's
  // post-completion "Spot the Rainbow" bonus skips its
  // found_rainbow/rainbow_solve_index write when this playthrough is a
  // detected replay, so a replay's Rainbow find can never rewrite the real
  // official result's Rainbows Spotted outcome. Defaults to proceeding
  // (treated as official) until a replay is positively confirmed, rather
  // than blocking on the narrow window before that async check resolves.
  //
  // Belt and braces since the durable-session work: those writes now target
  // the session by id, so a replay's bonus lands on the replay's OWN row
  // rather than the official one regardless — and that row is excluded from
  // Stats by is_official anyway. This guard is kept so the protection does
  // not depend on any one of those three mechanisms holding alone.
  const isOfficialAttemptRef = useRef<boolean | null>(null);

  // Finalizes this completed playthrough.
  //
  // The "first completed attempt is the official record" rule is unchanged:
  // a replay must not create a second Played, must not touch the streak
  // again, and must not increment puzzle_aggregates again. What changed is
  // WHERE that decision lands. The replay's own session row genuinely
  // finished, so it is still finalized truthfully (status won/lost) — just
  // with is_official = false, which every player-facing stat filters on.
  // Leaving it parked at in_progress forever would be both a lie and a
  // corruption of abandonment analytics.
  //
  // Note the asymmetry this preserves: "a session row exists for this
  // puzzle" is NOT the same question as "an official completed attempt
  // exists" — hasOfficialResult() asks only the latter, so the player's own
  // unfinished session can never be mistaken for a prior official result and
  // block their real one from being saved.
  //
  // Shared by both the Daily and Archive completion paths below — the only
  // per-route difference is streak handling: Archive intentionally never
  // updates the Daily streak, even for its own genuine first completion
  // (existing product behavior, unchanged here — see skipStreak below).
  const commitOfficialResult = useCallback(async (
    won: boolean,
    mistakes: number,
    statsParams: Omit<
      Parameters<typeof finalizeGameSession>[0],
      "skipStreak" | "sessionId" | "entryContext" | "isOfficial"
    >
  ) => {
    const alreadyOfficial = await hasOfficialResult(puzzle.id);
    const isOfficial = !alreadyOfficial;
    isOfficialAttemptRef.current = isOfficial;
    if (isOfficial) saveResultToDb(won, mistakes);
    await finalizeGameSession({
      ...statsParams,
      sessionId: sessionIdRef.current,
      entryContext,
      isOfficial,
      skipStreak: isArchive,
    });
  }, [puzzle.id, isArchive, saveResultToDb, sessionIdRef, entryContext]);

  const setTileColor = useCallback((word: string, color: string | null) => {
    setTileColors((prev) => ({ ...prev, [word]: color }));
  }, []);

  // Marks the rainbow as found after the puzzle is already complete (the
  // "Spot the Rainbow?" bonus prompt). Records a guessHistory entry and solve
  // position just like the mid-game find does, so the board and share grid
  // read from the same source of truth regardless of which path found it.
  // guessedAt is required rather than defaulted here: it must be captured by
  // the caller (GameBoard's handleSpotResult) at the moment the player
  // actually submitted the bonus modal, not whenever this callback happens
  // to run after that flow's own reveal delay.
  const markRainbowFound = useCallback((words: string[], guessedAt: string) => {
    setRainbowWords(words);
    setState((s) => {
      if (s.gotRainbow) return s;
      const attempt: GuessAttempt = {
        words: [...words],
        groupIndices: [],
        isCorrect: false,
        isRainbow: true,
        isRainbowAttempt: true,
        guessedAt,
      };
      return {
        ...s,
        gotRainbow: true,
        rainbowSolveIndex: s.solvedGroups.length,
        guessHistory: [...s.guessHistory, attempt],
      };
    });
  }, []);

  const clearAllColors = useCallback(() => {
    setTileColors({});
  }, []);

  const hasAnyColor = useMemo(() => {
    return Object.values(tileColors).some(Boolean);
  }, [tileColors]);

  const handleDragStart = useCallback((word: string) => {
    setDraggedWord(word);
  }, []);

  const handleDragOver = useCallback((targetWord: string) => {
    if (!draggedWord || draggedWord === targetWord) return;
    setShuffledWords((prev) => {
      const result = [...prev];
      const fromIdx = result.indexOf(draggedWord);
      const toIdx = result.indexOf(targetWord);
      if (fromIdx === -1 || toIdx === -1) return prev;
      result.splice(fromIdx, 1);
      result.splice(toIdx, 0, draggedWord);
      return result;
    });
  }, [draggedWord]);

  const handleDrop = useCallback(() => {
    setDraggedWord(null);
  }, []);

  const handleTouchDragMove = useCallback((x: number, y: number) => {
    const el = document.elementFromPoint(x, y);
    if (!el) return;
    const tileEl = el.closest("[data-word]") as HTMLElement | null;
    if (!tileEl) return;
    const targetWord = tileEl.dataset.word;
    if (!targetWord || !draggedWord || targetWord === draggedWord) return;
    setShuffledWords((prev) => {
      const result = [...prev];
      const fromIdx = result.indexOf(draggedWord);
      const toIdx = result.indexOf(targetWord);
      if (fromIdx === -1 || toIdx === -1) return prev;
      result.splice(fromIdx, 1);
      result.splice(toIdx, 0, draggedWord);
      return result;
    });
  }, [draggedWord]);

  const handleTouchDragEnd = useCallback(() => {
    setDraggedWord(null);
  }, []);

  const toggleWord = useCallback((word: string) => {
    if (state.isComplete || checkingRef.current) return;
    setState((s) => {
      if (s.selectedWords.includes(word)) {
        return { ...s, selectedWords: s.selectedWords.filter((w) => w !== word) };
      }
      if (s.selectedWords.length >= 4) return s;
      return { ...s, selectedWords: [...s.selectedWords, word] };
    });
  }, [state.isComplete]);

  const deselectAll = useCallback(() => {
    if (checkingRef.current) return;
    setState((s) => ({ ...s, selectedWords: [] }));
  }, []);

  const shuffle = useCallback(() => {
    if (checkingRef.current) return;
    setShuffledWords((prev) => shuffleArray(prev));
  }, []);

  const getWordGroupIndex = useCallback((word: string): number => {
    for (let i = 0; i < puzzle.groups.length; i++) {
      if (puzzle.groups[i].words.includes(word)) return i;
    }
    return -1;
  }, [puzzle]);

  const playCelebrationSound = useCallback(() => {
    try {
      const settings = JSON.parse(localStorage.getItem("connections-settings") || "{}");
      if (settings.soundEnabled === false) return;
      const ctx = new AudioContext();
      const notes = [523.25, 659.25, 783.99, 1046.50];
      notes.forEach((freq, i) => {
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.type = "sine";
        osc.frequency.value = freq;
        gain.gain.setValueAtTime(0.15, ctx.currentTime + i * 0.15);
        gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + i * 0.15 + 0.5);
        osc.connect(gain);
        gain.connect(ctx.destination);
        osc.start(ctx.currentTime + i * 0.15);
        osc.stop(ctx.currentTime + i * 0.15 + 0.5);
      });
    } catch {}
  }, []);

  const fireConfetti = useCallback(() => {
    const duration = 2000;
    const end = Date.now() + duration;
    const frame = () => {
      confetti({ particleCount: 3, angle: 60, spread: 55, origin: { x: 0, y: 0.7 }, colors: ['#4CAF50', '#FF9800', '#2196F3', '#E91E63'] });
      confetti({ particleCount: 3, angle: 120, spread: 55, origin: { x: 1, y: 0.7 }, colors: ['#4CAF50', '#FF9800', '#2196F3', '#E91E63'] });
      if (Date.now() < end) requestAnimationFrame(frame);
    };
    frame();
    playCelebrationSound();
  }, [playCelebrationSound]);

  // The full win celebration (confetti + melody + celebratory haptic). Kept
  // separate from the logical win so GameBoard can fire it only once the final
  // category's arrival pop has finished, rather than the instant isWon flips.
  const fireWinCelebration = useCallback(() => {
    fireConfetti();
    vibrateCelebration();
  }, [fireConfetti]);

  const getSolveOrder = useCallback((solvedGroups: number[]): string[] => {
    const colorNames = ["orange", "green", "blue", "red"];
    return solvedGroups.map((groupIdx) => {
      const diff = puzzle.groups[groupIdx]?.difficulty;
      return colorNames[diff - 1] ?? "unknown";
    });
  }, [puzzle]);

  const submitGuess = useCallback(() => {
    if (state.selectedWords.length !== 4 || state.isComplete || checkingRef.current) return;

    // Captured HERE — the moment the player actually submits — not inside
    // the setTimeout below, which only fires after the ~1s "checking guess"
    // suspense animation. That delay is presentation only; the guess itself
    // happened now.
    const guessedAt = new Date().toISOString();

    const sortedSelected = [...state.selectedWords].sort();
    const isDuplicate = state.guessHistory.some(
      (g) => !g.isRainbow && g.words.length === 4 && [...g.words].sort().every((w, i) => w === sortedSelected[i])
    );
    if (isDuplicate) {
      const isOneAway = puzzle.groups.some(
        (g, idx) => !state.solvedGroups.includes(idx) && g.words.filter((w) => state.selectedWords.includes(w)).length === 3
      );
      setAlreadyGuessed(isOneAway ? "oneaway" : "plain");
      setTimeout(() => setAlreadyGuessed(null), 2000);
      return;
    }

    const guessGroupIndices = state.selectedWords.map((w) => getWordGroupIndex(w));

    // Hidden rainbow/flag: the 4 selected words are exactly the herring set.
    const herring = puzzle.rainbowHerring;
    const isRainbowHerring =
      !!herring &&
      herring.length === 4 &&
      rainbowWords.length === 0 &&
      (() => {
        const sel = [...state.selectedWords].sort();
        const her = [...herring].sort();
        return sel.every((w, i) => w === her[i]);
      })();

    const matchedGroupIndex = puzzle.groups.findIndex(
      (g, idx) => !state.solvedGroups.includes(idx) && g.words.every((w) => state.selectedWords.includes(w))
    );
    const isCorrect = matchedGroupIndex !== -1;

    // Near-miss classification, hoisted out of the miss branch below so the
    // durable guess event can carry it too. Pure functions of the state this
    // guess was made against, so computing them here rather than after the
    // suspense delay changes nothing about the values.
    const rainbowHerringWords = puzzle.rainbowHerring ?? [];
    const rainbowHits = state.selectedWords.filter((w) => rainbowHerringWords.includes(w)).length;
    const isAlmostRainbow =
      rainbowHerringWords.length === 4 && rainbowWords.length === 0 && rainbowHits === 3;
    const isOneAway = puzzle.groups.some(
      (g, idx) => !state.solvedGroups.includes(idx) && g.words.filter((w) => state.selectedWords.includes(w)).length === 3
    );

    // ── Durable guess event, written as it happens ──
    // Persisted HERE, on submission, rather than batched at game end. A
    // player who makes six guesses and then leaves frustrated used to leave
    // no server-side trace at all; now every one of those guesses is already
    // durable. Written before the suspense animation resolves for the same
    // reason guessedAt is captured above: the delay is presentation, the
    // guess already happened.
    //
    // guess_number comes from the player's own restored history, so the same
    // guess always computes the same number across refresh and resume — which
    // is what makes the (game_session_id, guess_number) unique index an
    // effective idempotency key rather than a hope that the client won't
    // call twice.
    //
    // This is also the first-meaningful-action trigger: if no durable session
    // exists yet, recordGuess creates one.
    void recordGuess({
      guessNumber: submittedGuessCount(state.guessHistory) + 1,
      words: [...state.selectedWords],
      correct: isCorrect,
      groupName: isCorrect
        ? (["orange", "green", "blue", "red"][puzzle.groups[matchedGroupIndex].difficulty - 1] ?? null)
        : null,
      guessedAt,
      // HEURISTIC, by shape only — one word from each of the 4 categories.
      // Does not prove the player intended a Rainbow guess. Preserved exactly
      // as previously defined; see GuessEventInput.isRainbowAttempt.
      isRainbowAttempt: isRainbowHerring || new Set(guessGroupIndices).size === 4,
      isOneAway: isOneAway && !isAlmostRainbow,
      isAlmostRainbow,
      snapshot: eventSnapshot(),
    });

    // ── Shared "checking guess" suspense ──
    // Every outcome — category, hidden rainbow/flag, or miss — first plays the
    // same staggered per-tile bounce, then holds a beat, before the result is
    // applied, so nothing gives the answer away early. Interaction is blocked
    // meanwhile via checkingRef (see the toggleWord/shuffle/deselectAll/submit
    // guards).
    checkingRef.current = true;
    setCheckingWords([...state.selectedWords]);
    const totalDelay = prefersReducedMotion() ? 0 : CHECK_SUSPENSE_MS + CHECK_REVEAL_PAUSE_MS;

    setTimeout(() => {
      checkingRef.current = false;
      setCheckingWords([]);

      // Hidden rainbow/flag reveal (no longer bypasses the suspense): the
      // selected tiles turn rainbow and the reveal curtain wipes in. These
      // tiles stay in the grid — they're still part of their own categories.
      if (isRainbowHerring) {
        const attempt: GuessAttempt = {
          words: [...state.selectedWords],
          groupIndices: guessGroupIndices,
          isCorrect: false,
          isRainbow: true,
          isRainbowAttempt: true,
          guessedAt,
        };
        setRainbowWords(state.selectedWords);
        setShowRainbowPopup(true);
        playRainbowSound();
        setTimeout(() => setShowRainbowPopup(false), 3000);
        trackEvent("rainbow_found", { source: "in_game" });
        setState((s) => ({
          ...s,
          selectedWords: [],
          gotRainbow: true,
          rainbowSolveIndex: s.solvedGroups.length,
          guessHistory: [...s.guessHistory, attempt],
        }));
        return;
      }

      if (isCorrect) {
        const groupIdx = matchedGroupIndex;
        const attempt: GuessAttempt = {
          words: [...state.selectedWords],
          groupIndices: guessGroupIndices,
          isCorrect: true,
          isRainbowAttempt: new Set(guessGroupIndices).size === 4,
          guessedAt,
        };

        vibrateSuccess();
        setLastRevealedGroup(groupIdx);
        // Hold this group's tiles in the grid until GameBoard's clone-based
        // reveal animation finishes and calls releaseRevealHold() — see
        // remainingWords above. solvedGroups/isWon/stats are unaffected by
        // this hold; it only delays when the tiles visually leave the grid.
        setRevealHoldGroupIdx(groupIdx);
        trackEvent("category_solved", { difficulty: puzzle.groups[groupIdx].difficulty });

        const newSolved = [...state.solvedGroups, groupIdx];
        const isWon = newSolved.length === 4;

        setState((s) => ({
          ...s,
          solvedGroups: newSolved,
          selectedWords: [],
          isComplete: isWon || s.mistakes >= MAX_MISTAKES,
          isWon,
          guessHistory: [...s.guessHistory, attempt],
        }));

        if (isWon) {
          // NB: the win celebration (confetti/haptic) is intentionally NOT
          // fired here. GameBoard triggers fireWinCelebration() only after the
          // final category's arrival pop completes, so nothing celebratory
          // appears while the last tiles are still flying. Scoring/stats/saving
          // below stay on the immediate win, exactly as before.
          const fullGuessHistory = [...state.guessHistory, attempt];
          const shareGrid = buildShareGrid(fullGuessHistory, puzzle);

          // The timer has already stopped at this win (see the isComplete
          // guard on the active-time effect), so this snapshot is the final
          // solve time — and the post-completion Rainbow bonus cannot extend
          // it.
          const winSnapshot = eventSnapshot({ groupsSolved: newSolved.length });

          const winStatsParams = {
            puzzleId: puzzle.id,
            won: true,
            mistakes: state.mistakes,
            activeTimeSeconds: activeSecondsRef.current,
            foundRainbow: state.gotRainbow,
            rainbowSolveIndex: state.rainbowSolveIndex,
            solveOrder: getSolveOrder(newSolved),
            hintsUsed: effectiveSmallHintUsed || effectiveFullHintUsed,
            shareGrid,
            guessHistory: toGuessEventInputs(fullGuessHistory, winSnapshot),
          };

          void commitOfficialResult(true, state.mistakes, winStatsParams);

          const allGroupIndices = puzzle.groups.map((_, i) => i);
          saveProgress(puzzle.id, {
            solvedGroups: newSolved,
            finalSolvedGroups: allGroupIndices,
            mistakes: state.mistakes,
            guessHistory: fullGuessHistory,
            gotRainbow: state.gotRainbow,
            rainbowSolveIndex: state.rainbowSolveIndex,
            shuffledWords: [],
            rainbowWords,
            isComplete: true,
            isWon: true,
            tileColors,
            smallHintUsed: effectiveSmallHintUsed,
            fullHintUsed: effectiveFullHintUsed,
            activeTimeSeconds: activeSecondsRef.current,
        gameSessionId: sessionIdRef.current,
          });
        }
      } else {
        // isOneAway / isAlmostRainbow are computed once at submission time
        // above, so the local attempt and the durable guess event can never
        // disagree about the same guess.
        const attempt: GuessAttempt = {
          words: [...state.selectedWords],
          groupIndices: guessGroupIndices,
          isCorrect: false,
          isOneAway: isOneAway && !isAlmostRainbow,
          isAlmostRainbow,
          isRainbowAttempt: new Set(guessGroupIndices).size === 4,
          guessedAt,
        };

        // Miss: now that the suspense is over, the grid "reject" shake and the
        // mistake update happen together (the outcome wasn't revealed before).
        vibrateError();
        setShaking(true);
        setTimeout(() => setShaking(false), WRONG_SHAKE_MS);

        if (isAlmostRainbow) setAlmostRainbow(true);
        else if (isOneAway) setOneAway(true);

        const newMistakes = state.mistakes + 1;
        const isLost = newMistakes >= MAX_MISTAKES;

        setState((s) => ({
          ...s,
          mistakes: newMistakes,
          isComplete: isLost,
          isWon: false,
          guessHistory: [...s.guessHistory, attempt],
        }));

        if (isLost) {
          const fullGuessHistory = [...state.guessHistory, attempt];
          const shareGrid = buildShareGrid(fullGuessHistory, puzzle);

          const lossSnapshot = eventSnapshot({ mistakes: newMistakes });

          const lossStatsParams = {
            puzzleId: puzzle.id,
            won: false,
            mistakes: newMistakes,
            activeTimeSeconds: activeSecondsRef.current,
            foundRainbow: state.gotRainbow,
            rainbowSolveIndex: state.rainbowSolveIndex,
            solveOrder: getSolveOrder(state.solvedGroups),
            hintsUsed: effectiveSmallHintUsed || effectiveFullHintUsed,
            shareGrid,
            guessHistory: toGuessEventInputs(fullGuessHistory, lossSnapshot),
          };

          void commitOfficialResult(false, newMistakes, lossStatsParams);

          const sortedIndices = puzzle.groups
            .map((g, i) => ({ idx: i, diff: g.difficulty }))
            .sort((a, b) => a.diff - b.diff)
            .map((item) => item.idx);

          const unsolvedIndices = sortedIndices.filter((idx) => !state.solvedGroups.includes(idx));
          const finalSolvedGroups = [...state.solvedGroups, ...unsolvedIndices];

          unsolvedIndices.forEach((groupIdx, i) => {
            setTimeout(() => {
              const solvedWords = puzzle.groups[groupIdx].words;
              setLastRevealedGroup(groupIdx);
              setShuffledWords((prev) => prev.filter((w) => !solvedWords.includes(w)));
              setState((s) => ({ ...s, solvedGroups: [...s.solvedGroups, groupIdx] }));

              if (i === unsolvedIndices.length - 1) {
                saveProgress(puzzle.id, {
                  solvedGroups: finalSolvedGroups,
                  finalSolvedGroups,
                  mistakes: newMistakes,
                  guessHistory: fullGuessHistory,
                  gotRainbow: state.gotRainbow,
                  rainbowSolveIndex: state.rainbowSolveIndex,
                  shuffledWords: [],
                  rainbowWords,
                  isComplete: true,
                  isWon: false,
                  tileColors,
                  smallHintUsed: effectiveSmallHintUsed,
                  fullHintUsed: effectiveFullHintUsed,
                  activeTimeSeconds: activeSecondsRef.current,
        gameSessionId: sessionIdRef.current,
                });
              }
            }, 800 + i * 1500);
          });
        }
      }
    }, totalDelay);
  }, [state, puzzle, saveResultToDb, rainbowWords, getWordGroupIndex, tileColors, smallHintUsed, fullHintUsed, recordGuess, submittedGuessCount, toGuessEventInputs, eventSnapshot, commitOfficialResult, effectiveSmallHintUsed, effectiveFullHintUsed, getSolveOrder]);

  const remainingWords = useMemo(() => {
    const solvedWords = state.solvedGroups
      .filter((i) => i !== revealHoldGroupIdx)
      .flatMap((i) => puzzle.groups[i].words);
    return shuffledWords.filter((w) => !solvedWords.includes(w));
  }, [shuffledWords, state.solvedGroups, revealHoldGroupIdx, puzzle]);

  return {
    state,
    remainingWords,
    toggleWord,
    deselectAll,
    shuffle,
    submitGuess,
    shaking,
    checkingWords,
    lastRevealedGroup,
    releaseRevealHold,
    fireWinCelebration,
    oneAway,
    setOneAway,
    almostRainbow,
    setAlmostRainbow,
    rainbowWords,
    showRainbowPopup,
    matchedWords,
    tileColors,
    setTileColor,
    clearAllColors,
    hasAnyColor,
    markRainbowFound,
    handleDragStart,
    handleDragOver,
    handleDrop,
    handleTouchDragMove,
    handleTouchDragEnd,
    alreadyGuessed,
    isOfficialAttemptRef,
    /**
     * The durable session this attempt belongs to. Exposed so GameBoard's
     * post-completion "Spot the Rainbow" bonus can attach its own writes to
     * the CORRECT session by id, instead of re-deriving one from
     * puzzle + identity — a lookup that can now match the wrong row, since a
     * puzzle+identity may legitimately have both a completed official session
     * and a later in-progress replay.
     */
    sessionIdRef,
    /**
     * The single resume-safe active-play timer for this attempt. Exposed so
     * the post-completion Rainbow bonus can stamp its guess event with the
     * same active-time basis as every other event.
     *
     * Reading it after completion yields the FINAL solve time: the timer
     * effect tears down the moment isComplete flips, so time spent in the
     * bonus round is deliberately never added to it.
     */
    activeSecondsRef,
    /**
     * The guess number the next durable guess event should use, shared with
     * the bonus Rainbow path so it participates in the same
     * (game_session_id, guess_number) idempotency key as every other guess.
     *
     * A successful bonus attempt is appended to guessHistory, so the count
     * advances on its own. A FAILED one is not (it has no share-grid row), so
     * failedBonusAttempts is added separately — without it, a player who
     * failed the bonus, refreshed and failed again would have the second
     * attempt silently discarded as a duplicate.
     */
    nextGuessNumber: (failedBonusAttempts = 0) =>
      submittedGuessCount(state.guessHistory) + failedBonusAttempts + 1,
  };
}
