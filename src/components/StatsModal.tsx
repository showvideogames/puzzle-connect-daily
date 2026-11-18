import { PersonalStatsInsightsCards } from "./PersonalStatsInsightsCards";
import * as DialogPrimitive from "@radix-ui/react-dialog";
import { useEffect, useId, useState } from "react";
import { displayStreakOf, loadStatsFromSupabase, winRateOf } from "@/lib/gameStats";
import { GameStats } from "@/lib/types";
import { X, Puzzle, Trophy, Flame, Crown, Mountain, Star, LightbulbOff, BarChart3, ListOrdered, ChevronDown } from "lucide-react";
import { RainbowIcon } from "./RainbowIcon";
import { FULL_FORMAT, MINI_FORMAT, type PuzzleFormat } from "@/lib/puzzleFormat";

import "./StatsModal.css";

interface StatsModalProps {
  open: boolean;
  onClose: () => void;
  /**
   * Which format's personal record to show. Full and Mini keep entirely
   * separate Played/Win %/Streak/Max Streak/distribution/advanced numbers —
   * see loadStatsFromSupabase. Defaults to Full so existing call sites are
   * unchanged.
   */
  format?: PuzzleFormat;
}

export function StatsModal({ open, onClose, format = FULL_FORMAT }: StatsModalProps) {
  const [selectedFormat, setSelectedFormat] = useState(format);
  const [advancedOpen, setAdvancedOpen] = useState(false);
  const advancedContentId = useId();
  useEffect(() => { if (open) { setSelectedFormat(format); setAdvancedOpen(false); } }, [open, format]);
  const [stats, setStats] = useState<GameStats | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!open) return;
    setLoading(true);
    setStats(null);
    let cancelled = false;
    loadStatsFromSupabase(selectedFormat).then((s) => {
      if (cancelled) return;
      setStats(s);
      setLoading(false);
    });
    return () => { cancelled = true; };
  }, [open, selectedFormat]);

  const formatChoices = format.id === MINI_FORMAT.id ? [MINI_FORMAT, FULL_FORMAT] : [FULL_FORMAT, MINI_FORMAT];
  const visibleDistribution = stats?.guessDistribution.slice(0, selectedFormat.maxMistakes + 1) ?? [];
  const legacyDistributionCount = stats?.guessDistribution.slice(selectedFormat.maxMistakes + 1).reduce((sum, count) => sum + count, 0) ?? 0;
  const winRate = stats ? winRateOf(stats) : 0;
  // 0 once the streak has lapsed (see displayStreakOf).
  const displayStreak = stats ? displayStreakOf(stats) : 0;

  const topStats = stats
    ? [
        { value: stats.gamesPlayed, label: "Played", icon: Puzzle, colorClass: "text-[hsl(var(--brand-purple-from))]" },
        { value: `${winRate}%`, label: "Win Rate", icon: Trophy, colorClass: "text-group-2" },
        { value: displayStreak, label: "Current Streak", icon: Flame, colorClass: "text-orange-500" },
        { value: stats.maxStreak, label: "Best Streak", icon: Crown, colorClass: "text-amber-500" },
      ]
    : [];

  const advancedStats = stats
    ? [
        { key: "rainbows", label: "Rainbows Spotted", value: stats.rainbowSpottedCount, icon: <RainbowIcon className="w-4 h-4" /> },
        { key: "nohints", label: "No Hint Wins", value: stats.noHintsUsedCount, icon: <LightbulbOff className="w-full h-full" /> },
        { key: "nohintstreak", label: "Best No-Hint Streak", value: stats.noHintStreak.best ?? "—", icon: <Flame className="w-full h-full" /> },
        { key: "hardest", label: "Hardest Category First", value: stats.hardestFirstCount, icon: <Mountain className="w-full h-full" /> },
        { key: "perfect", label: "Perfect Games", value: stats.perfectGamesCount, icon: <Star className="w-4 h-4 text-amber-500" fill="currentColor" /> },
        { key: "inorder", label: "In Order", value: stats.inOrderCount, icon: <ListOrdered className="w-full h-full" /> },
        { key: "reverserainbow", label: "Reverse Rainbows", value: stats.reverseRainbowCount, icon: <ReverseRainbowAchievementIcon /> },
        { key: "avgmistakes", label: "Average Mistakes", value: stats.averageMistakes.toFixed(1), icon: <BarChart3 className="w-full h-full" /> },
      ]
        // The two Rainbow achievements are only meaningful for a format that
        // has a bonus category. A format without one would show a permanent
        // zero that no amount of play could ever move.
        .filter((item) => selectedFormat.hasRainbow || (item.key !== "rainbows" && item.key !== "reverserainbow"))
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
            className="personal-stats pointer-events-auto w-full
              max-h-[calc(100vh-24px)] max-h-[calc(100dvh-24px)]
              flex flex-col
              border shadow-lg
              data-[state=open]:animate-in data-[state=closed]:animate-out
              data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0
              data-[state=closed]:zoom-out-95 data-[state=open]:zoom-in-95
              focus:outline-none"
          >
            <div className="personal-stats-brand">
              <img src="/rainbow-categories-logo-stacked.webp" alt="Rainbow Categories" />
              <DialogPrimitive.Close
                aria-label="Close"
                className="shrink-0 -mr-2 -mt-1 w-9 h-9 flex items-center justify-center rounded-full
                  text-muted-foreground hover:bg-secondary transition-colors active:scale-95
                  focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              >
                <X className="w-6 h-6" />
              </DialogPrimitive.Close>
            </div>

            <div className="personal-stats-scroll min-h-0 overflow-y-auto">
              <div className="personal-stats-heading">
                <DialogPrimitive.Title>Your Stats</DialogPrimitive.Title>
                <div className="personal-stats-toggle" role="group" aria-label="Stats Format">
                  {formatChoices.map((item) => <button type="button" key={item.id}
                    aria-pressed={selectedFormat.id === item.id} onClick={() => setSelectedFormat(item)}>{item.name}</button>)}
                </div>
              </div>
              <DialogPrimitive.Description className="sr-only">Your personal {selectedFormat.name} game statistics.</DialogPrimitive.Description>
              {loading && (
                <div role="status" aria-label="Loading Stats" className="flex justify-center items-center h-40">
                  <div className="w-6 h-6 border-2 border-primary border-t-transparent rounded-full animate-spin" />
                </div>
              )}

              {!loading && stats && (
                <div className="personal-stats-body">
                  {/* Top stat cards */}
                  <div className="personal-stats-metrics">
                    {topStats.map((item) => {
                      const Icon = item.icon;
                      return (
                        <div
                          key={item.label}
                          className={`personal-stats-metric${item.label === "Win Rate" ? " personal-stats-rate" : ""}`}
                        >
                          <Icon className={`personal-stats-icon ${item.colorClass}`} />
                          <div><div className="personal-stats-label">{item.label}</div>
                          <div className="personal-stats-value">{item.value}</div></div>
                        </div>
                      );
                    })}
                  </div>

                  <div className="personal-stats-achievements">
                    <AchievementCard kind="perfect" label={<>Perfect<br />Games</>} value={stats.perfectGamesCount} />
                    {selectedFormat.hasRainbow && <AchievementCard kind="rainbow" label={<>Rainbows<br />Spotted</>} value={stats.rainbowSpottedCount} />}
                  </div>
                  {/* Mistake Distribution */}
                  <div className="personal-stats-distribution" role="group" aria-label="Mistake Distribution" aria-describedby="mistake-distribution-description">
                    <h3>Mistake Distribution</h3>
                    <p id="mistake-distribution-description" className="sr-only">
                      The {selectedFormat.maxMistakes}-mistake bucket includes losses.
                      {legacyDistributionCount > 0 && <> {legacyDistributionCount} historical {legacyDistributionCount === 1 ? "game with" : "games with"} more than {selectedFormat.maxMistakes} mistakes {legacyDistributionCount === 1 ? "is" : "are"} not shown in the chart. Original results remain in your totals.</>}
                    </p>
                    <div className="space-y-2">
                      {visibleDistribution.map((count, i) => {
                        const max = Math.max(...visibleDistribution, 1);
                        const pct = count > 0 ? Math.max((count / max) * 100, 4) : 0;
                        return (
                          <div key={i} className="personal-stats-bar-row">
                            <span className="personal-stats-bucket">{i}</span>
                            <div className="personal-stats-track">
                              <div
                                className="h-full rounded-full bg-[hsl(var(--brand-purple-from))] transition-all duration-500"
                                style={{ width: `${pct}%` }}
                              />
                            </div>
                            <span className="personal-stats-count">{count}</span>
                          </div>
                        );
                      })}
                    </div>
                  </div>

                  {/* Advanced Stats — hidden until the player has at least one
                      recorded game, so a brand-new player doesn't see a wall
                      of zeroes (same gate the previous version used). */}
                  {stats.gamesPlayed > 0 && (
                    <section className="personal-stats-advanced" aria-labelledby="advanced-stats-title">
                      <h3 id="advanced-stats-title">
                        <button type="button" className="personal-stats-advanced-toggle"
                          aria-expanded={advancedOpen} aria-controls={advancedContentId}
                          onClick={() => setAdvancedOpen((value) => !value)}>
                          <span>Advanced Stats</span>
                          <ChevronDown aria-hidden="true" />
                        </button>
                      </h3>
                      <div id={advancedContentId} hidden={!advancedOpen}>
                      <dl className="personal-stats-advanced-grid">
                        {advancedStats.filter((item) => item.key !== "perfect" && item.key !== "rainbows").map((item) => (
                          <div key={item.key} className={`personal-stats-advanced-card ${item.key}`} aria-describedby={item.key === "nohintstreak" ? "no-hint-streak-description" : undefined}>
                            <dt>
                              <span className="personal-stats-advanced-icon" aria-hidden="true">{item.icon}</span>
                              <span className="personal-stats-label">{item.label}</span>
                            </dt>
                            <dd className="personal-stats-value">{item.value}</dd>
                          </div>
                        ))}
                      </dl>
                      <p id="no-hint-streak-description" className="sr-only">
                        {stats.noHintStreak.best === null ? "Tracking is unavailable right now." : `Based on ${stats.noHintStreak.tracked} official games since tracking began. Earlier games are excluded. ${stats.noHintStreak.unknown} games have unknown hint status and break a verified streak.`}
                        Consecutive official wins without hints. Losses or hints break the streak. Calendar gaps do not.
                      </p>
                      <PersonalStatsInsightsCards insights={stats.insights} hasRainbow={selectedFormat.hasRainbow} />
                      </div>
                    </section>
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

function ReverseRainbowAchievementIcon() {
  return (
    <svg viewBox="54 42 172 92" fill="none" className="w-full h-full" aria-hidden="true">
      <g strokeWidth="10" transform="translate(0 176) scale(1 -1)">
        {["#ff43a0", "#ff9860", "#ffda43", "#94dc54", "#42cbdc", "#9461ff"].map((color, i) =>
          <path key={color} stroke={color} d={`M ${60+i*9} 128 A ${80-i*9} ${80-i*9} 0 0 1 ${220-i*9} 128`} />)}
      </g>
    </svg>
  );
}

function AchievementCard({ kind, label, value }: { kind: "perfect" | "rainbow"; label: React.ReactNode; value: number }) {
  return <div className={`personal-stats-achievement ${kind}`}>
    <svg viewBox="0 0 280 156" aria-hidden="true">
      <g stroke="#a331ff" strokeWidth="5" strokeLinecap="round"><path d="m44 53 -9 -12 m7 32 -15 -4 m201 -16 9 -12 m-4 32 15 -4" /></g>
      {kind === "rainbow" && <g fill="none" strokeWidth="10">
        {["#ff43a0", "#ff9860", "#ffda43", "#94dc54", "#42cbdc", "#9461ff"].map((color, i) =>
          <path key={color} stroke={color} d={`M ${60+i*9} 128 A ${80-i*9} ${80-i*9} 0 0 1 ${220-i*9} 128`} />)}
      </g>}
      <path fill="#ffffff" opacity=".85" d="M0 156 C0 133 16 119 34 121 C43 95 73 94 88 112 C104 87 135 90 145 113 C160 103 177 107 183 121 C203 93 230 106 233 126 C262 121 280 135 280 156Z" />
      {kind === "perfect" && <><path d="m140 38 16 35 37 5 -27 26 7 37 -33 -18 -33 18 7 -37 -27 -26 37 -5Z" fill="#ffdf54" stroke="#f4a000" strokeWidth="5" strokeLinejoin="round" />
        <path d="m140 48 2 42 39 -8 -29 24 16 26 -29 -15 -25 15 8 -30 -26 -21 32 -2Z" fill="#fff19a" /></>}
    </svg>
    <div className="personal-stats-achievement-label">{label}</div>
    <div className="personal-stats-achievement-value">{value}</div>
  </div>;
}
