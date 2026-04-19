import { useState } from "react";
import { Puzzle } from "@/lib/types";
import confetti from "canvas-confetti";
import { playRainbowSound } from "@/lib/sounds";

const GROUP_COLORS: Record<number, { bg: string; text: string }> = {
  1: { bg: "bg-group-1", text: "text-group-1-fg" },
  2: { bg: "bg-group-2", text: "text-group-2-fg" },
  3: { bg: "bg-group-3", text: "text-group-3-fg" },
  4: { bg: "bg-group-4", text: "text-group-4-fg" },
};

interface SpotTheRainbowModalProps {
  open: boolean;
  puzzle: Puzzle;
  onResult: (correct: boolean) => void;
}

export function SpotTheRainbowModal({ open, puzzle, onResult }: SpotTheRainbowModalProps) {
  const [selected, setSelected] = useState<Record<number, string>>({});

  if (!open || !puzzle.rainbowHerring) return null;

  const handleSelect = (groupIdx: number, word: string) => {
    setSelected(prev => ({ ...prev, [groupIdx]: word }));
  };

  const readyToSubmit = Object.keys(selected).length === puzzle.groups.length;

  const handleSubmit = () => {
    if (!readyToSubmit || !puzzle.rainbowHerring) return;

    const chosenSorted = Object.values(selected).sort();
    const correctSorted = [...puzzle.rainbowHerring].sort();
    const isCorrect =
      chosenSorted.length === correctSorted.length &&
      chosenSorted.every((w, i) => w === correctSorted[i]);

    // Pass result immediately — GameBoard handles the shake + reveal sequence
    onResult(isCorrect);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      <div className="absolute inset-0 bg-foreground/20 backdrop-blur-sm" />
      <div className="relative bg-card rounded-xl shadow-2xl p-5 w-full max-w-sm mx-4 animate-pop overflow-y-auto max-h-[90vh]">
        <h2 className="text-lg font-bold mb-1">Spot the Rainbow? 🌈</h2>
        <p className="text-xs text-muted-foreground mb-4">
          Pick one word from each group that shares a hidden connection.
        </p>

        <div className="space-y-2 mb-4">
          {puzzle.groups.map((group, groupIdx) => {
            const colors = GROUP_COLORS[group.difficulty] || GROUP_COLORS[1];
            const chosenWord = selected[groupIdx];
            return (
              <div key={groupIdx} className="rounded-lg overflow-hidden">
                <div className={`${colors.bg} ${colors.text} px-3 py-1.5 text-center`}>
                  <span className="text-[11px] font-bold uppercase tracking-wide opacity-75">
                    {group.category}
                  </span>
                </div>
                <div className="grid grid-cols-4 gap-1 p-1.5 bg-secondary/20">
                  {group.words.map(word => {
                    const isChosen = chosenWord === word;
                    return (
                      <button
                        key={word}
                        onClick={() => handleSelect(groupIdx, word)}
                        className={`py-2 px-1 rounded-md text-xs font-semibold text-center leading-tight
                          transition-all duration-100 active:scale-95
                          ${isChosen
                            ? `${colors.bg} ${colors.text} ring-2 ring-foreground/30`
                            : "bg-tile hover:bg-secondary"
                          }`}
                      >
                        {word}
                      </button>
                    );
                  })}
                </div>
              </div>
            );
          })}
        </div>

        <button
          onClick={handleSubmit}
          disabled={!readyToSubmit}
          className="w-full py-2.5 rounded-full bg-primary text-primary-foreground text-sm font-semibold
            hover:opacity-90 transition-all duration-150 active:scale-95
            disabled:opacity-40 disabled:cursor-default"
        >
          Submit
        </button>
      </div>
    </div>
  );
}
