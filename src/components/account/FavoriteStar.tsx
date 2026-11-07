import { useRef, useState } from "react";
import { Star } from "lucide-react";

/** The gold of the reference's star. The outline stays a darker amber so an empty star still shows on white. */
const GOLD = "#FBBF24";

export function FavoriteStar({
  name,
  favorite,
  onSave,
  size = "row",
}: {
  name: string;
  favorite: boolean;
  onSave: () => Promise<string | void>;
  /** "title" is the big star beside a friend's name on their profile. */
  size?: "row" | "title";
}) {
  const pending = useRef(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const title = size === "title";
  return (
    <span className="inline-flex shrink-0 flex-col items-center">
      <button
        type="button"
        aria-label={`${favorite ? "Remove" : "Add"} ${name} ${favorite ? "from" : "to"} favorites`}
        aria-pressed={favorite}
        disabled={busy}
        className={`inline-flex ${title ? "size-12 sm:size-14" : "size-11"} items-center justify-center rounded-full text-amber-600 transition-transform hover:bg-amber-100 active:scale-95 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[hsl(258_90%_52%)] disabled:opacity-50 dark:text-amber-300 dark:hover:bg-amber-950`}
        onClick={async () => {
          if (pending.current) return;
          pending.current = true;
          setBusy(true);
          setError(null);
          try {
            const problem = await onSave();
            if (problem) setError(problem);
          } catch {
            setError("Could not save favorite. Try again.");
          } finally {
            pending.current = false;
            setBusy(false);
          }
        }}
      >
        <Star
          aria-hidden
          className={title ? "h-10 w-10 sm:h-11 sm:w-11" : "h-7 w-7"}
          strokeWidth={title ? 1.75 : 2}
          fill={favorite ? GOLD : "none"}
        />
      </button>
      {error && (
        <span role="alert" className="max-w-48 text-sm text-destructive">
          {error}
        </span>
      )}
    </span>
  );
}
