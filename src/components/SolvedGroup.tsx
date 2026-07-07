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
  // Reveal-phase override used by GameBoard's clone animation:
  //  - "hidden": laid out but transparent, so its rect is measurable as the
  //    clones' fly target while they're still flying.
  //  - "shown": cross-fades in (opacity 0→1) underneath the clones as they
  //    fade/scale out during the merge phase.
  // undefined = normal rendering (animate-group-appear entrance if `animate`).
  reveal?: "hidden" | "shown";
}

// forwardRef so GameBoard can measure this bar's real DOM rect (the clones'
// fly target) via getBoundingClientRect.
export const SolvedGroup = forwardRef<HTMLDivElement, SolvedGroupProps>(function SolvedGroup(
  { group, animate, reveal },
  ref
) {
  const colors = groupColors[group.difficulty] || groupColors[1];
  const revealing = reveal !== undefined;
  return (
    <div
      ref={ref}
      className={`${colors.bg} ${colors.text} rounded-lg py-3 px-4 text-center ${
        !revealing && animate ? "animate-group-appear" : ""
      }`}
      style={
        revealing
          ? {
              opacity: reveal === "hidden" ? 0 : 1,
              // Grow in from a slightly smaller size with a tiny overshoot
              // (the back-out cubic) so the bar reveal feels bigger, not flat.
              transform: reveal === "hidden" ? "scale(0.96)" : "scale(1)",
              transformOrigin: "center",
              transition:
                "opacity 0.24s ease-out, transform 0.34s cubic-bezier(0.34, 1.56, 0.64, 1)",
            }
          : undefined
      }
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
