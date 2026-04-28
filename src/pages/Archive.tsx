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
import { playGiftOpenSound } from "@/lib/sounds";
import confetti from "canvas-confetti";
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

interface FreePuzzleItem {
  id: string;
  free_puzzle_order: number;
}

type ModalName = "stats" | "help" | "settings" | null;

const DAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const MONTHS = ["January","February","March","April","May","June","July","August","September","October","November","December"];
const OPENED_KEY = "rc-opened-free-boxes";

function loadOpenedOrders(): number[] {
  try { return JSON.parse(localStorage.getItem(OPENED_KEY) || "[]"); }
  catch { return []; }
}
function saveOpenedOrders(orders: number[]) {
  try { localStorage.setItem(OPENED_KEY, JSON.stringify(orders)); }
  catch {}
}

// ─── GiftBox ─────────────────────────────────────────────────────────────────

function GiftBox({
  puzzle,
  isOpened,
  onOpen,
}: {
  puzzle: FreePuzzleItem;
  isOpened: boolean;
  onOpen: (order: number) => void;
}) {
  const navigate = useNavigate();
  const [popping, setPopping] = useState(false);

  function handleClick() {
    if (isOpened) {
      navigate(`/free/${puzzle.id}`);
      return;
    }
    if (popping) return;

    playGiftOpenSound();
    confetti({
      particleCount: 70,
      spread: 100,
      origin: { y: 0.65 },
      colors: ["#f97316", "#eab308", "#22c55e", "#3b82f6", "#a855f7"],
    });

    // RAF ensures the element is painted at scale(1) before the transition fires
    requestAnimationFrame(() => {
      setPopping(true);
      setTimeout(() => {
        onOpen(puzzle.free_puzzle_order);
        // popping resets naturally: component re-renders as opened state
      }, 480);
    });
  }

  return (
    <button
      onClick={handleClick}
      aria-label={
        isOpened
          ? `Play free puzzle ${puzzle.free_puzzle_order}`
          : `Open gift box ${puzzle.free_puzzle_order}`
      }
      className="flex flex-col items-center gap-1.5 focus:outline-none active:scale-95"
      style={{ width: "100%", background: "none", border: "none", padding: 0, cursor: "pointer" }}
    >
      {isOpened ? (
        // Opened: rainbow numbered square, tappable
        <div
          className="w-full rounded-xl flex items-center justify-center text-white font-bold text-xl shadow-sm animate-fade-up"
          style={{
            aspectRatio: "1",
            background: "linear-gradient(135deg, #f97316, #eab308, #22c55e, #3b82f6, #a855f7)",
          }}
        >
          {puzzle.free_puzzle_order}
        </div>
      ) : (
        // Unopened: custom present icon, no border or background
        <div
          className="w-full flex items-center justify-center"
          style={{
            aspectRatio: "1",
            transform: popping
              ? "scale(0) translateY(-18px) rotate(12deg)"
              : "scale(1) translateY(0) rotate(0deg)",
            opacity: popping ? 0 : 1,
            transition:
              "transform 0.45s cubic-bezier(0.36, 0.07, 0.19, 0.97), opacity 0.35s ease-out",
          }}
        >
          <img
            src="/present-icon.png"
            alt="Gift box"
            className="w-full h-full object-contain"
            draggable={false}
          />
        </div>
      )}
      {/* Order number label — only on unopened boxes */}
      {!isOpened && (
        <span
          className="text-xs font-semibold leading-none"
          style={{ color: "hsl(var(--muted-foreground))" }}
        >
          {puzzle.free_puzzle_order}
        </span>
      )}
    </button>
  );
}

// ─── FreePuzzlesSection ───────────────────────────────────────────────────────

function FreePuzzlesSection({
  freePuzzles,
  openedOrders,
  onOpen,
}: {
  freePuzzles: FreePuzzleItem[];
  openedOrders: number[];
  onOpen: (order: number) => void;
}) {
  if (freePuzzles.length === 0) return null;

  return (
    <div className="mb-8">
      <h3
        style={{
          fontSize: "15px",
          fontWeight: 700,
          letterSpacing: "-0.01em",
          marginBottom: "12px",
        }}
      >
        Free Puzzles 🎁
      </h3>
      <div className="grid grid-cols-5 gap-3">
        {freePuzzles.map((puzzle) => (
          <GiftBox
            key={puzzle.id}
            puzzle={puzzle}
            isOpened={openedOrders.includes(puzzle.free_puzzle_order)}
            onOpen={onOpen}
          />
        ))}
      </div>
    </div>
  );
}

// ─── Main component ───────────────────────────────────────────────────────────

export default function Archive() {
  const navigate = useNavigate();
  const [user, setUser] = useState<User | null>(null);
  const [hasAccess, setHasAccess] = useState<boolean | null>(null);
  const [puzzles, setPuzzles] = useState<ArchivePuzzle[]>([]);
  const [results, setResults] = useState<GameResult[]>([]);
  const [loading, setLoading] = useState(true);
  const [activeModal, setActiveModal] = useState<ModalName>(null);
  const [settings, setSettings] = useState<GameSettings>(loadSettings);

  // Free puzzles — loaded independently, no auth needed
  const [freePuzzles, setFreePuzzles] = useState<FreePuzzleItem[]>([]);
  const [openedOrders, setOpenedOrders] = useState<number[]>(() => loadOpenedOrders());
  const [totalPuzzleCount, setTotalPuzzleCount] = useState(0);

  // Calendar navigation
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

  // Auth listener
  useEffect(() => {
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      setUser(session?.user ?? null);
    });
    supabase.auth.getSession().then(({ data: { session } }) => {
      setUser(session?.user ?? null);
    });
    return () => subscription.unsubscribe();
  }, []);

  // Archive access + puzzles (requires login)
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

  // Free puzzles + total published count (public, no auth)
  useEffect(() => {
    async function loadFree() {
      const [{ data: freeData }, { count }] = await Promise.all([
        supabase
          .from("puzzles")
          .select("id, free_puzzle_order")
          .eq("is_free_puzzle", true)
          .eq("is_published", true)
          .order("free_puzzle_order", { ascending: true })
          .limit(10),
        supabase
          .from("puzzles")
          .select("id", { count: "exact", head: true })
          .eq("is_published", true),
      ]);
      setFreePuzzles((freeData as FreePuzzleItem[]) || []);
      setTotalPuzzleCount(count ?? 0);
    }
    loadFree();
  }, []);

  function handleBoxOpen(order: number) {
    const next = [...openedOrders, order];
    setOpenedOrders(next);
    saveOpenedOrders(next);
  }

  // Calendar helpers
  const puzzleByDate = Object.fromEntries(puzzles.map((p) => [p.date, p]));
  const resultByPuzzleId = Object.fromEntries(results.map((r) => [r.puzzle_id, r]));
  const todayStr = today.toLocaleDateString("en-CA");

  const firstDay = new Date(viewYear, viewMonth, 1).getDay();
  const daysInMonth = new Date(viewYear, viewMonth + 1, 0).getDate();
  const totalCells = Math.ceil((firstDay + daysInMonth) / 7) * 7;

  const earliestPuzzleDate =
    puzzles.length > 0 ? new Date(puzzles.map((p) => p.date).sort()[0]) : today;

  const canGoBack =
    viewYear > earliestPuzzleDate.getFullYear() ||
    (viewYear === earliestPuzzleDate.getFullYear() &&
      viewMonth > earliestPuzzleDate.getMonth());
  const canGoForward =
    viewYear < today.getFullYear() ||
    (viewYear === today.getFullYear() && viewMonth < today.getMonth());

  function prevMonth() {
    if (viewMonth === 0) { setViewYear((y) => y - 1); setViewMonth(11); }
    else setViewMonth((m) => m - 1);
  }
  function nextMonth() {
    if (viewMonth === 11) { setViewYear((y) => y + 1); setViewMonth(0); }
    else setViewMonth((m) => m + 1);
  }

  function handleDayClick(dateStr: string) {
    if (dateStr >= todayStr) return;
    const puzzle = puzzleByDate[dateStr];
    if (!puzzle || !hasAccess) return;
    navigate(`/archive/${puzzle.id}`);
  }

  // Round total count down to nearest 50 for subscribe CTA
  const displayCount =
    totalPuzzleCount >= 50 ? Math.floor(totalPuzzleCount / 50) * 50 : totalPuzzleCount;

  // ── Shared sub-sections ───────────────────────────────────────────────────

  const pageHeader = (
    <>
      <GameHeader
        onStatsClick={() => setActiveModal("stats")}
        onHowToPlayClick={() => setActiveModal("help")}
        onSettingsClick={() => setActiveModal("settings")}
        user={user}
        onSignOut={() => supabase.auth.signOut()}
      />
      <div className="w-full max-w-lg border-b border-border mb-6" />
    </>
  );

  const titleRow = (
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
  );

  const modals = (
    <>
      <StatsModal open={activeModal === "stats"} onClose={() => setActiveModal(null)} />
      <TutorialModal open={activeModal === "help"} onClose={() => setActiveModal(null)} />
      <SettingsModal
        open={activeModal === "settings"}
        onClose={() => setActiveModal(null)}
        settings={settings}
        onSettingsChange={handleSettingsChange}
      />
    </>
  );

  const calendarBlock = (
    <div style={{ position: "relative" }}>
      {/* Calendar content — blurred for non-subscribers */}
      <div
        style={{
          filter: hasAccess ? "none" : "blur(4px)",
          pointerEvents: hasAccess ? "auto" : "none",
          userSelect: hasAccess ? "auto" : "none",
        }}
      >
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
            <div
              key={d}
              className="text-center py-1"
              style={{
                fontSize: "11px",
                fontWeight: 600,
                letterSpacing: "0.06em",
                textTransform: "uppercase",
                color: "hsl(var(--muted-foreground))",
              }}
            >
              {d}
            </div>
          ))}
        </div>

        {/* Calendar grid */}
        <div className="grid grid-cols-7 gap-1">
          {Array.from({ length: totalCells }).map((_, i) => {
            const dayNum = i - firstDay + 1;
            if (dayNum < 1 || dayNum > daysInMonth) return <div key={i} />;

            const dateStr = `${viewYear}-${String(viewMonth + 1).padStart(2, "0")}-${String(dayNum).padStart(2, "0")}`;
            const isPast = dateStr < todayStr;
            const isToday = dateStr === todayStr;
            const puzzle = puzzleByDate[dateStr];
            const result = puzzle ? resultByPuzzleId[puzzle.id] : null;
            const hasPuzzle = !!puzzle;
            const isClickable = isPast && hasPuzzle && !!hasAccess;

            return (
              <button
                key={i}
                onClick={() => handleDayClick(dateStr)}
                disabled={!isClickable}
                className="relative flex flex-col items-center rounded-lg transition-all duration-150"
                style={{
                  aspectRatio: "1",
                  background: isToday
                    ? "hsl(var(--foreground))"
                    : hasPuzzle && isPast
                    ? "hsl(var(--secondary))"
                    : "transparent",
                  border:
                    hasPuzzle && isPast && !isToday
                      ? "1px solid hsl(var(--border))"
                      : "1px solid transparent",
                  cursor: isClickable ? "pointer" : "default",
                  opacity: !isPast && !isToday ? 0.3 : 1,
                  paddingTop: "5px",
                  paddingBottom: "4px",
                  gap: "3px",
                }}
                onMouseEnter={(e) => {
                  if (isClickable)
                    (e.currentTarget as HTMLElement).style.background =
                      "hsl(var(--secondary)/0.8)";
                }}
                onMouseLeave={(e) => {
                  if (isClickable)
                    (e.currentTarget as HTMLElement).style.background =
                      "hsl(var(--secondary))";
                }}
              >
                <span
                  style={{
                    fontSize: "14px",
                    fontWeight: isToday ? 700 : 600,
                    color: isToday
                      ? "hsl(var(--background))"
                      : "hsl(var(--foreground))",
                    lineHeight: 1,
                  }}
                >
                  {dayNum}
                </span>
                {result ? (
                  <svg width="22" height="22" viewBox="0 0 24 24" fill="none">
                    <polygon
                      points="12,2 15.09,8.26 22,9.27 17,14.14 18.18,21.02 12,17.77 5.82,21.02 7,14.14 2,9.27 8.91,8.26"
                      fill={result.won ? "#f59e0b" : "none"}
                      stroke={result.won ? "#f59e0b" : "hsl(var(--muted-foreground))"}
                      strokeWidth="1.5"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    />
                  </svg>
                ) : (
                  <div style={{ width: "22px", height: "22px" }} />
                )}
              </button>
            );
          })}
        </div>

        {/* Legend */}
        <div className="flex items-center gap-4 mt-4 justify-center">
          <div className="flex items-center gap-1.5">
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none">
              <polygon
                points="12,2 15.09,8.26 22,9.27 17,14.14 18.18,21.02 12,17.77 5.82,21.02 7,14.14 2,9.27 8.91,8.26"
                fill="#f59e0b"
                stroke="#f59e0b"
                strokeWidth="1.5"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
            <span style={{ fontSize: "11px", color: "hsl(var(--muted-foreground))" }}>Won</span>
          </div>
          <div className="flex items-center gap-1.5">
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none">
              <polygon
                points="12,2 15.09,8.26 22,9.27 17,14.14 18.18,21.02 12,17.77 5.82,21.02 7,14.14 2,9.27 8.91,8.26"
                fill="none"
                stroke="hsl(var(--muted-foreground))"
                strokeWidth="1.5"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
            <span style={{ fontSize: "11px", color: "hsl(var(--muted-foreground))" }}>Played</span>
          </div>
        </div>
      </div>

      {/* Upgrade overlay — shown over blurred calendar for non-subscribers */}
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
            <p
              style={{
                fontSize: "13px",
                color: "hsl(var(--muted-foreground))",
                marginBottom: "16px",
                lineHeight: 1.5,
              }}
            >
              {displayCount > 0
                ? `Subscribe for $2/month to get access to ${displayCount}+ puzzles`
                : "Subscribe to unlock every past puzzle."}
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
            <p
              style={{
                fontSize: "11px",
                color: "hsl(var(--muted-foreground))",
                marginTop: "10px",
              }}
            >
              Already have access?{" "}
              <button
                style={{ textDecoration: "underline", textUnderlineOffset: "2px" }}
                onClick={() =>
                  supabase.auth.signOut().then(() => window.location.reload())
                }
              >
                Sign out and back in
              </button>
            </p>
          </div>
        </div>
      )}
    </div>
  );

  // ── Not logged in ─────────────────────────────────────────────────────────
  if (!user) {
    return (
      <div className="min-h-screen flex flex-col items-center pt-2 pb-12">
        {pageHeader}
        <div className="w-full max-w-lg px-4">
          {titleRow}
          {/* Free puzzles always visible, even when logged out */}
          <FreePuzzlesSection
            freePuzzles={freePuzzles}
            openedOrders={openedOrders}
            onOpen={handleBoxOpen}
          />
        </div>
        {/* Auth prompt */}
        <div className="flex-1 flex items-center justify-center px-4 w-full">
          <div className="text-center space-y-4 max-w-sm">
            <Lock
              className="w-8 h-8 mx-auto"
              style={{ color: "hsl(var(--muted-foreground))" }}
            />
            <h2 className="text-lg font-bold">Puzzle Archive</h2>
            <p className="text-sm" style={{ color: "hsl(var(--muted-foreground))" }}>
              Sign in to access the archive of past puzzles.
            </p>
            <PlayerAuth user={null} onSignOut={() => {}} />
          </div>
        </div>
        {modals}
      </div>
    );
  }

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <p className="animate-pulse" style={{ color: "hsl(var(--muted-foreground))" }}>
          Loading…
        </p>
      </div>
    );
  }

  // ── Calendar UI ───────────────────────────────────────────────────────────
  return (
    <div className="min-h-screen flex flex-col items-center pt-2 pb-12">
      {pageHeader}
      <div className="w-full max-w-lg px-4">
        {titleRow}

        {hasAccess ? (
          // Subscriber: calendar first, free puzzles below
          <>
            {calendarBlock}
            {freePuzzles.length > 0 && (
              <div className="mt-8">
                <FreePuzzlesSection
                  freePuzzles={freePuzzles}
                  openedOrders={openedOrders}
                  onOpen={handleBoxOpen}
                />
              </div>
            )}
          </>
        ) : (
          // Non-subscriber: free puzzles first, blurred calendar below
          <>
            <FreePuzzlesSection
              freePuzzles={freePuzzles}
              openedOrders={openedOrders}
              onOpen={handleBoxOpen}
            />
            {calendarBlock}
          </>
        )}
      </div>
      {modals}
    </div>
  );
}
