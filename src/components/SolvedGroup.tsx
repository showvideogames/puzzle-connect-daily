import { forwardRef } from "react";
import { PuzzleGroup } from "@/lib/types";
import { isCustomEmoji, customEmojiUrl, customEmojiName } from "@/lib/customEmoji";
import { CategoryEmojiInline } from "./CategoryEmojiInline";

const groupColors: Record<number, { bg: string; text: string }> = {
  1: { bg: "bg-group-1", text: "text-group-1-fg" },
  2: { bg: "bg-group-2", text: "text-group-2-fg" },
  3: { bg: "bg-group-3", text: "text-group-3-fg" },
  4: { bg: "bg-group-4", text: "text-group-4-fg" },
};

interface SolvedGroupProps {
  group: PuzzleGroup;
  // Sorts the displayed answers alphabetically when true (default); shows
  // them in the group's own stored/authored order when false. Puzzle-level
  // setting — see Puzzle.alphabetizeCompleted.
  alphabetizeCompleted?: boolean;
  animate?: boolean;
  // Reveal-phase override used by GameBoard's clone animation (two beats):
  //  - "hidden": laid out but transparent, so its rect is measurable as the
  //    clones' fly target while they're still flying. No transform, so the
  //    measured size is the bar's true final size.
  //  - "shown": beat 1 — quietly fades in (opacity 0→1) at scale 1 behind the
  //    clones as they fade/merge out. No pop yet.
  //  - "arrived": beat 2 — once the clones are gone, a distinct scale pop
  //    (.animate-solved-arrival) so the bar clearly "lands".
  // undefined = normal rendering (animate-group-appear entrance if `animate`).
  reveal?: "hidden" | "shown" | "arrived";
}

// forwardRef so GameBoard can measure this bar's real DOM rect (the clones'
// fly target) via getBoundingClientRect.
export const SolvedGroup = forwardRef<HTMLDivElement, SolvedGroupProps>(function SolvedGroup(
  { group, alphabetizeCompleted = true, animate, reveal },
  ref
) {
  const colors = groupColors[group.difficulty] || groupColors[1];
  const revealing = reveal !== undefined;
  const displayWords = alphabetizeCompleted
    ? [...group.words].sort((a, b) => a.localeCompare(b))
    : group.words;
  // Only the EXPLICIT Category Emoji is appended here. Older puzzles with no
  // explicit value rely on the legacy fallback (an emoji typed into the end
  // of the category title itself), which the plain title text below already
  // shows — appending it a second time would duplicate it.
  const explicitEmoji = (group.categoryEmoji ?? "").trim();
  return (
    <div
      ref={ref}
      className={`${colors.bg} ${colors.text} rounded-lg py-3 px-4 text-center ${
        !revealing && animate ? "animate-group-appear" : ""
      } ${reveal === "arrived" ? "animate-solved-arrival" : ""}`}
      style={
        reveal === "hidden"
          ? { opacity: 0 }
          : reveal === "shown"
            ? { opacity: 1, transition: "opacity 0.2s ease-out" }
            : undefined
      }
    >
      {/* Category title is the payoff/reveal on each card — noticeably
          larger and heavier than the answer line, and shares the puzzle
          tile's typeface (Inter Tight) to visually connect the two. */}
      <div className="font-tile font-extrabold text-[16px] md:text-[19px] leading-tight uppercase tracking-wide">
        {group.category}
        {explicitEmoji && (
          <>
            {" "}
            <CategoryEmojiInline value={explicitEmoji} />
          </>
        )}
      </div>
      {/* Answers stay clearly secondary: smaller, lighter weight, and a
          touch more breathing room below the title (~4px via mt-1). */}
      <div className="text-[13px] md:text-[15px] font-[575] leading-tight mt-1 flex items-center justify-center flex-wrap gap-x-1 gap-y-0.5">
        {displayWords.map((w, i) => (
          <span key={`${w}-${i}`} className="inline-flex items-center gap-x-1">
            {/* Middot separator between answers (not before the first one) —
                its own flex item so the surrounding gap gives it even
                spacing on both sides, e.g. "MOLE · FRECKLES · PIMPLE". */}
            {i > 0 && <span aria-hidden="true">·</span>}
            {isCustomEmoji(w) ? (
              <img
                src={customEmojiUrl(w)}
                alt={customEmojiName(w) ?? ""}
                draggable={false}
                style={{ height: "28px", width: "auto", objectFit: "contain" }}
              />
            ) : (
              <span>{w}</span>
            )}
          </span>
        ))}
      </div>
    </div>
  );
});
