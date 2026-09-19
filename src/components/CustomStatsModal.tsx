import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { X, TrendingUp, Users } from "lucide-react";
import { getCustomPuzzleStats, type CustomPuzzleStats } from "@/lib/customPuzzles";

interface CustomStatsModalProps {
  shareId: string;
  open: boolean;
  onClose: () => void;
  userWon?: boolean;
  userTotalGuesses?: number;
  isComplete?: boolean;
}

/**
 * The custom-puzzle sibling of DailyStatsModal — same layout/visual
 * language, but reading get_custom_puzzle_stats (lib/customPuzzles.ts)
 * instead of the official get_puzzle_stats RPC, and clearly labeled as
 * belonging to this one custom puzzle only (never official Global Stats).
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

  const winRate = stats && stats.finishedPlays > 0
    ? Math.round((stats.wins / stats.finishedPlays) * 100)
    : 0;

  const distributionEntries = stats
    ? Object.entries(stats.guessDistribution)
        .map(([k, v]) => [Number(k), v] as const)
        .sort((a, b) => a[0] - b[0])
    : [];
  const maxCount = Math.max(1, ...distributionEntries.map(([, v]) => v));

  return createPortal(
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      <div className="absolute inset-0 bg-foreground/20 backdrop-blur-sm" onClick={onClose} />
      <div className="relative bg-card rounded-xl shadow-2xl p-6 w-full max-w-sm mx-4 animate-pop">
        <button
          onClick={onClose}
          className="absolute top-3 right-3 p-1.5 rounded-lg hover:bg-secondary transition-colors active:scale-95"
        >
          <X className="w-4 h-4" />
        </button>

        <h2 className="text-lg font-bold text-center">This Puzzle's Stats</h2>
        <p className="text-xs text-muted-foreground text-center mb-4">
          Statistics for this custom puzzle only.
        </p>

        {loading ? (
          <p className="text-center text-muted-foreground text-sm animate-pulse py-8">Loading stats…</p>
        ) : !stats || stats.finishedPlays === 0 ? (
          <p className="text-center text-muted-foreground text-sm py-8">No one has finished this puzzle yet. Be the first!</p>
        ) : (
          <>
            <div className="grid grid-cols-3 gap-3 text-center mb-6">
              <div className="rounded-lg bg-secondary/50 p-3">
                <div className="flex items-center justify-center gap-1 mb-1">
                  <Users className="w-3.5 h-3.5 text-muted-foreground" />
                </div>
                <div className="text-2xl font-bold tabular-nums">{stats.finishedPlays}</div>
                <div className="text-[10px] text-muted-foreground uppercase tracking-wider">Finished</div>
              </div>
              <div className="rounded-lg bg-secondary/50 p-3">
                <div className="flex items-center justify-center gap-1 mb-1">
                  <TrendingUp className="w-3.5 h-3.5 text-muted-foreground" />
                </div>
                <div className="text-2xl font-bold tabular-nums">{winRate}%</div>
                <div className="text-[10px] text-muted-foreground uppercase tracking-wider">Win Rate</div>
              </div>
              <div className="rounded-lg bg-secondary/50 p-3">
                <div className="text-2xl font-bold tabular-nums mt-4">{stats.wins}<span className="text-sm text-muted-foreground">/{stats.finishedPlays}</span></div>
                <div className="text-[10px] text-muted-foreground uppercase tracking-wider">Won</div>
              </div>
            </div>

            <h3 className="text-sm font-semibold text-center mb-1">Average Guesses</h3>
            <p className="text-center text-2xl font-bold tabular-nums mb-4">{stats.avgGuesses}</p>

            <h3 className="text-sm font-semibold text-center mb-2">Guess Distribution</h3>
            <div className="space-y-1.5">
              {distributionEntries.map(([guesses, count]) => {
                const pct = (count / maxCount) * 100;
                const isYours = isComplete && userTotalGuesses === guesses;
                return (
                  <div key={guesses} className="flex items-center gap-2">
                    <span className="text-[10px] w-16 text-right text-muted-foreground">{guesses} guesses</span>
                    <div className="flex-1 h-5 bg-secondary rounded overflow-hidden">
                      <div
                        className={`h-full rounded flex items-center justify-end pr-1.5 transition-all duration-500 ${isYours ? "bg-green-500" : "bg-primary"}`}
                        style={{ width: `${Math.max(pct, count > 0 ? 14 : 0)}%` }}
                      >
                        {count > 0 && (
                          <span className="text-[10px] font-semibold text-primary-foreground tabular-nums">{count}</span>
                        )}
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>

            {isComplete && userWon !== undefined && (
              <p className="text-center text-xs text-muted-foreground mt-4">
                You {userWon ? "won" : "didn't finish"} this puzzle in {userTotalGuesses} guess{userTotalGuesses === 1 ? "" : "es"}.
              </p>
            )}
          </>
        )}
      </div>
    </div>,
    document.body
  );
}
