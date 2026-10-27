import { useEffect, useState } from "react";
import { Flame } from "lucide-react";

function prefersReducedMotion(): boolean {
  try {
    return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  } catch {
    return false;
  }
}

interface StreakCelebrationProps {
  streak: number;
  /**
   * True only for the moment a streak day is newly earned: the number counts
   * up from the day before and the pill pops. False shows the same pill
   * still, at the current streak — for reopening results, or a streak that
   * didn't change. Reduced motion always shows it still.
   */
  animate?: boolean;
  className?: string;
}

/** The flame "N day streak!" pill. */
export function StreakCelebration({ streak, animate = true, className = "mt-4" }: StreakCelebrationProps) {
  const [moving] = useState(() => animate && !prefersReducedMotion());
  const [displayNum, setDisplayNum] = useState(() => (moving ? Math.max(1, streak - 1) : streak));
  const [phase, setPhase] = useState<"counting" | "big" | "done">(moving ? "counting" : "done");

  useEffect(() => {
    if (!moving) {
      setDisplayNum(streak);
      return;
    }
    if (displayNum < streak) {
      const t = setTimeout(() => setDisplayNum(n => n + 1), 120);
      return () => clearTimeout(t);
    } else {
      setPhase("big");
      const t = setTimeout(() => setPhase("done"), 600);
      return () => clearTimeout(t);
    }
  }, [displayNum, streak, moving]);

  return (
    <div
      className={`flex justify-center ${moving ? "animate-fade-up" : ""} ${className}`}
      data-testid="streak-flame"
      data-earned={animate ? "true" : "false"}
    >
      {/* Read out once as the final number, not as each counted step. */}
      <span className="sr-only">{streak} day streak</span>
      <div
        aria-hidden="true"
        className={`flex items-center gap-2 bg-card border border-border rounded-full px-5 py-2.5 shadow-lg
          transition-all duration-300 ${phase === "big" ? "scale-125" : "scale-100"}`}
      >
        <Flame className="w-7 h-7 text-orange-500" aria-hidden="true" />
        <span
          className="font-bold tabular-nums transition-all duration-150"
          style={{ fontSize: phase === "big" ? "1.6rem" : "1.3rem" }}
        >
          {displayNum}
        </span>
        <span className="text-sm font-semibold text-muted-foreground">
          day streak!
        </span>
      </div>
    </div>
  );
}
