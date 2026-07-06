import { Puzzle } from "@/lib/types";
import { GameSettings } from "@/lib/settings";
import { useGame } from "@/hooks/useGame";
import { WordTile } from "./WordTile";
import { SolvedGroup } from "./SolvedGroup";
import { MistakeDots } from "./MistakeDots";
import { DailyStatsModal } from "./DailyStatsModal";
import { SpotTheRainbowModal } from "./SpotTheRainbowModal";
import { SillySaturdayModal } from "./SillySaturdayModal";
import { PuzzleRating } from "./PuzzleRating";
import { Shuffle, Send, X, Share2, Check, TrendingUp, Eraser, Flame, MousePointer2 } from "lucide-react";
import { useState, useCallback, useEffect, useLayoutEffect, useRef, useMemo } from "react";
import { useImagePreload } from "@/hooks/useImagePreload";
import type { User } from "@supabase/supabase-js";
import confetti from "canvas-confetti";
import { playRainbowSound } from "@/lib/sounds";
import { supabase } from "@/integrations/supabase/client";
import { getDeviceId, markRainbowFoundInSession } from "@/lib/gameStats";
import { isCustomEmoji, customEmojiUrl, customEmojiName } from "@/lib/customEmoji";
import { trackEvent } from "@/lib/analytics";
import { resolveTheme } from "@/lib/themes";

const TOOLTIP_MSG = "This puzzle has no Rainbow category.";

function extractTrailingEmojis(str: string): string {
  try {
    const segmenter = new Intl.Segmenter();
    const segments = [...segmenter.segment(str)].map(s => s.segment);
    const emojiRegex = /\p{Emoji}/u;
    const result: string[] = [];
    for (let i = segments.length - 1; i >= 0; i--) {
      const seg = segments[i].trim();
      if (seg === "") continue;
      if (emojiRegex.test(seg)) {
        result.unshift(seg);
      } else {
        break;
      }
    }
    return result.join("");
  } catch {
    return "";
  }
}

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

// ── Correct-guess fly-up + merge timing ──
// Must match useGame's MATCH_SHAKE_MS (the shake plays first, then this
// overlay takes over): tiles slide from their grid spot into a row aligned
// with the solved bar (FLY_MS), then cross-fade into the solid bar (MERGE_MS).
const FLY_MS = 380;
const MERGE_MS = 220;

interface FlyRect {
  top: number;
  left: number;
  width: number;
  height: number;
}

function rectToFlyRect(r: DOMRect): FlyRect {
  return { top: r.top, left: r.left, width: r.width, height: r.height };
}

interface FlyingGroupState {
  groupIdx: number;
  words: string[]; // left-to-right / reading order
  from: FlyRect[]; // where each tile currently sits in the grid
  to: FlyRect[]; // its slot within the solved bar's row
  phase: "start" | "moving" | "merging";
}

function NoRainbowIndicator() {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    function handleClick(e: MouseEvent | TouchEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    document.addEventListener("mousedown", handleClick);
    document.addEventListener("touchstart", handleClick);
    return () => {
      document.removeEventListener("mousedown", handleClick);
      document.removeEventListener("touchstart", handleClick);
    };
  }, [open]);

  return (
    <div ref={ref} className="relative flex-shrink-0" style={{ lineHeight: 0 }}>
      <button
        type="button"
        aria-label={TOOLTIP_MSG}
        onClick={() => setOpen((v) => !v)}
        className="group focus:outline-none"
        style={{ background: "none", border: "none", padding: 0, cursor: "pointer" }}
      >
        <img
          src="/no-rainbow.png"
          alt="No rainbow"
          style={{ height: "48px", width: "auto", display: "block" }}
        />
        <span
          className="pointer-events-none absolute bottom-full left-1/2 -translate-x-1/2 mb-2
            whitespace-nowrap rounded-md px-2.5 py-1.5 text-xs font-medium shadow-md
            bg-foreground text-background
            opacity-0 group-hover:opacity-100 transition-opacity duration-150
            hidden sm:block"
        >
          {TOOLTIP_MSG}
        </span>
      </button>

      {open && (
        <div
          className="absolute bottom-full right-0 mb-2 z-50
            rounded-xl px-3 py-2 text-xs font-medium shadow-lg text-center
            bg-foreground text-background sm:hidden"
          style={{ width: "max-content", maxWidth: "220px" }}
        >
          {TOOLTIP_MSG}
        </div>
      )}
    </div>
  );
}

function getResultHeadline(isWon: boolean, mistakes: number): string {
  if (isWon && mistakes === 0) return "Perfect game! 🎯";
  if (isWon && mistakes === 1) return "Amazing! 🎉";
  if (isWon && mistakes === 2) return "Great job! 👏";
  if (isWon && mistakes === 3) return "Clutch!!! 🙌";
  return "Valiant effort 💪";
}

function RainbowWordsRow({ words }: { words: string[] }) {
  return (
    <div className="text-xs mt-0.5 opacity-90 flex items-center justify-center flex-wrap gap-x-1 gap-y-0.5">
      {words.map((w, i) => (
        <span key={`${w}-${i}`} className="inline-flex items-center">
          {isCustomEmoji(w) ? (
            <img
              src={customEmojiUrl(w)}
              alt={customEmojiName(w) ?? ""}
              draggable={false}
              style={{ height: "28px", width: "auto", objectFit: "contain" }}
            />
          ) : (
            w
          )}
          {i < words.length - 1 && <span>,</span>}
        </span>
      ))}
    </div>
  );
}

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

type PaletteMode = "select" | "yellow" | "green" | "blue" | "red" | "eraser";

interface GameBoardProps {
  puzzle: Puzzle;
  settings?: GameSettings;
  user?: User | null;
  clearColorsTrigger?: number;
  isArchive?: boolean;
  smallHintUsed?: boolean;
  fullHintUsed?: boolean;
  onHintClick?: () => void;
  onComplete?: () => void;
}

export function GameBoard({ puzzle, settings, user = null, clearColorsTrigger = 0, isArchive = false, smallHintUsed = false, fullHintUsed = false, onHintClick, onComplete }: GameBoardProps) {
  const showRainbow = settings?.showRainbowColors ?? true;
  const arrangeTiles = settings?.arrangeTiles ?? false;
  const colorCodeTiles = settings?.colorCodeTiles ?? false;
  const colorPaletteMode = settings?.colorPaletteMode ?? false;

  const {
    state,
    remainingWords,
    toggleWord,
    deselectAll,
    shuffle,
    submitGuess,
    shaking,
    lastRevealedGroup,
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
  } = useGame(puzzle, { isArchive, smallHintUsed, fullHintUsed });

  // Preload custom emoji images so they don't pop in after the board renders
  const imagesToPreload = useMemo(() => {
    const words = [
      ...puzzle.groups.flatMap((g) => g.words),
      ...(puzzle.rainbowHerring ?? []),
    ];
    return words.filter(isCustomEmoji).map((w) => customEmojiUrl(w));
  }, [puzzle]);
  const imagesReady = useImagePreload(imagesToPreload);

  const [historyExpanded, setHistoryExpanded] = useState(true);
  const incorrectGuesses = useMemo(
    () => state.guessHistory.filter((a) => !a.isCorrect && !a.isRainbow && !a.isHintMarker),
    [state.guessHistory],
  );

  // Visual theme for the bonus category (gradient/emoji/copy). Defaults to the
  // classic rainbow when the puzzle has no theme set.
  const theme = useMemo(() => resolveTheme(puzzle.theme), [puzzle.theme]);

  // Renders solved groups and the rainbow reveal in actual solve order,
  // instead of always pinning the rainbow to the top of the list.
  const boardSlots = useMemo(() => {
    const slots: ({ kind: "group"; groupIdx: number } | { kind: "rainbow" })[] =
      state.solvedGroups.map((groupIdx) => ({ kind: "group" as const, groupIdx }));
    if (state.gotRainbow && puzzle.rainbowHerring) {
      const insertAt = Math.min(state.rainbowSolveIndex ?? 0, slots.length);
      slots.splice(insertAt, 0, { kind: "rainbow" as const });
    }
    return slots;
  }, [state.solvedGroups, state.gotRainbow, state.rainbowSolveIndex, puzzle.rainbowHerring]);

  // ── Correct-guess fly-up + merge animation (FLIP-style) ──
  // After the shake, the 4 matched tiles fly from their grid position into a
  // row aligned with the solved bar, then cross-fade into the solid bar —
  // instead of shrinking/fading away in place while the bar just pops in.
  //
  // flyingGroups is a queue (not a single slot): if a player is fast enough to
  // land a second correct guess before the first group's overlay has finished
  // (matchedWords only gates the ~350ms shake, not the ~600ms flight), a
  // single shared slot would get overwritten mid-flight and its cleanup
  // timers would silently no-op, orphaning fixed-position tiles on screen
  // forever. Each group's lifecycle here is fully independent.
  const gridRef = useRef<HTMLDivElement>(null);
  const groupBarRefs = useRef<Record<number, HTMLDivElement | null>>({});
  const matchedFromRectsRef = useRef<Record<string, DOMRect>>({});
  const prevRevealedGroupRef = useRef<number | null>(null);
  const flyTimersRef = useRef<Record<number, ReturnType<typeof setTimeout>[]>>({});
  const [flyingGroups, setFlyingGroups] = useState<FlyingGroupState[]>([]);
  // Groups whose bar is cleared to reveal itself (either the fly+merge
  // sequence finished, or it was skipped because measurement wasn't
  // possible). See the pendingMerge note below for why this exists.
  const [settledGroups, setSettledGroups] = useState<Set<number>>(new Set());
  const markSettled = useCallback((groupIdx: number) => {
    setSettledGroups((prev) => (prev.has(groupIdx) ? prev : new Set(prev).add(groupIdx)));
  }, []);

  const findTileEl = useCallback((word: string): HTMLElement | null => {
    const els = gridRef.current?.querySelectorAll<HTMLElement>("[data-word]");
    if (!els) return null;
    for (const el of els) {
      if (el.dataset.word === word) return el;
    }
    return null;
  }, []);

  const measureBarSlots = useCallback((barEl: HTMLElement, count: number): FlyRect[] => {
    const barRect = barEl.getBoundingClientRect();
    const slotWidth = barRect.width / count;
    return Array.from({ length: count }, (_, i) => ({
      top: barRect.top,
      left: barRect.left + i * slotWidth,
      width: slotWidth,
      height: barRect.height,
    }));
  }, []);

  // Capture each matched tile's current on-screen position while it's still
  // in the grid (mid-shake), before it gets removed once solvedGroups updates.
  useLayoutEffect(() => {
    if (matchedWords.length === 0) return;
    const rects: Record<string, DOMRect> = {};
    matchedWords.forEach((w) => {
      const el = findTileEl(w);
      if (el) rects[w] = el.getBoundingClientRect();
    });
    matchedFromRectsRef.current = { ...matchedFromRectsRef.current, ...rects };
  }, [matchedWords, findTileEl]);

  // Kick off the fly-up once a new group actually lands in solvedGroups (the
  // grid tiles vanish and the solved bar appears in this same render — we
  // measure its position and animate the captured "from" rects into it).
  //
  // Bug this fixes: pendingMerge used to only become true once this effect
  // ran setFlyingGroups, which is a render *after* lastRevealedGroup changes.
  // On that first render, the brand-new bar rendered with pendingMerge=false
  // and animate=true, so it started playing its own animate-group-appear
  // (opacity + scaleY) reveal immediately. Then getBoundingClientRect() below
  // forces a synchronous layout read — capturing the bar mid-keyframe
  // (scaleY(0.85), not its resting size) as the fly target. That happened on
  // every single solve, not just overlapping ones. Now pendingMerge (see
  // below) is derived so it's already true on that very first render, so the
  // bar can never get its entrance animation before this measurement runs.
  useLayoutEffect(() => {
    if (lastRevealedGroup === null || lastRevealedGroup === prevRevealedGroupRef.current) return;
    prevRevealedGroupRef.current = lastRevealedGroup;
    const thisGroup = lastRevealedGroup;

    const words = puzzle.groups[thisGroup]?.words ?? [];
    const barEl = groupBarRefs.current[thisGroup];
    const fromByWord = matchedFromRectsRef.current;
    const haveAllRects = barEl && words.length === 4 && words.every((w) => fromByWord[w]);
    if (!haveAllRects) {
      // e.g. loss auto-reveal never populated matchedWords — nothing to fly,
      // so just let the bar reveal itself plainly instead of staying hidden.
      markSettled(thisGroup);
      return;
    }

    // Reading order (top-to-bottom, then left-to-right) so tiles slide into
    // their row without crossing paths.
    const ordered = [...words].sort((a, b) => {
      const ra = fromByWord[a];
      const rb = fromByWord[b];
      return Math.abs(ra.top - rb.top) > 4 ? ra.top - rb.top : ra.left - rb.left;
    });

    setFlyingGroups((groups) => [
      ...groups,
      {
        groupIdx: thisGroup,
        words: ordered,
        from: ordered.map((w) => rectToFlyRect(fromByWord[w])),
        to: measureBarSlots(barEl!, ordered.length),
        phase: "start",
      },
    ]);

    const setPhase = (phase: FlyingGroupState["phase"]) =>
      setFlyingGroups((groups) => groups.map((g) => (g.groupIdx === thisGroup ? { ...g, phase } : g)));
    const remove = () => {
      setFlyingGroups((groups) => groups.filter((g) => g.groupIdx !== thisGroup));
      markSettled(thisGroup);
    };

    requestAnimationFrame(() => requestAnimationFrame(() => {
      // Re-measure right before the transition starts (rather than reusing
      // the rect from the commit above) as extra insurance against anything
      // else shifting the layout in between.
      setFlyingGroups((groups) =>
        groups.map((g) =>
          g.groupIdx === thisGroup ? { ...g, to: measureBarSlots(barEl!, ordered.length), phase: "moving" } : g
        )
      );
    }));
    const timers = [
      setTimeout(() => setPhase("merging"), FLY_MS),
      setTimeout(remove, FLY_MS + MERGE_MS),
      // A redundant hard safety-net: no matter what else happens (a missed
      // frame, a measurement edge case), this group's overlay is guaranteed
      // to be removed rather than lingering on screen indefinitely. Harmless
      // no-op if the line above already removed it.
      setTimeout(remove, FLY_MS + MERGE_MS + 500),
    ];
    flyTimersRef.current[thisGroup] = timers;
  }, [lastRevealedGroup, puzzle, measureBarSlots, markSettled]);

  useEffect(() => {
    return () => {
      Object.values(flyTimersRef.current).forEach((timers) => timers.forEach(clearTimeout));
    };
  }, []);

  // A freshly-solved group's bar defaults to hidden-but-laid-out the instant
  // lastRevealedGroup points at it — synchronously, on the very first render,
  // with no dependency on an effect having run yet. It only reveals once
  // we've explicitly marked it settled (fly+merge finished, or skipped).
  // Older groups are never affected since they're no longer lastRevealedGroup.
  const isPendingMerge = useCallback(
    (groupIdx: number) => groupIdx === lastRevealedGroup && !settledGroups.has(groupIdx),
    [lastRevealedGroup, settledGroups]
  );

  // If this GameBoard instance is reused for a different puzzle (e.g. archive
  // browsing without a remount), drop any in-flight animation state rather
  // than risk it referencing stale words/groups from the previous puzzle.
  useEffect(() => {
    Object.values(flyTimersRef.current).forEach((timers) => timers.forEach(clearTimeout));
    flyTimersRef.current = {};
    matchedFromRectsRef.current = {};
    groupBarRefs.current = {};
    prevRevealedGroupRef.current = null;
    setFlyingGroups([]);
    setSettledGroups(new Set());
  }, [puzzle.id]);

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
  const [showGlobalStats, setShowGlobalStats] = useState(false);
  const [showSpotModal, setShowSpotModal] = useState(false);
  const [bonusRainbowCorrect, setBonusRainbowCorrect] = useState<boolean | null>(null);
  const [rainbowVisible, setRainbowVisible] = useState(state.gotRainbow);
  const [spotShaking, setSpotShaking] = useState(false);
  const [bonusRainbowWords, setBonusRainbowWords] = useState<string[]>([]);
  const [hintVisible, setHintVisible] = useState(true);

  const [streakBefore, setStreakBefore] = useState<number | null>(null);
  const [showStreak, setShowStreak] = useState(false);
  const prevIsWon = useRef(state.isWon);
  const prevIsComplete = useRef(false);
  const prevGotRainbow = useRef(state.gotRainbow);

  useEffect(() => {
    if (isArchive) return;
    const fetchStreakBefore = async () => {
      try {
        const deviceId = getDeviceId();
        const { data: { user: authUser } } = await supabase.auth.getUser();
        const userId = authUser?.id ?? null;
        const { data } = userId
          ? await supabase.from("user_streaks").select("current_streak").eq("user_id", userId).single()
          : await supabase.from("user_streaks").select("current_streak").eq("device_id", deviceId).single();
        if (data?.current_streak != null) setStreakBefore(data.current_streak);
      } catch {}
    };
    void fetchStreakBefore();
  }, [isArchive]);

  useEffect(() => {
    if (state.isWon && !prevIsWon.current && !isArchive) {
      setTimeout(() => setShowStreak(true), 500);
    }
    prevIsWon.current = state.isWon;
  }, [state.isWon, isArchive]);

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
    if (fullHintUsed) setHintVisible(true);
  }, [fullHintUsed]);

  const handleSpotResult = useCallback((correct: boolean) => {
    setShowSpotModal(false);
    setSpotShaking(true);
    setTimeout(() => {
      setSpotShaking(false);
      if (correct && puzzle.rainbowHerring) {
        setBonusRainbowWords([...puzzle.rainbowHerring]);
        confetti({ particleCount: 100, spread: 80, origin: { y: 0.55 } });
        playRainbowSound();
        markRainbowFound(puzzle.rainbowHerring);
        void markRainbowFoundInSession(puzzle.id);
      }
      setTimeout(() => setBonusRainbowCorrect(correct), correct ? 600 : 0);
    }, 400);
  }, [puzzle.rainbowHerring, puzzle.id, markRainbowFound]);

  const hintItems = useCallback((): { color?: string; squareEmoji?: string; emoji: string }[] => {
    const sorted = [...puzzle.groups].sort((a, b) => a.difficulty - b.difficulty);
    const items: { color?: string; squareEmoji?: string; emoji: string }[] = sorted.map(g => ({
      color: DIFFICULTY_COLOR[g.difficulty],
      emoji: extractTrailingEmojis(g.category),
    }));
    if (puzzle.rainbowHerring && puzzle.rainbowCategoryName) {
      items.push({
        squareEmoji: theme.emoji,
        emoji: extractTrailingEmojis(puzzle.rainbowCategoryName),
      });
    }
    return items;
  }, [puzzle, theme]);

  const generateShareLines = useCallback((): string[] => {
    const lines: string[] = [];
    for (const attempt of state.guessHistory) {
      if (attempt.isHintMarker) {
        const emoji = attempt.hintType === "small" ? "💡" : "🔦";
        const last = lines[lines.length - 1];
        if (last === "💡" || last === "🔦" || last === "💡🔦" || last === "🔦💡") {
          lines[lines.length - 1] = last + emoji;
        } else {
          lines.push(emoji);
        }
      } else if (attempt.isRainbow) {
        lines.push(theme.shareRow);
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
    return lines;
  }, [state.guessHistory, puzzle, theme]);

  const generateShareText = useCallback(() => {
    const header = puzzle.title
      ? `Puzzle ${puzzle.title}`
      : "Rainbow Categories";
    return `${header}\n${generateShareLines().join("\n")}\nrainbowcategories.com`;
  }, [puzzle, generateShareLines]);

  const handleShare = useCallback(async () => {
    trackEvent("share_clicked");
    const text = generateShareText();
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
  }, [generateShareText]);

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

  return (
    <>
      {!imagesReady ? (
        <div className="w-full max-w-lg mx-auto px-2 flex flex-col items-center justify-center py-20">
          <div className="w-6 h-6 border-2 border-primary border-t-transparent rounded-full animate-spin" />
        </div>
      ) : (
    <div className="w-full max-w-lg mx-auto px-2 animate-fade-up">
      <div className="flex items-center justify-center gap-2 mb-4">
        <p className="text-center text-sm text-muted-foreground">
          Find four groups of four and the hidden {theme.label}!
        </p>
        {!puzzle.rainbowHerring && <NoRainbowIndicator />}
      </div>

      {/* Solved groups — rainbow is interleaved at the position it was actually
          found (boardSlots), not always pinned to the top */}
      <div className="space-y-2 mb-2">
        {boardSlots.map((slot) =>
          slot.kind === "rainbow" ? (
            <div
              key="rainbow-reveal"
              className={`w-full rounded-lg py-3 px-4 text-center text-white ${rainbowVisible ? "animate-rainbow-curtain" : ""}`}
              style={{
                background: theme.gradient,
                textShadow: theme.textShadow,
                clipPath: rainbowVisible ? undefined : "inset(0 100% 0 0)",
              }}
            >
              <div className="font-bold text-sm uppercase tracking-wide">
                {puzzle.rainbowCategoryName || theme.defaultCategoryName}
              </div>
              <RainbowWordsRow words={puzzle.rainbowHerring!} />
            </div>
          ) : (
            <SolvedGroup
              key={slot.groupIdx}
              ref={(el) => { groupBarRefs.current[slot.groupIdx] = el; }}
              group={puzzle.groups[slot.groupIdx]}
              animate={slot.groupIdx === lastRevealedGroup}
              pendingMerge={isPendingMerge(slot.groupIdx)}
            />
          )
        )}

        {state.isComplete && !state.gotRainbow && puzzle.rainbowHerring && (
          bonusRainbowCorrect === null ? (
            <button
              onClick={() => setShowSpotModal(true)}
              className="w-full rounded-lg py-3 px-4 text-center text-white
                hover:opacity-90 transition-opacity active:scale-[0.99]
                animate-rainbow-breathe animate-rainbow-shimmer"
              style={{ background: theme.gradient, textShadow: theme.textShadow }}
            >
              <div className="font-bold text-sm uppercase tracking-wide">{theme.spotPrompt}</div>
              <div className="text-xs mt-0.5 opacity-80">Find one word from each group</div>
            </button>
          ) : (
            <div
              className={`w-full rounded-lg py-3 px-4 text-center text-white ${rainbowVisible ? "animate-rainbow-curtain" : ""}`}
              style={{
                background: theme.gradient,
                textShadow: theme.textShadow,
                clipPath: rainbowVisible ? undefined : "inset(0 100% 0 0)",
              }}
            >
              <div className="font-bold text-sm uppercase tracking-wide">
                {puzzle.rainbowCategoryName || theme.defaultCategoryName}
              </div>
              <RainbowWordsRow words={puzzle.rainbowHerring} />
            </div>
          )
        )}
      </div>

      {/* Color Palette Mode buttons - ABOVE THE GRID */}
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
          <button
            onClick={() => setPaletteMode("yellow")}
            className={`w-10 h-10 rounded-lg bg-yellow-400 hover:scale-110 transition-all
              ${paletteMode === "yellow" ? "ring-2 ring-foreground ring-offset-2 ring-offset-background scale-110" : ""}`}
            aria-label="Yellow paint"
          />
          <button
            onClick={() => setPaletteMode("green")}
            className={`w-10 h-10 rounded-lg bg-green-500 hover:scale-110 transition-all
              ${paletteMode === "green" ? "ring-2 ring-foreground ring-offset-2 ring-offset-background scale-110" : ""}`}
            aria-label="Green paint"
          />
          <button
            onClick={() => setPaletteMode("blue")}
            className={`w-10 h-10 rounded-lg bg-blue-500 hover:scale-110 transition-all
              ${paletteMode === "blue" ? "ring-2 ring-foreground ring-offset-2 ring-offset-background scale-110" : ""}`}
            aria-label="Blue paint"
          />
          <button
            onClick={() => setPaletteMode("red")}
            className={`w-10 h-10 rounded-lg bg-red-500 hover:scale-110 transition-all
              ${paletteMode === "red" ? "ring-2 ring-foreground ring-offset-2 ring-offset-background scale-110" : ""}`}
            aria-label="Red paint"
          />
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

      {/* Word grid */}
      {remainingWords.length > 0 && (
        <div ref={gridRef} className={`grid grid-cols-4 gap-2 ${shaking || spotShaking ? "animate-shake" : ""}`}>
          {remainingWords.map((word, index) => (
            <WordTile
              key={word}
              word={word}
              isSelected={state.selectedWords.includes(word)}
              isRainbow={
                (showRainbow && rainbowWords.includes(word)) ||
                bonusRainbowWords.includes(word)
              }
              rainbowGradient={theme.isDefault ? undefined : theme.gradient}
              rainbowTextShadow={theme.textShadow}
              isMatched={matchedWords.includes(word)}
              onClick={() => handleTileClick(word)}
              disabled={state.isComplete || matchedWords.length > 0 || flyingGroups.length > 0}
              arrangeTiles={arrangeTiles}
              colorCodeTiles={colorCodeTiles}
              tileColor={tileColors[word] ?? null}
              onColorChange={setTileColor}
              draggable={arrangeTiles}
              onDragStart={handleDragStart}
              onDragOver={handleDragOver}
              onDrop={handleDrop}
              onTouchDragMove={handleTouchDragMove}
              column={(index % 4) + 1}
              onTouchDragEnd={handleTouchDragEnd}
              isEmojiPuzzle={puzzle.isEmojiPuzzle ?? false}
              colorPaletteMode={colorPaletteMode}
              isPaintMode={colorPaletteMode && paletteMode !== "select"}
              data-word={word}
            />
          ))}
        </div>
      )}

      {/* Flying tiles for the correct-guess fly-up + merge animation — slide
          from their grid spot into a row aligned with the solved bar, then
          fade out as the real bar cross-fades in underneath. Rendered as a
          queue so a fast second correct guess gets its own independent
          overlay instead of clobbering one still in flight. */}
      {flyingGroups.map((fg) =>
        fg.words.map((word, i) => {
          const rect = fg.phase === "start" ? fg.from[i] : fg.to[i];
          return (
            <div
              key={`${fg.groupIdx}-${word}`}
              className={`tile-flying flex items-center justify-center rounded-lg font-semibold text-xs sm:text-sm uppercase tracking-wide bg-tile-selected text-tile-selected-fg shadow-md ${
                fg.phase === "merging" ? "opacity-0" : "opacity-100"
              }`}
              style={{
                top: rect.top,
                left: rect.left,
                width: rect.width,
                height: rect.height,
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
        })
      )}

      {/* Rainbow Spotted popup — animated rainbow-tile for the default theme,
          static themed gradient otherwise */}
      {showRainbowPopup && (
        <div className="flex justify-center mt-3 animate-fade-up">
          <div
            className={`${showRainbow && theme.isDefault ? "rainbow-tile" : "bg-foreground"} px-6 py-2.5 rounded-full text-sm font-bold text-white shadow-lg`}
            style={showRainbow && !theme.isDefault ? { background: theme.gradient, textShadow: theme.textShadow } : undefined}
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

      {/* Mistakes dots — hidden when viewing an already-completed puzzle */}
      {!wasAlreadyComplete.current && (
        <div className="mt-4">
          <MistakeDots mistakes={state.mistakes} max={state.maxMistakes} />
        </div>
      )}

      {/* Controls */}
      {!state.isComplete && (
        <div className="flex items-center justify-center gap-3 mt-4 flex-wrap">
          <button
            onClick={shuffle}
            className="flex items-center gap-1.5 px-4 py-2 rounded-full border border-border text-sm font-medium
              hover:bg-secondary transition-colors duration-150 active:scale-95"
          >
            <Shuffle className="w-4 h-4" /> Shuffle
          </button>
          <button
            onClick={deselectAll}
            disabled={state.selectedWords.length === 0}
            className="flex items-center gap-1.5 px-4 py-2 rounded-full border border-border text-sm font-medium
              hover:bg-secondary transition-colors duration-150 active:scale-95
              disabled:opacity-40 disabled:cursor-default"
          >
            <X className="w-4 h-4" /> Deselect
          </button>
          <button
            onClick={submitGuess}
            disabled={state.selectedWords.length !== 4}
            className="flex items-center gap-1.5 px-4 py-2 rounded-full bg-primary text-primary-foreground text-sm font-medium
              hover:opacity-90 transition-all duration-150 active:scale-95
              disabled:opacity-40 disabled:cursor-default"
          >
            <Send className="w-4 h-4" /> Submit
          </button>
          {(colorCodeTiles || colorPaletteMode) && hasAnyColor && (
            <button
              onClick={clearAllColors}
              className="flex items-center gap-1.5 px-4 py-2 rounded-full border border-border text-sm font-medium
                hover:bg-secondary transition-colors duration-150 active:scale-95"
            >
              <Eraser className="w-4 h-4" /> Clear Colors
            </button>
          )}
        </div>
      )}

      {/* Hint pill */}
      {fullHintUsed && (
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
                  <span>{item.emoji}</span>
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
      {smallHintUsed && (
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

      {/* Guess History (Beta) */}
      {settings?.guessHistory && incorrectGuesses.length > 0 && (
        <div className="mt-3">
          <button
            onClick={() => setHistoryExpanded((v) => !v)}
            className="w-full text-xs font-semibold text-muted-foreground hover:text-foreground transition-colors py-1"
          >
            Guess History {historyExpanded ? "▴" : "▾"}
          </button>
          {historyExpanded && (
            <div className="mt-2 space-y-1">
              {incorrectGuesses.map((g, i) => {
                const sorted = [...g.words].sort((a, b) => a.localeCompare(b));
                const label = g.isAlmostRainbow
                  ? theme.almostMessage
                  : g.isOneAway
                    ? "One Away"
                    : null;
                const chips = (
                  <div className="flex items-center justify-center flex-wrap gap-1.5">
                    {sorted.map((w, j) => (
                      <span
                        key={`${w}-${j}`}
                        className="inline-flex items-center bg-secondary text-foreground rounded-full px-3 py-1 text-sm font-medium"
                      >
                        {isCustomEmoji(w) ? (
                          <img
                            src={customEmojiUrl(w)}
                            alt={customEmojiName(w) ?? ""}
                            draggable={false}
                            style={{ height: "18px", width: "auto", objectFit: "contain" }}
                          />
                        ) : (
                          w
                        )}
                      </span>
                    ))}
                  </div>
                );

                return label ? (
                  <div
                    key={i}
                    className="rounded-xl px-3 py-2 text-center"
                    style={{ border: "1.5px dashed hsl(var(--border))" }}
                  >
                    <p className="text-xs text-muted-foreground mb-1.5">{label}</p>
                    {chips}
                  </div>
                ) : (
                  <div key={i}>{chips}</div>
                );
              })}
            </div>
          )}
        </div>
      )}

      {/* Streak celebration */}
      {showStreak && <StreakCelebration streak={streakToShow} />}

      {/* End state — hide headline/subtitle when viewing already-completed puzzle */}
      {state.isComplete && (
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

          {state.guessHistory.length > 0 && (
            <div className="mt-4 space-y-3">
              <div className="flex flex-col items-center gap-0.5">
                {generateShareLines().map((line, i) => (
                  <span key={i} className="text-2xl leading-tight tracking-wider">
                    {line}
                  </span>
                ))}
              </div>
              <div className="flex items-center justify-center gap-3">
                <button
                  onClick={handleShare}
                  className="inline-flex items-center gap-2 px-5 py-2.5 rounded-full bg-primary text-primary-foreground text-sm font-semibold
                    hover:opacity-90 transition-all duration-150 active:scale-95 shadow-md"
                >
                  {copied ? <Check className="w-4 h-4" /> : <Share2 className="w-4 h-4" />}
                  {copied ? "Copied!" : "Share Score"}
                </button>
                <button
                  onClick={() => setShowGlobalStats(true)}
                  className="inline-flex items-center gap-2 px-5 py-2.5 rounded-full border border-border text-sm font-semibold
                    hover:bg-secondary transition-all duration-150 active:scale-95 shadow-md"
                >
                  <TrendingUp className="w-4 h-4" /> Global Stats
                </button>
              </div>
            </div>
          )}
        </div>
      )}

      {/* Rating */}
      {state.isComplete && <PuzzleRating puzzleId={puzzle.id} user={user} />}

      <DailyStatsModal
        puzzleId={puzzle.id}
        open={showGlobalStats}
        onClose={() => setShowGlobalStats(false)}
        userMistakes={state.mistakes}
        isComplete={state.isComplete}
      />

      {puzzle.rainbowHerring && (
        <SpotTheRainbowModal
          open={showSpotModal}
          puzzle={puzzle}
          onResult={handleSpotResult}
        />
      )}
    </div>
      )}

      {/* Silly Saturday modal — rendered outside the preload gate so it appears immediately */}
      <SillySaturdayModal isEmojiPuzzle={!!puzzle.isEmojiPuzzle} puzzleId={puzzle.id} />
    </>
  );
}
