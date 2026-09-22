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
import { ResultGrid, ResultCellKind, ResultRow } from "./ResultGrid";
import { PuzzleModeBadge } from "./PuzzleModeBadge";
import { X, Share2, Check, TrendingUp, Eraser, Flame, MousePointer2, History, ChevronDown, RotateCcw } from "lucide-react";
import { useState, useCallback, useEffect, useLayoutEffect, useRef, useMemo } from "react";
import { createPortal } from "react-dom";
import { useImagePreload } from "@/hooks/useImagePreload";
import type { User } from "@supabase/supabase-js";
import confetti from "canvas-confetti";
import { playRainbowSound } from "@/lib/sounds";
import { supabase } from "@/integrations/supabase/client";
import { getDeviceId, getDeviceToken, recordBonusRainbowAttempt } from "@/lib/gameStats";
import type { EntryContext } from "@/lib/entryContext";
import { isCustomEmoji, customEmojiUrl, customEmojiName } from "@/lib/customEmoji";
import { trackEvent } from "@/lib/analytics";
import { resolveTheme } from "@/lib/themes";
import { loadPlayedDifficulties } from "@/lib/puzzleVersion";
import { buildCustomShareText, buildOfficialShareText } from "@/lib/shareText";
import { customPuzzlePath } from "@/lib/customPuzzles";
import { resolveCategoryVisual, splitCategoryVisual } from "@/lib/categoryVisual";
import { DIFFICULTY_COLOR_NAME, rainbowHerringFor, type CategoryColor } from "@/lib/puzzleFormat";
import { formatActiveTime } from "@/lib/activeTimer";

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

// ── Correct-guess reveal animation (deterministic, overlay-clone based) ──
// Timings in ms, and a deliberate TWO-BEAT sequence:
//   beat 1: clones FLY from the grid into the bar's row, then fade/merge out
//           (CLONE_FADE) while the real bar quietly fades in at ~scale 1.
//   beat 2: once the clones are gone, a short PAUSE, then a distinct, bigger
//           "arrival" pop on the bar (index.css .animate-solved-arrival) so it
//           reads as a separate "category locked in" moment, not the fade.
const REVEAL_FLY_MS = 500; // must match .tile-reveal-clone position transition
const CLONE_FADE_MS = 220; // must match .tile-reveal-clone opacity transition
const ARRIVAL_PAUSE_MS = 80;
const ARRIVAL_POP_MS = 480; // must match .animate-solved-arrival duration
// The victory celebration triggers immediately when the final category's
// arrival pop finishes — no extra hold, so the pop landing and the celebration
// read as one continuous moment.
const VICTORY_HOLD_AFTER_ARRIVAL_MS = 0;
// Reduced-motion / fallback path: no clone animation plays, so reveal the
// victory UI shortly after the final category bar has appeared.
const VICTORY_REDUCED_MOTION_MS = 200;

interface RevealRect {
  top: number;
  left: number;
  width: number;
  height: number;
}

function rectToRevealRect(r: DOMRect): RevealRect {
  return { top: r.top, left: r.left, width: r.width, height: r.height };
}

interface RevealState {
  groupIdx: number;
  words: string[]; // reading order (top-to-bottom, then left-to-right)
  from: RevealRect[]; // each clone's starting rect (viewport-relative)
  to: RevealRect[] | null; // each clone's target slot within the bar (null until the bar is measured)
  phase: "cloned" | "flying" | "merging" | "arrived";
}

function prefersReducedMotion(): boolean {
  try {
    return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  } catch {
    return false;
  }
}

function getResultHeadline(isWon: boolean, mistakes: number): string {
  if (isWon && mistakes === 0) return "Perfect game! 🎯";
  if (isWon && mistakes === 1) return "Amazing! 🎉";
  if (isWon && mistakes === 2) return "Great job! 👏";
  if (isWon && mistakes === 3) return "Clutch!!! 🙌";
  return "Valiant effort 💪";
}

// Same typography/spacing/separator treatment as SolvedGroup's answer line
// — the completed Rainbow category should read as the same component
// family as the four main categories, differing only in background.
function getResultSubtitle(isWon: boolean, mistakes: number): string {
  if (isWon && mistakes === 0) return "No mistakes — impressive. Come back tomorrow!";
  if (isWon && mistakes === 1) return "Well done. Come back tomorrow!";
  if (isWon && mistakes === 2) return "Easy does it. Come back tomorrow!";
  if (isWon && mistakes === 3) return "Way to dig deep and not give up. Come back tomorrow!";
  return "Almost had it. Come back tomorrow!";
}

function StreakCelebration({ streak }: { streak: number }) {
  const [displayNum, setDisplayNum] = useState(Math.max(1, streak - 1));
  const [phase, setPhase] = useState<"counting" | "big" | "done">("counting");

  useEffect(() => {
    if (displayNum < streak) {
      const t = setTimeout(() => setDisplayNum(n => n + 1), 120);
      return () => clearTimeout(t);
    } else {
      setPhase("big");
      const t = setTimeout(() => setPhase("done"), 600);
      return () => clearTimeout(t);
    }
  }, [displayNum, streak]);

  return (
    <div className="flex justify-center mt-4 animate-fade-up">
      <div
        className={`flex items-center gap-2 bg-card border border-border rounded-full px-5 py-2.5 shadow-lg
          transition-all duration-300 ${phase === "big" ? "scale-125" : "scale-100"}`}
      >
        <Flame className="w-7 h-7 text-orange-500" />
        <span
          className="font-bold tabular-nums transition-all duration-150"
          style={{ fontSize: phase === "big" ? "1.6rem" : "1.3rem" }}
        >
          {displayNum}
        </span>
        <span className="text-sm font-semibold text-muted-foreground">
          day streak!
        </span>
      </div>
    </div>
  );
}

type PaletteMode = "select" | CategoryColor | "eraser";

// The paint-palette swatch for one category colour. bg-group-N is the exact
// same CSS custom property the SOLVED category bars use (SolvedGroup.tsx), not
// a separately hardcoded hex — see WordTile.tsx's COLOR_STYLES/COLOR_CIRCLES
// for the matching painted-tile fill and per-tile picker, which read the
// identical classes. Since --group-1..4 has no .dark override (index.css),
// these are automatically the same colour in both themes with no dark:
// variant needed. Keyed by difficulty, so a format that uses difficulties
// 2-4 (Mini: Green/Blue/Red) picks up exactly its own three swatches.
// The board instruction reads as prose, so the count is spelled out. Falls
// back to the digit for any size not listed, rather than printing nothing.
const SELECTION_COUNT_WORD: Record<number, string> = { 3: "three", 4: "four" };

const PALETTE_SWATCH_CLASS: Record<1 | 2 | 3 | 4, string> = {
  1: "bg-group-1",
  2: "bg-group-2",
  3: "bg-group-3",
  4: "bg-group-4",
};

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

export function GameBoard({ puzzle, settings, user = null, clearColorsTrigger = 0, isArchive = false, variant = "default", wideBoard = false, smallHintUsed = false, fullHintUsed = false, onHintClick, onComplete, onHintsViewOnlyChange, showModeBadge = true, entryContext = "daily_home", betaMode = false, customMode = false, statsOpen: statsOpenProp, onStatsOpenChange, onReplay }: GameBoardProps) {
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
    smallHintVisible,
    fullHintVisible,
    hintsViewOnly,
    markRainbowFound,
    handleDragStart,
    handleDragOver,
    handleDrop,
    handleTouchDragMove,
    handleTouchDragEnd,
    alreadyGuessed,
    isOfficialAttemptRef,
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
  });

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

  // Renders solved groups and the rainbow reveal in actual solve order,
  // instead of always pinning the rainbow to the top of the list.
  const boardSlots = useMemo(() => {
    const slots: ({ kind: "group"; groupIdx: number } | { kind: "rainbow" })[] =
      state.solvedGroups.map((groupIdx) => ({ kind: "group" as const, groupIdx }));
    if (state.gotRainbow && rainbowHerring) {
      const insertAt = Math.min(state.rainbowSolveIndex ?? 0, slots.length);
      slots.splice(insertAt, 0, { kind: "rainbow" as const });
    }
    return slots;
  }, [state.solvedGroups, state.gotRainbow, state.rainbowSolveIndex, rainbowHerring]);

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

  // ── Correct-guess reveal animation (deterministic, overlay-clone based) ──
  // Sequence: shake (in useGame, unchanged) -> measure the 4 real tiles ->
  // mount the solved bar hidden (still occupying its layout space, so it's
  // measurable) -> spawn 4 clones in a document.body portal positioned at
  // the tiles' exact viewport rects -> hide the real tiles (kept in the grid
  // via useGame's revealHoldGroupIdx, not removed) -> fly clones into the
  // bar's 4 slots -> cross-fade clones out / real bar in -> release the hold,
  // which is what actually removes the words from the grid's data model.
  //
  // Every rect here comes from getBoundingClientRect() and is used only
  // against position:fixed clones portaled to document.body, so it's always
  // viewport-relative on both ends — no reparented/transformed-ancestor
  // coordinate mismatch is possible.
  const wordTileRefs = useRef<Record<string, HTMLElement | null>>({});
  const revealBarRef = useRef<HTMLElement | null>(null);
  const prevRevealedGroupRef = useRef<number | null>(null);
  const revealTimersRef = useRef<ReturnType<typeof setTimeout>[]>([]);
  // Groups that have gone through (or are going through) the clone reveal.
  // Their bar cross-fades in via the `reveal` prop, so it must NOT also get
  // the normal animate-group-appear entrance once the reveal state clears.
  const cloneRevealedGroupsRef = useRef<Set<number>>(new Set());
  // Stores the remaining (non-solved) tiles' rects captured just before the
  // held words are released, so the grid can FLIP those tiles smoothly into
  // the gaps instead of snapping. Only set for a reveal-triggered release.
  const gridFlipBeforeRef = useRef<Record<string, DOMRect> | null>(null);
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

  // Kick off the reveal once a group finishes shaking (lastRevealedGroup
  // changes) and useGame is holding its tiles in the grid for us.
  useLayoutEffect(() => {
    if (lastRevealedGroup === null || lastRevealedGroup === prevRevealedGroupRef.current) return;
    prevRevealedGroupRef.current = lastRevealedGroup;
    const groupIdx = lastRevealedGroup;

    if (prefersReducedMotion()) {
      releaseRevealHold();
      // No clone animation to wait on — if this solve won the game, reveal the
      // victory UI right after the final bar appears (no full animation delay).
      if (isWonRef.current) revealVictory(true, VICTORY_REDUCED_MOTION_MS);
      return;
    }

    const words = puzzle.groups[groupIdx]?.words ?? [];
    const fromByWord: Record<string, DOMRect> = {};
    let haveAllRects = words.length === format.answersPerCategory;
    words.forEach((w) => {
      const el = wordTileRefs.current[w];
      if (el) fromByWord[w] = el.getBoundingClientRect();
      else haveAllRects = false;
    });

    if (!haveAllRects) {
      // Couldn't measure the real tiles (shouldn't normally happen) — skip
      // the clone animation rather than get stuck; just reveal plainly.
      console.warn(`[reveal] couldn't measure all ${format.answersPerCategory} tiles for group`, groupIdx, "— falling back to a plain reveal");
      releaseRevealHold();
      // Fallback still has to un-gate the victory UI on a winning solve, or the
      // results would never appear.
      if (isWonRef.current) revealVictory(true, VICTORY_REDUCED_MOTION_MS);
      return;
    }

    // Match the solved bar's own display order (SolvedGroup.tsx) so each
    // clone lands in the slot matching its final subtitle position — the
    // morph reads as continuous. Clone i starts at word i's measured grid
    // rect and flies to slot i of the bar.
    const ordered = puzzle.alphabetizeCompleted ?? true
      ? [...words].sort((a, b) => a.localeCompare(b))
      : [...words];

    cloneRevealedGroupsRef.current.add(groupIdx);
    clearRevealTimers();
    setReveal({
      groupIdx,
      words: ordered,
      from: ordered.map((w) => rectToRevealRect(fromByWord[w])),
      to: null,
      phase: "cloned",
    });
  }, [lastRevealedGroup, puzzle, format.answersPerCategory, releaseRevealHold, clearRevealTimers, revealVictory]);

  // Once the bar has mounted (hidden) for this reveal, measure it and start
  // the fly. Runs whenever `reveal` is freshly "cloned" — i.e. once per
  // reveal, right after the bar's ref is guaranteed to be populated.
  useLayoutEffect(() => {
    if (!reveal || reveal.phase !== "cloned") return;
    const barEl = revealBarRef.current;
    if (!barEl) {
      // Bar failed to mount/measure — bail out to a plain reveal rather than
      // leaving clones stuck mid-air.
      console.warn("[reveal] solved bar ref wasn't available for group", reveal.groupIdx, "— falling back to a plain reveal");
      clearRevealTimers();
      setReveal(null);
      releaseRevealHold();
      if (isWonRef.current) revealVictory(true, VICTORY_REDUCED_MOTION_MS);
      return;
    }

    const thisGroup = reveal.groupIdx;
    const barRect = barEl.getBoundingClientRect();
    const slotWidth = barRect.width / 4;
    const to: RevealRect[] = reveal.words.map((_, i) => ({
      top: barRect.top,
      left: barRect.left + i * slotWidth,
      width: slotWidth,
      height: barRect.height,
    }));

    const groupWords = new Set(reveal.words);

    requestAnimationFrame(() => requestAnimationFrame(() => {
      // Capture the remaining tiles' current positions (holes still present,
      // the selected tiles are hidden-but-laid-out), then release the hold so
      // the selected words leave the grid and the gaps close. The grid FLIP
      // effect below animates the remaining tiles old→new so they slide into
      // the gaps while the clones fly upward, instead of snapping.
      const before: Record<string, DOMRect> = {};
      Object.entries(wordTileRefs.current).forEach(([w, el]) => {
        if (el && !groupWords.has(w)) before[w] = el.getBoundingClientRect();
      });
      gridFlipBeforeRef.current = before;
      releaseRevealHold();
      setReveal((r) => (r && r.groupIdx === thisGroup ? { ...r, to, phase: "flying" } : r));
    }));

    revealTimersRef.current = [
      // Beat 1: clones fade/merge out on top while the real bar quietly fades
      // in behind them at ~scale 1 (no pop yet).
      setTimeout(() => {
        setReveal((r) => (r && r.groupIdx === thisGroup ? { ...r, phase: "merging" } : r));
      }, REVEAL_FLY_MS),
      // Beat 2: clones are gone + a brief pause -> the bar does its distinct
      // arrival pop, so it reads as a separate "locked in" moment.
      setTimeout(() => {
        setReveal((r) => (r && r.groupIdx === thisGroup ? { ...r, phase: "arrived" } : r));
      }, REVEAL_FLY_MS + CLONE_FADE_MS + ARRIVAL_PAUSE_MS),
      // Tear the clones down once the arrival pop has played out. (The hold was
      // released at fly-start, so the grid closed long ago.) This is also the
      // moment the FINAL category has fully "landed": if the game is won by now,
      // un-gate the victory celebration immediately (no extra hold) so confetti,
      // sound, haptics, streak, and results all start together with the pop's
      // finish. isWonRef is read at fire time (not captured earlier), so it
      // can't be stale — and input is locked during the reveal, so a non-final
      // group's timer can never see a win that hadn't happened when its pop
      // started.
      setTimeout(() => {
        setReveal((r) => (r && r.groupIdx === thisGroup ? null : r));
        if (isWonRef.current) revealVictory(true, VICTORY_HOLD_AFTER_ARRIVAL_MS);
      }, REVEAL_FLY_MS + CLONE_FADE_MS + ARRIVAL_PAUSE_MS + ARRIVAL_POP_MS),
    ];
  }, [reveal, releaseRevealHold, clearRevealTimers, revealVictory]);

  // Grid FLIP: after a reveal releases its held words (gaps close), slide the
  // remaining tiles from their old positions into their new ones with a
  // transform, rather than letting them jump.
  useLayoutEffect(() => {
    const before = gridFlipBeforeRef.current;
    if (!before) return;
    gridFlipBeforeRef.current = null;

    const FLIP_MS = 350;
    Object.keys(before).forEach((w) => {
      const el = wordTileRefs.current[w];
      if (!el) return;
      const after = el.getBoundingClientRect();
      const dx = before[w].left - after.left;
      const dy = before[w].top - after.top;
      if (Math.abs(dx) < 0.5 && Math.abs(dy) < 0.5) return;

      // Invert: start the tile visually at its OLD spot, then animate to none.
      el.style.transition = "none";
      el.style.transform = `translate(${dx}px, ${dy}px)`;
      requestAnimationFrame(() => {
        el.style.transition = `transform ${FLIP_MS}ms cubic-bezier(0.2, 0, 0, 1)`;
        el.style.transform = "";
      });
      window.setTimeout(() => {
        // Clear inline styles so nothing lingers on the tile afterward.
        if (el.style.transition.includes("transform")) {
          el.style.transition = "";
          el.style.transform = "";
        }
      }, FLIP_MS + 60);
    });
  }, [remainingWords]);

  useEffect(() => clearRevealTimers, [clearRevealTimers]);
  useEffect(() => clearVictoryTimers, [clearVictoryTimers]);

  // If this GameBoard instance is reused for a different puzzle (e.g. archive
  // browsing without a remount), drop any in-flight reveal rather than risk
  // it referencing stale words/groups from the previous puzzle.
  useEffect(() => {
    clearRevealTimers();
    clearVictoryTimers();
    setReveal(null);
    setVictoryRevealReady(false);
    wordTileRefs.current = {};
    revealBarRef.current = null;
    prevRevealedGroupRef.current = null;
    cloneRevealedGroupsRef.current = new Set();
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

  const [streakBefore, setStreakBefore] = useState<number | null>(null);
  const [showStreak, setShowStreak] = useState(false);
  const prevIsComplete = useRef(false);
  const prevGotRainbow = useRef(state.gotRainbow);

  useEffect(() => {
    // Beta mode never calls record_streak (see useGame's commitOfficialResult),
    // so a beta win can never actually be "day N" of the real streak — showing
    // this banner here would read the player's genuine current_streak and
    // display it as if THIS win had just extended it, directly contradicting
    // the "won't affect your official stats or streak" banner on the page.
    if (isArchive || betaMode || customMode) return;
    const fetchStreakBefore = async () => {
      try {
        // user_streaks is RPC-only now; the function resolves account vs
        // proven-device ownership server-side.
        // Scoped to THIS format: the celebration says "day N streak" about
        // the game that was just won, so a Mini win must never display the
        // player's Full streak (or extend the wrong one in the copy).
        const { data } = await supabase.rpc("get_own_streak", {
          _device_id: getDeviceId(),
          _device_token: getDeviceToken(),
          _format: format.statsNamespace,
        });
        const row = Array.isArray(data) ? data[0] : data;
        if (row?.current_streak != null) setStreakBefore(row.current_streak);
      } catch {}
    };
    void fetchStreakBefore();
  }, [isArchive, betaMode, customMode, format.statsNamespace]);

  // Streak celebration is part of the victory moment, so it waits for the same
  // reveal gate. Gating on `lastRevealedGroup !== null` keeps it to LIVE wins:
  // a solve happened this session. A restored/hydrated completed game never set
  // lastRevealedGroup, so it won't re-show the streak — and this stays correct
  // even if the completed state hydrates asynchronously.
  useEffect(() => {
    if (victoryRevealReady && state.isWon && lastRevealedGroup !== null && !isArchive && !betaMode && !customMode) {
      setShowStreak(true);
    }
  }, [victoryRevealReady, state.isWon, lastRevealedGroup, isArchive, betaMode, customMode]);

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
      if (canPersist) {
        void recordBonusRainbowAttempt({
          sessionId,
          guessNumber: nextGuessNumber(attemptOffset),
          words,
          correct,
          guessedAt,
          activeTimeSeconds,
          groupsSolved: state.solvedGroups.length,
        });
      }

      setTimeout(() => setBonusRainbowCorrect(correct), correct ? 600 : 0);
    }, 400);
  }, [rainbowHerring, markRainbowFound, isOfficialAttemptRef, sessionIdRef, activeSecondsRef, nextGuessNumber, state.solvedGroups.length, betaMode]);

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

  const streakToShow = streakBefore != null ? streakBefore + 1 : 1;

  // Gate for the end-of-game results/share section. A WON game waits for the
  // victory reveal (final arrival pop finished); a LOST game shows immediately
  // as before, since it has no victory animation to wait on.
  const showEndState = state.isComplete && (!state.isWon || victoryRevealReady);

  // The solved-rainbow reveal card (both the direct-guess and Spot the
  // Rainbow paths below) isn't itself gated by the Rainbow Animation
  // setting today, but should still show the same static treatment as the
  // tiles when it's off — for the default theme only; a themed (non-
  // default) bonus's gradient is a fixed image regardless of this setting.
  const rainbowCardStatic = theme.isDefault && !showRainbow;
  const rainbowCardBg = rainbowCardStatic ? "var(--rainbow-static-gradient)" : theme.gradient;
  const rainbowCardTextClass = rainbowCardStatic ? "text-[#292825]" : "text-white";
  const rainbowCardTextShadow = rainbowCardStatic ? undefined : theme.textShadow;

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
      <p className="text-center font-sans text-[clamp(13px,4.2vw,16px)] font-bold tracking-wide text-foreground mb-2">
        Select {SELECTION_COUNT_WORD[format.answersPerCategory] ?? format.answersPerCategory} words that share a connection!
      </p>

      {/* Color Palette Mode buttons. Fixed position: directly under the
          instruction and ABOVE the solved bars, so solving a category never
          moves it. Order: instruction, palette, solved bars, remaining board. */}
      {colorPaletteMode && remainingWords.length > 0 && (
        <div className="flex items-center justify-center gap-2 mb-3">
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
              Full gets Yellow/Green/Blue/Red, Mini gets Green/Blue/Red. See
              PALETTE_SWATCH_CLASS for why these are the solved-bar variables
              rather than hardcoded hexes. */}
          {format.difficultyOrder.map((difficulty) => {
            const color = DIFFICULTY_COLOR_NAME[difficulty];
            const label = color.charAt(0).toUpperCase() + color.slice(1);
            return (
              <button
                key={color}
                onClick={() => setPaletteMode(color)}
                className={`w-10 h-10 rounded-lg ${PALETTE_SWATCH_CLASS[difficulty]} hover:scale-110 transition-all
                  ${paletteMode === color ? "ring-2 ring-foreground ring-offset-2 ring-offset-background scale-110" : ""}`}
                aria-label={`${label} paint`}
              />
            );
          })}
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
      )}

      {/* Compact board wrapper — Mini only (see isMiniBoard above). Caps the
          solved bars, Rainbow reveal bar and tile grid together at ~330px so
          they all share one width and stop growing past it, while every
          other element on the page (instruction, controls, mistakes/timer
          row) is unaffected because it lives outside this div. */}
      <div className={isMiniBoard ? "w-full max-w-[330px] mx-auto" : undefined}>
      {/* Solved groups — rainbow is interleaved at the position it was actually
          found (boardSlots), not always pinned to the top */}
      <div className="space-y-2 mb-2">
        {boardSlots.map((slot) =>
          slot.kind === "rainbow" ? (
            <RainbowRevealBar
              key="rainbow-reveal"
              categoryName={puzzle.rainbowCategoryName}
              categoryEmoji={puzzle.rainbowCategoryEmoji}
              theme={theme}
              words={rainbowHerring!}
              alphabetizeCompleted={puzzle.alphabetizeCompleted ?? true}
              textClass={rainbowCardTextClass}
              background={rainbowCardBg}
              textShadow={rainbowCardTextShadow}
              curtain={rainbowVisible}
            />
          ) : (
            <SolvedGroup
              key={slot.groupIdx}
              ref={reveal?.groupIdx === slot.groupIdx ? (el) => { revealBarRef.current = el; } : undefined}
              group={puzzle.groups[slot.groupIdx]}
              alphabetizeCompleted={puzzle.alphabetizeCompleted ?? true}
              // animate-group-appear is only for bars that DIDN'T go through the
              // clone reveal (reduced-motion path, loss cascade). Clone-revealed
              // bars cross-fade in via the `reveal` prop instead.
              animate={slot.groupIdx === lastRevealedGroup && !cloneRevealedGroupsRef.current.has(slot.groupIdx)}
              reveal={
                reveal?.groupIdx === slot.groupIdx
                  ? (reveal.phase === "arrived"
                      ? "arrived"
                      : reveal.phase === "merging"
                        ? "shown"
                        : "hidden")
                  : undefined
              }
            />
          )
        )}

        {showEndState && !state.gotRainbow && rainbowHerring && (
          bonusRainbowCorrect === null ? (
            <button
              onClick={() => setShowSpotModal(true)}
              className="w-full rounded-lg py-3 px-4 text-center text-white
                hover:opacity-90 transition-opacity active:scale-[0.99]
                animate-rainbow-breathe animate-rainbow-shimmer"
              style={{ background: theme.gradient, textShadow: theme.textShadow }}
            >
              <div className="font-tile font-bold text-[16px] md:text-[19px] leading-tight uppercase tracking-wide">{theme.spotPrompt}</div>
              <div className="text-[13px] md:text-[15px] font-[575] leading-tight mt-0.5">Find one word from each group</div>
            </button>
          ) : (
            <RainbowRevealBar
              categoryName={puzzle.rainbowCategoryName}
              categoryEmoji={puzzle.rainbowCategoryEmoji}
              theme={theme}
              words={rainbowHerring}
              alphabetizeCompleted={puzzle.alphabetizeCompleted ?? true}
              textClass={rainbowCardTextClass}
              background={rainbowCardBg}
              textShadow={rainbowCardTextShadow}
              curtain={rainbowVisible}
            />
          )
        )}
      </div>

      {/* Word grid */}
      {remainingWords.length > 0 && (
        <div className="relative">
          {/* Columns come from the format (4 on Full, 3 on Mini) as an inline
              grid-template rather than a `grid-cols-N` class, because Tailwind
              only emits the classes it can see in the source and a computed
              class name would be purged from the production build. */}
          <div
            className={`grid ${isMiniBoard ? "gap-2" : `gap-1.5 ${useWideBoard ? "md:gap-3" : ""}`} ${shaking || spotShaking ? "animate-shake" : ""}`}
            style={{ gridTemplateColumns: `repeat(${format.columns}, minmax(0, 1fr))` }}
          >
          {remainingWords.map((word, index) => {
            const isRevealingWord = reveal?.words.includes(word) ?? false;
            return (
              <WordTile
                key={word}
                ref={(el) => { wordTileRefs.current[word] = el; }}
                word={word}
                isSelected={state.selectedWords.includes(word)}
                isRainbow={
                  rainbowWords.includes(word) ||
                  bonusRainbowWords.includes(word)
                }
                rainbowGradient={theme.isDefault ? undefined : theme.gradient}
                rainbowTextShadow={theme.textShadow}
                rainbowAnimated={showRainbow}
                isMatched={matchedWords.includes(word)}
                hiddenForReveal={isRevealingWord}
                isChecking={checkingWords.includes(word)}
                checkingIndex={checkingStagger[word] ?? 0}
                onClick={() => handleTileClick(word)}
                disabled={state.isComplete || matchedWords.length > 0 || reveal !== null || isChecking}
                arrangeTiles={arrangeTiles}
                colorCodeTiles={colorCodeTiles}
                tileColor={tileColors[word] ?? null}
                onColorChange={setTileColor}
                draggable={arrangeTiles}
                onDragStart={handleDragStart}
                onDragOver={handleDragOver}
                onDrop={handleDrop}
                onTouchDragMove={handleTouchDragMove}
                column={(index % format.columns) + 1}
                columnCount={format.columns}
                onTouchDragEnd={handleTouchDragEnd}
                isEmojiPuzzle={puzzle.isEmojiPuzzle ?? false}
                colorPaletteMode={colorPaletteMode}
                isPaintMode={colorPaletteMode && paletteMode !== "select"}
                squareTiles={isMiniBoard}
                data-word={word}
              />
            );
          })}
          </div>
        </div>
      )}
      </div>

      {/* Correct-guess reveal overlay: clones portaled to document.body so
          every measurement here is viewport-relative, with no risk of a
          reparented/transformed-ancestor coordinate mismatch. */}
      {reveal && typeof document !== "undefined" && createPortal(
        reveal.words.map((word, i) => {
          const rect = reveal.phase === "cloned" || !reveal.to ? reveal.from[i] : reveal.to[i];
          // Faded out from the merge beat onward (and stay gone through the
          // arrival pop) so they never reappear over the popping bar.
          const faded = reveal.phase === "merging" || reveal.phase === "arrived";
          return (
            <div
              key={word}
              className="tile-reveal-clone flex items-center justify-center rounded-lg font-semibold text-xs sm:text-sm uppercase tracking-wide bg-tile-selected text-tile-selected-fg shadow-md"
              style={{
                top: rect.top,
                left: rect.left,
                width: rect.width,
                height: rect.height,
                // Fade AND scale down while the real bar fades in underneath
                // them (z-index 60 keeps clones on top). transformOrigin center
                // so they shrink in place.
                opacity: faded ? 0 : 1,
                transform: faded ? "scale(0.9)" : "scale(1)",
                transformOrigin: "center",
              }}
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
        }),
        document.body
      )}

      {/* Rainbow Spotted popup — animated (or static, per the Rainbow
          Animation setting) rainbow-tile for the default theme; themed
          gradients are already static images and always show regardless
          of that setting, same as the actual game tiles. Static uses dark
          ink text (better contrast on that softer gradient); animated and
          themed keep the original white text. */}
      {showRainbowPopup && (
        <div className="flex justify-center mt-3 animate-fade-up">
          <div
            className={`${
              theme.isDefault
                ? showRainbow ? "rainbow-tile text-white" : "rainbow-tile-static text-[#292825]"
                : "text-white"
            } px-6 py-2.5 rounded-full text-sm font-bold shadow-lg`}
            style={!theme.isDefault ? { background: theme.gradient, textShadow: theme.textShadow } : undefined}
          >
            {theme.spottedMessage}
          </div>
        </div>
      )}

      {/* Almost 🌈 takes priority over One Away */}
      {almostRainbow ? (
        <div className="flex justify-center mt-3 animate-fade-up">
          <div className="bg-foreground text-background pl-5 pr-3 py-2 rounded-full text-sm font-semibold shadow-md flex items-center gap-2">
            {theme.almostMessage}
            <button
              onClick={() => setAlmostRainbow(false)}
              className="w-5 h-5 rounded-full bg-background/20 hover:bg-background/30 flex items-center justify-center transition-colors active:scale-95"
              aria-label="Dismiss"
            >
              <X className="w-3 h-3" />
            </button>
          </div>
        </div>
      ) : oneAway ? (
        <div className="flex justify-center mt-3 animate-fade-up">
          <div className="bg-foreground text-background pl-5 pr-3 py-2 rounded-full text-sm font-semibold shadow-md flex items-center gap-2">
            One away…
            <button
              onClick={() => setOneAway(false)}
              className="w-5 h-5 rounded-full bg-background/20 hover:bg-background/30 flex items-center justify-center transition-colors active:scale-95"
              aria-label="Dismiss"
            >
              <X className="w-3 h-3" />
            </button>
          </div>
        </div>
      ) : null}

      {/* Already Guessed popup */}
      {alreadyGuessed && (
        <div className="flex justify-center mt-3 animate-fade-up">
          <div className="bg-foreground text-background px-5 py-2 rounded-full text-sm font-semibold shadow-md">
            {alreadyGuessed === "oneaway" ? "Already guessed — and one away!" : "Already guessed!"}
          </div>
        </div>
      )}

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
        <div className="mt-4 w-full flex items-center justify-center">
          <MistakeDots mistakes={state.mistakes} max={state.maxMistakes} />
        </div>
      )}

      {/* Controls — a 3-column grid so Shuffle/Clear/Submit are always
          exactly equal width and the row spans close to the board's own
          width (100% on mobile, 80% on desktop), rather than three
          fixed-width buttons floating narrower than the grid above them. */}
      {!state.isComplete && (
        <>
          <div className="w-full md:w-[80%] mx-auto grid grid-cols-3 gap-2 mt-3">
            <button
              onClick={shuffle}
              disabled={isChecking || reveal !== null}
              className={`w-full ${isMiniBoard ? "h-12" : "h-14"} rounded-full text-sm md:text-base font-bold transition-colors
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
              onClick={deselectAll}
              disabled={state.selectedWords.length === 0 || isChecking || reveal !== null}
              className={`w-full ${isMiniBoard ? "h-12" : "h-14"} rounded-full text-sm md:text-base font-bold transition-colors
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
              onClick={submitGuess}
              disabled={state.selectedWords.length !== format.answersPerCategory || isChecking || reveal !== null}
              className={`w-full ${isMiniBoard ? "h-12" : "h-14"} rounded-full text-sm md:text-base font-bold text-white transition-all
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
          {(colorCodeTiles || colorPaletteMode) && hasAnyColor && (
            // Same w-full md:w-[80%] mx-auto grid-cols-3 gap-2 math as the
            // Shuffle/Deselect All/Submit row above, with the button in the
            // center column only — guarantees this matches one of those
            // buttons' width exactly (not an eyeballed value) while staying
            // centered, rather than sizing its own single-button container.
            <div className="w-full md:w-[80%] mx-auto grid grid-cols-3 gap-2 mt-3">
              <div aria-hidden="true" />
              <button
                onClick={clearAllColors}
                className="w-full h-12 rounded-full text-sm md:text-base font-bold transition-colors
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
        <div className="mt-3 rounded-2xl bg-card border border-border overflow-hidden">
          <button
            onClick={() => setHistoryExpanded((v) => !v)}
            aria-expanded={historyExpanded}
            className="relative w-full px-4 py-3 text-center hover:bg-secondary/40 transition-colors"
          >
            {/* Centered relative to the full card width — the chevron below
                is positioned absolutely so it doesn't shift this group off
                center. */}
            <span className="flex items-center justify-center gap-2">
              <History className="w-4 h-4 text-muted-foreground shrink-0" />
              <span className="text-sm font-bold text-foreground">Guess History</span>
            </span>
            <ChevronDown
              className={`absolute right-4 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground shrink-0 transition-transform duration-200 ${
                historyExpanded ? "rotate-180" : ""
              }`}
            />
          </button>
          {historyExpanded && (
            <div className="px-4 pb-3 divide-y divide-border">
              {incorrectGuesses.map((g, i) => {
                const sorted = [...g.words].sort((a, b) => a.localeCompare(b));
                // Reuse the guess's own stored feedback (set at guess-time in
                // useGame.ts) rather than re-deriving one-away/rainbow status
                // from the final solved categories.
                const label = g.isAlmostRainbow
                  ? "One Away 🌈"
                  : g.isOneAway
                    ? "One Away"
                    : "Incorrect";

                return (
                  <div key={i} className="py-2 text-center first:pt-0 last:pb-0">
                    <p className="text-xs font-semibold text-muted-foreground mb-1">{label}</p>
                    {/* Equal-width grid, one column per answer in a guess (4 on
                        Full, 3 on Mini), matching the Spot the Rainbow
                        selection rows — cell width never varies with word
                        length, and grid rows keep every cell the same
                        height even when one wraps to two lines. */}
                    <div
                      className="grid gap-1"
                      style={{ gridTemplateColumns: `repeat(${format.answersPerCategory}, minmax(0, 1fr))` }}
                    >
                      {sorted.map((w, j) => (
                        <span
                          key={`${w}-${j}`}
                          className="flex items-center justify-center min-w-0 bg-secondary text-foreground rounded-md px-0.5 py-1.5 text-[11px] sm:text-xs md:text-sm font-medium text-center leading-tight"
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

      {/* Streak celebration */}
      {showStreak && <StreakCelebration streak={streakToShow} />}

      {/* End state — hide headline/subtitle when viewing already-completed puzzle */}
      {showEndState && (
        <div className="text-center mt-6 animate-fade-up">
          {!wasAlreadyComplete.current && (
            <>
              <p className="text-lg font-bold">
                {getResultHeadline(state.isWon, state.mistakes)}
              </p>
              <p className="text-sm text-muted-foreground mt-1">
                {getResultSubtitle(state.isWon, state.mistakes)}
              </p>
            </>
          )}

          {/* The frozen solve time. Shown on a timed format for any finished
              run — including one being revisited later, where the headline
              above is suppressed — because "how long did that take me?" is
              exactly what someone reopening a finished Mini wants to see.
              Zero seconds is not rendered: a restored legacy run that never
              recorded a time should say nothing rather than claim "0s". */}
          {format.showsTimer && activeSeconds > 0 && (
            <p className="text-sm font-semibold tabular-nums mt-2">
              ⏳ {formatActiveTime(activeSeconds)}
            </p>
          )}

          {state.guessHistory.length > 0 && (
            <div className="mt-4 space-y-3">
              {/* Custom brand-color visual grid — decorative only. The
                  copied Share Score text below is built from
                  generateShareLines()/generateShareText() exactly as
                  before and is unaffected by this. */}
              <ResultGrid rows={resultRows} />
              <div className="flex flex-wrap items-center justify-center gap-3">
                <button
                  onClick={handleShare}
                  className="inline-flex items-center gap-2 px-5 py-2.5 rounded-full bg-primary text-primary-foreground text-sm font-semibold
                    hover:opacity-90 transition-all duration-150 active:scale-95 shadow-md"
                >
                  {copied ? <Check className="w-4 h-4" /> : <Share2 className="w-4 h-4" />}
                  {copied ? "Copied!" : "Share Score"}
                </button>
                {/* Global Stats reads real official completions for this
                    puzzle id — meaningless (and potentially confusing) for a
                    puzzle that structurally can never have any while it's in
                    Beta. Custom puzzles get their OWN lightweight stats
                    button/modal instead of losing this row entirely — see
                    CustomStatsModal below. */}
                {!betaMode && (
                  <button
                    onClick={() => setShowGlobalStats(true)}
                    className="inline-flex items-center gap-2 px-5 py-2.5 rounded-full border border-border text-sm font-semibold
                      hover:bg-secondary transition-all duration-150 active:scale-95 shadow-md"
                  >
                    <TrendingUp className="w-4 h-4" /> {customMode ? "Results" : "Global Stats"}
                  </button>
                )}
                {customMode && onReplay && (
                  <button
                    onClick={onReplay}
                    className="inline-flex items-center gap-2 px-5 py-2.5 rounded-full border border-border text-sm font-semibold
                      hover:bg-secondary transition-all duration-150 active:scale-95 shadow-md"
                  >
                    <RotateCcw className="w-4 h-4" /> Replay
                  </button>
                )}
              </div>
            </div>
          )}
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
