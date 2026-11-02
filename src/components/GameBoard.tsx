import { miniOneAwayColor } from "@/lib/miniRules";
import { Puzzle } from "@/lib/types";
import { GameSettings } from "@/lib/settings";
import { useGame } from "@/hooks/useGame";
import { WordTile } from "./WordTile";
import { SolvedGroup } from "./SolvedGroup";
import { RainbowRevealBar } from "./RainbowRevealBar";
import { dedupeHintMarkers } from "@/lib/hints";
import { MistakeDots } from "./MistakeDots";
import { DailyStatsModal } from "./DailyStatsModal";
import { CustomStatsModal } from "./CustomStatsModal";
import { SpotTheRainbowModal } from "./SpotTheRainbowModal";
import { SillySaturdayModal } from "./SillySaturdayModal";
import { PuzzleRating } from "./PuzzleRating";
import { LuckyBot } from "./LuckyBot";
import { ResultCellKind, ResultRow } from "./ResultGrid";
import { ResultsDialog } from "./ResultsDialog";
import { SpotRainbowPrompt } from "./SpotRainbowPrompt";
import { PuzzleModeBadge } from "./PuzzleModeBadge";
import { X, TrendingUp, Eraser, MousePointer2, History, ChevronDown, RotateCcw } from "lucide-react";
import { useState, useCallback, useEffect, useLayoutEffect, useRef, useMemo } from "react";
import { flushSync } from "react-dom";
import { useImagePreload } from "@/hooks/useImagePreload";
import type { User } from "@supabase/supabase-js";
import confetti from "canvas-confetti";
import { playRainbowSound } from "@/lib/sounds";
import { fetchSavedPromptAnswer, recordBonusRainbowAttempt } from "@/lib/gameStats";
import {
  loadProgress,
  loadPromptAnswer,
  markPromptAnswerSaved,
  savePromptAnswer,
  type PromptAnswerSave,
} from "@/lib/gameProgress";
import type { EntryContext } from "@/lib/entryContext";
import { isCustomEmoji, customEmojiUrl, customEmojiName } from "@/lib/customEmoji";
import { trackEvent } from "@/lib/analytics";
import { resolveTheme } from "@/lib/themes";
import { loadPlayedDifficulties } from "@/lib/puzzleVersion";
import { buildCustomShareText, buildOfficialShareText } from "@/lib/shareText";
import { customPuzzlePath } from "@/lib/customPuzzles";
import { resolveCategoryVisual, splitCategoryVisual } from "@/lib/categoryVisual";
import { formatOf, progressStorageId, rainbowHerringFor, type CategoryColor } from "@/lib/puzzleFormat";
import { lookupFinishedGame, type RestoredGame } from "@/lib/finishedGame";
import { ownerKey, useProgressOwner, type ProgressOwner } from "@/lib/progressOwner";
import { categorySwatches } from "@/lib/categoryPalette";
import { formatActiveTime } from "@/lib/activeTimer";
import {
  gatherIntoFirstRow,
  SOLVE_EASE,
  SOLVE_GATHER_HOLD_MS,
  SOLVE_GATHER_MS,
  SOLVE_POP_MS,
  SOLVE_SETTLE_MS,
} from "@/lib/solveAnimation";

const DIFFICULTY_SQUARE: Record<number, string> = {
  1: "🟨",
  2: "🟩",
  3: "🟦",
  4: "🟥",
};

// Matches the colors used by MistakeDots — yellow, green, blue, red
const DIFFICULTY_COLOR: Record<number, string> = {
  1: "bg-yellow-400",
  2: "bg-green-500",
  3: "bg-blue-500",
  4: "bg-red-500",
};

// Maps a word's group difficulty to the ResultGrid cell color it should
// render — same yellow/green/blue/red assignment as DIFFICULTY_SQUARE/
// DIFFICULTY_COLOR above, just as ResultCellKind values instead of
// emoji/Tailwind classes.
const DIFFICULTY_RESULT_KIND: Record<number, ResultCellKind> = {
  1: "yellow",
  2: "green",
  3: "blue",
  4: "red",
};

// ── Correct-guess solve animation ──
// Three beats — gather, bar, settle — with their timings and the reasoning in
// lib/solveAnimation.ts. The celebration for the final category triggers the
// moment its settle beat finishes, so the landing and the celebration read as
// one continuous moment.
const VICTORY_HOLD_AFTER_SOLVE_MS = 0;
// Reduced-motion / fallback path: no solve animation plays, so reveal the
// victory UI shortly after the final category bar has appeared.
const VICTORY_REDUCED_MOTION_MS = 200;

interface RevealState {
  groupIdx: number;
  words: string[];
  //  pending   — just solved; the bar is mounted out of the page flow and
  //              invisible, and the board hasn't moved yet.
  //  gathering — the guessed tiles are swapping into the top row.
  //  arrived   — the bar swaps in over that row, solid in the very frame
  //              the tiles vanish, and plays the arrival pop from that
  //              frame while its text lands.
  //  settling  — the pop finishes; the row has left the grid and anything
  //              the bar didn't exactly replace glides into place.
  phase: "pending" | "gathering" | "arrived" | "settling";
}

// One queued FLIP ("first, last, invert, play") slide of the grid, applied by
// the layout effect that runs when the grid's words change.
interface GridFlip {
  before: Record<string, DOMRect>; // tile rects before the change
  ms: number;
  raise?: Set<string>; // tiles drawn above the others while they move
  gridBottom?: number; // the grid's old bottom edge, so its height glides too
}

// Arrange Tiles: one drag in progress. Positions are viewport pixels; slot
// boxes are relative to the tiles' offset parent, indexed by grid position.
interface TileDrag {
  word: string;
  x: number; // latest pointer position
  y: number;
  grabX: number; // where on the tile it was picked up
  grabY: number;
  startOrder: string[]; // the order to restore if the drag is cancelled
  slots: ({ left: number; top: number; right: number; bottom: number } | null)[];
}

// How long the other tiles take to slide aside, and the dragged tile to
// settle into its slot once released.
const DRAG_SLIDE_MS = 180;
const DRAG_SETTLE_MS = 200;

function prefersReducedMotion(): boolean {
  try {
    return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  } catch {
    return false;
  }
}

/**
 * Sends a Full game's post-game Rainbow answer and, once the server has
 * answered (saved it, or refused it because the game already has one),
 * stops remembering it as pending. A save that fails, or never finishes
 * because the page closed, stays pending and is sent again on the next
 * visit; the server stores a repeat of the same submission once.
 */
async function deliverPromptAnswer(storageId: string, save: PromptAnswerSave) {
  const result = await recordBonusRainbowAttempt(save);
  if (result !== "failed") markPromptAnswerSaved(storageId);
}

// The results popup's one-word message: won or lost, and how many mistakes.
// Same on every format and mode. Docs: docs/RESULTS-COPY.md.
function getResultHeadline(isWon: boolean, mistakes: number): string {
  if (isWon && mistakes === 0) return "Perfect!";
  if (isWon && mistakes === 1) return "Excellent!";
  if (isWon && mistakes === 2) return "Nice!";
  if (isWon && mistakes === 3) return "Clutch!";
  return "Onward!";
}

// A lost game's last category bar plays its 0.3s entrance (group-appear)
// before the board counts as settled; a little longer so it has fully landed.
const LOSS_SETTLE_MS = 350;
// The emptied Rainbow/instruction space folds away over this long once the
// game ends without the Rainbow found (index.css .rainbow-slot-fold); the
// results popup opens after it, so the board has stopped moving first.
const SLOT_FOLD_MS = 320;

type PaletteMode = "select" | CategoryColor | "eraser";

// The board instruction reads as prose, so the count is spelled out. Falls
// back to the digit for any size not listed, rather than printing nothing.
const SELECTION_COUNT_WORD: Record<number, string> = { 3: "three", 4: "four" };

interface GameBoardProps {
  puzzle: Puzzle;
  settings?: GameSettings;
  user?: User | null;
  clearColorsTrigger?: number;
  isArchive?: boolean;
  // "dailyHomepage" is an explicit, dedicated signal for the redesigned daily
  // homepage layout — deliberately separate from `isArchive` so it can never
  // be conflated with "is this an archive page" for FreePuzzle or any future
  // route.
  variant?: "default" | "dailyHomepage";
  // Opts into the SAME desktop board width/tile geometry as variant
  // "dailyHomepage" (see useWideBoard below), without setting
  // isDailyHomepage itself — so a context that isn't literally the daily
  // homepage (e.g. ArchivePuzzle) can render an identically-sized board on
  // desktop while staying distinct from `isDailyHomepage`/`isArchive`. Purely
  // a container/geometry flag; carries no other behavior.
  wideBoard?: boolean;
  smallHintUsed?: boolean;
  fullHintUsed?: boolean;
  onHintClick?: () => void;
  onComplete?: () => void;
  // Fires whenever hints flip into/out of view-only mode (puzzle fully resolved).
  onHintsViewOnlyChange?: (viewOnly: boolean) => void;
  // Whether to show the RAINBOW / 4 GROUPS PuzzleModeBadge above the board.
  // Defaults to true so every current call site keeps rendering it exactly
  // as before; pass false for contexts that shouldn't show it (e.g. a future
  // Daily homepage that opts out) without touching this component further.
  showModeBadge?: boolean;
  // How the player reached this game (see lib/entryContext.ts). Recorded
  // once on the durable session at creation. Describes the ROUTE taken, not
  // any attribute of the puzzle itself. Defaults to the Daily home route,
  // which is the only call site that does not pass one.
  entryContext?: EntryContext;
  /**
   * The one explicit playtest-mode signal (see useGame's `mode` option doc).
   * Reroutes gameplay persistence to the beta-only tracking system and turns
   * off every official-only side effect this board would otherwise trigger:
   * the Rainbow bonus's durable write, Global Stats, and puzzle ratings.
   * Defaults to false so every existing call site is unaffected.
   */
  betaMode?: boolean;
  /**
   * The public-custom-puzzle sibling of betaMode (see useGame's `mode` doc).
   * Reroutes persistence to the localStorage-only + one-result-row custom
   * system (lib/customPuzzles.ts) and turns off the same official-only side
   * effects betaMode does (streak banner, PuzzleRating, official Global
   * Stats) — plus swaps the post-game stats button/modal for the
   * custom-puzzle-only CustomStatsModal instead of hiding it outright.
   * Defaults to false so every existing call site is unaffected.
   */
  customMode?: boolean;
  /**
   * Custom mode only. The page owns the stats modal so its header Stats button
   * can open it at any time (before, during and after play); when omitted the
   * board falls back to its own local state.
   */
  statsOpen?: boolean;
  onStatsOpenChange?: (open: boolean) => void;
  /** Custom mode only. Called by the post-completion Replay button. */
  onReplay?: () => void;
}

function GameBoardView({ puzzle, settings, user = null, clearColorsTrigger = 0, isArchive = false, variant = "default", wideBoard = false, smallHintUsed = false, fullHintUsed = false, onHintClick, onComplete, onHintsViewOnlyChange, showModeBadge = true, entryContext = "daily_home", betaMode = false, customMode = false, statsOpen: statsOpenProp, onStatsOpenChange, onReplay, owner, restored }: GameBoardProps & {
  owner: ProgressOwner | null;
  restored: RestoredGame | null;
}) {
  const isDailyHomepage = variant === "dailyHomepage";
  // Drives the board's own desktop width/tile-gap classes below — true for
  // the daily homepage itself, or any other context that explicitly opted
  // into matching its geometry via `wideBoard` (e.g. ArchivePuzzle). Kept
  // separate from `isDailyHomepage` so nothing else keyed on "is this
  // literally the daily homepage" changes for those other contexts.
  const useWideBoard = isDailyHomepage || wideBoard;
  const showRainbow = settings?.showRainbowColors ?? true;
  const arrangeTiles = settings?.arrangeTiles ?? false;
  const colorCodeTiles = settings?.colorCodeTiles ?? false;
  const colorPaletteMode = settings?.colorPaletteMode ?? false;

  // Declared before useGame: whether the Rainbow bonus result is known feeds
  // the hook's "puzzle fully resolved" (view-only hints) decision.
  const [bonusRainbowCorrect, setBonusRainbowCorrect] = useState<boolean | null>(null);

  // Preload custom emoji images so they don't pop in after the board renders.
  //
  // Resolved from the PUZZLE rather than from useGame's `rainbowHerring`
  // below, even though the two are the same value (both come from
  // rainbowHerringFor) — the preload gate has to be known BEFORE useGame
  // runs, because it is what tells the active-play timer whether the
  // playable board is actually on screen yet.
  const imagesToPreload = useMemo(() => {
    const words = [
      ...puzzle.groups.flatMap((g) => g.words),
      ...(rainbowHerringFor(puzzle) ?? []),
    ];
    return words.filter(isCustomEmoji).map((w) => customEmojiUrl(w));
  }, [puzzle]);
  const imagesReady = useImagePreload(imagesToPreload);

  const {
    format,
    rainbowHerring,
    storageId,
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
    setWordOrder,
    fireWinCelebration,
    rainbowWords,
    showRainbowPopup,
    matchedWords,
    tileColors,
    setTileColor,
    clearAllColors,
    hasAnyColor,
    smallHintVisible,
    fullHintVisible,
    hintsViewOnly,
    markRainbowFound,
    handleDragStart,
    handleDragOver,
    handleDrop,
    alreadyGuessed,
    isOfficialAttemptRef,
    officialAttempt,
    sessionIdRef,
    activeSecondsRef,
    activeSeconds,
    nextGuessNumber,
  } = useGame(puzzle, {
    isArchive,
    smallHintUsed,
    fullHintUsed,
    rainbowResolved: bonusRainbowCorrect !== null,
    entryContext,
    mode: customMode ? "custom" : betaMode ? "beta" : "official",
    // The timer starts when the board is genuinely on screen, not while the
    // preload spinner is up — a slow image load is not solving time.
    boardReady: imagesReady,
    owner,
    restored,
  });

  // ── One post-game Rainbow answer per Full game ──
  // The answer is remembered at Submit (savePromptAnswer) and restored here
  // before the first paint, so a refresh or a later visit shows the outcome
  // instead of the prompt: a wrong answer shows the revealed Rainbow, exactly
  // as it did in the visit it was given, and a right one shows the find. The
  // database refuses a second answer too (record_bonus_rainbow, migration
  // 20260928000000), so a stale page cannot add one. Mini keeps its own,
  // original prompt behaviour for now.
  const oneAnswerPrompt = format.id === "full";
  const promptAnsweredRef = useRef(false);
  // A wrong answer restored from storage shows its Rainbow straight away,
  // without replaying the reveal animation it already had.
  const restoredWrongAnswerRef = useRef(false);
  const promptRestoredForRef = useRef<string | null>(null);
  // True while asking the server whether a reopened, finished game already
  // used its prompt; the prompt stays hidden until the answer arrives.
  const [promptCheckPending, setPromptCheckPending] = useState(false);
  useLayoutEffect(() => {
    if (promptRestoredForRef.current === storageId) return;
    promptRestoredForRef.current = storageId;
    promptAnsweredRef.current = false;
    // A game restored from the server: its own record says whether the
    // post-game question was answered (a right answer is already on the
    // board as a found Rainbow). Answered wrong shows the revealed Rainbow,
    // exactly as reopening it on the device it was answered on does.
    const restoredAnsweredWrong = !!restored && restored.bonusRainbowAttempted && !state.gotRainbow;
    if (!oneAnswerPrompt) {
      if (restoredAnsweredWrong && bonusRainbowCorrect === null) {
        restoredWrongAnswerRef.current = true;
        setBonusRainbowCorrect(false);
      }
      return;
    }
    const answer = loadPromptAnswer(storageId);
    if (!answer && restored) {
      if (restored.bonusRainbowAttempted) promptAnsweredRef.current = true;
      if (restoredAnsweredWrong) {
        restoredWrongAnswerRef.current = true;
        setBonusRainbowCorrect(false);
      }
      return;
    }
    if (!answer) {
      // A game finished before this visit, with no answer remembered here,
      // may have been answered by an older version of the app, which kept no
      // record of it in the browser. Ask the server before offering the
      // prompt; the server refuses a second answer, so offering it would let
      // the board celebrate a find that is never counted.
      if (state.isComplete && !state.gotRainbow && rainbowHerring && !betaMode && !customMode) {
        setPromptCheckPending(true);
        void fetchSavedPromptAnswer(puzzle.id).then((saved) => {
          if (saved?.answered) {
            promptAnsweredRef.current = true;
            const guessedAt = new Date().toISOString();
            savePromptAnswer(storageId, { correct: saved.found, words: [], guessedAt, pendingSave: null });
            if (saved.found) {
              markRainbowFound(rainbowHerring, guessedAt);
            } else {
              restoredWrongAnswerRef.current = true;
              setBonusRainbowCorrect(false);
            }
          }
          setPromptCheckPending(false);
        });
      }
      return;
    }
    promptAnsweredRef.current = true;
    if (answer.correct) {
      // Refreshed in the moment between Submit and the find reaching the
      // board: finish recording it, once, with its original time.
      if (!state.gotRainbow && rainbowHerring) markRainbowFound(rainbowHerring, answer.guessedAt);
    } else if (bonusRainbowCorrect === null) {
      restoredWrongAnswerRef.current = true;
      setBonusRainbowCorrect(false);
    }
  }, [storageId, oneAnswerPrompt, state.isComplete, state.gotRainbow, rainbowHerring, markRainbowFound, bonusRainbowCorrect, betaMode, customMode, puzzle.id, restored]);

  // An answer whose save never got through on an earlier visit (the page
  // closed during the reveal or while the request was in flight) is sent
  // again when the game is opened. Once per opened game; the one-answer rule
  // above only hides the prompt, it never stops this delivery.
  useEffect(() => {
    if (!oneAnswerPrompt) return;
    const pending = loadPromptAnswer(storageId)?.pendingSave;
    if (pending) void deliverPromptAnswer(storageId, pending);
  }, [storageId, oneAnswerPrompt]);

  // Mini's tile grid, solved bars and Rainbow reveal bar are capped to a
  // compact, near-square-tile width regardless of useWideBoard — a Mini is
  // a quick 3x3, not a scaled-down Full, so it never grows into the same
  // desktop board width a Full/wideBoard context gets. Nothing else reads
  // this: the surrounding page container, the instruction line and the
  // Shuffle/Deselect/Submit controls keep whatever width useWideBoard
  // already gave them, so those controls stay their current comfortable
  // width instead of shrinking down with the board.
  const isMiniBoard = format.id === "mini";

  const [historyExpanded, setHistoryExpanded] = useState(true);
  const incorrectGuesses = useMemo(
    () => state.guessHistory.filter((a) => !a.isCorrect && !a.isRainbow && !a.isHintMarker),
    [state.guessHistory],
  );

  // Visual theme for the bonus category (gradient/emoji/copy). Defaults to the
  // classic rainbow when the puzzle has no theme set.
  // The board's own category count makes the bonus share row as wide as the
  // board — four 🌈 on a Full, three on a Mini.
  const theme = useMemo(
    () => resolveTheme(puzzle.theme, format.categoryCount),
    [puzzle.theme, format.categoryCount]
  );

  // The solved category bars, in solve order. The Rainbow is never one of
  // them: it has its own reserved slot above the board (rainbowSlot), so
  // finding it never adds a row here.
  const boardSlots = useMemo(
    () => state.solvedGroups.map((groupIdx) => ({ kind: "group" as const, groupIdx })),
    [state.solvedGroups],
  );

  // Shared "checking guess" suspense: which tiles are animating, and their
  // stagger order (by grid position, so the bounce reads as a left-to-right
  // wave). Both correct and incorrect guesses use this before branching.
  const isChecking = checkingWords.length > 0;
  const checkingStagger = useMemo(() => {
    const order: Record<string, number> = {};
    if (checkingWords.length > 0) {
      let n = 0;
      remainingWords.forEach((w) => {
        if (checkingWords.includes(w)) order[w] = n++;
      });
    }
    return order;
  }, [remainingWords, checkingWords]);

  // ── Correct-guess solve animation (see lib/solveAnimation.ts) ──
  // The guessed tiles stay in the grid the whole time (useGame holds them via
  // revealHoldGroupIdx until releaseRevealHold()), so every movement is the
  // REAL tiles moving — no stand-in copies — and the solved bar appears
  // exactly where it ends up:
  //   gather: the guessed tiles swap into the top row (FLIP slide).
  //   bar:    the solved bar, mounted out of the page flow at its final spot,
  //           fades in over that row while the tiles fade out beneath it.
  //   settle: the hold is released, the bar joins the page flow in the same
  //           spot, and the remaining tiles and the page below slide up.
  const wordTileRefs = useRef<Record<string, HTMLElement | null>>({});
  const gridWrapperRef = useRef<HTMLDivElement | null>(null);
  const prevRevealedGroupRef = useRef<number | null>(null);
  const revealTimersRef = useRef<ReturnType<typeof setTimeout>[]>([]);
  // Groups that have gone through (or are going through) the solve
  // animation. Their bar fades in via the `reveal` prop, so it must NOT also
  // get the normal animate-group-appear entrance once the reveal clears.
  const animatedRevealGroupsRef = useRef<Set<number>>(new Set());
  // The next grid slide to play (see GridFlip), consumed by the FLIP effect.
  const gridFlipRef = useRef<GridFlip | null>(null);
  const [reveal, setReveal] = useState<RevealState | null>(null);

  // ── Victory celebration gating ──────────────────────────────────────────
  // The results/share UI + confetti stay hidden until the FINAL category's
  // arrival pop has completely finished. This is a distinct visual signal from
  // the logical won state (state.isWon), which still flips the instant the 4th
  // group is solved — scoring/stats/saving are unchanged. Initialized true only
  // when the puzzle is ALREADY complete+won on mount, so a saved finished
  // puzzle shows its results immediately without waiting on an animation that
  // isn't playing.
  const [victoryRevealReady, setVictoryRevealReady] = useState<boolean>(
    () => state.isComplete && state.isWon,
  );
  // Latest-value mirror of state.isWon, updated during render so it's already
  // current before any layout effect or timer runs in the same commit. Reading
  // this at the moment a decision is made (e.g. when the arrival-pop timer
  // fires) is guaranteed non-stale: isWon only ever goes false→true and never
  // back, and the reveal machinery locks input so a later solve can't sneak in.
  const isWonRef = useRef(state.isWon);
  isWonRef.current = state.isWon;
  const victoryTimersRef = useRef<ReturnType<typeof setTimeout>[]>([]);
  const clearVictoryTimers = useCallback(() => {
    victoryTimersRef.current.forEach(clearTimeout);
    victoryTimersRef.current = [];
  }, []);
  // Reveal the victory UI after `delayMs`. `withCelebration` fires the confetti
  // + haptic — passed only for a live win, never for an already-completed load.
  const revealVictory = useCallback(
    (withCelebration: boolean, delayMs: number) => {
      clearVictoryTimers();
      const t = setTimeout(() => {
        setVictoryRevealReady(true);
        if (withCelebration) fireWinCelebration();
      }, delayMs);
      victoryTimersRef.current.push(t);
    },
    [clearVictoryTimers, fireWinCelebration],
  );

  const clearRevealTimers = useCallback(() => {
    revealTimersRef.current.forEach(clearTimeout);
    revealTimersRef.current = [];
  }, []);

  // Kick off the solve animation once a guess is confirmed correct
  // (lastRevealedGroup changes) and useGame is holding its tiles in the grid.
  useLayoutEffect(() => {
    if (lastRevealedGroup === null || lastRevealedGroup === prevRevealedGroupRef.current) return;
    prevRevealedGroupRef.current = lastRevealedGroup;
    const groupIdx = lastRevealedGroup;

    if (prefersReducedMotion()) {
      releaseRevealHold();
      // No animation to wait on — if this solve won the game, reveal the
      // victory UI right after the final bar appears.
      if (isWonRef.current) revealVictory(true, VICTORY_REDUCED_MOTION_MS);
      return;
    }

    const words = puzzle.groups[groupIdx]?.words ?? [];
    if (words.length !== format.answersPerCategory || !words.every((w) => wordTileRefs.current[w])) {
      // The tiles aren't on the board (e.g. the loss cascade, which removes
      // them itself) — nothing to animate, so just reveal plainly.
      releaseRevealHold();
      if (isWonRef.current) revealVictory(true, VICTORY_REDUCED_MOTION_MS);
      return;
    }

    animatedRevealGroupsRef.current.add(groupIdx);
    clearRevealTimers();
    // "pending" takes the just-mounted bar back out of the page flow before
    // the browser paints, so the board never jumps down to make room for it.
    setReveal({ groupIdx, words: [...words], phase: "pending" });
  }, [lastRevealedGroup, puzzle, format.answersPerCategory, releaseRevealHold, clearRevealTimers, revealVictory]);

  // With the board back where the player last saw it, run the three beats.
  useLayoutEffect(() => {
    if (!reveal || reveal.phase !== "pending") return;
    const thisGroup = reveal.groupIdx;
    const groupWords = new Set(reveal.words);
    const measure = (words: string[]) => {
      const rects: Record<string, DOMRect> = {};
      words.forEach((w) => {
        const el = wordTileRefs.current[w];
        if (el) rects[w] = el.getBoundingClientRect();
      });
      return rects;
    };
    const setPhase = (phase: RevealState["phase"] | null) =>
      setReveal((r) => (r && r.groupIdx === thisGroup ? (phase ? { ...r, phase } : null) : r));

    // Beat 1 — gather. Only the tiles that have to swap move; if the category
    // is already the top row there is nothing to gather and the bar comes in
    // straight away.
    const gathered = gatherIntoFirstRow(remainingWords, reveal.words, format.columns);
    const gathers = gathered.some((w, i) => w !== remainingWords[i]);
    if (gathers) {
      gridFlipRef.current = { before: measure(remainingWords), ms: SOLVE_GATHER_MS, raise: groupWords };
      setWordOrder(gathered);
    }
    setPhase("gathering");

    // The swap comes once the gathered row is complete and has held a beat.
    const barAt = gathers ? SOLVE_GATHER_MS + SOLVE_GATHER_HOLD_MS : 0;
    revealTimersRef.current = [
      // Beat 2 — swap + pop: the bar replaces the gathered row in one frame,
      // solid, floating over the (now hidden) row, and starts its arrival pop
      // on that same frame, its text landing during the pop.
      setTimeout(() => setPhase("arrived"), barAt),
      // Beat 3 — settle, once the pop has finished: release the hold (the row
      // leaves the grid) and put the bar into the page flow in the same spot,
      // in one render. Deliberately NOT during the pop: removing the row is a
      // React render plus layout measuring, and doing it mid-pop stalled
      // frames (~90ms measured) so the card froze and then jumped. The bar
      // is the row's exact size, so waiting costs nothing visible; anything
      // it didn't exactly replace glides into place from here on its own.
      //
      // This is also the moment the FINAL category has fully landed: if the
      // game is won, un-gate the celebration now so confetti, sound,
      // haptics, streak and results all start together. isWonRef is read at
      // fire time, so it can't be stale, and input is locked during the
      // reveal, so a non-final group's timer can never see a later win.
      setTimeout(() => {
        gridFlipRef.current = {
          before: measure(Object.keys(wordTileRefs.current).filter((w) => !groupWords.has(w))),
          ms: SOLVE_SETTLE_MS,
          gridBottom: gridWrapperRef.current?.getBoundingClientRect().bottom,
        };
        releaseRevealHold();
        setPhase(null);
        if (isWonRef.current) revealVictory(true, VICTORY_HOLD_AFTER_SOLVE_MS);
      }, barAt + SOLVE_POP_MS),
    ];
  }, [reveal, remainingWords, format.columns, setWordOrder, releaseRevealHold, revealVictory]);

  // Grid FLIP: when the grid's words change for a queued slide (the gather
  // swap, or the settle after the row leaves), start each moved tile at its
  // old spot and let it glide to its new one — and, for the settle, let the
  // grid's own height glide too, so the controls below follow smoothly
  // instead of jumping up.
  useLayoutEffect(() => {
    const flip = gridFlipRef.current;
    if (!flip) return;
    gridFlipRef.current = null;
    const { before, ms, raise, gridBottom } = flip;
    const transition = `transform ${ms}ms ${SOLVE_EASE}`;

    Object.keys(before).forEach((w) => {
      const el = wordTileRefs.current[w];
      if (!el) return;
      const after = el.getBoundingClientRect();
      const dx = before[w].left - after.left;
      const dy = before[w].top - after.top;
      if (Math.abs(dx) < 0.5 && Math.abs(dy) < 0.5) return;

      // Invert: put the tile back at its OLD spot, commit that, then play.
      el.style.transition = "none";
      el.style.transform = `translate(${dx}px, ${dy}px)`;
      if (raise?.has(w)) el.style.zIndex = "2";
      void el.offsetWidth;
      el.style.transition = transition;
      el.style.transform = "";
      window.setTimeout(() => {
        // Clear inline styles so nothing lingers on the tile afterward.
        if (el.style.transition === transition) el.style.transition = "";
        el.style.zIndex = "";
      }, ms + 60);
    });

    const grid = gridWrapperRef.current;
    if (grid && gridBottom !== undefined) {
      const rect = grid.getBoundingClientRect();
      const from = gridBottom - rect.top; // the height that keeps the old bottom edge
      if (from > 0 && Math.abs(from - rect.height) >= 0.5) {
        const heightTransition = `height ${ms}ms ${SOLVE_EASE}`;
        grid.style.transition = "none";
        grid.style.height = `${from}px`;
        void grid.offsetWidth;
        grid.style.transition = heightTransition;
        grid.style.height = `${rect.height}px`;
        window.setTimeout(() => {
          if (grid.style.transition === heightTransition) {
            grid.style.transition = "";
            grid.style.height = "";
          }
        }, ms + 60);
      }
    }
  }, [remainingWords]);

  // ── Arrange Tiles drag ──
  // The dragged tile itself lifts and follows the pointer (an inline
  // translate on its wrapper, measured from its CURRENT grid slot), so the
  // slot it belongs in is simply left empty — that empty slot is the gap.
  // Where the tile goes is decided exactly as before: hovering another
  // tile's slot hands that tile to useGame's handleDragOver, which moves the
  // dragged word to that index and shifts the words between. Everything
  // that moves because of that glides (FLIP) rather than jumping.
  // Release settles the tile into its slot; a cancel puts the board back in
  // the order it had when the drag began, then settles the same way.
  const dragRef = useRef<TileDrag | null>(null);
  const dragSlideBeforeRef = useRef<Record<string, DOMRect> | null>(null);
  const settleRef = useRef<{ el: HTMLElement; timer: ReturnType<typeof setTimeout> } | null>(null);
  const slideTokensRef = useRef(new WeakMap<HTMLElement, number>());
  const [liftedWord, setLiftedWord] = useState<string | null>(null);
  // Latest values for the drag callbacks, which stay stable so the tiles
  // don't re-render on every move.
  const remainingWordsRef = useRef(remainingWords);
  remainingWordsRef.current = remainingWords;
  const dragActionsRef = useRef({ handleDragStart, handleDragOver, handleDrop, setWordOrder });
  dragActionsRef.current = { handleDragStart, handleDragOver, handleDrop, setWordOrder };

  // A tile's wrapper element. Falls back to the DOM because wordTileRefs is
  // emptied by the per-puzzle reset effect just after mount and only refills
  // on the next render — so a drag straight after the board appears would
  // otherwise find no tile.
  const tileEl = useCallback((word: string): HTMLElement | null => {
    return wordTileRefs.current[word]
      ?? gridWrapperRef.current?.querySelector<HTMLElement>(`[data-word="${CSS.escape(word)}"]`)
      ?? null;
  }, []);

  // Keeps the lifted tile under the pointer, relative to wherever its slot
  // is right now.
  const placeLiftedTile = useCallback(() => {
    const drag = dragRef.current;
    const el = drag && tileEl(drag.word);
    const parent = el?.offsetParent as HTMLElement | null | undefined;
    if (!drag || !el || !parent) return;
    const p = parent.getBoundingClientRect();
    const slotLeft = p.left + parent.clientLeft + el.offsetLeft;
    const slotTop = p.top + parent.clientTop + el.offsetTop;
    el.style.transform = `translate(${drag.x - drag.grabX - slotLeft}px, ${drag.y - drag.grabY - slotTop}px)`;
  }, [tileEl]);

  // Where every tile but the dragged one is on screen right now (mid-glide
  // included), for the slide after the order changes.
  const measureOtherTiles = useCallback((dragged: string) => {
    const rects: Record<string, DOMRect> = {};
    if (prefersReducedMotion()) return rects;
    remainingWordsRef.current.forEach((w) => {
      const el = tileEl(w);
      if (w !== dragged && el) rects[w] = el.getBoundingClientRect();
    });
    return rects;
  }, [tileEl]);

  // Ends a settle early (a new drag started) or on schedule.
  const finishSettle = useCallback(() => {
    const settle = settleRef.current;
    if (!settle) return;
    settleRef.current = null;
    clearTimeout(settle.timer);
    settle.el.style.transition = "";
    settle.el.style.transform = "";
    settle.el.style.zIndex = "";
  }, []);

  const settleLiftedTile = useCallback((word: string) => {
    const el = tileEl(word);
    setLiftedWord(null);
    if (!el) return;
    if (prefersReducedMotion()) {
      el.style.transition = "";
      el.style.transform = "";
      el.style.zIndex = "";
      return;
    }
    el.style.transition = `transform ${DRAG_SETTLE_MS}ms ${SOLVE_EASE}`;
    el.style.transform = "";
    settleRef.current = { el, timer: setTimeout(finishSettle, DRAG_SETTLE_MS + 40) };
  }, [finishSettle, tileEl]);

  const handleTileDragStart = useCallback((word: string, x: number, y: number) => {
    finishSettle();
    const el = tileEl(word);
    if (!el) return;
    const order = [...remainingWordsRef.current];
    // Every slot's box, by grid index, relative to the tiles' offset parent.
    // Layout boxes (offset*), not on-screen ones, so a tile still gliding
    // can't make its slot read as somewhere else.
    const slots = order.map((w) => {
      const t = tileEl(w);
      return t ? { left: t.offsetLeft, top: t.offsetTop, right: t.offsetLeft + t.offsetWidth, bottom: t.offsetTop + t.offsetHeight } : null;
    });
    const rect = el.getBoundingClientRect();
    dragRef.current = { word, x, y, grabX: x - rect.left, grabY: y - rect.top, startOrder: order, slots };
    el.style.transition = "none";
    el.style.zIndex = "30";
    placeLiftedTile();
    flushSync(() => {
      dragActionsRef.current.handleDragStart(word);
      setLiftedWord(word);
    });
  }, [finishSettle, placeLiftedTile, tileEl]);

  const handleTileDragMove = useCallback((x: number, y: number) => {
    const drag = dragRef.current;
    if (!drag) return;
    drag.x = x;
    drag.y = y;
    const el = tileEl(drag.word);
    const parent = el?.offsetParent as HTMLElement | null | undefined;
    if (parent) {
      const p = parent.getBoundingClientRect();
      const px = x - p.left - parent.clientLeft;
      const py = y - p.top - parent.clientTop;
      const index = drag.slots.findIndex((s) => s && px >= s.left && px < s.right && py >= s.top && py < s.bottom);
      const target = index >= 0 ? remainingWordsRef.current[index] : undefined;
      if (target && target !== drag.word) {
        dragSlideBeforeRef.current = measureOtherTiles(drag.word);
        // Committed synchronously so the next move already sees the new order.
        flushSync(() => dragActionsRef.current.handleDragOver(target));
      }
    }
    placeLiftedTile();
  }, [measureOtherTiles, placeLiftedTile, tileEl]);

  const handleTileDragEnd = useCallback(() => {
    const drag = dragRef.current;
    if (!drag) return;
    dragRef.current = null;
    dragActionsRef.current.handleDrop();
    settleLiftedTile(drag.word);
  }, [settleLiftedTile]);

  const handleTileDragCancel = useCallback(() => {
    const drag = dragRef.current;
    if (!drag) return;
    const current = remainingWordsRef.current;
    if (current.length !== drag.startOrder.length || current.some((w, i) => w !== drag.startOrder[i])) {
      dragSlideBeforeRef.current = measureOtherTiles(drag.word);
      flushSync(() => dragActionsRef.current.setWordOrder(drag.startOrder));
    }
    dragRef.current = null;
    dragActionsRef.current.handleDrop();
    settleLiftedTile(drag.word);
  }, [measureOtherTiles, settleLiftedTile]);

  // The slide for a drag's reorder: every other tile glides from where it
  // was on screen to its new slot, and the lifted tile is re-anchored to its
  // own new slot so it stays under the pointer.
  useLayoutEffect(() => {
    const before = dragSlideBeforeRef.current;
    if (!before) return;
    dragSlideBeforeRef.current = null;
    const moved = Object.keys(before)
      .map((w) => ({ w, el: tileEl(w) }))
      .filter((m): m is { w: string; el: HTMLElement } => !!m.el);
    // Drop any glide still in flight first, so the reading below is the new
    // slot itself rather than part-way along the old glide.
    moved.forEach(({ el }) => {
      if (!el.style.transform) return;
      el.style.transition = "none";
      el.style.transform = "";
    });
    const transition = `transform ${DRAG_SLIDE_MS}ms ${SOLVE_EASE}`;
    const playing: HTMLElement[] = [];
    moved.forEach(({ w, el }) => {
      const after = el.getBoundingClientRect();
      const dx = before[w].left - after.left;
      const dy = before[w].top - after.top;
      if (Math.abs(dx) < 0.5 && Math.abs(dy) < 0.5) return;
      el.style.transform = `translate(${dx}px, ${dy}px)`;
      playing.push(el);
    });
    placeLiftedTile();
    if (playing.length === 0) return;
    void gridWrapperRef.current?.offsetWidth;
    playing.forEach((el) => {
      const token = (slideTokensRef.current.get(el) ?? 0) + 1;
      slideTokensRef.current.set(el, token);
      el.style.transition = transition;
      el.style.transform = "";
      setTimeout(() => {
        if (slideTokensRef.current.get(el) === token) el.style.transition = "";
      }, DRAG_SLIDE_MS + 40);
    });
  }, [remainingWords, placeLiftedTile, tileEl]);

  // If the board locks mid-drag (a guess submitted with another finger),
  // let go of the tile where it is so it can't fight the solve animation.
  const tilesLocked = state.isComplete || matchedWords.length > 0 || reveal !== null || isChecking;
  useEffect(() => {
    if (!tilesLocked || !dragRef.current) return;
    const { word } = dragRef.current;
    dragRef.current = null;
    handleDrop();
    const el = tileEl(word);
    if (el) {
      el.style.transition = "";
      el.style.transform = "";
      el.style.zIndex = "";
    }
    setLiftedWord(null);
  }, [tilesLocked, handleDrop, tileEl]);

  useEffect(() => clearRevealTimers, [clearRevealTimers]);
  useEffect(() => clearVictoryTimers, [clearVictoryTimers]);

  // If this GameBoard instance is reused for a different puzzle (e.g. archive
  // browsing without a remount), drop any in-flight reveal rather than risk
  // it referencing stale words/groups from the previous puzzle. Not on the
  // first mount: there is nothing to drop, and un-revealing a restored
  // finished game for a moment would briefly unfold its board.
  const resetPuzzleIdRef = useRef(puzzle.id);
  useEffect(() => {
    if (resetPuzzleIdRef.current === puzzle.id) return;
    resetPuzzleIdRef.current = puzzle.id;
    clearRevealTimers();
    clearVictoryTimers();
    setReveal(null);
    setVictoryRevealReady(false);
    wordTileRefs.current = {};
    gridFlipRef.current = null;
    prevRevealedGroupRef.current = null;
    animatedRevealGroupsRef.current = new Set();
  }, [puzzle.id, clearRevealTimers, clearVictoryTimers]);

  // Safety net for a RESTORED completed+won puzzle. victoryRevealReady's
  // initializer runs only once at mount; if the saved state hydrates afterward
  // (so it captured false) the results would otherwise stay gated forever. Once
  // such a game is complete+won, reveal immediately — there's no animation to
  // wait for. This is fenced off from a LIVE win: a live final solve always
  // drives the reveal sequence, which sets lastRevealedGroup and mounts
  // `reveal`; a pure restore does neither, so those two being null/absent is
  // exactly what marks a restored game. No celebration fires here — the player
  // already saw the confetti when they originally won.
  useEffect(() => {
    if (
      state.isComplete &&
      state.isWon &&
      !victoryRevealReady &&
      lastRevealedGroup === null &&
      reveal === null
    ) {
      setVictoryRevealReady(true);
    }
  }, [state.isComplete, state.isWon, victoryRevealReady, lastRevealedGroup, reveal]);

  // Track if puzzle was already complete when component first mounted
  // Used to hide redundant UI (dots, headline) when viewing a completed puzzle
  const wasAlreadyComplete = useRef(state.isComplete);

  useEffect(() => {
    trackEvent("puzzle_started", { puzzle_id: puzzle.id, is_archive: isArchive });
  }, [puzzle.id, isArchive]);

  const [paletteMode, setPaletteMode] = useState<PaletteMode>("select");

  useEffect(() => {
    if (clearColorsTrigger > 0) clearAllColors();
  }, [clearColorsTrigger]);

  // Reset palette mode when Color Palette Mode is turned off
  useEffect(() => {
    if (!colorPaletteMode) {
      setPaletteMode("select");
    }
  }, [colorPaletteMode]);

  const [copied, setCopied] = useState(false);
  const [localStatsOpen, setLocalStatsOpen] = useState(false);
  const showGlobalStats = statsOpenProp ?? localStatsOpen;
  const setShowGlobalStats = onStatsOpenChange ?? setLocalStatsOpen;
  const [showSpotModal, setShowSpotModal] = useState(false);
  // How many bonus "Spot the Rainbow" attempts have FAILED this mount.
  // A failed attempt is not appended to guessHistory (it has no share-grid
  // row), so it has to advance the durable guess numbering itself — see
  // handleSpotResult below.
  const failedBonusAttemptsRef = useRef(0);
  const [rainbowVisible, setRainbowVisible] = useState(state.gotRainbow);
  const [spotShaking, setSpotShaking] = useState(false);
  const [bonusRainbowWords, setBonusRainbowWords] = useState<string[]>([]);
  const [hintVisible, setHintVisible] = useState(true);

  const prevIsComplete = useRef(false);
  const prevGotRainbow = useRef(state.gotRainbow);

  // ── The results popup and the flame streak pill ──
  // The game ended in THIS visit: a solve or the loss cascade revealed a bar
  // here. A game restored already finished never sets lastRevealedGroup, so
  // it never opens the popup by itself or replays the streak — nor does a
  // game read back from the server.
  const finishedThisVisit = state.isComplete && lastRevealedGroup !== null && !restored;
  // The flame pill belongs to the Daily streak. Archive never updates it, and
  // Beta and custom play never touch official stats at all, so none of them
  // shows it — reading the player's real streak there would present it as
  // something this game changed.
  const isDailyStreakGame = !isArchive && !betaMode && !customMode;
  // A streak day newly earned: this visit's win, saved as THE official result
  // (the server's answer, so a replay never qualifies), on a Daily. Only then
  // does the flame count up — once; reopening shows it still.
  const streakNewlyEarned = finishedThisVisit && state.isWon && isDailyStreakGame && officialAttempt === true;
  const streakAnimatedRef = useRef(false);
  const handleStreakAnimated = useCallback(() => {
    streakAnimatedRef.current = true;
  }, []);
  const [resultsOpen, setResultsOpen] = useState(false);
  // A finished game read back from the server with its outcome only (see
  // lib/finishedGame.ts): what the record says, and nothing more.
  const restoredSummary = restored?.detail === "summary";
  const restoredFacts = restoredSummary
    ? [
        rainbowHerring ? (state.gotRainbow ? "Rainbow found" : "Rainbow not found") : null,
        restored.hintsUsed ? "Hints used" : "No hints used",
      ].filter((f): f is string => f !== null)
    : [];
  const resultsAutoOpenedRef = useRef(false);
  const viewResultsRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (state.isComplete && !prevIsComplete.current) {
      if (!wasAlreadyComplete.current) {
        trackEvent("puzzle_completed", {
          won: state.isWon,
          mistakes: state.mistakes,
          found_rainbow: state.gotRainbow,
        });
      }
      onComplete?.();
    }
    prevIsComplete.current = state.isComplete;
  }, [state.isComplete, state.isWon, state.mistakes, state.gotRainbow, onComplete]);

  useEffect(() => {
    if (state.gotRainbow && !prevGotRainbow.current) {
      setRainbowVisible(false);
      requestAnimationFrame(() => requestAnimationFrame(() => setRainbowVisible(true)));
    }
    prevGotRainbow.current = state.gotRainbow;
  }, [state.gotRainbow]);


  useEffect(() => {
    if (bonusRainbowCorrect === true) {
      // Reveal animation already ran off the state.gotRainbow flip above —
      // markRainbowFound sets it synchronously, before this delayed flag.
      trackEvent("rainbow_found", { source: "bonus_modal" });
    } else if (bonusRainbowCorrect === false) {
      if (restoredWrongAnswerRef.current) {
        // Restored from an earlier visit: already revealed then.
        restoredWrongAnswerRef.current = false;
        setRainbowVisible(true);
        return;
      }
      setRainbowVisible(false);
      requestAnimationFrame(() => requestAnimationFrame(() => setRainbowVisible(true)));
    }
  }, [bonusRainbowCorrect]);

  useEffect(() => {
    if (fullHintVisible) setHintVisible(true);
  }, [fullHintVisible]);

  useEffect(() => {
    onHintsViewOnlyChange?.(hintsViewOnly);
  }, [hintsViewOnly, onHintsViewOnlyChange]);

  const handleSpotResult = useCallback((correct: boolean, words: string[]) => {
    // Captured HERE — the moment SpotTheRainbowModal's Submit actually fired
    // — not inside the setTimeout below, which only runs after this
    // component's own 400ms shake/reveal delay. That delay is presentation
    // only; the bonus attempt itself happened now.
    const guessedAt = new Date().toISOString();
    setShowSpotModal(false);
    // One answer per Full game. Remembered now, at Submit, not after the
    // reveal delay below, so a refresh during that delay still counts it —
    // and a second press before the result appears is ignored. Its durable
    // save starts now too, and stays remembered as pending until the server
    // answers, so a page closed before then sends it on the next visit.
    // (Same rules as the Mini path below: nothing is saved for a confirmed
    // replay, a beta playtest, or a game that never got a session.)
    if (oneAnswerPrompt) {
      if (promptAnsweredRef.current) return;
      promptAnsweredRef.current = true;
      const sessionId = sessionIdRef.current;
      const pendingSave =
        sessionId && isOfficialAttemptRef.current !== false && !betaMode
          ? {
              sessionId,
              guessNumber: nextGuessNumber(0),
              words: [...words],
              correct,
              guessedAt,
              activeTimeSeconds: activeSecondsRef.current,
              groupsSolved: state.solvedGroups.length,
            }
          : null;
      savePromptAnswer(storageId, { correct, words: [...words], guessedAt, pendingSave });
      if (pendingSave) void deliverPromptAnswer(storageId, pendingSave);
    }
    setSpotShaking(true);
    setTimeout(() => {
      setSpotShaking(false);
      // Local UI/share state always reflects what actually happened THIS
      // playthrough — that part is unconditional (see markRainbowFound
      // below). The durable write is skipped when this playthrough is a
      // confirmed replay/duplicate (isOfficialAttemptRef.current === false —
      // see commitOfficialResult in useGame.ts), so a replay's bonus find can
      // never rewrite the real official result's Rainbows Spotted outcome.
      // Defaults to proceeding (undetermined or confirmed official both pass)
      // since the check resolves well before a human could reach this prompt
      // in the normal, non-replay case.
      const isDuplicateAttempt = isOfficialAttemptRef.current === false;

      // The write targets the session BY ID — the very session this
      // playthrough has been appending events to all along. The previous
      // implementation re-derived a session from puzzle_id + identity, a
      // lookup that can now return the wrong row, since one puzzle+identity
      // may legitimately have both a completed official session and a later
      // in-progress replay. A null id means this attempt never got a durable
      // session at all (creation failed), in which case there is nothing
      // truthful to attach the bonus to and it is skipped rather than guessed
      // at.
      const sessionId = sessionIdRef.current;
      // Beta mode never writes here: recordBonusRainbowAttempt targets
      // game_sessions/guess_events, and sessionIdRef in beta mode holds a
      // beta_playtests id, not a game_sessions id. The bonus find itself is
      // still fully playable (markRainbowFound below is unconditional) — only
      // the official durable write is skipped.
      const canPersist = !!sessionId && !isDuplicateAttempt && !betaMode;

      // The active timer has already stopped at formal completion, so this is
      // the final solve time — the bonus round cannot inflate it.
      const activeTimeSeconds = activeSecondsRef.current;

      // A failed bonus attempt is never appended to guessHistory (it has no
      // share-grid row), so the guess numbering has to advance here instead —
      // otherwise a player who failed, refreshed and failed again would have
      // the second attempt silently discarded as a duplicate. A CORRECT one
      // does get appended by markRainbowFound, so the count advances on its
      // own and this offset must not also move.
      const attemptOffset = failedBonusAttemptsRef.current;
      if (!correct) failedBonusAttemptsRef.current = attemptOffset + 1;

      if (correct && rainbowHerring) {
        setBonusRainbowWords([...rainbowHerring]);
        confetti({ particleCount: 100, spread: 80, origin: { y: 0.55 } });
        playRainbowSound();
        markRainbowFound(rainbowHerring, guessedAt);
      }

      // ONE write path for both outcomes. This is the only call site in the
      // app that produces attempt_type = 'bonus_rainbow', which is what makes
      // "did the player explicitly try Spot the Rainbow?" answerable from
      // intent rather than from the Rainbow-shape heuristic.
      //
      // Runs on success AND failure, and after a WIN or a formal LOSS alike —
      // the post-loss prompt exists on purpose (showEndState is true for a
      // loss), and a Rainbow found there counts. A failed attempt would
      // otherwise vanish entirely, leaving it indistinguishable from never
      // having tried.
      // A Full game already started its save at Submit (above); this delayed
      // write is the Mini's, unchanged.
      if (canPersist && !oneAnswerPrompt) {
        void recordBonusRainbowAttempt({
          sessionId,
          guessNumber: nextGuessNumber(attemptOffset),
          words,
          correct,
          guessedAt,
          activeTimeSeconds,
          groupsSolved: state.solvedGroups.length,
        }, { retry: false });
      }

      setTimeout(() => setBonusRainbowCorrect(correct), correct ? 600 : 0);
    }, 400);
  }, [rainbowHerring, markRainbowFound, isOfficialAttemptRef, sessionIdRef, activeSecondsRef, nextGuessNumber, state.solvedGroups.length, betaMode, storageId, oneAnswerPrompt]);

  const hintItems = useCallback((): { color?: string; squareEmoji?: string; emoji: string }[] => {
    const sorted = [...puzzle.groups].sort((a, b) => a.difficulty - b.difficulty);
    const items: { color?: string; squareEmoji?: string; emoji: string }[] = sorted.map(g => ({
      color: DIFFICULTY_COLOR[g.difficulty],
      emoji: resolveCategoryVisual(g.categoryEmoji, g.category),
    }));
    if (rainbowHerring && (puzzle.rainbowCategoryName || puzzle.rainbowCategoryEmoji)) {
      items.push({
        squareEmoji: theme.emoji,
        emoji: resolveCategoryVisual(puzzle.rainbowCategoryEmoji, puzzle.rainbowCategoryName ?? ""),
      });
    }
    return items;
  }, [puzzle, rainbowHerring, theme]);

  /**
   * The colour of each group AS THIS PLAYER PLAYED IT.
   *
   * The share grid and the Guess History grid are records of what somebody
   * did, so they are drawn from the version that was on the board at the
   * time — not from whatever is canonical now. Both map a guess's stored
   * group indices to a difficulty colour, so an admin who later reorders a
   * puzzle's difficulties would otherwise silently recolour a finished
   * player's saved result into a game they never played.
   *
   * This affects the COLOUR of a square and nothing else. The stored guesses
   * keep their real words, order and outcomes; the share_grid saved on the
   * session at completion is never regenerated at all; and the SOLUTION
   * shown above the grid still comes from the current version, per the rule
   * that a completed player revisiting the Archive sees the newest
   * corrected answers.
   *
   * null for a game with no pinned snapshot (a legacy blob, or a database
   * without the versioning migration), which falls back to the live puzzle
   * exactly as before.
   */
  const playedDifficulties = useMemo(
    () => loadPlayedDifficulties(storageId),
    [storageId]
  );
  // 0 when neither source knows this index — not a valid difficulty, so the
  // lookups below fall through to their existing "unknown" rendering rather
  // than inventing a colour.
  const playedDifficultyAt = useCallback(
    (groupIndex: number): number =>
      playedDifficulties?.[groupIndex] ?? puzzle.groups[groupIndex]?.difficulty ?? 0,
    [playedDifficulties, puzzle]
  );

  /**
   * How a hint reveal is drawn in the share grid.
   *
   * FULL keeps exactly what it has always produced: a bare "💡"/"🔦", and two
   * hints that happened back to back merged onto one line ("💡🔦"). Changing
   * that would rewrite the look of every Full result.
   *
   * MINI draws each hint as its own row, padded to the board's width with ✨
   * ("✨💡✨"), and never merges two hints onto one line. Two reasons:
   *
   *   - A Mini result is a tidy block of three-wide rows, and a one-emoji row
   *     sitting in the middle of it reads as a rendering fault. Padding with
   *     ordinary SPACES — the obvious fix — does not survive the trip: chat
   *     apps variously trim leading whitespace, collapse runs of it, or
   *     render it at a different width to an emoji, so the row lands ragged
   *     somewhere. A visible glyph cannot be trimmed.
   *   - Merging would produce a six-symbol row, breaking the "every row is
   *     exactly three symbols" rule that makes the block read as a grid.
   *
   * Each hint type still appears AT MOST ONCE, on either format:
   * dedupeHintMarkers is the single guarantee, and it is applied here and in
   * resultRows from the same guess history, so a restored, refreshed or
   * double-fired reveal cannot add a second row.
   */
  const hintShareRow = useCallback(
    (hintType: "small" | "full" | undefined): string => {
      const emoji = hintType === "small" ? "💡" : "🔦";
      if (format.id === "full") return emoji;
      const pad = Math.max(0, format.categoryCount - 1);
      const left = Math.floor(pad / 2);
      return "✨".repeat(left) + emoji + "✨".repeat(pad - left);
    },
    [format.id, format.categoryCount]
  );

  const generateShareLines = useCallback((): string[] => {
    const lines: string[] = [];
    for (const attempt of dedupeHintMarkers(state.guessHistory)) {
      if (attempt.isHintMarker) {
        const row = hintShareRow(attempt.hintType);
        // Full's historical merge of two adjacent hint markers onto one line.
        // Mini never merges — see hintShareRow.
        const last = lines[lines.length - 1];
        if (format.id === "full" && (last === "💡" || last === "🔦" || last === "💡🔦" || last === "🔦💡")) {
          lines[lines.length - 1] = last + row;
        } else {
          lines.push(row);
        }
      } else if (attempt.isRainbow) {
        lines.push(theme.shareRow);
      } else {
        const row = attempt.groupIndices
          .map((gi) => {
            const diff = playedDifficultyAt(gi);
            return DIFFICULTY_SQUARE[diff] || "⬜";
          })
          .join("");
        lines.push(row);
      }
    }
    return lines;
  }, [state.guessHistory, playedDifficultyAt, theme, hintShareRow, format.id]);

  // Same source of truth as generateShareLines above (state.guessHistory) —
  // guessHistory is already the real chronological event log (guesses AND
  // hint markers get pushed onto it at the moment each happens, see
  // addHintMarker in useGame.ts), so no separate history model or
  // persistence change is needed; this just maps that existing log to
  // ResultGrid's row shape instead of filtering hints out of it. Guess rows
  // reuse the same per-word logic generateShareLines uses for its
  // non-rainbow lines (attempt.groupIndices, in submitted order), so an
  // incorrect or one-away guess renders each of its 4 cells in that WORD's
  // own true category color, exactly matching the mixed-color rows Share
  // Score's emoji text already produces. Old saved games from before this
  // feature existed simply have no isHintMarker entries in their history,
  // so they render exactly as before — nothing to migrate.
  const resultRows = useMemo((): ResultRow[] => {
    return dedupeHintMarkers(state.guessHistory).map((attempt): ResultRow => {
      if (attempt.isHintMarker) {
        return { type: "hint", hint: attempt.hintType === "small" ? "bulb" : "flashlight" };
      }
      if (attempt.isRainbow) {
        // As wide as the board's own guesses, not a fixed four.
        return { type: "guess", cells: Array<ResultCellKind>(format.categoryCount).fill("rainbow") };
      }
      return {
        type: "guess",
        cells: attempt.groupIndices.map((gi): ResultCellKind => {
          const diff = playedDifficultyAt(gi);
          return DIFFICULTY_RESULT_KIND[diff] ?? "yellow";
        }),
      };
    });
  }, [state.guessHistory, playedDifficultyAt, format.categoryCount]);

  const generateShareText = useCallback(() => {
    const lines = generateShareLines();
    // Custom puzzles share their own real title and short link; the result
    // rows are the exact same ones the official text uses. Daily/Archive/Beta
    // keep the original text (see lib/shareText.ts).
    if (customMode) {
      return buildCustomShareText({
        title: puzzle.title,
        lines,
        origin: window.location.origin,
        path: customPuzzlePath(puzzle),
        format,
      });
    }
    // activeSecondsRef, not the rendered `activeSeconds`: the ref is always
    // the live total, and at share time (post-completion) it is the frozen
    // final solve time. A format that doesn't show a timer ignores it.
    return buildOfficialShareText(puzzle.title, lines, format, {
      activeSeconds: activeSecondsRef.current,
    });
  }, [puzzle, generateShareLines, customMode, format, activeSecondsRef]);

  const handleShare = useCallback(async () => {
    trackEvent("share_clicked");
    const text = generateShareText();
    // Custom results also offer the native share sheet where the browser has
    // one; it carries the exact same text as Copy. Any failure other than the
    // player dismissing the sheet falls through to copying.
    if (customMode && typeof navigator.share === "function") {
      try {
        await navigator.share({ text });
        return;
      } catch (err) {
        if ((err as { name?: string })?.name === "AbortError") return;
      }
    }
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      const textarea = document.createElement("textarea");
      textarea.value = text;
      document.body.appendChild(textarea);
      textarea.select();
      document.execCommand("copy");
      document.body.removeChild(textarea);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  }, [generateShareText, customMode]);

  const handleTileClick = useCallback((word: string) => {
    if (!colorPaletteMode || paletteMode === "select") {
      toggleWord(word);
    } else if (paletteMode === "eraser") {
      setTileColor(word, null);
    } else {
      // Painting mode: yellow, green, blue, red
      // Clicking the same color twice clears the tile (toggle off)
      if (tileColors[word] === paletteMode) {
        setTileColor(word, null);
      } else {
        setTileColor(word, paletteMode);
      }
    }
  }, [colorPaletteMode, paletteMode, toggleWord, setTileColor, tileColors]);

  // A lost game has settled once the loss cascade has put every remaining
  // category on the board and the last bar has landed. A game restored
  // already lost starts settled.
  const lossBoardEmpty = state.isComplete && !state.isWon && remainingWords.length === 0 && reveal === null;
  const [lossSettled, setLossSettled] = useState(lossBoardEmpty);
  useEffect(() => {
    if (!lossBoardEmpty) {
      setLossSettled(false);
      return;
    }
    const t = setTimeout(() => setLossSettled(true), prefersReducedMotion() ? 0 : LOSS_SETTLE_MS);
    return () => clearTimeout(t);
  }, [lossBoardEmpty]);

  // Gate for everything that belongs to the finished board: the results
  // popup, View Results and the post-game Rainbow. A WON game waits for the
  // victory reveal (final arrival pop finished), a LOST one for its loss
  // cascade, so nothing moves the board while it is still animating. A game
  // read back from the server has nothing to wait for.
  const showEndState =
    state.isComplete && (!!restored || (state.isWon ? victoryRevealReady : lossSettled));

  // Whether the Rainbow was found DURING the main game (it keeps its place
  // at the top) rather than afterwards, through Spot the Rainbow (it goes
  // below the categories). A find during play is always followed by the
  // guess that ended the game; a post-game find is the last thing recorded.
  const rainbowFoundInPlay = useMemo(() => {
    if (!state.gotRainbow) return false;
    if (!state.isComplete) return true;
    const at = state.guessHistory.findIndex((a) => a.isRainbow);
    // No record of when (an old save, or a game restored with its outcome
    // only): keep it where it always was, unless the record says it was
    // found after the game.
    if (at === -1) return restored?.rainbowSource !== "post_game";
    return state.guessHistory.slice(at + 1).some((a) => !a.isHintMarker && !a.isRainbow);
  }, [state.gotRainbow, state.isComplete, state.guessHistory, restored]);

  // Once a game has ended without the Rainbow found, the space reserved for
  // it at the top (and the instruction it held) folds away and the solved
  // categories move up into it. Waits for showEndState, so the final solve
  // or loss cascade has finished first.
  const slotFolded = showEndState && !rainbowFoundInPlay;
  // Once folded, the slot leaves the page altogether (after its glide, or
  // straight away for a finished game opened later), so nothing hidden in it
  // lingers.
  const [slotGone, setSlotGone] = useState(slotFolded);
  useEffect(() => {
    if (!slotFolded) {
      setSlotGone(false);
      return;
    }
    const t = setTimeout(() => setSlotGone(true), prefersReducedMotion() ? 0 : SLOT_FOLD_MS);
    return () => clearTimeout(t);
  }, [slotFolded]);

  // Whether the solved-bar list has anything in the page flow — a bar still
  // merging floats over its tile row and takes no space yet. Only then does
  // the list need the gap that separates it from the grid, so the board
  // doesn't shift the moment a merge starts.
  const barsInFlow =
    boardSlots.some((s) => !(reveal && reveal.groupIdx === s.groupIdx && reveal.phase !== "settling"));

  // The solved-rainbow reveal card (both the direct-guess and Spot the
  // Rainbow paths below) isn't itself gated by the Rainbow Animation
  // setting today, but should still show the same static treatment as the
  // tiles when it's off — for the default theme only; a themed (non-
  // default) bonus's gradient is a fixed image regardless of this setting.
  const rainbowCardStatic = theme.isDefault && !showRainbow;
  const rainbowCardBg = rainbowCardStatic ? "var(--rainbow-static-gradient)" : theme.gradient;
  const rainbowCardTextClass = rainbowCardStatic ? "text-[#292825]" : "text-white";
  const rainbowCardTextShadow = rainbowCardStatic ? undefined : theme.textShadow;

  // After the game, when the Rainbow wasn't found during play: the "spot
  // the Rainbow" prompt, then (once answered) the revealed Rainbow — or the
  // Rainbow found through it. It sits BELOW the solved categories, never in
  // the top slot (which has folded away by then, see slotFolded).
  const lateRainbowShown = showEndState && !rainbowFoundInPlay && !!rainbowHerring;
  // A game read back from the server keeps an unanswered question, so
  // changing device never takes it away — but only when the answer can be
  // saved to that same game (a guest cannot read its id), and never a
  // second time: one already given, right or wrong, is final.
  const restoredPromptOpen = !restored || (!!restored.sessionId && !restored.bonusRainbowAttempted);
  // The invitation is still on offer: nothing answered yet, and not hidden
  // for the moment it takes to confirm with the server that a reopened game
  // has not already used its prompt.
  const spotPromptAvailable =
    lateRainbowShown && !state.gotRainbow && bonusRainbowCorrect === null && !promptCheckPending && restoredPromptOpen;
  const openSpotTheRainbow = useCallback(() => {
    if (!promptAnsweredRef.current) setShowSpotModal(true);
  }, []);
  // From the results popup: close it, then open the real challenge — one
  // dialog at a time, so the popup has handed focus back before the
  // challenge takes it.
  const handleSpotFromResults = useCallback(() => {
    setResultsOpen(false);
    requestAnimationFrame(() => openSpotTheRainbow());
  }, [openSpotTheRainbow]);

  // Opens the results by itself once, when the game ends in front of the
  // player: after the final solve or loss cascade has settled and the
  // emptied Rainbow space has folded away. Never for a game reopened
  // already finished — View Results is there for that.
  useEffect(() => {
    if (!finishedThisVisit || !showEndState || resultsAutoOpenedRef.current) return;
    const t = setTimeout(
      () => {
        resultsAutoOpenedRef.current = true;
        setResultsOpen(true);
      },
      // A win first lets its confetti burst over the finished board for a
      // moment; a loss waits only for the emptied space to fold.
      prefersReducedMotion() ? 150 : state.isWon ? 1000 : slotFolded ? SLOT_FOLD_MS + 250 : 450,
    );
    return () => clearTimeout(t);
    // slotFolded is settled by the time showEndState is: read once.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [finishedThisVisit, showEndState]);

  const rainbowEndCard = lateRainbowShown && rainbowHerring ? (
      !state.gotRainbow && bonusRainbowCorrect === null ? (
        spotPromptAvailable ? (
          <SpotRainbowPrompt theme={theme} onClick={openSpotTheRainbow} className="solved-bar solved-bar-rainbow" />
        ) : null
      ) : (
        <RainbowRevealBar
          categoryName={puzzle.rainbowCategoryName}
          categoryEmoji={puzzle.rainbowCategoryEmoji}
          categoryEmojiHintOnly={puzzle.rainbowCategoryEmojiHintOnly}
          theme={theme}
          words={rainbowHerring}
          alphabetizeCompleted={puzzle.alphabetizeCompleted ?? true}
          textClass={rainbowCardTextClass}
          background={rainbowCardBg}
          textShadow={rainbowCardTextShadow}
          curtain={rainbowVisible}
          fitText
        />
      )
  ) : null;

  // ── One shared space for the instruction and the Rainbow ──
  // Before the Rainbow is found the space shows the instruction; a Rainbow
  // found during play then takes that same space instead of adding a row, so
  // the board below never moves. The space is sized by an invisible copy of
  // THIS puzzle's own Rainbow bar — its real name and all of its answers —
  // stacked in the same grid cell, so it is always exactly tall enough. A
  // game that ends without the Rainbow found folds the space away
  // (slotFolded); anything Rainbow after that goes below the categories.
  const rainbowInSlot = !!rainbowHerring && rainbowFoundInPlay;
  const slotTaken = rainbowInSlot || state.isComplete;
  // Once the real bar is showing it sizes the slot itself (same box, same
  // text), so the invisible copy goes — never two copies of its words.
  const realBarShown = rainbowInSlot;
  const rainbowSlot = slotGone ? null : (
    // board-bars: the same size container, one-tile-row height rule and gap
    // as the solved bars below (square tiles on a Mini, the wide board's
    // gaps where it has them), so the slot, the instruction's space and the
    // Rainbow bar are exactly as tall as an ordinary category bar on every
    // board; the gap under it is the board's own tile gap.
    // rainbow-slot-fold (index.css) folds it to nothing once slotFolded —
    // gliding when the game ends in front of the player, already folded
    // when a finished game is reopened. Its margin folds with it.
    <div className={`rainbow-slot-fold ${slotFolded ? "is-folded" : ""}`} aria-hidden={slotFolded || undefined}>
    <div className="min-h-0 overflow-hidden">
    <div
      className={`board-bars rainbow-slot-grid grid [&>*]:[grid-area:1/1] ${
        isMiniBoard ? "board-bars-square mb-2" : `mb-1.5 ${useWideBoard ? "board-bars-wide md:mb-3" : ""}`
      }`}
      style={{ "--board-cols": format.columns } as import("react").CSSProperties}
      data-testid="rainbow-slot"
    >
      {rainbowHerring && !realBarShown && (
        <div aria-hidden="true" className="invisible pointer-events-none">
          <RainbowRevealBar
            categoryName={puzzle.rainbowCategoryName}
            categoryEmoji={puzzle.rainbowCategoryEmoji}
            categoryEmojiHintOnly={puzzle.rainbowCategoryEmojiHintOnly}
            theme={theme}
            words={rainbowHerring}
            alphabetizeCompleted={puzzle.alphabetizeCompleted ?? true}
            textClass={rainbowCardTextClass}
            background="transparent"
            curtain
            fitText
          />
        </div>
      )}
      {/* One line at every width: the size follows the board's own width
          (cqw of this slot), so the full sentence fits on a Full board, a
          narrow phone and the capped Mini board alike, without wrapping or
          scrolling. */}
      <p
        aria-hidden={slotTaken || undefined}
        className={`self-center text-center font-sans font-bold text-foreground whitespace-nowrap leading-tight
          text-[clamp(12px,4.75cqw,28px)] transition-opacity duration-300 ${slotTaken ? "opacity-0" : ""}`}
      >
        Select {SELECTION_COUNT_WORD[format.answersPerCategory] ?? format.answersPerCategory} words that share a connection.
      </p>
      {rainbowInSlot && rainbowHerring ? (
        <RainbowRevealBar
          categoryName={puzzle.rainbowCategoryName}
          categoryEmoji={puzzle.rainbowCategoryEmoji}
          categoryEmojiHintOnly={puzzle.rainbowCategoryEmojiHintOnly}
          theme={theme}
          words={rainbowHerring}
          alphabetizeCompleted={puzzle.alphabetizeCompleted ?? true}
          textClass={rainbowCardTextClass}
          background={rainbowCardBg}
          textShadow={rainbowCardTextShadow}
          curtain={rainbowVisible}
          fitText
        />
      ) : null}
    </div>
    </div>
    </div>
  );

  // The post-game Rainbow's own row, below the solved categories: the same
  // size container and 80%-height Rainbow bar as the top slot.
  const lateRainbowRow = rainbowEndCard ? (
    <div
      className={`board-bars ${isMiniBoard ? "board-bars-square" : useWideBoard ? "board-bars-wide" : ""}`}
      style={{ "--board-cols": format.columns } as import("react").CSSProperties}
      data-testid="late-rainbow"
    >
      {rainbowEndCard}
    </div>
  ) : null;

  // ── Guess feedback, in its own row directly below the board ──
  // After a wrong guess exactly one message shows, read from that guess's own
  // stored result (useGame records it on the attempt at submission, with the
  // existing one-away and near-Rainbow rules): "One Away... 🌈" for a
  // near-Rainbow guess, "One Away..." for one away, otherwise "Incorrect".
  //  - One Away (either kind) belongs to the exact set of tiles selected when
  //    it was triggered — the submitted guess's words, by identity, so a
  //    shuffle doesn't matter. It goes when that set changes (deselecting a
  //    tile, Deselect All) or on its ×. A fifth tile can't be added to a full
  //    selection, so clicking one changes nothing and keeps it; nor do clicks
  //    on blank space or other controls.
  //  - Incorrect goes on any click/tap on the board (which still does its
  //    normal action), its ×, or Deselect All.
  // Once dismissed, only a new submission can show one again. A message is
  // armed by a submission in this visit, so a restored game never reopens its
  // last guess's message. "Rainbow Spotted!" (3s) and "Already guessed!" (2s)
  // keep useGame's timing.
  const lastGuessIndex = useMemo(() => {
    for (let i = state.guessHistory.length - 1; i >= 0; i--) {
      if (!state.guessHistory[i].isHintMarker) return i;
    }
    return -1;
  }, [state.guessHistory]);
  const [feedbackFrom, setFeedbackFrom] = useState(Number.POSITIVE_INFINITY);
  const dismissFeedback = useCallback(() => setFeedbackFrom(Number.POSITIVE_INFINITY), []);
  const handleSubmit = useCallback(() => {
    setFeedbackFrom(state.guessHistory.length);
    submitGuess();
  }, [state.guessHistory.length, submitGuess]);
  const handleDeselectAll = useCallback(() => {
    dismissFeedback();
    deselectAll();
  }, [dismissFeedback, deselectAll]);
  const lastGuess = lastGuessIndex >= feedbackFrom ? state.guessHistory[lastGuessIndex] : undefined;
  const triggeredFeedback: "almost" | "oneaway" | "incorrect" | null =
    !lastGuess || lastGuess.isCorrect || lastGuess.isRainbow || state.isComplete
      ? null
      : lastGuess.isAlmostRainbow ? "almost" : lastGuess.isOneAway ? "oneaway" : "incorrect";
  const triggeredSetStillSelected =
    !!lastGuess &&
    lastGuess.words.length === state.selectedWords.length &&
    lastGuess.words.every((w) => state.selectedWords.includes(w));
  const isOneAwayKind = triggeredFeedback === "almost" || triggeredFeedback === "oneaway";
  // Hidden in the very render the set changes; the effect makes it final, so
  // re-selecting the same tiles doesn't bring it back.
  const guessFeedback = isOneAwayKind && !triggeredSetStillSelected ? null : triggeredFeedback;
  useEffect(() => {
    if (isOneAwayKind && !triggeredSetStillSelected) dismissFeedback();
  }, [isOneAwayKind, triggeredSetStillSelected, dismissFeedback]);
  const feedbackKind = alreadyGuessed ? `already-${alreadyGuessed}` : guessFeedback ?? (showRainbowPopup ? "spotted" : null);

  // One visual family: a white pill with a strong purple outline and bold
  // purple lettering (the Submit button's purple). The pill is sized to its
  // content: the label (with its 🌈, if any) and the close button sit together
  // as one group, centred with equal padding on both sides. Rainbow Spotted
  // keeps its rainbow fill as the success message.
  const pillBase = "relative inline-flex h-9 sm:h-10 shrink-0 items-center justify-center whitespace-nowrap rounded-full text-[15px] sm:text-base font-extrabold leading-none animate-fade-up motion-reduce:animate-none";
  const purplePill = `${pillBase} border-2 border-[hsl(var(--brand-purple-to))] bg-white text-[hsl(258_68%_48%)] shadow-[0_2px_8px_-3px_rgba(139,92,246,0.45)] dark:shadow-none dark:bg-card dark:text-[hsl(var(--brand-purple-from))]`;
  const oneAwayColor = guessFeedback === "oneaway" && lastGuess
    ? miniOneAwayColor(puzzle, lastGuess.words, state.solvedGroups) : null;
  const oneAwayCopy = `One Away...${oneAwayColor ? ` ${oneAwayColor.square}` : ""}`;
  const feedbackAnnouncement = !feedbackKind
    ? ""
    : alreadyGuessed
      ? (alreadyGuessed === "oneaway" ? "Already guessed — one away!" : "Already guessed!")
      : guessFeedback === "incorrect" ? "Incorrect"
      : guessFeedback === "almost" ? `One Away... ${theme.emoji}`
      : guessFeedback === "oneaway" ? (oneAwayColor ? `One Away... ${oneAwayColor.name} category` : oneAwayCopy)
      : theme.spottedMessage;
  const feedbackPill = !feedbackKind ? null : guessFeedback && !alreadyGuessed ? (
    <div className={`${purplePill} gap-2 px-3`} data-testid="guess-feedback">
      {guessFeedback === "incorrect" ? "Incorrect" : guessFeedback === "almost" ? `One Away... ${theme.emoji}` : oneAwayCopy}
      {/* 28px circle, with a 44px invisible tap area around it. */}
      <button
        onClick={dismissFeedback}
        aria-label="Dismiss"
        className="relative shrink-0 w-7 h-7 rounded-full flex items-center justify-center
          game-submit bg-[linear-gradient(135deg,_hsl(var(--brand-purple-from)),_hsl(var(--brand-purple-to)))] text-white
          before:absolute before:-inset-2 before:content-[''] active:scale-95 transition-transform
          focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
      >
        <X className="w-4 h-4" strokeWidth={3} />
      </button>
    </div>
  ) : alreadyGuessed ? (
    <div className={`${purplePill} px-3.5`} data-testid="guess-feedback">
      {alreadyGuessed === "oneaway" ? "Already guessed — one away!" : "Already guessed!"}
    </div>
  ) : (
    // Animated (or static, per the Rainbow Animation setting) rainbow fill for
    // the default theme; a themed bonus's gradient is a fixed image either way.
    <div
      data-testid="guess-feedback"
      className={`${pillBase} px-3.5 shadow-md ${
        theme.isDefault
          ? showRainbow ? "rainbow-tile text-white" : "rainbow-tile-static text-[#292825]"
          : "text-white"
      }`}
      style={!theme.isDefault ? { background: theme.gradient, textShadow: theme.textShadow } : undefined}
    >
      {theme.spottedMessage}
    </div>
  );


  // Color Palette Mode buttons, below the Shuffle/Deselect/Submit row, so
  // neither turning the setting on nor switching modes can move the grid.
  const paletteRow = colorPaletteMode && remainingWords.length > 0 ? (
      <div className="flex items-center justify-center gap-2 mt-4">
        <button
          onClick={() => setPaletteMode("select")}
          className={`w-10 h-10 rounded-lg flex items-center justify-center transition-all
            ${paletteMode === "select"
              ? "bg-foreground text-background ring-2 ring-foreground ring-offset-2 ring-offset-background"
              : "bg-secondary hover:bg-secondary/80"
            }`}
          aria-label="Select mode"
        >
          <MousePointer2 className="w-5 h-5" />
        </button>
        {/* One swatch per colour THIS FORMAT uses, in difficulty order —
            Full gets Yellow/Green/Blue/Red, Mini gets Green/Blue/Red.
            categorySwatches() is the shared list WordTile's double-tap
            picker also renders, so the two colouring interfaces can never
            drift apart; see categoryPalette.ts for why the fills are the
            solved-bar CSS variables rather than hardcoded hexes. */}
        {categorySwatches(format).map(({ color, label, swatchClass }) => (
          <button
            key={color}
            onClick={() => setPaletteMode(color)}
            className={`w-10 h-10 rounded-lg ${swatchClass} hover:scale-110 transition-all
              ${paletteMode === color ? "ring-2 ring-foreground ring-offset-2 ring-offset-background scale-110" : ""}`}
            aria-label={`${label} paint`}
          />
        ))}
        <button
          onClick={() => setPaletteMode("eraser")}
          className={`w-10 h-10 rounded-lg flex items-center justify-center transition-all
            ${paletteMode === "eraser"
              ? "bg-foreground text-background ring-2 ring-foreground ring-offset-2 ring-offset-background"
              : "bg-secondary hover:bg-secondary/80"
            }`}
          aria-label="Eraser"
        >
          <Eraser className="w-5 h-5" />
        </button>
      </div>
  ) : null;

  return (
    <>
      {!imagesReady ? (
        <div className={`w-full mx-auto flex flex-col items-center justify-center py-20 ${useWideBoard ? "max-w-[840px] px-3 md:px-0" : "max-w-lg px-2"}`}>
          <div className="w-6 h-6 border-2 border-primary border-t-transparent rounded-full animate-spin" />
        </div>
      ) : (
    <div className={`w-full mx-auto animate-fade-up ${useWideBoard ? "max-w-[840px] px-3 md:px-0" : "max-w-lg px-2"}`}>
      {/* Puzzle-mode badge on its own right-aligned row (opt-in via
          showModeBadge — see its prop doc), then the centered instruction
          directly beneath — stacked (not sharing one row) so both read
          clearly against the reference layout, with minimal margin between
          each so this whole block stays compact above the board. */}
      {showModeBadge && (
        <div className="flex justify-end mb-1">
          <PuzzleModeBadge isRainbow={!!rainbowHerring} groupCount={format.categoryCount} />
        </div>
      )}
      {/* The board area: the instruction/Rainbow slot, the solved bars and the
          tile grid. On a Mini it is capped at ~330px so all three share one
          width and stop growing past it; the controls below keep the page
          width. While "Incorrect" shows, any click or tap on it (tile, bar or
          gap, by pointer or keyboard) dismisses it, in the capture phase, so
          the click still does its normal job. */}
      <div onClickCapture={guessFeedback === "incorrect" ? dismissFeedback : undefined} className={isMiniBoard ? "w-full max-w-[330px] mx-auto" : undefined}>
      {rainbowSlot}
      {/* The solved bars. Spaced exactly like the tile grid (same gaps), and
          each bar is one tile row tall (.board-bars / .solved-bar in
          index.css), so a row becoming a bar leaves the board below where
          it was. relative: the bar of a category mid-solve-animation is
          positioned against this list. z-[1]: one layer below the tile grid
          (z-[2]), so animated tiles draw in front of solved bars. */}
      <div
        data-testid="solved-bars"
        className={`board-bars relative z-[1] ${
          isMiniBoard
            ? `board-bars-square space-y-2 ${barsInFlow ? "mb-2" : ""}`
            : `space-y-1.5 ${barsInFlow ? "mb-1.5" : ""} ${useWideBoard ? `board-bars-wide md:space-y-3 ${barsInFlow ? "md:mb-3" : ""}` : ""}`
        }`}
        style={{ "--board-cols": format.columns } as import("react").CSSProperties}
      >
        {boardSlots.map((slot) => (
            <SolvedGroup
              key={slot.groupIdx}
              group={puzzle.groups[slot.groupIdx]}
              fitText
              alphabetizeCompleted={puzzle.alphabetizeCompleted ?? true}
              // animate-group-appear is only for bars that DIDN'T go through the
              // solve animation (reduced-motion path, loss cascade). Animated
              // bars fade in via the `reveal` prop instead.
              animate={slot.groupIdx === lastRevealedGroup && !animatedRevealGroupsRef.current.has(slot.groupIdx)}
              reveal={
                reveal?.groupIdx === slot.groupIdx
                  ? (reveal.phase === "pending" || reveal.phase === "gathering"
                      ? "pending"
                      : reveal.phase)
                  : undefined
              }
            />
        ))}
      </div>
      {lateRainbowRow}

      {/* Word grid. Stays mounted (empty) through the settle beat of the
          final solve, so its height can glide to zero like any other settle. */}
      {(remainingWords.length > 0 || reveal !== null) && (
        // relative z-[2]: the grid is its own layer ABOVE the solved-bar
        // list (z-[1], which .board-bars' size containment makes a layer of
        // its own anyway). A tile that lifts or pops past its box — the
        // checking bounce, the selection pop, a gathering tile — draws in
        // front of a solved bar instead of disappearing behind it. Nothing in
        // the solve animation needs a bar above a visible tile: the gathered
        // tiles are gone by the time their bar shows.
        <div ref={gridWrapperRef} className="relative z-[2]">
          {/* Columns come from the format (4 on Full, 3 on Mini) as an inline
              grid-template rather than a `grid-cols-N` class, because Tailwind
              only emits the classes it can see in the source and a computed
              class name would be purged from the production build. */}
          <div
            className={`grid ${isMiniBoard ? "gap-2" : `gap-1.5 ${useWideBoard ? "md:gap-3" : ""}`} ${shaking || spotShaking ? "animate-shake" : ""}`}
            style={{ gridTemplateColumns: `repeat(${format.columns}, minmax(0, 1fr))` }}
          >
          {remainingWords.map((word, index) => {
            // A word mid-solve-animation keeps its selected look (useGame
            // clears the selection the moment the guess is confirmed) so the
            // guessed tiles stay visibly the same four dark tiles right up to
            // the moment the bar replaces them.
            const isRevealingWord = reveal?.words.includes(word) ?? false;
            return (
              <WordTile
                key={word}
                ref={(el) => { wordTileRefs.current[word] = el; }}
                word={word}
                isSelected={state.selectedWords.includes(word) || isRevealingWord}
                isRainbow={
                  rainbowWords.includes(word) ||
                  bonusRainbowWords.includes(word)
                }
                rainbowGradient={theme.isDefault ? undefined : theme.gradient}
                rainbowTextShadow={theme.textShadow}
                rainbowAnimated={showRainbow}
                isMatched={matchedWords.includes(word)}
                // Hidden from the swap until the row leaves the grid, through
                // the bar's pop.
                fadingForReveal={isRevealingWord && reveal?.phase === "arrived"}
                isChecking={checkingWords.includes(word)}
                checkingIndex={checkingStagger[word] ?? 0}
                onClick={() => handleTileClick(word)}
                disabled={state.isComplete || matchedWords.length > 0 || reveal !== null || isChecking}
                // Only a finished board (or the Rainbow wiggle) greys tiles
                // out; the brief lock while a guess is checked and animates
                // doesn't, so nothing dims and re-brightens mid-solve.
                dimWhenDisabled={(state.isComplete && !isRevealingWord) || matchedWords.length > 0}
                arrangeTiles={arrangeTiles}
                colorCodeTiles={colorCodeTiles}
                tileColor={tileColors[word] ?? null}
                onColorChange={setTileColor}
                draggable={arrangeTiles}
                onDragStart={handleTileDragStart}
                onDragMove={handleTileDragMove}
                onDragEnd={handleTileDragEnd}
                onDragCancel={handleTileDragCancel}
                isLifted={liftedWord === word}
                column={(index % format.columns) + 1}
                format={format}
                isEmojiPuzzle={puzzle.isEmojiPuzzle ?? false}
                colorPaletteMode={colorPaletteMode}
                isPaintMode={colorPaletteMode && paletteMode !== "select"}
                squareTiles={isMiniBoard}
                splitLongWords
                data-word={word}
              />
            );
          })}
          </div>
        </div>
      )}
      </div>

      {/* Guess feedback: a centred row of its own directly below the board,
          present only while a message shows — it pushes the mistakes line and
          controls down, and its space goes with it. The board never moves. */}
      {feedbackPill && (
        <div data-testid="feedback-row" className="mt-2 md:mt-4 flex justify-center">
          {feedbackPill}
        </div>
      )}
      {/* Announced through a region that is always present. */}
      <div role="status" aria-live="polite" className="sr-only">
        {feedbackAnnouncement}
      </div>

      {/* Mistakes dots — hidden when viewing an already-completed puzzle.
          The running solve time is never shown during active play (on any
          format) — timing itself, persistence, hidden-tab pausing and
          completion logic are all unchanged in useGame/activeTimer; only
          this live readout is gone. The frozen final time still appears
          once the run finishes (see showEndState below) and still goes
          into Mini's share text (generateShareText reads activeSecondsRef
          regardless of whether this live span ever rendered). With no
          second item in this row, the pill is simply centered. */}
      {!wasAlreadyComplete.current && (
        <div className="mt-2 md:mt-4 w-full flex items-center justify-center">
          <MistakeDots mistakes={state.mistakes} max={state.maxMistakes} plain />
        </div>
      )}

      {/* Controls — a 3-column grid so Shuffle/Clear/Submit are always
          exactly equal width and the row spans close to the board's own
          width (100% on mobile, 80% on desktop), rather than three
          fixed-width buttons floating narrower than the grid above them. */}
      {!state.isComplete && (
        <>
          <div className="w-full md:w-[80%] mx-auto grid grid-cols-3 gap-2 mt-2 sm:mt-3">
            <button
              onClick={shuffle}
              disabled={isChecking || reveal !== null}
              className={`game-secondary w-full ${isMiniBoard ? "h-12" : "h-12 sm:h-14"} rounded-full text-sm md:text-base font-bold transition-colors
                bg-action-secondary-bg text-action-secondary-fg border border-transparent
                shadow-[0_1px_2px_rgba(30,25,20,0.04),0_2px_6px_rgba(30,25,20,0.05)] dark:shadow-none
                dark:bg-secondary dark:text-foreground dark:border-border
                dark:hover:bg-muted active:scale-95 dark:disabled:opacity-40
                focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring
                focus-visible:ring-offset-2 focus-visible:ring-offset-background
                disabled:cursor-default`}
            >
              Shuffle
            </button>
            <button
              onClick={handleDeselectAll}
              disabled={state.selectedWords.length === 0 || isChecking || reveal !== null}
              className={`game-secondary w-full ${isMiniBoard ? "h-12" : "h-12 sm:h-14"} rounded-full text-sm md:text-base font-bold transition-colors
                border border-transparent
                shadow-[0_1px_2px_rgba(30,25,20,0.04),0_2px_6px_rgba(30,25,20,0.05)] dark:shadow-none
                dark:bg-secondary dark:text-foreground dark:border-border
                dark:hover:bg-muted active:scale-95 dark:disabled:opacity-40
                focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring
                focus-visible:ring-offset-2 focus-visible:ring-offset-background
                disabled:cursor-default ${
                  state.selectedWords.length === 0
                    ? "bg-disabled-bg text-disabled-fg"
                    : "bg-action-secondary-bg text-action-secondary-fg"
                }`}
            >
              Deselect All
            </button>
            <button
              onClick={handleSubmit}
              disabled={state.selectedWords.length !== format.answersPerCategory || isChecking || reveal !== null}
              className={`game-submit w-full ${isMiniBoard ? "h-12" : "h-12 sm:h-14"} rounded-full text-sm md:text-base font-bold text-white transition-all
                bg-[linear-gradient(135deg,_hsl(var(--brand-purple-from)),_hsl(var(--brand-purple-to)))]
                shadow-[0_6px_16px_-8px_rgba(139,92,246,0.45),inset_0_1px_0_rgba(255,255,255,0.3)]
                hover:-translate-y-px active:scale-95
                disabled:opacity-40 disabled:hover:translate-y-0
                focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring
                focus-visible:ring-offset-2 focus-visible:ring-offset-background
                disabled:cursor-default`}
            >
              Submit
            </button>
          </div>
          {paletteRow}
          {(colorCodeTiles || colorPaletteMode) && hasAnyColor && (
            // Same w-full md:w-[80%] mx-auto grid-cols-3 gap-2 math as the
            // Shuffle/Deselect All/Submit row above, with the button in the
            // center column only — guarantees this matches one of those
            // buttons' width exactly (not an eyeballed value) while staying
            // centered, rather than sizing its own single-button container.
            <div className="w-full md:w-[80%] mx-auto grid grid-cols-3 gap-2 mt-2 sm:mt-3">
              <div aria-hidden="true" />
              <button
                onClick={clearAllColors}
                className="game-secondary w-full h-12 rounded-full text-sm md:text-base font-bold transition-colors
                  bg-action-secondary-bg text-action-secondary-fg border border-transparent
                  dark:bg-transparent dark:border-border
                  dark:hover:bg-muted active:scale-95 dark:disabled:opacity-40
                  focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring
                  focus-visible:ring-offset-2 focus-visible:ring-offset-background
                  disabled:cursor-default"
              >
                <span className="flex items-center justify-center gap-1.5">
                  <img
                    src="/new-broom-icon.png"
                    alt=""
                    aria-hidden="true"
                    className="w-6 h-6 shrink-0 dark:invert"
                  />
                  Clear Colors
                </span>
              </button>
              <div aria-hidden="true" />
            </div>
          )}
        </>
      )}

      {/* The finished board's own actions, where the play controls were. */}
      {showEndState && (
        <div className="mt-3 sm:mt-4 flex flex-col items-center gap-3 text-center animate-fade-up motion-reduce:animate-none">
            <>
              <button
                ref={viewResultsRef}
                type="button"
                onClick={() => setResultsOpen(true)}
                className={`w-full md:w-[80%] max-w-[420px] ${isMiniBoard ? "h-12" : "h-12 sm:h-14"} rounded-full text-base font-bold text-white transition-all
                  bg-[linear-gradient(135deg,_hsl(var(--brand-purple-from)),_hsl(var(--brand-purple-to)))]
                  shadow-[0_6px_16px_-8px_rgba(139,92,246,0.45),inset_0_1px_0_rgba(255,255,255,0.3)]
                  hover:-translate-y-px active:scale-95
                  focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring
                  focus-visible:ring-offset-2 focus-visible:ring-offset-background`}
              >
                View Results
              </button>
              {state.guessHistory.length > 0 && (!betaMode || (customMode && onReplay)) && (
                <div className="flex flex-wrap items-center justify-center gap-3">
                  {/* Global Stats reads real official completions for this
                      puzzle id — meaningless (and potentially confusing) for
                      a puzzle that structurally can never have any while
                      it's in Beta. Custom puzzles get their OWN lightweight
                      stats button/modal instead — see CustomStatsModal. */}
                  {!betaMode && (
                    <button
                      type="button"
                      onClick={() => setShowGlobalStats(true)}
                      className="inline-flex items-center gap-2 px-5 py-2.5 rounded-full border border-border text-sm font-semibold
                        hover:bg-secondary transition-all duration-150 active:scale-95 shadow-md"
                    >
                      <TrendingUp className="w-4 h-4" /> {customMode ? "Results" : "Global Stats"}
                    </button>
                  )}
                  {customMode && onReplay && (
                    <button
                      type="button"
                      onClick={onReplay}
                      className="inline-flex items-center gap-2 px-5 py-2.5 rounded-full border border-border text-sm font-semibold
                        hover:bg-secondary transition-all duration-150 active:scale-95 shadow-md"
                    >
                      <RotateCcw className="w-4 h-4" /> Replay
                    </button>
                  )}
                </div>
              )}
            </>
        </div>
      )}

      {/* Hint pill */}
      {fullHintVisible && (
        <div className="mt-4 flex justify-center">
          {hintVisible ? (
            <div className="flex items-center gap-3 flex-wrap justify-center animate-fade-up">
              {hintItems().map((item, i) => (
                <span key={i} className="flex items-center gap-1.5 text-2xl leading-none">
                  {item.color ? (
                    <span className={`inline-block w-4 h-4 rounded-sm ${item.color}`} />
                  ) : (
                    <span>{item.squareEmoji}</span>
                  )}
                  <span className="text-base text-muted-foreground">:</span>
                  <span data-testid="hint-visual">
                    {splitCategoryVisual(item.emoji).map((part, k) =>
                      part.type === "text" ? (
                        <span key={k}>{part.value}</span>
                      ) : (
                        <img
                          key={k}
                          src={customEmojiUrl(part.name)}
                          alt={part.name}
                          draggable={false}
                          className="inline-block align-middle"
                          style={{ height: "1em", width: "auto" }}
                        />
                      )
                    )}
                  </span>
                </span>
              ))}
            </div>
          ) : (
            <button
              onClick={() => setHintVisible(true)}
              className="text-2xl leading-none hover:scale-110 transition-transform active:scale-95"
              aria-label="Show hints"
            >
              💡
            </button>
          )}
        </div>
      )}

      {/* Small Hint tile row */}
      {smallHintVisible && (
        <div className="mt-4 flex flex-wrap justify-center gap-2 animate-fade-up">
          {[...puzzle.groups]
            .sort((a, b) => a.difficulty - b.difficulty)
            .filter((g) => (g.hintWord ?? "").trim() !== "")
            .map((g) => {
              const colorClass =
                g.difficulty === 1 ? "bg-yellow-500"
                : g.difficulty === 2 ? "bg-green-600"
                : g.difficulty === 3 ? "bg-blue-500"
                : "bg-red-500";
              const word = (g.hintWord ?? "").trim();
              return (
                <div
                  key={g.difficulty}
                  className={`${colorClass} text-white text-sm font-semibold uppercase rounded-lg h-10 px-3 min-w-[60px] flex items-center justify-center`}
                >
                  {isCustomEmoji(word) ? (
                    <img
                      src={customEmojiUrl(word)}
                      alt={customEmojiName(word) ?? ""}
                      draggable={false}
                      style={{ height: "28px", width: "auto", objectFit: "contain" }}
                    />
                  ) : (
                    word
                  )}
                </div>
              );
            })}
          {puzzle.rainbowHintWord && puzzle.rainbowHintWord.trim() !== "" && (
            <div
              className="text-white text-sm font-semibold uppercase rounded-lg h-10 px-3 min-w-[60px] flex items-center justify-center"
              style={{ background: theme.gradient, textShadow: theme.textShadow }}
            >
              {isCustomEmoji(puzzle.rainbowHintWord) ? (
                <img
                  src={customEmojiUrl(puzzle.rainbowHintWord)}
                  alt={customEmojiName(puzzle.rainbowHintWord) ?? ""}
                  draggable={false}
                  style={{ height: "28px", width: "auto", objectFit: "contain" }}
                />
              ) : (
                puzzle.rainbowHintWord
              )}
            </div>
          )}
        </div>
      )}

      {/* Guess History */}
      {settings?.guessHistory && incorrectGuesses.length > 0 && (
        // A narrower card than the board, its title left-aligned with the
        // guess count.
        <div className="mt-5 mx-auto w-[86%] sm:w-[72%] max-w-[600px] rounded-xl bg-card border border-border overflow-hidden">
          <button
            onClick={() => setHistoryExpanded((v) => !v)}
            aria-expanded={historyExpanded}
            className="relative w-full px-4 py-3 hover:bg-secondary/40 transition-colors text-left"
          >
            <span className="flex items-center gap-2.5 pr-6">
              <History className="w-5 h-5 text-foreground shrink-0" />
              <span className="text-sm md:text-base font-semibold text-foreground">
                Guess History ({incorrectGuesses.length})
              </span>
            </span>
            <ChevronDown
              className={`absolute right-4 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground shrink-0 transition-transform duration-200 ${
                historyExpanded ? "rotate-180" : ""
              }`}
            />
          </button>
          {historyExpanded && (
            <div className="mx-4 pt-2 pb-3 border-t border-border divide-y divide-border">
              {incorrectGuesses.map((g, i) => {
                const sorted = [...g.words].sort((a, b) => a.localeCompare(b));
                // Reuse the guess's own stored feedback (set at guess-time in
                // useGame.ts) rather than re-deriving one-away/rainbow status
                // from the final solved categories.
                // Historical guesses precede today's solved state. Derive only
                // the color from their own tiles, never reclassify the outcome.
                const historyColor = g.isOneAway && !g.isAlmostRainbow
                  ? miniOneAwayColor(puzzle, g.words, []) : null;
                const label = g.isAlmostRainbow
                  ? "One Away 🌈"
                  : g.isOneAway
                    ? (format.id === "mini" ? `One Away${historyColor ? ` ${historyColor.square}` : ""}` : "One Away")
                    : "Incorrect";

                return (
                  <div key={i} className="py-2 text-center first:pt-0 last:pb-0">
                    <p className="text-xs font-semibold text-muted-foreground mb-1" data-testid="history-feedback">
                      <span aria-hidden={historyColor ? true : undefined}>{label}</span>
                      {historyColor && <span className="sr-only">One Away {historyColor.name} category</span>}
                    </p>
                    {/* Equal-width grid, one column per answer in a guess (4 on
                        Full, 3 on Mini), matching the Spot the Rainbow
                        selection rows — cell width never varies with word
                        length, and grid rows keep every cell the same
                        height even when one wraps to two lines. */}
                    {/* A Full guess is two by two on phones and one row from
                        sm up; a Mini guess (three words) is always one row. */}
                    <div
                      className={`grid gap-1.5 ${format.answersPerCategory === 4 ? "grid-cols-2 sm:[grid-template-columns:var(--history-cols)]" : "[grid-template-columns:var(--history-cols)]"}`}
                      style={{ "--history-cols": `repeat(${format.answersPerCategory}, minmax(0, 1fr))` } as import("react").CSSProperties}
                    >
                      {sorted.map((w, j) => (
                        <span
                          key={`${w}-${j}`}
                          className="flex items-center justify-center min-w-0 bg-secondary text-foreground rounded-lg px-1 py-1.5 text-xs md:text-sm font-medium text-center leading-tight"
                        >
                          {isCustomEmoji(w) ? (
                            <img
                              src={customEmojiUrl(w)}
                              alt={customEmojiName(w) ?? ""}
                              draggable={false}
                              style={{ height: "18px", width: "auto", objectFit: "contain" }}
                            />
                          ) : (
                            // A nested min-w-0 element is required: without it,
                            // a long unbroken word (e.g. "STRAWBERRY") keeps its
                            // full intrinsic width as this flex item and simply
                            // overflows the cell into its neighbor instead of
                            // wrapping, even though the cell itself is sized
                            // correctly by the grid.
                            <span className="min-w-0 break-words">{w}</span>
                          )}
                        </span>
                      ))}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}

      {/* Lucky Bot: the player's skill score and how it compares with
          everyone else who finished this puzzle. Official puzzles only, for
          the same reason as Global Stats — a beta or custom puzzle has no
          official sessions to compare against. */}
      {showEndState && restored?.detail !== "summary" && state.guessHistory.length > 0 && !betaMode && !customMode && (
        <div className="mt-6 animate-fade-up motion-reduce:animate-none">
          <LuckyBot puzzle={puzzle} state={state} rainbowPromptResult={bonusRainbowCorrect} />
        </div>
      )}

      {/* Rating — tied to the real puzzle id and account, neither of which
          make sense for an unlisted playtest or a public custom puzzle. */}
      {showEndState && !betaMode && !customMode && <PuzzleRating puzzleId={puzzle.id} user={user} />}

      {customMode ? (
        <CustomStatsModal
          shareId={puzzle.id}
          open={showGlobalStats}
          onClose={() => setShowGlobalStats(false)}
          userWon={state.isWon}
          userTotalGuesses={state.guessHistory.filter((g) => !g.isHintMarker).length}
          isComplete={state.isComplete}
        />
      ) : (
        <DailyStatsModal
          puzzleId={puzzle.id}
          open={showGlobalStats}
          onClose={() => setShowGlobalStats(false)}
          userMistakes={state.mistakes}
          isComplete={state.isComplete}
        />
      )}

      <ResultsDialog
          open={resultsOpen && showEndState}
          onOpenChange={setResultsOpen}
          headline={getResultHeadline(state.isWon, state.mistakes)}
          // The frozen solve time, on a timed format. Zero seconds is not
          // shown: a restored legacy run that never recorded a time says
          // nothing rather than claim "0s".
          timeLabel={format.showsTimer && activeSeconds > 0 ? formatActiveTime(activeSeconds) : null}
          // A game restored with its outcome only has no rows to show and
          // nothing honest to share; it lists what its record does say.
          resultRows={restoredSummary ? [] : resultRows}
          onShare={restoredSummary ? null : handleShare}
          summary={restoredSummary ? { facts: restoredFacts, note: "Detailed results aren't available for this game." } : null}
          copied={copied}
          // Personal stats only where play counts toward them.
          statsFormat={betaMode || customMode ? null : format}
          statsPending={finishedThisVisit && officialAttempt === null}
          // The flame celebrates a win, as it always has. (The server starts
          // a brand-new player's streak at 1 even on a lost first game;
          // the stats row still says so, but a loss is never celebrated.)
          showStreak={isDailyStreakGame && state.isWon}
          animateStreak={streakNewlyEarned && !streakAnimatedRef.current}
          onStreakAnimated={handleStreakAnimated}
          spotTheme={spotPromptAvailable ? theme : null}
          onSpotRainbow={handleSpotFromResults}
          returnFocusRef={viewResultsRef}
        />

      {rainbowHerring && (
        <SpotTheRainbowModal
          open={showSpotModal}
          puzzle={puzzle}
          onResult={handleSpotResult}
          onClose={() => setShowSpotModal(false)}
        />
      )}
    </div>
      )}

      {/* Silly Saturday modal — rendered outside the preload gate so it appears immediately */}
      <SillySaturdayModal isEmojiPuzzle={!!puzzle.isEmojiPuzzle} puzzleId={puzzle.id} />
    </>
  );
}

/**
 * Whether this browser's board can be shown straight away, or the server
 * must first be asked about a finished game this browser has no copy of.
 */
type FinishedGameCheck =
  | { status: "checking" }
  | { status: "failed" }
  | { status: "ready"; restored: RestoredGame | null };

/** How long to wait for that answer before offering Retry. */
const FINISHED_GAME_CHECK_TIMEOUT_MS = 10_000;

/**
 * The game board, for whoever is playing (see lib/progressOwner.ts).
 *
 * When this browser has the player's own progress for the puzzle — a game
 * underway or finished here — the board opens from it at once, as it always
 * has. When it has none, the board waits while the server is asked whether
 * this player already finished the puzzle elsewhere (another device, or
 * before this browser was cleared):
 *
 *   checking  a plain loading state — never a playable board that might
 *             turn out to be already finished
 *   found     the finished game, read back from the server (lib/finishedGame.ts)
 *   none      a fresh board
 *   failed    "couldn't load your result" with Retry. There is deliberately
 *             no way past it: "we don't know" is not "you haven't played",
 *             and a fresh board here could not count anyway.
 *
 * Every answer is tied to the player and puzzle it was asked about; one that
 * arrives after either has changed, or after Retry, is ignored.
 *
 * Beta and custom puzzles never have an official result, so they open at once.
 */
export function GameBoard(props: GameBoardProps) {
  const { puzzle, betaMode = false, customMode = false, variant = "default", wideBoard = false } = props;
  const owner = useProgressOwner();
  const mode = customMode ? "custom" : betaMode ? "beta" : "official";
  const storageId = progressStorageId(puzzle.id, formatOf(puzzle), mode, owner);
  const checkKey = `${ownerKey(owner)}|${storageId}`;

  // Decided once per player and puzzle: a game the player starts on this
  // board then saves progress, which must not send it back to "checking".
  // Without a known player (a board rendered outside the app's
  // OnboardingGate, as unit tests do) there is no one to ask about.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const needsCheck = useMemo(() => mode === "official" && owner !== null && loadProgress(storageId) === null, [checkKey, mode]);

  const [attempt, setAttempt] = useState(0);
  const [answer, setAnswer] = useState<{ forKey: string; check: FinishedGameCheck } | null>(null);

  useEffect(() => {
    if (!needsCheck || !owner) return;
    let current = true;
    const settle = (check: FinishedGameCheck) => {
      if (!current) return;
      current = false;
      clearTimeout(timer);
      setAnswer({ forKey: checkKey, check });
    };
    const timer = setTimeout(() => settle({ status: "failed" }), FINISHED_GAME_CHECK_TIMEOUT_MS);
    lookupFinishedGame(puzzle, owner).then(
      (found) => settle({ status: "ready", restored: found.status === "found" ? found.game : null }),
      (err) => {
        console.error("Could not check for a finished game:", err);
        settle({ status: "failed" });
      }
    );
    return () => {
      current = false;
      clearTimeout(timer);
    };
    // checkKey stands for the player and puzzle; attempt is Retry.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [needsCheck, checkKey, attempt]);

  const check: FinishedGameCheck = !needsCheck
    ? { status: "ready", restored: null }
    : answer && answer.forKey === checkKey
      ? answer.check
      : { status: "checking" };

  if (check.status === "ready") {
    return <GameBoardView key={checkKey} {...props} owner={owner} restored={check.restored} />;
  }

  const width = variant === "dailyHomepage" || wideBoard ? "max-w-[840px] px-3 md:px-0" : "max-w-lg px-2";
  return (
    <div className={`w-full mx-auto flex flex-col items-center justify-center py-20 text-center ${width}`}>
      {check.status === "checking" ? (
        <div role="status" data-testid="finished-check-loading">
          <div className="w-6 h-6 border-2 border-primary border-t-transparent rounded-full animate-spin" aria-hidden="true" />
          <span className="sr-only">Loading</span>
        </div>
      ) : (
        <div data-testid="finished-check-failed">
          <p className="text-base font-medium">We couldn't load your result for this puzzle.</p>
          <p className="mt-1 text-sm text-muted-foreground">Check your connection and try again.</p>
          <button
            type="button"
            onClick={() => {
              setAnswer(null);
              setAttempt((n) => n + 1);
            }}
            className="mt-4 px-5 py-2.5 rounded-full text-sm font-semibold transition-opacity hover:opacity-90 active:scale-95
              focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
            style={{ background: "hsl(var(--foreground))", color: "hsl(var(--background))" }}
          >
            Retry
          </button>
        </div>
      )}
    </div>
  );
}
