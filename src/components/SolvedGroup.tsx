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
}

// forwardRef so react-flip-toolkit's <Flipped> can attach its own ref to the
// real DOM node — it needs that to measure this bar's position/size, both for
// its own FLIP tracking and as the merge target read in the exiting tiles'
// onExit handler (see GameBoard.tsx).
export const SolvedGroup = forwardRef<HTMLDivElement, SolvedGroupProps>(function SolvedGroup(
  { group, animate },
  ref
) {
  const colors = groupColors[group.difficulty] || groupColors[1];
  return (
    <div
      ref={ref}
      className={`${colors.bg} ${colors.text} rounded-lg py-3 px-4 text-center ${animate ? "animate-group-appear" : ""}`}
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
