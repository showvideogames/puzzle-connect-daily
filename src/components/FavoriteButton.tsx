import { Star } from "lucide-react";

interface FavoriteButtonProps {
  favorited: boolean;
  /** Public count of signed-in favorites; hidden when zero. */
  count: number;
  onToggle: () => void;
  /** Small polite status line ("Saved on this device"). Its row is always reserved so nothing shifts. */
  note?: string | null;
}

/**
 * The custom-puzzle favorite control. Width and the status row are fixed so
 * toggling never shifts the layout; state is exposed with aria-pressed and
 * the visible label ("Favorite" / "Favorited") is the accessible name.
 */
export function FavoriteButton({ favorited, count, onToggle, note }: FavoriteButtonProps) {
  return (
    <div className="flex flex-col items-center">
      <button
        type="button"
        onClick={onToggle}
        aria-pressed={favorited}
        className={`inline-flex items-center justify-center gap-1.5 w-[9.75rem] h-9 rounded-full border text-sm font-semibold
          transition-colors active:scale-95
          focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background
          ${favorited
            ? "bg-amber-100 dark:bg-amber-900/30 border-amber-300 dark:border-amber-700 text-amber-900 dark:text-amber-200"
            : "bg-card border-border text-foreground hover:bg-secondary"}`}
      >
        <Star
          aria-hidden="true"
          className={`w-4 h-4 shrink-0 ${favorited ? "fill-amber-500 text-amber-500" : "text-muted-foreground"}`}
        />
        <span>{favorited ? "Favorited" : "Favorite"}</span>
        {count > 0 && (
          <span className="tabular-nums text-muted-foreground font-medium">
            <span aria-hidden="true">·</span> {count}
            <span className="sr-only"> {count === 1 ? "favorite" : "favorites"}</span>
          </span>
        )}
      </button>
      <p role="status" aria-live="polite" className="h-4 mt-0.5 text-[11px] leading-4 text-muted-foreground">
        {note ?? ""}
      </p>
    </div>
  );
}
