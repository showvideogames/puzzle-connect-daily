import { useState } from "react";
import * as DialogPrimitive from "@radix-ui/react-dialog";
import { X } from "lucide-react";
import { Puzzle } from "@/lib/types";
import confetti from "canvas-confetti";
import { playRainbowSound } from "@/lib/sounds";
import { resolveTheme } from "@/lib/themes";

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
  // Closes the modal without submitting anything — no result, no mistake,
  // no change to solved categories. Reopening later starts fresh (the
  // existing behavior already resets `selected` on close, since this
  // component only rendered its content while `open`).
  onClose: () => void;
}

export function SpotTheRainbowModal({ open, puzzle, onResult, onClose }: SpotTheRainbowModalProps) {
  const [selected, setSelected] = useState<Record<number, string>>({});

  if (!puzzle.rainbowHerring) return null;
  const rainbowHerring = puzzle.rainbowHerring;

  const theme = resolveTheme(puzzle.theme);

  const handleSelect = (groupIdx: number, word: string) => {
    setSelected(prev => ({ ...prev, [groupIdx]: word }));
  };

  const readyToSubmit = Object.keys(selected).length === puzzle.groups.length;

  const handleSubmit = () => {
    if (!readyToSubmit) return;

    const chosenSorted = Object.values(selected).sort();
    const correctSorted = [...rainbowHerring].sort();
    const isCorrect =
      chosenSorted.length === correctSorted.length &&
      chosenSorted.every((w, i) => w === correctSorted[i]);

    // Pass result immediately — GameBoard handles the shake + reveal sequence
    onResult(isCorrect);
  };

  return (
    <DialogPrimitive.Root open={open} onOpenChange={(next) => { if (!next) onClose(); }}>
      <DialogPrimitive.Portal>
        <DialogPrimitive.Overlay className="fixed inset-0 z-50 bg-foreground/20 backdrop-blur-sm" />
        {/* Positioning wrapper: a full-viewport flex box does the centering
            (not a transform), since Content's own entrance animation
            (.animate-pop, a scale keyframe with fill-mode:forwards) would
            otherwise permanently clobber any transform-based centering on
            that same element — CSS animations override transforms
            regardless of specificity/order.

            Always centers (items-center), on every screen — positioning is
            driven by AVAILABLE HEIGHT, not width/device type. The ~12px
            padding (plus safe-area insets) sets a floor of breathing room;
            Content's max-height is derived from that same budget so that
            when the modal's natural height fits within the visible
            viewport it simply renders centered with room to spare, and
            only when it genuinely doesn't fit does it get clamped to the
            available height and scroll internally (still centered — a
            height-clamped box centered in a flex container just ends up
            filling most of the space, not pinned to an edge).
            pointer-events-none/auto split lets clicks in the empty flex
            space still reach the backdrop. */}
        <div
          className="fixed inset-0 z-50 flex items-center justify-center pointer-events-none
            px-4 pt-[max(12px,env(safe-area-inset-top))] pb-[max(12px,env(safe-area-inset-bottom))]"
        >
          {/* No onEscapeKeyDown here — Radix's default Escape behavior
              already calls the Root's onOpenChange(false) below, same path
              as backdrop-click; adding a second handler would fire onClose
              twice per Escape press. */}
          <DialogPrimitive.Content
            className="pointer-events-auto w-full max-w-sm
              max-h-[calc(100dvh-24px)]
              overflow-y-auto
              bg-card rounded-xl shadow-2xl p-5 animate-pop
              focus:outline-none"
          >
            <div className="flex items-start justify-between gap-2 mb-1">
              <DialogPrimitive.Title asChild>
                <h2 className="text-lg font-bold">{theme.spotPrompt}</h2>
              </DialogPrimitive.Title>
              <DialogPrimitive.Close
                aria-label="Close without submitting"
                className="shrink-0 -mr-2 -mt-2 w-11 h-11 flex items-center justify-center rounded-full
                  text-muted-foreground hover:bg-secondary transition-colors active:scale-95
                  focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              >
                <X className="w-5 h-5" />
              </DialogPrimitive.Close>
            </div>
            <DialogPrimitive.Description asChild>
              <p className="text-xs text-muted-foreground mb-4">
                Pick one word from each group that shares a hidden connection.
              </p>
            </DialogPrimitive.Description>

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
          </DialogPrimitive.Content>
        </div>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  );
}
