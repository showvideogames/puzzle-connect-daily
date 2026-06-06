import { X } from "lucide-react";
import { Puzzle } from "@/lib/types";

interface HintModalProps {
  open: boolean;
  onClose: () => void;
  onSmallHint: () => void;
  onFullHint: () => void;
  puzzle?: Puzzle | null;
}

export function HintModal({ open, onClose, onSmallHint, onFullHint, puzzle }: HintModalProps) {
  if (!open) return null;

  const hasAnyHint =
    !!puzzle &&
    (puzzle.groups.some((g) => (g.hintWord ?? "").trim() !== "") ||
      !!(puzzle.rainbowHintWord && puzzle.rainbowHintWord.trim() !== ""));

  const handleSmallClick = () => {
    if (!hasAnyHint) return;
    onSmallHint();
    onClose();
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

        <div className="text-center mb-5">
          <div className="text-4xl mb-3">💡</div>
          <h2 className="text-lg font-bold mb-1">Want a hint?</h2>
          <p className="text-sm text-muted-foreground">Start small — you can always come back for more.</p>
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
      </div>
    </div>
  );
}
