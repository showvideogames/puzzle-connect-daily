import { forwardRef } from "react";
import { PuzzleGroup } from "@/lib/types";
import { isCustomEmoji, customEmojiUrl, customEmojiName } from "@/lib/customEmoji";

const groupColors: Record<number, { bg: string; text: string }> = {
  1: { bg: "bg-group-1", text: "text-group-1-fg" },
  2: { bg: "bg-group-2", text: "text-group-2-fg" },
  3: { bg: "bg-group-3", text: "text-group-3-fg" },
  4: { bg: "bg-group-4", text: "text-group-4-fg" },
};

interface SolvedGroupProps {
  group: PuzzleGroup;
  animate?: boolean;
  // True while GameBoard's clone-based reveal animation is still converging
  // on this bar: kept invisible-but-laid-out (not unrendered) so its real DOM
  // rect can be measured as the animation's target.
  pendingMerge?: boolean;
}

// forwardRef so GameBoard can measure this bar's real DOM rect (the reveal
// animation's target) via getBoundingClientRect.
export const SolvedGroup = forwardRef<HTMLDivElement, SolvedGroupProps>(function SolvedGroup(
  { group, animate, pendingMerge },
  ref
) {
  const colors = groupColors[group.difficulty] || groupColors[1];
  return (
    <div
      ref={ref}
      className={`${colors.bg} ${colors.text} rounded-lg py-3 px-4 text-center ${
        pendingMerge ? "opacity-0" : animate ? "animate-group-appear" : ""
      }`}
    >
      <div className="font-bold text-sm uppercase tracking-wide">{group.category}</div>
      <div className="text-xs mt-0.5 opacity-80 flex items-center justify-center flex-wrap gap-x-1 gap-y-0.5">
        {group.words.map((w, i) => (
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
            {i < group.words.length - 1 && <span>,</span>}
          </span>
        ))}
      </div>
    </div>
  );
});
