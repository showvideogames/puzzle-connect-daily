import { useEffect, useState } from "react";
import type { User } from "@supabase/supabase-js";
import { supabase } from "@/integrations/supabase/client";
import { getDeviceId, getDeviceToken } from "@/lib/gameStats";
import { Puzzle } from "@/lib/types";
import { todaysLogo } from "@/lib/themes";
import { FULL_FORMAT, type PuzzleFormat } from "@/lib/puzzleFormat";

interface LandingScreenProps {
  puzzle: Puzzle | null;
  user: User | null;
  onPlay: () => void;
  onSignInClick: () => void;
  /**
   * Which game this landing is the door to. Drives the one-line description
   * and — importantly — WHICH streak is shown: Full and Mini keep separate
   * streaks, so a Mini landing showing the player's Full streak would be
   * telling them a number that has nothing to do with the game behind the
   * button. Defaults to Full, so "/" is unchanged.
   */
  format?: PuzzleFormat;
}

const RAINBOW_GRADIENT = "linear-gradient(to bottom, #fb923c, #facc15, #4ade80, #60a5fa, #c084fc)";

export function LandingScreen({ puzzle, user, onPlay, onSignInClick, format = FULL_FORMAT }: LandingScreenProps) {
  const [streak, setStreak] = useState<number>(0);

  useEffect(() => {
    let cancelled = false;
    const fetchStreak = async () => {
      try {
        // user_streaks is RPC-only now; the function answers for the account
        // when there is one and for the proven device otherwise.
        const { data } = await supabase.rpc("get_own_streak", {
          _device_id: getDeviceId(),
          _device_token: getDeviceToken(),
          _format: format.statsNamespace,
        });
        const row = Array.isArray(data) ? data[0] : data;
        if (!cancelled && row?.current_streak != null) {
          setStreak(row.current_streak);
        }
      } catch {
        // ignore — streak just stays at 0
      }
    };
    void fetchStreak();
    return () => { cancelled = true; };
  }, [format.statsNamespace]);

  const formattedDate = puzzle
    ? new Date(puzzle.date + "T12:00:00").toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric" })
    : "";
  const titleText = puzzle?.title?.trim()
    ? `Puzzle ${puzzle.title.trim()}`
    : formattedDate;
  const showDateSubtitle = !!puzzle?.title?.trim();
  const puzzleReady = !!puzzle;

  if (format.id === FULL_FORMAT.id) {
    const button = "inline-flex min-h-[50px] w-full items-center justify-center rounded-full px-5 text-lg font-extrabold leading-tight transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-[#6924d6] active:scale-[.98]";
    return (
      <main
        className="fixed inset-0 z-10 overflow-y-auto bg-white text-[#252324]"
      >
        <div className="mx-auto flex min-h-full w-full max-w-[31rem] flex-col justify-center px-[clamp(1.25rem,5.5vw,2.5rem)] py-[clamp(1.25rem,4dvh,3rem)] text-center">
          <h1 className="w-full">
            <img src={todaysLogo()} alt="Rainbow Categories" width={2000} height={251} className="block h-auto w-full" />
          </h1>
          <div aria-hidden="true" className="mx-auto mt-[clamp(1rem,3dvh,1.75rem)] grid aspect-square w-[clamp(5.5rem,13dvh,7.5rem)] place-items-center overflow-hidden rounded-[15%]">
            <img src="/icons/rainbow-icon-192-0e09e6d1.png" alt="" width={192} height={192} className="block aspect-square h-auto w-full scale-[1.28]" />
          </div>
          <p className="mt-[clamp(1rem,3.25dvh,1.75rem)] text-[clamp(1rem,4vw,1.125rem)] font-semibold leading-relaxed">
            Find four groups of four words, then spot the Rainbow.
          </p>
          <div className="mt-[clamp(1rem,3dvh,1.75rem)] grid gap-2.5">
            <button type="button" onClick={onPlay} disabled={!puzzleReady} className={`${button} bg-[#6924d6] text-white hover:bg-[#561bb6] disabled:cursor-default disabled:opacity-60`}>Play</button>
            {!user && <button type="button" onClick={onSignInClick} className={`${button} border-[1.5px] border-[#252324] bg-transparent hover:bg-white/25`}>Sign In</button>}
          </div>
          <div className="mt-[clamp(.9rem,2.6dvh,1.5rem)] min-h-5 text-sm font-semibold sm:text-base" aria-hidden={!puzzleReady}>
            {puzzleReady ? (showDateSubtitle ? `${titleText} · ${formattedDate}` : formattedDate) : null}
          </div>
          <p className="mt-2.5 text-sm italic text-[#615b60] sm:text-base">By Sam West</p>
          {streak > 0 && <p className="mt-2 text-sm font-bold">{streak} Win Streak! 🔥</p>}
        </div>
      </main>
    );
  }

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
          {/* Full keeps its exact existing sentence; any other format states
              its own real shape rather than inheriting a claim about four
              words and a Rainbow it does not have. */}
          {format.hasRainbow
            ? "Find groups of four hidden words — then spot the secret Rainbow."
            : `Find ${format.categoryCount} groups of ${format.answersPerCategory} hidden words.`}
        </p>

        <div className="mt-8 w-full flex flex-col items-center gap-3">
          <button
            onClick={onPlay}
            disabled={!puzzleReady}
            className="w-full max-w-xs inline-flex items-center justify-center px-6 py-3.5 rounded-full
              bg-foreground text-background font-semibold text-base shadow-lg
              hover:opacity-90 transition-opacity active:scale-95
              disabled:opacity-60 disabled:cursor-default disabled:hover:opacity-60"
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

      {/* Puzzle metadata at the bottom (only when data is available) */}
      <div className="text-center text-foreground/80 transition-opacity duration-300" style={{ opacity: puzzleReady ? 1 : 0 }} aria-hidden={!puzzleReady}>
        <p className="text-xl font-bold">{titleText || "Puzzle"}</p>
        {showDateSubtitle ? (
          <p className="text-lg font-semibold mt-1">{formattedDate}</p>
        ) : (
          <p className="text-lg mt-1" aria-hidden="true">&nbsp;</p>
        )}
        {streak > 0 ? (
          <p className="text-xl font-bold mt-2">{streak} Win Streak! 🔥</p>
        ) : null}
      </div>
    </div>
  );
}
