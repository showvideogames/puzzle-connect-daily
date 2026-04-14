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

function Star({ filled, partial }: { filled: boolean; partial?: boolean }) {
  return (
    <svg
      width="28"
      height="28"
      viewBox="0 0 24 24"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
    >
      <polygon
        points="12,2 15.09,8.26 22,9.27 17,14.14 18.18,21.02 12,17.77 5.82,21.02 7,14.14 2,9.27 8.91,8.26"
        fill={filled ? "hsl(var(--foreground))" : "none"}
        stroke="hsl(var(--foreground))"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
        style={{ transition: "fill 120ms ease" }}
      />
    </svg>
  );
}

interface PuzzleRatingProps {
  puzzleId: string;
  user: User | null;
}

export function PuzzleRating({ puzzleId, user }: PuzzleRatingProps) {
  const [hovered, setHovered] = useState<number | null>(null);
  const [submitted, setSubmitted] = useState(false);
  const [existing, setExisting] = useState<number | null>(null);
  const [loading, setLoading] = useState(true);

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
    <div className="animate-fade-up" style={{ marginTop: "20px", marginBottom: "4px" }}>
      {/* Thin divider */}
      <div style={{
        height: "1px",
        background: "hsl(var(--border))",
        marginBottom: "16px",
      }} />

      {!submitted ? (
        <div className="flex flex-col items-center gap-2">
          <p style={{
            fontSize: "11px",
            fontWeight: 600,
            letterSpacing: "0.08em",
            textTransform: "uppercase",
            color: "hsl(var(--muted-foreground))",
          }}>
            Rate this puzzle
          </p>

          {/* Stars */}
          <div
            className="flex items-center gap-1"
            onMouseLeave={() => setHovered(null)}
          >
            {[1, 2, 3, 4, 5].map((star) => (
              <button
                key={star}
                onClick={() => handleRate(star)}
                onMouseEnter={() => setHovered(star)}
                className="p-1 transition-transform duration-100 hover:scale-110 active:scale-95"
                aria-label={LABELS[star]}
              >
                <Star filled={star <= activeRating} />
              </button>
            ))}
          </div>

          {/* Label */}
          <div style={{ height: "18px" }}>
            {activeRating > 0 && (
              <p style={{
                fontSize: "12px",
                fontWeight: 500,
                color: "hsl(var(--foreground))",
                letterSpacing: "0.02em",
              }}>
                {LABELS[activeRating]}
              </p>
            )}
          </div>
        </div>
      ) : (
        <p
          className="text-center animate-fade-up"
          style={{
            fontSize: "12px",
            fontWeight: 500,
            letterSpacing: "0.02em",
            color: "hsl(var(--muted-foreground))",
          }}
        >
          Thank you for your contribution
        </p>
      )}

      {/* Thin divider */}
      <div style={{
        height: "1px",
        background: "hsl(var(--border))",
        marginTop: "16px",
      }} />
    </div>
  );
}
