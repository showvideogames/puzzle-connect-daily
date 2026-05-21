import { useEffect, useState } from "react";
import type { User } from "@supabase/supabase-js";
import { supabase } from "@/integrations/supabase/client";
import { getDeviceId } from "@/lib/gameStats";
import { Puzzle } from "@/lib/types";

interface LandingScreenProps {
  puzzle: Puzzle;
  user: User | null;
  onPlay: () => void;
  onSignInClick: () => void;
}

const RAINBOW_GRADIENT = "linear-gradient(to bottom, #fb923c, #facc15, #4ade80, #60a5fa, #c084fc)";

export function LandingScreen({ puzzle, user, onPlay, onSignInClick }: LandingScreenProps) {
  const [streak, setStreak] = useState<number>(0);

  useEffect(() => {
    let cancelled = false;
    const fetchStreak = async () => {
      try {
        const deviceId = getDeviceId();
        const { data: { user: authUser } } = await supabase.auth.getUser();
        const userId = authUser?.id ?? null;
        const { data } = userId
          ? await supabase.from("user_streaks").select("current_streak").eq("user_id", userId).single()
          : await supabase.from("user_streaks").select("current_streak").eq("device_id", deviceId).single();
        if (!cancelled && data?.current_streak != null) {
          setStreak(data.current_streak);
        }
      } catch {
        // ignore — streak just stays at 0
      }
    };
    void fetchStreak();
    return () => { cancelled = true; };
  }, []);

  const d = new Date(puzzle.date + "T12:00:00");
  const formattedDate = d.toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric" });
  const titleText = puzzle.title?.trim()
    ? `Puzzle ${puzzle.title.trim()}`
    : formattedDate;
  const showDateSubtitle = !!puzzle.title?.trim();

  return (
    <div
      className="fixed inset-0 flex flex-col items-center justify-between py-12 px-6 overflow-y-auto"
      style={{ background: RAINBOW_GRADIENT }}
    >
      {/* Spacer for visual breathing room at the top */}
      <div />

      {/* Center stack */}
      <div className="flex flex-col items-center text-center max-w-md w-full">
        <img
          src="/rainbow-categories.png"
          alt="Rainbow Categories"
          className="h-24 w-auto mb-4"
        />
        <h1 className="text-3xl sm:text-4xl font-bold tracking-tight text-foreground">
          Rainbow Categories
        </h1>
        <p className="text-base text-foreground/80 mt-3 leading-relaxed">
          Find groups of four hidden words — then spot the secret Rainbow.
        </p>

        <div className="mt-8 w-full flex flex-col items-center gap-3">
          <button
            onClick={onPlay}
            className="w-full max-w-xs inline-flex items-center justify-center px-6 py-3.5 rounded-full
              bg-foreground text-background font-semibold text-base shadow-lg
              hover:opacity-90 transition-opacity active:scale-95"
          >
            Play
          </button>
          {!user && (
            <button
              onClick={onSignInClick}
              className="w-full max-w-xs inline-flex items-center justify-center px-6 py-3 rounded-full
                border-2 border-foreground text-foreground font-semibold text-base
                bg-transparent hover:bg-foreground/10 transition-colors active:scale-95"
            >
              Sign In
            </button>
          )}
        </div>
      </div>

      {/* Puzzle metadata at the bottom */}
      <div className="text-center text-foreground/80">
        <p className="text-base font-semibold">{titleText}</p>
        {showDateSubtitle && (
          <p className="text-sm mt-0.5">{formattedDate}</p>
        )}
        {streak > 0 && (
          <p className="text-sm font-semibold mt-2">{streak} Day Streak! 🔥</p>
        )}
      </div>
    </div>
  );
}
