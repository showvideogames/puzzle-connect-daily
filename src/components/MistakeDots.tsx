interface MistakeDotsProps {
  mistakes: number;
  max: number;
}

// Legacy per-category colors — kept ONLY as dark-mode overrides so dark mode
// keeps rendering exactly as it did before the redesign. Light mode uses a
// single neutral Ink color instead (no per-category mapping).
const LEGACY_DARK_COLORS = [
  "dark:bg-yellow-400",
  "dark:bg-green-500",
  "dark:bg-blue-500",
  "dark:bg-red-500",
];

export function MistakeDots({ mistakes, max }: MistakeDotsProps) {
  const remaining = max - mistakes;
  return (
    <div className="flex items-center gap-1.5 justify-center">
      <span className="text-xs text-slate mr-1">Mistakes remaining:</span>
      <span className="sr-only" role="status">
        {`${remaining} of ${max} mistakes remaining`}
      </span>
      {Array.from({ length: max }).map((_, i) => (
        <div
          key={i}
          aria-hidden="true"
          className={`w-6 h-2.5 rounded-full transition-colors duration-300 ${
            i < remaining
              ? `bg-ink ${LEGACY_DARK_COLORS[i] ?? "dark:bg-foreground"}`
              : "bg-tile-selected dark:bg-muted"
          }`}
        />
      ))}
    </div>
  );
}
