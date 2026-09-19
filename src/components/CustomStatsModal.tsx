import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { X } from "lucide-react";
import {
  getCustomPuzzleStats,
  guessBucketFor,
  GUESS_BUCKETS,
  type CustomPuzzleStats,
} from "@/lib/customPuzzles";

interface CustomStatsModalProps {
  shareId: string;
  open: boolean;
  onClose: () => void;
  userWon?: boolean;
  userTotalGuesses?: number;
  isComplete?: boolean;
}

const BUCKET_LABELS: Record<(typeof GUESS_BUCKETS)[number], string> = {
  "4": "4 guesses",
  "5": "5 guesses",
  "6": "6 guesses",
  "7": "7 guesses",
  "8+": "8+ guesses",
};

function Tile({ value, label, testId }: { value: string | number; label: string; testId: string }) {
  return (
    <div className="rounded-lg bg-secondary/50 p-3 text-center" data-testid={testId}>
      <div className="text-2xl font-bold tabular-nums">{value}</div>
      <div className="text-[10px] text-muted-foreground uppercase tracking-wider">{label}</div>
    </div>
  );
}

/**
 * The custom-puzzle sibling of DailyStatsModal — same card, tiles and bar
 * language — reading get_custom_puzzle_stats. Available before, during and
 * after play. Losses are their own tile and never enter the average or the
 * guess distribution, which always lists all five buckets.
 */
export function CustomStatsModal({ shareId, open, onClose, userWon, userTotalGuesses, isComplete }: CustomStatsModalProps) {
  const [stats, setStats] = useState<CustomPuzzleStats | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!open) return;
    setLoading(true);
    getCustomPuzzleStats(shareId).then((s) => {
      setStats(s);
      setLoading(false);
    });
  }, [open, shareId]);

  if (!open) return null;

  const plays = stats?.completedPlays ?? 0;
  const winRate = stats && plays > 0 ? Math.round((stats.wins / plays) * 100) : 0;
  const dist = stats?.guessDistribution;
  const maxCount = Math.max(1, ...GUESS_BUCKETS.map((b) => dist?.[b] ?? 0));
  const yourBucket = isComplete && userWon && userTotalGuesses !== undefined ? guessBucketFor(userTotalGuesses) : null;

  return createPortal(
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      <div className="absolute inset-0 bg-foreground/20 backdrop-blur-sm" onClick={onClose} />
      <div
        role="dialog"
        aria-label="Puzzle stats"
        className="relative bg-card rounded-xl shadow-2xl p-6 w-full max-w-sm mx-4 animate-pop max-h-[90vh] overflow-y-auto"
      >
        <button
          onClick={onClose}
          aria-label="Close"
          className="absolute top-3 right-3 p-1.5 rounded-lg hover:bg-secondary transition-colors active:scale-95"
        >
          <X className="w-4 h-4" />
        </button>

        <h2 className="text-lg font-bold text-center">This Puzzle's Stats</h2>
        <p className="text-xs text-muted-foreground text-center mb-4">Statistics for this custom puzzle only.</p>

        {loading ? (
          <p className="text-center text-muted-foreground text-sm animate-pulse py-8">Loading stats…</p>
        ) : !stats ? (
          <p className="text-center text-muted-foreground text-sm py-8">Couldn't load stats right now.</p>
        ) : (
          <>
            {plays === 0 ? (
              <p className="text-center text-muted-foreground text-sm py-4 mb-2">
                No completed plays yet. Be the first!
              </p>
            ) : (
              <div className="grid grid-cols-6 gap-3 mb-6">
                <div className="col-span-2"><Tile testId="stat-plays" value={plays} label="Completed Plays" /></div>
                <div className="col-span-2"><Tile testId="stat-wins" value={stats.wins} label="Wins" /></div>
                <div className="col-span-2"><Tile testId="stat-losses" value={stats.losses} label="Losses" /></div>
                <div className="col-span-3"><Tile testId="stat-winrate" value={`${winRate}%`} label="Win Rate" /></div>
                <div className="col-span-3">
                  <Tile
                    testId="stat-avg"
                    value={stats.wins > 0 ? stats.avgGuessesToSolve : "–"}
                    label="Avg Guesses to Solve"
                  />
                </div>
              </div>
            )}

            <h3 className="text-sm font-semibold text-center mb-2">Guess Distribution</h3>
            <div className="space-y-1.5" data-testid="guess-distribution">
              {GUESS_BUCKETS.map((bucket) => {
                const count = dist?.[bucket] ?? 0;
                const pct = (count / maxCount) * 100;
                const isYours = yourBucket === bucket;
                return (
                  <div key={bucket} className="flex items-center gap-2" data-testid={`bucket-${bucket}`}>
                    <span className="text-[10px] w-16 text-right text-muted-foreground shrink-0">{BUCKET_LABELS[bucket]}</span>
                    <div className="flex-1 h-5 bg-secondary rounded overflow-hidden flex items-center">
                      {count > 0 ? (
                        <div
                          className={`h-full rounded flex items-center justify-end pr-1.5 transition-all duration-500 ${isYours ? "bg-green-500" : "bg-primary"}`}
                          style={{ width: `${Math.max(pct, 14)}%` }}
                        >
                          <span className="text-[10px] font-semibold text-primary-foreground tabular-nums">{count}</span>
                        </div>
                      ) : (
                        <span className="pl-1.5 text-[10px] font-semibold text-muted-foreground tabular-nums">0</span>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>

            {isComplete && userWon !== undefined && (
              <p className="text-center text-xs text-muted-foreground mt-4">
                {userWon
                  ? `You solved this puzzle in ${userTotalGuesses} guess${userTotalGuesses === 1 ? "" : "es"}.`
                  : "You didn't solve this one."}
              </p>
            )}
          </>
        )}
      </div>
    </div>,
    document.body
  );
}
