import { Puzzle } from "@/lib/types";
import { useGame } from "@/hooks/useGame";
import { WordTile } from "./WordTile";
import { SolvedGroup } from "./SolvedGroup";
import { MistakeDots } from "./MistakeDots";
import { Shuffle, Send, X } from "lucide-react";

interface GameBoardProps {
  puzzle: Puzzle;
}

export function GameBoard({ puzzle }: GameBoardProps) {
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
              isRainbow={rainbowWords.includes(word)}
              isMatched={matchedWords.includes(word)}
              onClick={() => toggleWord(word)}
              disabled={state.isComplete || matchedWords.length > 0}
            />
          ))}
        </div>
      )}

      {/* Rainbow Herring popup */}
      {showRainbowPopup && (
        <div className="flex justify-center mt-3 animate-fade-up">
          <div className="rainbow-tile px-6 py-2.5 rounded-full text-sm font-bold text-white shadow-lg">
            🌈 Rainbow Herring!
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
            {state.isWon ? "🎉 Well done!" : "Better luck next time!"}
          </p>
          <p className="text-sm text-muted-foreground mt-1">
            Come back tomorrow for a new puzzle.
          </p>
        </div>
      )}
    </div>
  );
}
