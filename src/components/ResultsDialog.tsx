import * as DialogPrimitive from "@radix-ui/react-dialog";
import { Suspense, lazy, useCallback, useEffect, useRef, useState, type RefObject } from "react";
import { Check, Share2, X } from "lucide-react";
import { ResultGrid, type ResultRow } from "./ResultGrid";
import { StreakCelebration } from "./StreakCelebration";
import { SpotRainbowPrompt } from "./SpotRainbowPrompt";
import { FriendsBoundary, FriendsCard, FriendsPlaceholder } from "./results/FriendsSection";
import { UpNext } from "./results/UpNext";
import { socialBetaOn } from "@/components/social/socialFlag";
import { displayStreakOf, loadStatsFromSupabase, winRateOf } from "@/lib/gameStats";
import type { GameStats } from "@/lib/types";
import type { PuzzleFormat } from "@/lib/puzzleFormat";
import type { ResolvedTheme } from "@/lib/themes";

// The social client comes only with this section, so it never enters the main chunk.
const FriendsResults = lazy(() => import("./results/FriendsResults"));

interface ResultsDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** The board's own one-word result message (getResultHeadline). */
  headline: string;
  /** A timed format's frozen solve time, already formatted; null to omit. */
  timeLabel: string | null;
  /** The real share squares, from the same guess history the Share text uses. */
  resultRows: ResultRow[];
  /** null when there is nothing honest to share (see `summary`). */
  onShare: (() => void) | null;
  /**
   * A finished game whose details were not saved, restored from its outcome
   * only (lib/finishedGame.ts): the facts its record does hold, and a line
   * saying the rest is not available. null for every other game.
   */
  summary?: { facts: string[]; note: string } | null;
  copied: boolean;
  /**
   * Whose personal stats to show (Played / Win % / Max Streak), read the
   * same way My Stats reads them. null for a mode that never counts toward
   * them (Beta, custom), which shows no stats.
   */
  statsFormat: PuzzleFormat | null;
  /**
   * Hold off reading stats while a completion from this visit is still being
   * saved, so the numbers already include it.
   */
  statsPending: boolean;
  /** Show the flame streak pill (official Daily only). */
  showStreak: boolean;
  /**
   * Play the flame's count-up — only for a streak day newly earned by this
   * visit's win, and only the first time it is shown.
   */
  animateStreak: boolean;
  /** Called when an animated flame has been shown, so it never plays again. */
  onStreakAnimated: () => void;
  /**
   * The post-game Spot the Rainbow invitation, when it's still on offer.
   * Clicking it closes this popup and opens the real challenge.
   */
  spotTheme: ResolvedTheme | null;
  onSpotRainbow: () => void;
  /**
   * Where keyboard focus goes when the popup closes — View Results. The
   * popup usually opens by itself, with nothing focused to go back to.
   */
  returnFocusRef?: RefObject<HTMLElement>;
  /** Which game this is: Up next offers the other one, and Friends' results follow it. */
  gameFormat: PuzzleFormat["id"];
  /**
   * The official Daily (not Archive, Beta or custom). Only it has friends'
   * results; every other game shows no Friends' results section.
   */
  officialDaily: boolean;
  puzzleId: string;
  /** This game's own outcome, for the player's own row before the server has one. */
  solved: boolean;
  mistakes: number;
}

/**
 * The end-of-game results popup. The personal part is the board's own: the
 * share squares, the Share action, the result wording, the stats My Stats
 * shows, the flame streak pill and the Spot the Rainbow invitation, all shown
 * at once. Friends' results load on their own inside their section (beta flag,
 * official Daily only), so they never hold up the rest. It only reads —
 * opening, closing and reopening it never saves anything.
 */
export function ResultsDialog({
  open,
  onOpenChange,
  headline,
  timeLabel,
  resultRows,
  onShare,
  summary = null,
  copied,
  statsFormat,
  statsPending,
  showStreak,
  animateStreak,
  onStreakAnimated,
  spotTheme,
  onSpotRainbow,
  returnFocusRef,
  gameFormat,
  officialDaily,
  puzzleId,
  solved,
  mistakes,
}: ResultsDialogProps) {
  const [stats, setStats] = useState<GameStats | null>(null);
  const shareRef = useRef<HTMLButtonElement>(null);
  const close = useCallback(() => onOpenChange(false), [onOpenChange]);

  useEffect(() => {
    if (!open || !statsFormat || statsPending) return;
    let cancelled = false;
    loadStatsFromSupabase(statsFormat).then((s) => {
      if (!cancelled) setStats(s);
    });
    return () => { cancelled = true; };
  }, [open, statsFormat, statsPending]);

  const streak = stats ? displayStreakOf(stats) : 0;
  const streakShown = showStreak && !!stats && streak > 0;
  // Decided when the pill first appears, so later re-renders can't restart it.
  const [streakMoves, setStreakMoves] = useState<boolean | null>(null);
  useEffect(() => {
    if (!open) {
      setStreakMoves(null);
      return;
    }
    if (streakShown && streakMoves === null) {
      setStreakMoves(animateStreak);
      if (animateStreak) onStreakAnimated();
    }
  }, [open, streakShown, streakMoves, animateStreak, onStreakAnimated]);

  const statItems = statsFormat
    ? [
        { label: "Played", value: stats ? String(stats.gamesPlayed) : "–" },
        { label: "Win %", value: stats ? String(winRateOf(stats)) : "–" },
        { label: "Max Streak", value: stats ? String(stats.maxStreak) : "–" },
      ]
    : [];

  const showFriends = officialDaily && socialBetaOn();

  return (
    <DialogPrimitive.Root open={open} onOpenChange={onOpenChange}>
      <DialogPrimitive.Portal>
        <DialogPrimitive.Overlay className="fixed inset-0 z-50 bg-foreground/20 backdrop-blur-sm" />
        {/* Same centring shell as the Spot the Rainbow modal: centred by a
            flex box (the entrance animation owns transform), capped to the
            visible height, the body scrolling inside while the close button
            stays put. */}
        <div
          className="fixed inset-0 z-50 flex items-center justify-center pointer-events-none
            px-4 pt-[max(12px,env(safe-area-inset-top))] pb-[max(12px,env(safe-area-inset-bottom))]"
        >
          <DialogPrimitive.Content
            data-testid="results-dialog"
            // Titled by the result word only; there is no description line.
            aria-describedby={undefined}
            onOpenAutoFocus={(e) => {
              // Share first, as before; without one, the dialog's own default.
              if (!shareRef.current) return;
              e.preventDefault();
              shareRef.current.focus();
            }}
            onCloseAutoFocus={(e) => {
              const target = returnFocusRef?.current;
              if (!target) return;
              e.preventDefault();
              target.focus({ preventScroll: true });
            }}
            className="pointer-events-auto relative w-full max-w-[26rem]
              max-h-[calc(100vh-24px)] max-h-[calc(100dvh-24px)]
              flex flex-col bg-card rounded-3xl shadow-2xl
              animate-pop motion-reduce:animate-none focus:outline-none"
          >
            {/* Outside the scrolling body, so it never scrolls away. */}
            <DialogPrimitive.Close
              aria-label="Close results"
              className="absolute right-2 top-2 z-10 w-11 h-11 flex items-center justify-center rounded-full
                bg-card text-muted-foreground hover:bg-secondary transition-colors active:scale-95
                focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              <X className="w-5 h-5" />
            </DialogPrimitive.Close>

            <div className="min-h-0 overflow-y-auto overscroll-contain px-5 sm:px-6 pt-10 pb-5 text-center">
              {/* The squares and the result word side by side when they fit,
                  stacked when they don't. */}
              <div className="flex flex-wrap items-center justify-center gap-x-6 gap-y-3">
                {resultRows.length > 0 && <ResultGrid rows={resultRows} />}
                <div className={resultRows.length > 0 ? "text-left" : "text-center"}>
                  <DialogPrimitive.Title asChild>
                    <h2 className="text-[2rem] sm:text-[2.25rem] font-extrabold tracking-tight leading-tight">{headline}</h2>
                  </DialogPrimitive.Title>
                  {timeLabel && (
                    <p className="text-base font-semibold tabular-nums mt-1">⏳ {timeLabel}</p>
                  )}
                </div>
              </div>

              {summary && (
                <div className="mt-3" data-testid="results-summary">
                  {summary.facts.length > 0 && (
                    <p className="text-[15px] font-semibold">{summary.facts.join(" · ")}</p>
                  )}
                  <p className="mt-1 text-[15px] text-muted-foreground">{summary.note}</p>
                </div>
              )}

              {statItems.length > 0 && (
                <dl className="mt-4 grid grid-cols-3 divide-x divide-border" data-testid="results-stats">
                  {statItems.map((item) => (
                    <div key={item.label} className="flex flex-col-reverse items-center px-1">
                      <dt className="text-[15px] text-muted-foreground leading-tight">{item.label}</dt>
                      <dd className="text-2xl font-extrabold tabular-nums leading-none mb-1">{item.value}</dd>
                    </div>
                  ))}
                </dl>
              )}

              {streakShown && streakMoves !== null && (
                <StreakCelebration streak={streak} animate={streakMoves} className="mt-3" />
              )}

              {onShare && (
              <button
                ref={shareRef}
                type="button"
                onClick={onShare}
                className="mt-5 w-full h-12 inline-flex items-center justify-center gap-2 rounded-full
                  bg-primary text-primary-foreground text-base font-bold shadow-md
                  hover:opacity-90 transition-all duration-150 active:scale-[0.98]
                  focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-card"
              >
                {copied ? <Check className="w-5 h-5" /> : <Share2 className="w-5 h-5" />}
                {copied ? "Copied!" : "Share Score"}
              </button>
              )}

              {spotTheme && (
                // A size container, so the prompt's text scales with the
                // popup's width the way it does with the board's.
                <div className="mt-3" style={{ containerType: "inline-size" }}>
                  <SpotRainbowPrompt theme={spotTheme} onClick={onSpotRainbow} className="py-2.5" />
                </div>
              )}

              {showFriends && (
                <FriendsBoundary>
                  <Suspense fallback={<FriendsCard pending><FriendsPlaceholder /></FriendsCard>}>
                    <FriendsResults format={gameFormat} puzzleId={puzzleId} solved={solved} mistakes={mistakes} onClose={close} />
                  </Suspense>
                </FriendsBoundary>
              )}

              <UpNext format={gameFormat} onNavigate={close} />

              <DialogPrimitive.Close
                className="mt-4 min-h-11 px-2 text-[15px] font-semibold underline underline-offset-4 text-foreground/80 hover:text-foreground
                  rounded focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              >
                Back to board
              </DialogPrimitive.Close>
            </div>
          </DialogPrimitive.Content>
        </div>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  );
}
