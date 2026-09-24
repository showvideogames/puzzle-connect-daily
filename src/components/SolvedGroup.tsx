import { forwardRef } from "react";
import { PuzzleGroup } from "@/lib/types";
import { isCustomEmoji, customEmojiUrl, customEmojiName } from "@/lib/customEmoji";
import { CategoryEmojiInline } from "./CategoryEmojiInline";
import { SOLVE_BAR_FADE_MS } from "@/lib/solveAnimation";

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
  // Phase of GameBoard's solve animation (see lib/solveAnimation.ts):
  //  - "pending": the guessed tiles are still gathering into the top row.
  //    The bar is invisible and taken OUT of the page flow (absolute, with
  //    no top set, so it sits exactly where it will end up and at the full
  //    board width) — the board below doesn't move to make room for it yet.
  //  - "appearing": same place, fading in over the gathered row while its
  //    text settles in (.animate-solved-content-land). The bar box itself
  //    never scales or moves, so its width never changes.
  //  - "settling": back in the page flow — the row has gone and the board
  //    below is sliding up. The text animation carries on uninterrupted.
  // undefined = normal rendering (animate-group-appear entrance if `animate`).
  reveal?: "pending" | "appearing" | "settling";
}

// forwardRef so GameBoard can reach this bar's DOM node during the solve
// animation.
export const SolvedGroup = forwardRef<HTMLDivElement, SolvedGroupProps>(function SolvedGroup(
  { group, alphabetizeCompleted = true, animate, reveal },
  ref
) {
  const colors = groupColors[group.difficulty] || groupColors[1];
  const revealing = reveal !== undefined;
  const floating = reveal === "pending" || reveal === "appearing";
  const contentLand = reveal === "appearing" || reveal === "settling" ? "animate-solved-content-land" : "";
  const displayWords = alphabetizeCompleted
    ? [...group.words].sort((a, b) => a.localeCompare(b))
    : group.words;
  // Only the EXPLICIT Category Emoji is appended here. Older puzzles with no
  // explicit value rely on the legacy fallback (an emoji typed into the end
  // of the category title itself), which the plain title text below already
  // shows — appending it a second time would duplicate it.
  //
  // "Hint Only" withholds it from THIS bar while the Full Hint still shows it
  // (see GameBoard's hintItems) — for a visual that reads as a clue but not
  // as part of the answer, e.g. "___ 💬" on a "HIGH ___" category. It never
  // touches the category NAME, so an emoji typed into the name still shows.
  const explicitEmoji = group.categoryEmojiHintOnly ? "" : (group.categoryEmoji ?? "").trim();
  return (
    <div
      ref={ref}
      className={`${colors.bg} ${colors.text} rounded-lg py-3 px-4 text-center ${
        !revealing && animate ? "animate-group-appear" : ""
      }`}
      style={
        floating
          ? {
              position: "absolute",
              left: 0,
              right: 0,
              zIndex: 10,
              pointerEvents: "none",
              opacity: reveal === "appearing" ? 1 : 0,
              transition: `opacity ${SOLVE_BAR_FADE_MS}ms ease-out`,
            }
          : undefined
      }
    >
      {/* Category title is the payoff/reveal on each card — noticeably
          larger and heavier than the answer line, and shares the puzzle
          tile's typeface (Inter) to visually connect the two. */}
      <div className={`font-tile font-bold text-[16px] md:text-[19px] leading-tight uppercase tracking-wide ${contentLand}`}>
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
      <div className={`text-[13px] md:text-[15px] font-[575] leading-tight mt-1 flex items-center justify-center flex-wrap gap-x-1 gap-y-0.5 ${contentLand}`}>
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
