import { useState, useEffect } from "react";
import { X } from "lucide-react";
import { Puzzle } from "@/lib/types";

const DIFFICULTY_SQUARE: Record<number, string> = {
  1: "🟧",
  2: "🟩",
  3: "🟦",
  4: "🟥",
};

interface HintModalProps {
  open: boolean;
  onClose: () => void;
  onSmallHint: () => void;
  onFullHint: () => void;
  puzzle?: Puzzle | null;
}

export function HintModal({ open, onClose, onSmallHint, onFullHint, puzzle }: HintModalProps) {
  const [view, setView] = useState<"choice" | "small">("choice");

  useEffect(() => {
    if (open) setView("choice");
  }, [open]);

  if (!open) return null;

  // Sorted by difficulty so the small-hint list reads orange → red
  const sortedGroups = puzzle
    ? [...puzzle.groups].sort((a, b) => a.difficulty - b.difficulty)
    : [];
  const hasAnyHint =
    sortedGroups.some((g) => (g.hintWord ?? "").trim() !== "") ||
    !!(puzzle?.rainbowHintWord && puzzle.rainbowHintWord.trim() !== "");

  const handleSmallClick = () => {
    if (!hasAnyHint) return;
    onSmallHint();
    setView("small");
  };

  const handleFullClick = () => {
    onFullHint();
    onClose();
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      <div className="absolute inset-0 bg-foreground/20 backdrop-blur-sm" onClick={onClose} />
      <div className="relative bg-card rounded-xl shadow-2xl p-6 w-full max-w-sm mx-4 animate-pop">
        <button
          onClick={onClose}
          className="absolute top-3 right-3 p-1.5 rounded-lg hover:bg-secondary transition-colors active:scale-95"
        >
          <X className="w-4 h-4" />
        </button>

        {view === "choice" ? (
          <>
            <div className="text-center mb-5">
              <div className="text-4xl mb-3">💡</div>
              <h2 className="text-lg font-bold mb-1">Want a hint?</h2>
              <p className="text-sm text-muted-foreground">Choose how much help you want:</p>
            </div>

            <div className="flex flex-col gap-4">
              <div>
                <button
                  type="button"
                  onClick={handleSmallClick}
                  disabled={!hasAnyHint}
                  title={!hasAnyHint ? "No hints available for this puzzle" : undefined}
                  className="w-full py-2.5 rounded-full bg-primary text-primary-foreground text-sm font-semibold
                    hover:opacity-90 transition-all duration-150 active:scale-95
                    disabled:opacity-40 disabled:cursor-not-allowed disabled:hover:opacity-40"
                >
                  Small Hint
                </button>
                <p className="text-xs text-muted-foreground mt-1.5 text-center">
                  See one extra example word for each category. Helps you find the connection without giving it away.
                </p>
              </div>

              <div>
                <button
                  type="button"
                  onClick={handleFullClick}
                  className="w-full py-2.5 rounded-full bg-primary text-primary-foreground text-sm font-semibold
                    hover:opacity-90 transition-all duration-150 active:scale-95"
                >
                  Full Hint
                </button>
                <p className="text-xs text-muted-foreground mt-1.5 text-center">
                  See visual hints for each category. Choose this if you're really stuck.
                </p>
              </div>

              <button
                type="button"
                onClick={onClose}
                className="w-full py-2.5 rounded-full border border-border text-sm font-semibold
                  hover:bg-secondary transition-all duration-150 active:scale-95"
              >
                No thanks
              </button>
            </div>
          </>
        ) : (
          <>
            <div className="text-center mb-4">
              <h2 className="text-lg font-bold">Small Hint</h2>
              <p className="text-xs text-muted-foreground mt-1">One extra example word per category.</p>
            </div>

            <div className="space-y-2">
              {sortedGroups.map((g) => {
                const square = DIFFICULTY_SQUARE[g.difficulty] || "⬜";
                const word = (g.hintWord ?? "").trim();
                return (
                  <div
                    key={g.difficulty}
                    className="rounded-lg bg-secondary/60 px-3 py-2 text-sm flex items-center gap-2"
                  >
                    <span>{square}</span>
                    <span className="font-medium">{word || <span className="text-muted-foreground italic">(none)</span>}</span>
                  </div>
                );
              })}

              {puzzle?.rainbowHintWord && (
                <div
                  className="rounded-lg px-3 py-2 text-sm flex items-center gap-2 text-white font-semibold"
                  style={{ background: "linear-gradient(to right, #f97316, #eab308, #22c55e, #3b82f6, #a855f7)" }}
                >
                  <span>🌈</span>
                  <span>{puzzle.rainbowHintWord}</span>
                </div>
              )}
            </div>

            <button
              type="button"
              onClick={onClose}
              className="w-full mt-5 py-2.5 rounded-full border border-border text-sm font-semibold
                hover:bg-secondary transition-all duration-150 active:scale-95"
            >
              Close
            </button>
          </>
        )}
      </div>
    </div>
  );
}
