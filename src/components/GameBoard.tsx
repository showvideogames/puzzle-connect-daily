import { Puzzle } from "@/lib/types";
import { GameSettings } from "@/lib/settings";
import { useGame } from "@/hooks/useGame";
import { WordTile } from "./WordTile";
import { SolvedGroup } from "./SolvedGroup";
import { MistakeDots } from "./MistakeDots";
import { DailyStatsModal } from "./DailyStatsModal";
import { SpotTheRainbowModal } from "./SpotTheRainbowModal";
import { PuzzleRating } from "./PuzzleRating";
import { Shuffle, Send, X, Share2, Check, TrendingUp, Eraser, Flame, MousePointer2 } from "lucide-react";
import { useState, useCallback, useEffect, useRef } from "react";
import type { User } from "@supabase/supabase-js";
import confetti from "canvas-confetti";
import { playRainbowSound } from "@/lib/sounds";
import { supabase } from "@/integrations/supabase/client";
import { getDeviceId } from "@/lib/gameStats";

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
  1: "🟧",
  2: "🟩",
  3: "🟦",
  4: "🟥",
};

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

const DIFFICULTY_EMOJI: Record<number, string> = {
  0: "🧡",
  1: "💚",
  2: "💙",
  3: "💗",
};

function getResultHeadline(isWon: boolean, mistakes: number): string {
  if (isWon && mistakes === 0) return "Perfect game! 🎯";
  if (isWon && mistakes === 1) return "Amazing! 🎉";
  if (isWon && mistakes === 2) return "Great job! 👏";
  if (isWon && mistakes === 3) return "Clutch!!! 🙌";
  return "Valiant effort 💪";
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

type PaletteMode = "select" | "orange" | "green" | "blue" | "red" | "eraser";

interface GameBoardProps {
  puzzle: Puzzle;
  settings?: GameSettings;
  user?: User | null;
  clearColorsTrigger?: number;
  isArchive?: boolean;
  hintsUsed?: boolean;
  onHintClick?: () => void;
  onComplete?: () => void;
}

export function GameBoard({ puzzle, settings, user = null, clearColorsTrigger = 0, isArchive = false, hintsUsed = false, onHintClick, onComplete }: GameBoardProps) {
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
    rainbowWords,
    showRainbowPopup,
    matchedWords,
    tileColors,
    setTileColor,
    clearAllColors,
    hasAnyColor,
    handleDragStart,
    handleDragOver,
    handleDrop,
    handleTouchDragMove,
    handleTouchDragEnd,
    alreadyGuessed,
  } = useGame(puzzle, { isArchive, hintsUsed });

  // Track if puzzle was already complete when component first mounted
  // Used to hide redundant UI (dots, headline) when viewing a completed puzzle
  const wasAlreadyComplete = useRef(state.isComplete);

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
  const prevIsComplete = useRef(state.isComplete);
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
      onComplete?.();
    }
    prevIsComplete.current = state.isComplete;
  }, [state.isComplete, onComplete]);

  useEffect(() => {
    if (state.gotRainbow && !prevGotRainbow.current) {
      setRainbowVisible(false);
      requestAnimationFrame(() => requestAnimationFrame(() => setRainbowVisible(true)));
    }
    prevGotRainbow.current = state.gotRainbow;
  }, [state.gotRainbow]);

  useEffect(() => {
    if (bonusRainbowCorrect !== null) {
      setRainbowVisible(false);
      requestAnimationFrame(() => requestAnimationFrame(() => setRainbowVisible(true)));
    }
  }, [bonusRainbowCorrect]);

  useEffect(() => {
    if (hintsUsed) setHintVisible(true);
  }, [hintsUsed]);

  const handleSpotResult = useCallback((correct: boolean) => {
    setShowSpotModal(false);
    setSpotShaking(true);
    setTimeout(() => {
      setSpotShaking(false);
      if (correct && puzzle.rainbowHerring) {
        setBonusRainbowWords([...puzzle.rainbowHerring]);
        confetti({ particleCount: 100, spread: 80, origin: { y: 0.55 } });
        playRainbowSound();
      }
      setTimeout(() => setBonusRainbowCorrect(correct), correct ? 600 : 0);
    }, 400);
  }, [puzzle.rainbowHerring]);

  const hintItems = useCallback(() => {
    const sorted = [...puzzle.groups].sort((a, b) => a.difficulty - b.difficulty);
    const items = sorted.map(g => ({
      square: DIFFICULTY_SQUARE[g.difficulty] || "⬜",
      emoji: extractTrailingEmojis(g.category),
    }));
    if (puzzle.rainbowHerring && puzzle.rainbowCategoryName) {
      items.push({
        square: "🌈",
        emoji: extractTrailingEmojis(puzzle.rainbowCategoryName),
      });
    }
    return items;
  }, [puzzle]);

  const generateShareLines = useCallback((): string[] => {
    const lines: string[] = [];
    if (hintsUsed) lines.push("💡");
    for (const attempt of state.guessHistory) {
      if (attempt.isRainbow) {
        if (hintsUsed && lines.length === 1) {
          lines[0] = "💡🌈";
        } else {
          lines.push("🌈");
        }
      } else {
        const row = attempt.groupIndices
          .map((gi) => {
            const diff = puzzle.groups[gi]?.difficulty;
            return DIFFICULTY_EMOJI[diff - 1] || "⬜";
          })
          .join("");
        lines.push(row);
      }
    }
    if (bonusRainbowCorrect === true) lines.push("🌈");
    return lines;
  }, [state.guessHistory, puzzle, bonusRainbowCorrect, hintsUsed]);

  const generateShareText = useCallback(() => {
    const d = new Date(puzzle.date + "T12:00:00");
    const formatted = d.toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" });
    return `🧩 ${formatted}\n${generateShareLines().join("\n")}`;
  }, [puzzle, generateShareLines]);

  const handleShare = useCallback(async () => {
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
      // Painting mode: orange, green, blue, red
      setTileColor(word, paletteMode);
    }
  }, [colorPaletteMode, paletteMode, toggleWord, setTileColor]);

  const streakToShow = streakBefore != null ? streakBefore + 1 : 1;

  return (
    <div className="w-full max-w-lg mx-auto px-2 animate-fade-up">
      <div className="flex items-center justify-center gap-2 mb-4">
        <p className="text-center text-sm text-muted-foreground">
          Find groups of four words that share something in common.
        </p>
        {!puzzle.rainbowHerring && <NoRainbowIndicator />}
      </div>

      {/* Solved groups */}
      <div className="space-y-2 mb-2">
        {state.gotRainbow && puzzle.rainbowHerring && (
          <div
            className={`w-full rounded-lg py-3 px-4 text-center text-white ${rainbowVisible ? "animate-rainbow-curtain" : ""}`}
            style={{
              background: "linear-gradient(to right, #f97316, #eab308, #22c55e, #3b82f6, #a855f7)",
              clipPath: rainbowVisible ? undefined : "inset(0 100% 0 0)",
            }}
          >
            <div className="font-bold text-sm uppercase tracking-wide">
              {puzzle.rainbowCategoryName || "Rainbow 🌈"}
            </div>
            <div className="text-xs mt-0.5 opacity-90">
              {puzzle.rainbowHerring.join(", ")}
            </div>
          </div>
        )}

        {state.solvedGroups.map((groupIdx) => (
          <SolvedGroup
            key={groupIdx}
            group={puzzle.groups[groupIdx]}
            animate={groupIdx === lastRevealedGroup}
          />
        ))}

        {state.isComplete && !state.gotRainbow && puzzle.rainbowHerring && (
          bonusRainbowCorrect === null ? (
            <button
              onClick={() => setShowSpotModal(true)}
              className="w-full rounded-lg py-3 px-4 text-center text-white
                hover:opacity-90 transition-opacity active:scale-[0.99]
                animate-rainbow-breathe animate-rainbow-shimmer"
              style={{ background: "linear-gradient(to right, #f97316, #eab308, #22c55e, #3b82f6, #a855f7)" }}
            >
              <div className="font-bold text-sm uppercase tracking-wide">Spot the Rainbow? 🌈</div>
              <div className="text-xs mt-0.5 opacity-80">Find one word from each group</div>
            </button>
          ) : (
            <div
              className={`w-full rounded-lg py-3 px-4 text-center text-white ${rainbowVisible ? "animate-rainbow-curtain" : ""}`}
              style={{
                background: "linear-gradient(to right, #f97316, #eab308, #22c55e, #3b82f6, #a855f7)",
                clipPath: rainbowVisible ? undefined : "inset(0 100% 0 0)",
              }}
            >
              <div className="font-bold text-sm uppercase tracking-wide">
                {puzzle.rainbowCategoryName || "Rainbow 🌈"}
              </div>
              <div className="text-xs mt-0.5 opacity-90">
                {puzzle.rainbowHerring.join(", ")}
              </div>
            </div>
          )
        )}
      </div>

      {/* Word grid */}
      {remainingWords.length > 0 && (
        <div className={`grid grid-cols-4 gap-2 ${shaking || spotShaking ? "animate-shake" : ""}`}>
          {remainingWords.map((word, index) => (
            <WordTile
              key={word}
              word={word}
              isSelected={state.selectedWords.includes(word)}
              isRainbow={
                (showRainbow && rainbowWords.includes(word)) ||
                bonusRainbowWords.includes(word)
              }
              isMatched={matchedWords.includes(word)}
              onClick={() => handleTileClick(word)}
              disabled={state.isComplete || matchedWords.length > 0}
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

      {/* Rainbow Spotted popup */}
      {showRainbowPopup && (
        <div className="flex justify-center mt-3 animate-fade-up">
          <div className={`${showRainbow ? "rainbow-tile" : "bg-foreground"} px-6 py-2.5 rounded-full text-sm font-bold text-white shadow-lg`}>
            🌈 Rainbow Spotted!
          </div>
        </div>
      )}

      {/* One Away popup */}
      {oneAway && (
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
      )}

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

      {/* Color Palette Mode buttons - MOVED BELOW CONTROLS */}
      {colorPaletteMode && remainingWords.length > 0 && (
        <div className="flex items-center justify-center gap-2 mt-3">
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
            onClick={() => setPaletteMode("orange")}
            className={`w-10 h-10 rounded-lg bg-orange-400 hover:scale-110 transition-all
              ${paletteMode === "orange" ? "ring-2 ring-foreground ring-offset-2 ring-offset-background scale-110" : ""}`}
            aria-label="Orange paint"
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

      {/* Hint pill */}
      {hintsUsed && (
        <div className="mt-4 flex justify-center">
          {hintVisible ? (
            <div className="bg-secondary rounded-full px-4 py-2.5 flex items-center gap-3 flex-wrap justify-center animate-fade-up">
              {hintItems().map((item, i) => (
                <span key={i} className="flex items-center gap-1 text-2xl leading-none">
                  {item.square}{item.emoji}
                </span>
              ))}
              <button
                onClick={() => setHintVisible(false)}
                className="ml-1 text-xs text-muted-foreground hover:text-foreground transition-colors px-2 py-0.5 rounded-full hover:bg-muted"
              >
                Hide
              </button>
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
  );
}
