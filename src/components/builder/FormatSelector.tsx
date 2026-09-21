import { PUZZLE_FORMAT_IDS, getFormat, type PuzzleFormatId } from "@/lib/puzzleFormat";

interface FormatSelectorProps {
  value: PuzzleFormatId;
  onChange: (next: PuzzleFormatId) => void;
  /**
   * When set, the selector is read-only and this explains why — an existing
   * puzzle keeps the size it was saved with, because its stored content, its
   * players' pinned boards and its statistics all assume one shape.
   */
  lockedReason?: string;
  /**
   * Format ids that exist but are not offered here yet, mapped to the reason.
   * Rendered greyed out with the reason as its tooltip, rather than hidden —
   * a size that is coming is worth showing, but it must never be selectable
   * if choosing it would produce something unusable.
   */
  unavailable?: Partial<Record<PuzzleFormatId, string>>;
}

/**
 * The Full 4×4 / Mini 3×3 size selector, shared by the Admin builder and the
 * public creator. Replaces the two shells' separate hardcoded "Full 4×4 |
 * Mini 3×3 (soon)" spans.
 *
 * Same segmented-control geometry those spans already had, so neither shell
 * changes shape — the difference is that the options are now real, come from
 * lib/puzzleFormat.ts, and can be disabled with a truthful reason instead of
 * a permanent "(soon)".
 */
export function FormatSelector({ value, onChange, lockedReason, unavailable }: FormatSelectorProps) {
  return (
    <div>
      <span className="text-xs font-medium text-slate block mb-1">Size</span>
      <div className="inline-flex rounded-lg border border-border p-0.5 bg-secondary/50" role="group" aria-label="Puzzle size">
        {PUZZLE_FORMAT_IDS.map((id) => {
          const format = getFormat(id);
          const label = `${format.name} ${format.sizeLabel}`;
          const selected = id === value;
          const blockedReason = unavailable?.[id];
          const disabled = !!blockedReason || (!!lockedReason && !selected);

          if (disabled) {
            return (
              <span
                key={id}
                title={blockedReason ?? lockedReason}
                aria-disabled="true"
                className="px-3 py-1.5 rounded-md text-xs font-semibold text-muted-foreground/50 cursor-not-allowed"
              >
                {label}
              </span>
            );
          }

          return (
            <button
              key={id}
              type="button"
              onClick={() => onChange(id)}
              aria-pressed={selected}
              title={selected ? lockedReason : undefined}
              className={`px-3 py-1.5 rounded-md text-xs font-semibold transition-colors
                ${selected ? "bg-card text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground"}`}
            >
              {label}
            </button>
          );
        })}
      </div>
      {lockedReason && <p className="text-[11px] text-muted-foreground mt-1 max-w-[260px]">{lockedReason}</p>}
    </div>
  );
}
