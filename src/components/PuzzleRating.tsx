import { useState, useEffect } from "react";
import { supabase } from "@/integrations/supabase/client";
import type { User } from "@supabase/supabase-js";

const LABELS: Record<number, string> = {
  1: "Bad",
  2: "Meh",
  3: "Good",
  4: "Liked it",
  5: "Loved it",
};

interface PuzzleRatingProps {
  puzzleId: string;
  user: User | null;
}

export function PuzzleRating({ puzzleId, user }: PuzzleRatingProps) {
  const [hovered, setHovered] = useState<number | null>(null);
  const [submitted, setSubmitted] = useState(false);
  const [existing, setExisting] = useState<number | null>(null);
  const [loading, setLoading] = useState(true);

  // Check if user already rated this puzzle
  useEffect(() => {
    if (!user) { setLoading(false); return; }
    supabase
      .from("puzzle_ratings")
      .select("rating")
      .eq("puzzle_id", puzzleId)
      .eq("user_id", user.id)
      .single()
      .then(({ data }) => {
        if (data) {
          setExisting(data.rating);
          setSubmitted(true);
        }
        setLoading(false);
      });
  }, [puzzleId, user]);

  if (!user || loading) return null;

  const handleRate = async (stars: number) => {
    if (submitted) return;
    setSubmitted(true);
    setExisting(stars);
    await supabase.from("puzzle_ratings").upsert({
      puzzle_id: puzzleId,
      user_id: user.id,
      rating: stars,
    }, { onConflict: "puzzle_id,user_id" });
  };

  const activeRating = hovered ?? existing ?? 0;

  return (
    <div className="flex flex-col items-center gap-2 mt-4 mb-2 animate-fade-up">
      {!submitted ? (
        <>
          <p className="text-sm font-semibold">Rate this puzzle</p>
          <div className="flex items-center gap-1">
            {[1, 2, 3, 4, 5].map((star) => (
              <button
                key={star}
                onClick={() => handleRate(star)}
                onMouseEnter={() => setHovered(star)}
                onMouseLeave={() => setHovered(null)}
                className="text-2xl transition-transform duration-100 hover:scale-125 active:scale-110"
                aria-label={LABELS[star]}
              >
                <span className={star <= activeRating ? "opacity-100" : "opacity-25"}>
                  ⭐
                </span>
              </button>
            ))}
          </div>
          {activeRating > 0 && (
            <p className="text-xs text-muted-foreground h-4 transition-all">
              {LABELS[activeRating]}
            </p>
          )}
          {activeRating === 0 && <div className="h-4" />}
        </>
      ) : (
        <p className="text-sm text-muted-foreground animate-fade-up">
          Thank you for your contribution! 🙏
        </p>
      )}
    </div>
  );
}
