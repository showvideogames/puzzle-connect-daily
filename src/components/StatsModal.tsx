import { useEffect, useState } from "react";
import { loadStatsFromSupabase } from "@/lib/gameStats";
import { GameStats } from "@/lib/types";
import { X } from "lucide-react";

interface StatsModalProps {
  open: boolean;
  onClose: () => void;
}

const times = (n: number) => `${n} ${n === 1 ? "time" : "times"}`;

export function StatsModal({ open, onClose }: StatsModalProps) {
  const [stats, setStats] = useState<GameStats | null>(null);
  const [loading, setLoading] = useState(false);
  const [advancedOpen, setAdvancedOpen] = useState(false);

  useEffect(() => {
    if (!open) return;
    setLoading(true);
    loadStatsFromSupabase().then((s) => {
      setStats(s);
      setLoading(false);
    });
  }, [open]);

  if (!open) return null;

  const winRate = stats && stats.gamesPlayed > 0
    ? Math.round((stats.gamesWon / stats.gamesPlayed) * 100)
    : 0;

  const statItems = stats
    ? [
        { value: stats.gamesPlayed, label: "Played" },
        { value: winRate, label: "Win %" },
        { value: stats.currentStreak, label: "Streak" },
        { value: stats.maxStreak, label: "Max Streak" },
      ]
    : [];

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      <div className="absolute inset-0 bg-foreground/20 backdrop-blur-sm" onClick={onClose} />
      <div className="relative bg-card rounded-xl shadow-2xl p-6 w-full max-w-sm mx-4 animate-pop">
        <button
          onClick={onClose}
          className="absolute top-3 right-3 p-1.5 rounded-lg hover:bg-secondary transition-colors active:scale-95"
        >
          <X className="w-4 h-4" />
        </button>

        <h2 className="text-lg font-bold text-center mb-4">Statistics</h2>

        {loading && (
          <div className="flex justify-center items-center h-32">
            <div className="w-6 h-6 border-2 border-primary border-t-transparent rounded-full animate-spin" />
          </div>
        )}

        {!loading && stats && (
          <>
            <div className="grid grid-cols-4 gap-2 text-center mb-6">
              {statItems.map((item) => (
                <div key={item.label}>
                  <div className="text-2xl font-bold tabular-nums">{item.value}</div>
                  <div className="text-xs text-muted-foreground">{item.label}</div>
                </div>
              ))}
            </div>

            <h3 className="text-sm font-semibold text-center mb-2">Mistake Distribution</h3>
            <div className="space-y-1.5">
              {stats.guessDistribution.map((count, i) => {
                const max = Math.max(...stats.guessDistribution, 1);
                const pct = (count / max) * 100;
                return (
                  <div key={i} className="flex items-center gap-2">
                    <span className="text-xs w-3 text-right tabular-nums text-muted-foreground">{i}</span>
                    <div className="flex-1 h-5 bg-secondary rounded overflow-hidden">
                      <div
                        className="h-full bg-primary rounded flex items-center justify-end pr-1.5 transition-all duration-500"
                        style={{ width: `${Math.max(pct, count > 0 ? 12 : 0)}%` }}
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

            {stats.gamesPlayed > 0 && (
              <>
                <button
                  onClick={() => setAdvancedOpen((v) => !v)}
                  className="mt-6 mb-2 w-full text-sm font-semibold text-center hover:text-primary transition-colors"
                >
                  Advanced Stats {advancedOpen ? "▴" : "▾"}
                </button>
                {advancedOpen && (
                  <div className="space-y-2 text-sm">
                    <div className="flex items-center justify-between">
                      <span>🌈 Rainbows Spotted</span>
                      <span className="font-semibold tabular-nums">{times(stats.rainbowSpottedCount)}</span>
                    </div>
                    <div className="flex items-center justify-between">
                      <span>🟥 Hardest Category First</span>
                      <span className="font-semibold tabular-nums">{times(stats.hardestFirstCount)}</span>
                    </div>
                  </div>
                )}
              </>
            )}
          </>
        )}
      </div>
    </div>
  );
}
