import * as DialogPrimitive from "@radix-ui/react-dialog";
import { useEffect, useState } from "react";
import { loadStatsFromSupabase } from "@/lib/gameStats";
import { GameStats } from "@/lib/types";
import { X, Puzzle, Trophy, Flame, Crown, Star, LightbulbOff, BarChart3, ListOrdered } from "lucide-react";
import { RainbowIcon } from "./RainbowIcon";

interface StatsModalProps {
  open: boolean;
  onClose: () => void;
}

export function StatsModal({ open, onClose }: StatsModalProps) {
  const [stats, setStats] = useState<GameStats | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!open) return;
    setLoading(true);
    loadStatsFromSupabase().then((s) => {
      setStats(s);
      setLoading(false);
    });
  }, [open]);

  const winRate = stats && stats.gamesPlayed > 0
    ? Math.round((stats.gamesWon / stats.gamesPlayed) * 100)
    : 0;

  // Show 0 if the player hasn't played today or yesterday — streak has lapsed
  // but we intentionally leave the DB value alone so it can be inspected.
  const displayStreak = (() => {
    if (!stats?.lastPlayedDate) return 0;
    const today = new Date().toLocaleDateString("en-CA");
    const yesterday = new Date();
    yesterday.setDate(yesterday.getDate() - 1);
    const yesterdayStr = yesterday.toLocaleDateString("en-CA");
    return (stats.lastPlayedDate === today || stats.lastPlayedDate === yesterdayStr)
      ? stats.currentStreak
      : 0;
  })();

  const topStats = stats
    ? [
        { value: stats.gamesPlayed, label: "Played", icon: Puzzle, colorClass: "text-[hsl(var(--brand-purple-from))]" },
        { value: winRate, label: "Win %", icon: Trophy, colorClass: "text-group-2" },
        { value: displayStreak, label: "Streak", icon: Flame, colorClass: "text-orange-500" },
        { value: stats.maxStreak, label: "Max Streak", icon: Crown, colorClass: "text-amber-500" },
      ]
    : [];

  // "Reverse Rainbow" is still omitted — it has a real definition now (see
  // GameStats.inOrderCount's comment in types.ts for the shared blocker),
  // but no data to back it, unlike "In Order" which has a fully-verifiable
  // non-rainbow subset.
  const advancedStats = stats
    ? [
        { key: "rainbows", label: "Rainbows Spotted", value: stats.rainbowSpottedCount, icon: <RainbowIcon className="w-4 h-4" /> },
        { key: "hardest", label: "Hardest Category First", value: stats.hardestFirstCount, icon: <span className="w-3 h-3 rounded-[3px] bg-group-4 inline-block" /> },
        { key: "perfect", label: "Perfect Games", value: stats.perfectGamesCount, icon: <Star className="w-4 h-4 text-amber-500" fill="currentColor" /> },
        { key: "nohints", label: "No Hints Used", value: stats.noHintsUsedCount, icon: <LightbulbOff className="w-4 h-4 text-[hsl(var(--brand-purple-from))]" /> },
        { key: "inorder", label: "In Order", value: stats.inOrderCount, icon: <ListOrdered className="w-4 h-4 text-group-3" /> },
        { key: "avgmistakes", label: "Average Mistakes", value: stats.averageMistakes.toFixed(1), icon: <BarChart3 className="w-4 h-4 text-muted-foreground" /> },
      ]
    : [];

  return (
    <DialogPrimitive.Root open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogPrimitive.Portal>
        <DialogPrimitive.Overlay
          className="fixed inset-0 z-50 bg-black/80 data-[state=open]:animate-in data-[state=closed]:animate-out
            data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0"
        />
        {/* Same centering/height-capped/scroll shell as SettingsModal, so this
            page never spills off a short phone viewport regardless of how
            much content Advanced Stats ends up with. */}
        <div
          className="fixed inset-0 z-50 flex items-center justify-center pointer-events-none
            pt-[max(12px,env(safe-area-inset-top))] pb-[max(12px,env(safe-area-inset-bottom))]"
        >
          <DialogPrimitive.Content
            className="pointer-events-auto w-full max-w-md
              max-h-[calc(100vh-24px)] max-h-[calc(100dvh-24px)]
              flex flex-col
              bg-background border shadow-lg rounded-none sm:rounded-2xl
              data-[state=open]:animate-in data-[state=closed]:animate-out
              data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0
              data-[state=closed]:zoom-out-95 data-[state=open]:zoom-in-95
              focus:outline-none"
          >
            <div className="shrink-0 flex items-center justify-between gap-2 px-6 pt-6 pb-2">
              <DialogPrimitive.Title className="text-2xl font-extrabold tracking-tight">My Stats</DialogPrimitive.Title>
              <DialogPrimitive.Close
                aria-label="Close"
                className="shrink-0 -mr-2 -mt-1 w-9 h-9 flex items-center justify-center rounded-full
                  text-muted-foreground hover:bg-secondary transition-colors active:scale-95
                  focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              >
                <X className="w-4 h-4" />
              </DialogPrimitive.Close>
            </div>

            <div className="min-h-0 overflow-y-auto px-6 pb-[calc(1.5rem+env(safe-area-inset-bottom))]">
              {loading && (
                <div className="flex justify-center items-center h-40">
                  <div className="w-6 h-6 border-2 border-primary border-t-transparent rounded-full animate-spin" />
                </div>
              )}

              {!loading && stats && (
                <div className="space-y-5 pt-2">
                  {/* Top stat cards */}
                  <div className="grid grid-cols-4 gap-2">
                    {topStats.map((item) => {
                      const Icon = item.icon;
                      return (
                        <div
                          key={item.label}
                          className="flex flex-col items-center gap-1 rounded-2xl border border-border bg-card px-1.5 py-3"
                        >
                          <Icon className={`w-5 h-5 ${item.colorClass}`} />
                          <div className="text-2xl font-extrabold tabular-nums leading-none">{item.value}</div>
                          <div className="text-[11px] text-muted-foreground text-center leading-tight">{item.label}</div>
                        </div>
                      );
                    })}
                  </div>

                  {/* Mistake Distribution */}
                  <div className="rounded-2xl border border-border bg-card px-4 py-4">
                    <h3 className="text-base font-bold mb-3">Mistake Distribution</h3>
                    <div className="space-y-2">
                      {stats.guessDistribution.map((count, i) => {
                        const max = Math.max(...stats.guessDistribution, 1);
                        const pct = count > 0 ? Math.max((count / max) * 100, 4) : 0;
                        return (
                          <div key={i} className="flex items-center gap-3">
                            <span className="w-3 text-sm text-muted-foreground text-right shrink-0 tabular-nums">{i}</span>
                            <div className="flex-1 h-3.5 rounded-full bg-muted overflow-hidden">
                              <div
                                className="h-full rounded-full bg-[hsl(var(--brand-purple-from))] transition-all duration-500"
                                style={{ width: `${pct}%` }}
                              />
                            </div>
                            <span className="w-5 text-sm font-semibold tabular-nums text-right shrink-0">{count}</span>
                          </div>
                        );
                      })}
                    </div>
                  </div>

                  {/* Advanced Stats — hidden until the player has at least one
                      recorded game, so a brand-new player doesn't see a wall
                      of zeroes (same gate the previous version used). */}
                  {stats.gamesPlayed > 0 && (
                    <div className="rounded-2xl border border-border bg-card px-4 py-4">
                      <h3 className="text-base font-bold mb-1">Advanced Stats</h3>
                      <div>
                        {advancedStats.map((item) => (
                          <div
                            key={item.key}
                            className="flex items-center justify-between gap-3 py-2.5 border-b border-border last:border-0"
                          >
                            <span className="flex items-center gap-2.5 text-sm text-muted-foreground">
                              <span className="w-4 h-4 flex items-center justify-center shrink-0">{item.icon}</span>
                              {item.label}
                            </span>
                            <span className="text-sm font-semibold tabular-nums">{item.value}</span>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              )}
            </div>
          </DialogPrimitive.Content>
        </div>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  );
}
