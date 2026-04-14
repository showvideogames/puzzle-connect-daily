import { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { GameHeader } from "@/components/GameHeader";
import { TutorialModal } from "@/components/TutorialModal";
import { StatsModal } from "@/components/StatsModal";
import { SettingsModal } from "@/components/SettingsModal";
import { ChevronLeft, ChevronRight, Lock } from "lucide-react";
import { PlayerAuth } from "@/components/PlayerAuth";
import { loadSettings, saveSettings, GameSettings } from "@/lib/settings";
import type { User } from "@supabase/supabase-js";

interface ArchivePuzzle {
  id: string;
  date: string;
  title: string | null;
}

interface GameResult {
  puzzle_id: string;
  won: boolean;
  mistakes: number;
}

type ModalName = "stats" | "help" | "settings" | null;

const DAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const MONTHS = ["January","February","March","April","May","June","July","August","September","October","November","December"];

function isSameMonth(date: Date, year: number, month: number) {
  return date.getFullYear() === year && date.getMonth() === month;
}

export default function Archive() {
  const navigate = useNavigate();
  const [user, setUser] = useState<User | null>(null);
  const [hasAccess, setHasAccess] = useState<boolean | null>(null);
  const [puzzles, setPuzzles] = useState<ArchivePuzzle[]>([]);
  const [results, setResults] = useState<GameResult[]>([]);
  const [loading, setLoading] = useState(true);
  const [activeModal, setActiveModal] = useState<ModalName>(null);
  const [settings, setSettings] = useState<GameSettings>(loadSettings);

  // Calendar navigation — start at current month
  const today = new Date();
  const [viewYear, setViewYear] = useState(today.getFullYear());
  const [viewMonth, setViewMonth] = useState(today.getMonth());

  const handleSettingsChange = (s: GameSettings) => {
    setSettings(s);
    saveSettings(s);
    document.documentElement.classList.toggle("dark", s.darkMode);
  };

  useEffect(() => {
    document.documentElement.classList.toggle("dark", settings.darkMode);
  }, [settings.darkMode]);

  // Auth
  useEffect(() => {
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      setUser(session?.user ?? null);
    });
    supabase.auth.getSession().then(({ data: { session } }) => {
      setUser(session?.user ?? null);
    });
    return () => subscription.unsubscribe();
  }, []);

  // Access + puzzles
  useEffect(() => {
    if (!user) {
      setHasAccess(null);
      setPuzzles([]);
      setLoading(false);
      return;
    }

    async function load() {
      setLoading(true);
      const { data: access } = await supabase.rpc("has_archive_access", { _user_id: user!.id });
      setHasAccess(!!access);

      if (access) {
        const { data: archiveData } = await supabase.rpc("get_archive_puzzles");
        setPuzzles((archiveData as ArchivePuzzle[]) || []);

        // Load user's game results for completed puzzles
        const { data: resultData } = await supabase
          .from("game_results")
          .select("puzzle_id, won, mistakes")
          .eq("user_id", user!.id);
        setResults((resultData as GameResult[]) || []);
      }
      setLoading(false);
    }
    load();
  }, [user]);

  // Build puzzle lookup by date
  const puzzleByDate = Object.fromEntries(puzzles.map((p) => [p.date, p]));
  const resultByPuzzleId = Object.fromEntries(results.map((r) => [r.puzzle_id, r]));
  const todayStr = today.toISOString().split("T")[0];

  // Calendar grid for current viewMonth/viewYear
  const firstDay = new Date(viewYear, viewMonth, 1).getDay();
  const daysInMonth = new Date(viewYear, viewMonth + 1, 0).getDate();
  const totalCells = Math.ceil((firstDay + daysInMonth) / 7) * 7;

  // Find earliest puzzle month for back navigation limit
  const earliestPuzzleDate = puzzles.length > 0
    ? new Date(puzzles.map(p => p.date).sort()[0])
    : today;

  const canGoBack = viewYear > earliestPuzzleDate.getFullYear() ||
    (viewYear === earliestPuzzleDate.getFullYear() && viewMonth > earliestPuzzleDate.getMonth());
  const canGoForward = viewYear < today.getFullYear() ||
    (viewYear === today.getFullYear() && viewMonth < today.getMonth());

  function prevMonth() {
    if (viewMonth === 0) { setViewYear(y => y - 1); setViewMonth(11); }
    else setViewMonth(m => m - 1);
  }
  function nextMonth() {
    if (viewMonth === 11) { setViewYear(y => y + 1); setViewMonth(0); }
    else setViewMonth(m => m + 1);
  }

  function handleDayClick(dateStr: string) {
    if (dateStr >= todayStr) return; // today or future — not archived
    const puzzle = puzzleByDate[dateStr];
    if (!puzzle) return;
    if (!hasAccess) return;
    navigate(`/archive/${puzzle.id}`);
  }

  // ── Not logged in ──
  if (!user) {
    return (
      <div className="min-h-screen flex flex-col items-center pt-2 pb-12">
        <GameHeader
          onStatsClick={() => setActiveModal("stats")}
          onHowToPlayClick={() => setActiveModal("help")}
          onDailyStatsClick={() => {}}
          onSettingsClick={() => setActiveModal("settings")}
          user={user}
          onSignOut={() => supabase.auth.signOut()}
        />
        <div className="w-full max-w-lg border-b border-border mb-4" />
        <div className="flex-1 flex items-center justify-center px-4">
          <div className="text-center space-y-4 max-w-sm">
            <Lock className="w-8 h-8 mx-auto" style={{ color: "hsl(var(--muted-foreground))" }} />
            <h2 className="text-lg font-bold">Puzzle Archive</h2>
            <p className="text-sm" style={{ color: "hsl(var(--muted-foreground))" }}>
              Sign in to access the archive of past puzzles.
            </p>
            <PlayerAuth user={null} onSignOut={() => {}} />
          </div>
        </div>
        <StatsModal open={activeModal === "stats"} onClose={() => setActiveModal(null)} />
        <TutorialModal open={activeModal === "help"} onClose={() => setActiveModal(null)} />
        <SettingsModal open={activeModal === "settings"} onClose={() => setActiveModal(null)} settings={settings} onSettingsChange={handleSettingsChange} />
      </div>
    );
  }

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <p className="animate-pulse" style={{ color: "hsl(var(--muted-foreground))" }}>Loading…</p>
      </div>
    );
  }

  // ── Calendar UI (shown for both access and no-access, blurred for no-access) ──
  return (
    <div className="min-h-screen flex flex-col items-center pt-2 pb-12">
      <GameHeader
        onStatsClick={() => setActiveModal("stats")}
        onHowToPlayClick={() => setActiveModal("help")}
        onDailyStatsClick={() => {}}
        onSettingsClick={() => setActiveModal("settings")}
        user={user}
        onSignOut={() => supabase.auth.signOut()}
      />
      <div className="w-full max-w-lg border-b border-border mb-6" />

      <div className="w-full max-w-lg px-4 relative">

        {/* Page title */}
        <div className="flex items-center justify-between mb-6">
          <h2 style={{ fontSize: "18px", fontWeight: 700, letterSpacing: "-0.02em" }}>
            Puzzle Archive
          </h2>
          <button
            onClick={() => navigate("/")}
            className="text-xs hover:opacity-70 transition-opacity"
            style={{ color: "hsl(var(--muted-foreground))" }}
          >
            ← Today's puzzle
          </button>
        </div>

        {/* Calendar — blurred if no access */}
        <div style={{ position: "relative" }}>
          <div style={{
            filter: hasAccess ? "none" : "blur(4px)",
            pointerEvents: hasAccess ? "auto" : "none",
            userSelect: hasAccess ? "auto" : "none",
          }}>

            {/* Month navigation */}
            <div className="flex items-center justify-between mb-4">
              <button
                onClick={prevMonth}
                disabled={!canGoBack}
                className="p-1.5 rounded-lg transition-colors hover:bg-secondary disabled:opacity-30"
                aria-label="Previous month"
              >
                <ChevronLeft className="w-4 h-4" />
              </button>
              <p style={{ fontSize: "14px", fontWeight: 600, letterSpacing: "0.01em" }}>
                {MONTHS[viewMonth]} {viewYear}
              </p>
              <button
                onClick={nextMonth}
                disabled={!canGoForward}
                className="p-1.5 rounded-lg transition-colors hover:bg-secondary disabled:opacity-30"
                aria-label="Next month"
              >
                <ChevronRight className="w-4 h-4" />
              </button>
            </div>

            {/* Day headers */}
            <div className="grid grid-cols-7 mb-1">
              {DAYS.map((d) => (
                <div key={d} className="text-center py-1" style={{
                  fontSize: "11px",
                  fontWeight: 600,
                  letterSpacing: "0.06em",
                  textTransform: "uppercase",
                  color: "hsl(var(--muted-foreground))",
                }}>
                  {d}
                </div>
              ))}
            </div>

            {/* Calendar grid */}
            <div className="grid grid-cols-7 gap-1">
              {Array.from({ length: totalCells }).map((_, i) => {
                const dayNum = i - firstDay + 1;
                if (dayNum < 1 || dayNum > daysInMonth) {
                  return <div key={i} />;
                }

                const dateStr = `${viewYear}-${String(viewMonth + 1).padStart(2, "0")}-${String(dayNum).padStart(2, "0")}`;
                const isPast = dateStr < todayStr;
                const isToday = dateStr === todayStr;
                const puzzle = puzzleByDate[dateStr];
                const result = puzzle ? resultByPuzzleId[puzzle.id] : null;
                const hasPuzzle = !!puzzle;
                const isClickable = isPast && hasPuzzle && hasAccess;

                return (
                  <button
                    key={i}
                    onClick={() => handleDayClick(dateStr)}
                    disabled={!isClickable}
                    className="relative flex flex-col items-center justify-center rounded-lg transition-all duration-150"
                    style={{
                      aspectRatio: "1",
                      background: isToday
                        ? "hsl(var(--foreground))"
                        : hasPuzzle && isPast
                        ? "hsl(var(--secondary))"
                        : "transparent",
                      border: hasPuzzle && isPast && !isToday
                        ? "1px solid hsl(var(--border))"
                        : "1px solid transparent",
                      cursor: isClickable ? "pointer" : "default",
                      opacity: !isPast && !isToday ? 0.3 : 1,
                    }}
                    onMouseEnter={(e) => {
                      if (isClickable) (e.currentTarget as HTMLElement).style.background = "hsl(var(--secondary)/0.8)";
                    }}
                    onMouseLeave={(e) => {
                      if (isClickable) (e.currentTarget as HTMLElement).style.background = "hsl(var(--secondary))";
                    }}
                  >
                    <span style={{
                      fontSize: "13px",
                      fontWeight: isToday ? 700 : 500,
                      color: isToday ? "hsl(var(--background))" : "hsl(var(--foreground))",
                      lineHeight: 1,
                    }}>
                      {dayNum}
                    </span>

                    {/* Star indicator */}
                    {result && (
                      <span style={{
                        fontSize: "9px",
                        lineHeight: 1,
                        marginTop: "2px",
                        color: result.won ? "#f59e0b" : "hsl(var(--muted-foreground))",
                      }}>
                        {result.won ? "★" : "✦"}
                      </span>
                    )}
                  </button>
                );
              })}
            </div>

            {/* Legend */}
            <div className="flex items-center gap-4 mt-4 justify-center">
              <div className="flex items-center gap-1.5">
                <span style={{ fontSize: "11px", color: "#f59e0b" }}>★</span>
                <span style={{ fontSize: "11px", color: "hsl(var(--muted-foreground))" }}>Won</span>
              </div>
              <div className="flex items-center gap-1.5">
                <span style={{ fontSize: "11px", color: "hsl(var(--muted-foreground))" }}>✦</span>
                <span style={{ fontSize: "11px", color: "hsl(var(--muted-foreground))" }}>Played</span>
              </div>
            </div>
          </div>

          {/* Upgrade overlay — shown over blurred calendar */}
          {!hasAccess && (
            <div
              className="absolute inset-0 flex items-center justify-center rounded-2xl"
              style={{ background: "rgba(0,0,0,0.04)" }}
            >
              <div
                className="text-center rounded-2xl px-6 py-6 shadow-xl mx-4"
                style={{
                  background: "hsl(var(--card))",
                  border: "1px solid hsl(var(--border))",
                  maxWidth: "280px",
                  width: "100%",
                }}
              >
                <Lock className="w-6 h-6 mx-auto mb-3" style={{ color: "hsl(var(--foreground))" }} />
                <p style={{ fontSize: "15px", fontWeight: 700, marginBottom: "6px" }}>
                  Archive Access
                </p>
                <p style={{ fontSize: "13px", color: "hsl(var(--muted-foreground))", marginBottom: "16px", lineHeight: 1.5 }}>
                  Subscribe to unlock every past puzzle.
                </p>
                <button
                  className="w-full py-2.5 rounded-full text-sm font-semibold transition-opacity hover:opacity-90 active:scale-95"
                  style={{
                    background: "hsl(var(--foreground))",
                    color: "hsl(var(--background))",
                  }}
                  onClick={() => {/* Stripe flow — coming soon */}}
                >
                  Subscribe
                </button>
                <p style={{ fontSize: "11px", color: "hsl(var(--muted-foreground))", marginTop: "10px" }}>
                  Already have access?{" "}
                  <button
                    style={{ textDecoration: "underline", textUnderlineOffset: "2px" }}
                    onClick={() => supabase.auth.signOut().then(() => window.location.reload())}
                  >
                    Sign out and back in
                  </button>
                </p>
              </div>
            </div>
          )}
        </div>
      </div>

      <StatsModal open={activeModal === "stats"} onClose={() => setActiveModal(null)} />
      <TutorialModal open={activeModal === "help"} onClose={() => setActiveModal(null)} />
      <SettingsModal
        open={activeModal === "settings"}
        onClose={() => setActiveModal(null)}
        settings={settings}
        onSettingsChange={handleSettingsChange}
      />
    </div>
  );
}
