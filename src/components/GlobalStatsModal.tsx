import { useEffect, useState } from "react";
import { fetchGlobalStats, PuzzleStats } from "@/lib/globalStats";
import { X, Users } from "lucide-react";

interface GlobalStatsModalProps {
  puzzleId: string;
  open: boolean;
  onClose: () => void;
}

const ROWS: { key: keyof Omit<PuzzleStats, "total">; label: string; emoji: string }[] = [
  { key: "mistakes0", label: "0 mistakes", emoji: "🎯" },
  { key: "mistakes1", label: "1 mistake",  emoji: "✅" },
  { key: "mistakes2", label: "2 mistakes", emoji: "😅" },
  { key: "mistakes3", label: "3 mistakes", emoji: "😬" },
  { key: "mistakes4", label: "Didn't finish", emoji: "💀" },
];

function pct(count: number, total: number): number {
  if (total === 0) return 0;
  return Math.round((count / total) * 100);
}

export function GlobalStatsModal({ puzzleId, open, onClose }: GlobalStatsModalProps) {
  const [stats, setStats] = useState<PuzzleStats | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!open) return;
    setLoading(true);
    fetchGlobalStats(puzzleId).then((s) => {
      setStats(s);
      setLoading(false);
    });
  }, [open, puzzleId]);

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4"
      style={{ background: "rgba(0,0,0,0.6)", backdropFilter: "blur(4px)" }}
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div
        className="relative w-full max-w-sm rounded-2xl shadow-2xl overflow-hidden"
        style={{ background: "var(--color-card, hsl(var(--card)))", border: "1px solid hsl(var(--border))" }}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-5 pt-5 pb-3">
          <div className="flex items-center gap-2">
            <Users className="w-5 h-5 text-primary" />
            <h2 className="text-base font-bold tracking-tight">Global Stats</h2>
          </div>
          <button
            onClick={onClose}
            className="rounded-full p-1 hover:bg-secondary transition-colors"
            aria-label="Close"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Player count */}
        {stats && (
          <p className="text-center text-2xl font-bold tabular-nums px-5 pb-1">
            {stats.total.toLocaleString()}
            <span className="text-sm font-normal text-muted-foreground ml-1">
              {stats.total === 1 ? "player" : "players"}
            </span>
          </p>
        )}

        {/* Body */}
        <div className="px-5 pb-6 pt-2">
          {loading && (
            <div className="flex justify-center items-center h-32">
              <div className="w-6 h-6 border-2 border-primary border-t-transparent rounded-full animate-spin" />
            </div>
          )}

          {!loading && !stats && (
            <p className="text-center text-sm text-muted-foreground py-8">
              No stats yet — be the first to play!
            </p>
          )}

          {!loading && stats && (
            <div className="space-y-3 mt-2">
              {ROWS.map(({ key, label, emoji }) => {
                const count = stats[key];
                const p = pct(count, stats.total);
                return (
                  <div key={key}>
                    {/* Label row */}
                    <div className="flex items-center justify-between mb-1">
                      <span className="text-xs font-medium text-muted-foreground">
                        {emoji} {label}
                      </span>
                      <span className="text-xs font-bold tabular-nums">
                        {p}%
                        <span className="text-muted-foreground font-normal ml-1">
                          ({count.toLocaleString()})
                        </span>
                      </span>
                    </div>
                    {/* Bar */}
                    <div
                      className="w-full rounded-full overflow-hidden"
                      style={{ height: "8px", background: "hsl(var(--secondary))" }}
                    >
                      <div
                        className="h-full rounded-full transition-all duration-700 ease-out"
                        style={{
                          width: `${p}%`,
                          background: barColor(key),
                        }}
                      />
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function barColor(key: string): string {
  switch (key) {
    case "mistakes0": return "#22c55e"; // green — perfect
    case "mistakes1": return "#84cc16"; // lime
    case "mistakes2": return "#f59e0b"; // amber
    case "mistakes3": return "#f97316"; // orange
    case "mistakes4": return "#ef4444"; // red — didn't finish
    default: return "hsl(var(--primary))";
  }
}
