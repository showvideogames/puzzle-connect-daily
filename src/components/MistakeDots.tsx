interface MistakeDotsProps {
  mistakes: number;
  max: number;
  /** Bare text and dots, no pill (the refreshed game layout). */
  plain?: boolean;
  /**
   * Narrow boards with guess feedback beside the dots: the visible label is
   * shortened to "Mistakes:" and the dots tighten. The full count is still
   * announced (sr-only), so nothing is lost for screen readers.
   */
  compact?: boolean;
  /** Narrowest boards with feedback showing: the visible label hides; dots and the announced count stay. */
  dotsOnly?: boolean;
}

export function MistakeDots({ mistakes, max, plain = false, compact = false, dotsOnly = false }: MistakeDotsProps) {
  const remaining = max - mistakes;
  return (
    // A quiet metadata pill rather than text/dots floating directly on the
    // page — bg-card/border-border are the same theme-aware tokens the
    // Guess History panel already uses, so this reads correctly in both
    // themes without a dark-specific override. The shadow is light-mode
    // only (dark already gets its separation from the border/bg contrast
    // against the page, and doesn't need an added shadow layer).
    <div
      className={plain
        ? `w-fit flex items-center justify-center py-1 whitespace-nowrap ${compact ? "gap-1" : "gap-1.5"}`
        : `mx-auto w-fit flex items-center gap-1.5 justify-center rounded-full border border-border bg-card
        px-4 py-2 shadow-[0_1px_2px_rgba(30,25,20,0.04),0_2px_6px_rgba(30,25,20,0.05)] dark:shadow-none`}
    >
      {!dotsOnly && (
        <span aria-hidden="true" className="text-sm md:text-base text-slate mr-1">
          {compact ? "Mistakes:" : "Mistakes remaining:"}
        </span>
      )}
      <span className="sr-only" role="status">
        {`${remaining} of ${max} mistakes remaining`}
      </span>
      <div className={`flex items-center ${compact ? "gap-1.5" : "gap-2"}`}>
        {Array.from({ length: max }).map((_, i) => (
          <div
            key={i}
            aria-hidden="true"
            className={`${compact ? "w-3.5 h-3.5" : "w-4 h-4"} shrink-0 aspect-square rounded-full transition-colors duration-300 ${
              // These communicate lives/mistakes remaining, not the puzzle
              // categories — neutral in both themes, never category colors.
              i < remaining
                ? "bg-ink dark:bg-foreground"
                : "bg-disabled-bg dark:bg-muted"
            }`}
          />
        ))}
      </div>
    </div>
  );
}
