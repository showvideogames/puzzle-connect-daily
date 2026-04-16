import { useState } from "react";
import { Puzzle } from "@/lib/types";
import confetti from "canvas-confetti";

const GROUP_COLORS: Record<number, { bg: string; text: string }> = {
  1: { bg: "bg-group-1", text: "text-group-1-fg" },
  2: { bg: "bg-group-2", text: "text-group-2-fg" },
  3: { bg: "bg-group-3", text: "text-group-3-fg" },
  4: { bg: "bg-group-4", text: "text-group-4-fg" },
};

const RAINBOW_GRADIENT = "linear-gradient(to right, #f97316, #eab308, #22c55e, #3b82f6, #a855f7)";

interface SpotTheRainbowModalProps {
  open: boolean;
  puzzle: Puzzle;
  onResult: (correct: boolean) => void;
}

export function SpotTheRainbowModal({ open, puzzle, onResult }: SpotTheRainbowModalProps) {
  const [selected, setSelected] = useState<Record<number, string>>({});
  const [phase, setPhase] = useState<"picking" | "correct" | "wrong">("picking");

  if (!open || !puzzle.rainbowHerring) return null;

  const handleSelect = (groupIdx: number, word: string) => {
    if (phase !== "picking") return;
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

    if (isCorrect) {
      setPhase("correct");
      confetti({ particleCount: 100, spread: 80, origin: { y: 0.55 } });
      setTimeout(() => onResult(true), 2000);
    } else {
      setPhase("wrong");
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      <div
        className="absolute inset-0 bg-foreground/20 backdrop-blur-sm"
        onClick={phase === "wrong" ? () => onResult(false) : undefined}
      />
      <div className="relative bg-card rounded-xl shadow-2xl p-5 w-full max-w-sm mx-4 animate-pop overflow-y-auto max-h-[90vh]">

        {/* Correct result */}
        {phase === "correct" && (
          <>
            <h2 className="text-lg font-bold mb-1">Spot the Rainbow? 🌈</h2>
            <div className="text-center py-8">
              <div className="text-4xl mb-3">🌈</div>
              <p className="text-xl font-bold">You spotted it!</p>
              <p className="text-sm text-muted-foreground mt-1">Rainbow added to your share.</p>
            </div>
          </>
        )}

        {/* Wrong result — modal transforms, no auto-close */}
        {phase === "wrong" && (
          <>
            <h2 className="text-lg font-bold mb-4">Rainbow 🌈</h2>
            <div
              className="w-full rounded-lg py-3 px-4 text-center text-white font-bold text-sm mb-4"
              style={{ background: RAINBOW_GRADIENT }}
            >
              {puzzle.rainbowHerring.join(" · ")}
            </div>
            <button
              onClick={() => onResult(false)}
              className="w-full py-2.5 rounded-full border border-border text-sm font-semibold
                hover:bg-secondary transition-all duration-150 active:scale-95"
            >
              Close
            </button>
          </>
        )}

        {/* Word selection UI */}
        {phase === "picking" && (
          <>
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
                    {/* Group header shows category name, then chosen word once picked */}
                    <div className={`${colors.bg} ${colors.text} px-3 py-1.5 text-center`}>
                      <span className="text-[11px] font-bold uppercase tracking-wide opacity-75">
                        {chosenWord ? `✓ ${chosenWord}` : group.category}
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
          </>
        )}
      </div>
    </div>
  );
}
