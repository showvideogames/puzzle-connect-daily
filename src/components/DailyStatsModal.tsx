import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { X, TrendingUp, Users } from "lucide-react";

interface DailyStatsProps {
  puzzleId: string;
  open: boolean;
  onClose: () => void;
}

interface PuzzleStats {
  total_players: number;
  wins: number;
  losses: number;
  guess_distribution: Record<string, number>;
}

export function DailyStatsModal({ puzzleId, open, onClose }: DailyStatsProps) {
  const [stats, setStats] = useState<PuzzleStats | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!open) return;
    setLoading(true);
    supabase.rpc("get_puzzle_stats", { _puzzle_id: puzzleId }).then(({ data }) => {
      setStats(data as PuzzleStats | null);
      setLoading(false);
    });
  }, [open, puzzleId]);

  if (!open) return null;

  const winRate = stats && stats.total_players > 0
    ? Math.round((stats.wins / stats.total_players) * 100)
    : 0;

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

        <h2 className="text-lg font-bold text-center mb-4">Today's Puzzle Stats</h2>

        {loading ? (
          <p className="text-center text-muted-foreground text-sm animate-pulse py-8">Loading stats…</p>
        ) : !stats || stats.total_players === 0 ? (
          <p className="text-center text-muted-foreground text-sm py-8">No one has completed this puzzle yet. Be the first!</p>
        ) : (
          <>
            <div className="grid grid-cols-3 gap-3 text-center mb-6">
              <div className="rounded-lg bg-secondary/50 p-3">
                <div className="flex items-center justify-center gap-1 mb-1">
                  <Users className="w-3.5 h-3.5 text-muted-foreground" />
                </div>
                <div className="text-2xl font-bold tabular-nums">{stats.total_players}</div>
                <div className="text-[10px] text-muted-foreground uppercase tracking-wider">Players</div>
              </div>
              <div className="rounded-lg bg-secondary/50 p-3">
                <div className="flex items-center justify-center gap-1 mb-1">
                  <TrendingUp className="w-3.5 h-3.5 text-muted-foreground" />
                </div>
                <div className="text-2xl font-bold tabular-nums">{winRate}%</div>
                <div className="text-[10px] text-muted-foreground uppercase tracking-wider">Win Rate</div>
              </div>
              <div className="rounded-lg bg-secondary/50 p-3">
                <div className="text-2xl font-bold tabular-nums mt-4">{stats.wins}<span className="text-sm text-muted-foreground">/{stats.total_players}</span></div>
                <div className="text-[10px] text-muted-foreground uppercase tracking-wider">Solved</div>
              </div>
            </div>

            <h3 className="text-sm font-semibold text-center mb-2">Mistakes When Winning</h3>
            <div className="space-y-1.5">
              {[0, 1, 2, 3].map((m) => {
                const count = stats.guess_distribution[String(m)] || 0;
                const max = Math.max(...Object.values(stats.guess_distribution), 1);
                const pct = (count / max) * 100;
                const labels = ["Perfect 🎯", "1 mistake", "2 mistakes", "3 mistakes"];
                return (
                  <div key={m} className="flex items-center gap-2">
                    <span className="text-[10px] w-16 text-right text-muted-foreground">{labels[m]}</span>
                    <div className="flex-1 h-5 bg-secondary rounded overflow-hidden">
                      <div
                        className="h-full bg-primary rounded flex items-center justify-end pr-1.5 transition-all duration-500"
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
          </>
        )}
      </div>
    </div>
  );
}
