import { useEffect, useId, useState } from "react";
import { getMyCustomPuzzleRating, setCustomPuzzleRating } from "@/lib/customPuzzles";

const STARS = [1, 2, 3, 4, 5] as const;

function StarIcon({ filled }: { filled: boolean }) {
  return (
    <svg width="28" height="28" viewBox="0 0 24 24" aria-hidden="true" focusable="false">
      <polygon
        points="12,2 15.09,8.26 22,9.27 17,14.14 18.18,21.02 12,17.77 5.82,21.02 7,14.14 2,9.27 8.91,8.26"
        fill={filled ? "#FFC83D" : "none"}
        stroke="hsl(var(--foreground))"
        strokeWidth="1.5"
        strokeLinejoin="round"
        style={{ transition: "fill 120ms ease" }}
      />
    </svg>
  );
}

function messageFor(err: unknown): string {
  const m = err instanceof Error ? err.message : typeof err === "object" && err && "message" in err ? String((err as { message: unknown }).message) : "";
  if (/finish the puzzle/i.test(m)) return "Finish the puzzle to rate it.";
  if (/sign in/i.test(m)) return "Sign in to rate puzzles.";
  return "Couldn't save your rating. Try again.";
}

/**
 * The optional "Rate this puzzle" row on a custom puzzle's Results screen.
 * Shown only after the game is over (the board decides that), and only to a
 * signed-in player who may rate it (not its author; the server says so).
 * One editable rating per player: tapping another star replaces it. The
 * server also checks this browser's finish record. Private: nothing here
 * shows anyone else's rating or any total.
 */
export function CustomPuzzleRating({ shareId }: { shareId: string }) {
  const labelId = useId();
  const [state, setState] = useState<"loading" | "hidden" | "ready">("loading");
  const [rating, setRating] = useState<number | null>(null);
  const [hovered, setHovered] = useState<number | null>(null);
  const [saving, setSaving] = useState(false);
  const [note, setNote] = useState("");

  useEffect(() => {
    let live = true;
    setState("loading");
    getMyCustomPuzzleRating(shareId).then((r) => {
      if (!live) return;
      if (!r?.canRate) { setState("hidden"); return; }
      setRating(r.rating);
      setState("ready");
    });
    return () => { live = false; };
  }, [shareId]);

  if (state !== "ready") return null;

  const rate = async (stars: number) => {
    if (saving || stars === rating) return;
    const had = rating !== null;
    setSaving(true);
    setNote("");
    try {
      const saved = await setCustomPuzzleRating(shareId, stars);
      setRating(saved);
      setNote(`${had ? "Updated" : "Saved"}: ${saved} of 5`);
    } catch (err) {
      setNote(messageFor(err));
    } finally {
      setSaving(false);
    }
  };

  const shown = hovered ?? rating ?? 0;
  return (
    <div className="mt-4 flex flex-col items-center" data-testid="custom-rating">
      <p id={labelId} className="text-[15px] font-semibold">Rate this puzzle</p>
      <div role="group" aria-labelledby={labelId} className="mt-1 flex" onMouseLeave={() => setHovered(null)}>
        {STARS.map((n) => (
          <button
            key={n}
            type="button"
            aria-label={`${n} ${n === 1 ? "star" : "stars"}`}
            aria-pressed={rating === n}
            disabled={saving}
            onClick={() => void rate(n)}
            onMouseEnter={() => setHovered(n)}
            className="inline-flex h-11 w-11 items-center justify-center rounded-full transition-transform active:scale-90 disabled:opacity-60
              focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            data-testid="custom-rating-star"
          >
            <StarIcon filled={n <= shown} />
          </button>
        ))}
      </div>
      <p className="min-h-5 text-sm text-muted-foreground" aria-live="polite" data-testid="custom-rating-note">
        {note || (rating ? `Your rating: ${rating} of 5` : "")}
      </p>
    </div>
  );
}
