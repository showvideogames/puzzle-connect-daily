interface MistakeDotsProps {
  mistakes: number;
  max: number;
}

export function MistakeDots({ mistakes, max }: MistakeDotsProps) {
  const remaining = max - mistakes;
  return (
    <div className="flex items-center gap-1.5 justify-center">
      <span className="text-sm md:text-base text-slate mr-1">Mistakes remaining:</span>
      <span className="sr-only" role="status">
        {`${remaining} of ${max} mistakes remaining`}
      </span>
      <div className="flex items-center gap-2">
        {Array.from({ length: max }).map((_, i) => (
          <div
            key={i}
            aria-hidden="true"
            className={`w-4 h-4 shrink-0 aspect-square rounded-full transition-colors duration-300 ${
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
