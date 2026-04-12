import { Puzzle } from "@/lib/types";
import { GameSettings } from "@/lib/settings";
import { useGame } from "@/hooks/useGame";
import { WordTile } from "./WordTile";
import { SolvedGroup } from "./SolvedGroup";
import { MistakeDots } from "./MistakeDots";
import { DailyStatsModal } from "./DailyStatsModal";
import { Shuffle, Send, X, Share2, Check, TrendingUp } from "lucide-react";
import { useState, useCallback } from "react";

const DIFFICULTY_EMOJI: Record<number, string> = {
  0: "🟩",
  1: "🟧",
  2: "🟦",
  3: "🟪",
};

interface GameBoardProps {
  puzzle: Puzzle;
  settings?: GameSettings;
}

export function GameBoard({ puzzle, settings }: GameBoardProps) {
  const showRainbow = settings?.showRainbowColors ?? true;
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
    rainbowWords,
    showRainbowPopup,
    matchedWords,
  } = useGame(puzzle);

  const [copied, setCopied] = useState(false);
  const [showGlobalStats, setShowGlobalStats] = useState(false);

  const generateShareLines = useCallback((): string[] => {
    const lines: string[] = [];
    for (const attempt of state.guessHistory) {
      if (attempt.isRainbow) {
        lines.push("🌈");
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
    return lines;
  }, [state.guessHistory, puzzle]);

  const generateShareText = useCallback(() => {
    const title = puzzle.title || `Puzzle ${puzzle.date}`;
    return `🧩 ${title}\n${generateShareLines().join("\n")}`;
  }, [puzzle, generateShareLines]);

  const handleShare = useCallback(async () => {
    const text = generateShareText();
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // fallback
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

  return (
    <div className="w-full max-w-lg mx-auto px-2 animate-fade-up">
      <p className="text-center text-sm text-muted-foreground mb-4">
        Find groups of four words that share something in common.
      </p>

      {/* Solved groups */}
      <div className="space-y-2 mb-2">
        {state.solvedGroups.map((groupIdx) => (
            <SolvedGroup
              key={groupIdx}
              group={puzzle.groups[groupIdx]}
              animate={groupIdx === lastRevealedGroup}
            />
          ))}
      </div>

      {/* Word grid */}
      {remainingWords.length > 0 && (
        <div className={`grid grid-cols-4 gap-2 ${shaking ? "animate-shake" : ""}`}>
          {remainingWords.map((word) => (
            <WordTile
              key={word}
              word={word}
              isSelected={state.selectedWords.includes(word)}
              isRainbow={showRainbow && rainbowWords.includes(word)}
              isMatched={matchedWords.includes(word)}
              onClick={() => toggleWord(word)}
              disabled={state.isComplete || matchedWords.length > 0}
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
          <div className="bg-foreground text-background px-5 py-2 rounded-full text-sm font-semibold shadow-md">
            One away…
          </div>
        </div>
      )}

      {/* Mistakes */}
      <div className="mt-4">
        <MistakeDots mistakes={state.mistakes} max={state.maxMistakes} />
      </div>

      {/* Controls */}
      {!state.isComplete && (
        <div className="flex items-center justify-center gap-3 mt-4">
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
        </div>
      )}

      {/* End state */}
      {state.isComplete && (
        <div className="text-center mt-6 animate-fade-up">
          <p className="text-lg font-bold">
            {state.isWon
              ? "🎉 Well done!"
              : `😔 Nice try! ${state.mistakes}/${state.maxMistakes} mistakes`}
          </p>
          <p className="text-sm text-muted-foreground mt-1">
            {state.isWon
              ? "Come back tomorrow for a new puzzle."
              : "Here are the answers. Come back tomorrow!"}
          </p>
          {state.guessHistory.length > 0 && (
            <div className="mt-4 space-y-3">
              {/* Emoji grid preview */}
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

      <DailyStatsModal
        puzzleId={puzzle.id}
        open={showGlobalStats}
        onClose={() => setShowGlobalStats(false)}
      />
    </div>
  );
}
