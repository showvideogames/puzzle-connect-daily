import { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { GameHeader } from "@/components/GameHeader";
import { TutorialModal } from "@/components/TutorialModal";
import { StatsModal } from "@/components/StatsModal";
import { SettingsModal } from "@/components/SettingsModal";
import { FeedbackModal } from "@/components/FeedbackModal";
import { SiteFooter } from "@/components/SiteFooter";
import { SEO } from "@/components/SEO";
import { ChevronLeft, ChevronRight, Calendar } from "lucide-react";
import { loadSettings, saveSettings, GameSettings } from "@/lib/settings";
import { playGiftOpenSound } from "@/lib/sounds";
import confetti from "canvas-confetti";
import type { User } from "@supabase/supabase-js";

function StarIcon({
  size = 22,
  fill = "none",
  stroke = "hsl(var(--muted-foreground))",
}: {
  size?: number;
  fill?: string;
  stroke?: string;
}) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      <polygon
        points="12,2 15.09,8.26 22,9.27 17,14.14 18.18,21.02 12,17.77 5.82,21.02 7,14.14 2,9.27 8.91,8.26"
        fill={fill}
        stroke={stroke}
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

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

type ModalName = "stats" | "help" | "settings" | "feedback" | null;

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

// Per-weekday header colors (Sun→Sat), tracing the rainbow.
const WEEKDAY_COLORS = ["#ef4444", "#f97316", "#eab308", "#22c55e", "#14b8a6", "#3b82f6", "#a855f7"];
// Free-puzzle card colors, cycled by puzzle order.
const FREE_COLORS = ["#f97316", "#22c55e", "#3b82f6", "#a855f7", "#ec4899"];
const RAINBOW_BAR = "linear-gradient(90deg,#ef4444,#f97316,#eab308,#22c55e,#3b82f6,#a855f7)";
// Subtle interlocking puzzle-piece texture overlaid on opened free-puzzle cards.
const PUZZLE_TEXTURE = `url("data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' width='48' height='48' viewBox='0 0 48 48'><g fill='none' stroke='white' stroke-opacity='0.28' stroke-width='1.4'><path d='M0 16 h8 a4 4 0 0 1 0 8 h-8'/><path d='M24 0 v8 a4 4 0 0 0 8 0 v-8'/><path d='M16 48 v-8 a4 4 0 0 1 8 0 v8'/><path d='M48 24 h-8 a4 4 0 0 0 0 8 h8'/></g></svg>")`;

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
  const color = FREE_COLORS[(puzzle.free_puzzle_order - 1) % FREE_COLORS.length];

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
        // Opened: colorful puzzle-piece card with number + Play now
        <div
          className="w-full flex flex-col items-center justify-center gap-2 text-white animate-fade-up"
          style={{
            aspectRatio: "3 / 4",
            borderRadius: "16px",
            background: color,
            backgroundImage: PUZZLE_TEXTURE,
            backgroundSize: "38px 38px",
            boxShadow: "0 8px 20px -10px rgba(60,40,110,0.5)",
          }}
        >
          <div
            className="flex items-center justify-center font-extrabold"
            style={{
              width: "38px",
              height: "38px",
              borderRadius: "999px",
              background: "#fff",
              color,
              fontSize: "18px",
              boxShadow: "0 3px 8px -3px rgba(0,0,0,0.35)",
            }}
          >
            {puzzle.free_puzzle_order}
          </div>
          <span style={{ fontSize: "10px", fontWeight: 800, letterSpacing: "0.03em" }}>
            PLAY NOW
          </span>
        </div>
      ) : (
        // Unopened: gift box (tap to unwrap) — keeps the surprise
        <div
          className="w-full flex items-center justify-center"
          style={{
            aspectRatio: "3 / 4",
            borderRadius: "16px",
            background: "hsl(var(--secondary))",
            border: "1.5px dashed hsl(var(--border))",
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
            style={{ width: "56%", height: "56%", objectFit: "contain" }}
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

  // Archive puzzles — free and open to everyone, no login required.
  useEffect(() => {
    async function load() {
      setLoading(true);

      // Published puzzles are publicly readable, so this works logged out too.
      const { data: archiveData } = await supabase
        .from("puzzles")
        .select("id, date, title")
        .eq("is_published", true)
        .order("date", { ascending: false });
      setPuzzles((archiveData as ArchivePuzzle[]) || []);

      // Personal progress stars only exist for signed-in players.
      if (user) {
        const { data: resultData } = await supabase
          .from("game_results")
          .select("puzzle_id, won, mistakes")
          .eq("user_id", user.id);
        setResults((resultData as GameResult[]) || []);
      } else {
        setResults([]);
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
    if (!puzzle) return;
    navigate(`/archive/${puzzle.id}`);
  }

  // Round total count down to nearest 50 for subscribe CTA
  const displayCount =
    totalPuzzleCount >= 50 ? Math.floor(totalPuzzleCount / 50) * 50 : totalPuzzleCount;

  // ── Shared sub-sections ───────────────────────────────────────────────────

  const pageHeader = (
    <>
      <SEO
        title="Puzzle Archive — Rainbow Categories"
        description={`Browse and play every Rainbow Categories puzzle ever made. ${displayCount >= 50 ? `${displayCount}+ ` : ""}daily word puzzles in the archive.`}
        path="/archive"
      />
      <GameHeader
        onStatsClick={() => setActiveModal("stats")}
        onHowToPlayClick={() => setActiveModal("help")}
        onSettingsClick={() => setActiveModal("settings")}
        user={user}
        onSignOut={() => supabase.auth.signOut()}
      />
      <div className="w-full max-w-lg border-b border-border mb-4" />
    </>
  );

  const titleRow = (
    <div className="flex items-start justify-between gap-3 mb-4">
      <div>
        <h2 style={{ fontSize: "22px", fontWeight: 800, letterSpacing: "-0.03em" }}>
          Puzzle Archive
        </h2>
        <div
          style={{
            height: "4px",
            width: "112px",
            borderRadius: "999px",
            marginTop: "6px",
            background: RAINBOW_BAR,
          }}
        />
      </div>
      <button
        onClick={() => navigate("/")}
        className="flex-shrink-0 inline-flex items-center gap-1.5 rounded-full transition-transform
          hover:-translate-y-px active:scale-95"
        style={{
          padding: "9px 15px",
          background: "hsl(var(--card))",
          border: "1px solid hsl(var(--border))",
          color: "#a855f7",
          fontWeight: 700,
          fontSize: "13px",
          boxShadow: "0 2px 8px -3px rgba(60,40,110,0.18)",
        }}
      >
        <Calendar className="w-4 h-4" /> Today's puzzle
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
        onOpenFeedback={() => setActiveModal("feedback")}
      />
      <FeedbackModal
        open={activeModal === "feedback"}
        onClose={() => setActiveModal(null)}
        user={null}
      />
    </>
  );

  const calendarBlock = (
    <div style={{ position: "relative" }}>
      {/* Soft rainbow glow behind the card */}
      <div
        aria-hidden="true"
        style={{
          position: "absolute",
          inset: "-6px -2px",
          zIndex: 0,
          borderRadius: "34px",
          filter: "blur(14px)",
          background:
            "radial-gradient(60% 55% at 50% 0%, rgba(168,85,247,0.16), transparent 70%)," +
            "radial-gradient(70% 60% at 100% 60%, rgba(59,130,246,0.14), transparent 70%)," +
            "radial-gradient(70% 60% at 0% 65%, rgba(239,68,68,0.10), transparent 70%)",
        }}
      />
      <div
        className="relative px-5 pt-5 pb-4"
        style={{
          zIndex: 1,
          background: "hsl(var(--card))",
          border: "1px solid hsl(var(--border))",
          borderRadius: "24px",
          width: "100%",
          boxShadow: "0 18px 50px -20px rgba(60,40,110,0.28)",
        }}
      >
        {/* Month navigation */}
        <div className="flex items-center justify-between mb-4">
          <button
            onClick={prevMonth}
            disabled={!canGoBack}
            className="grid place-items-center transition-transform hover:scale-105 disabled:opacity-30
              disabled:hover:scale-100"
            style={{
              width: "42px",
              height: "42px",
              borderRadius: "14px",
              background: "hsl(var(--card))",
              border: "1px solid hsl(var(--border))",
              color: "#a855f7",
              boxShadow: "0 2px 6px -3px rgba(60,40,110,0.25)",
            }}
            aria-label="Previous month"
          >
            <ChevronLeft className="w-5 h-5" />
          </button>
          <p style={{ fontSize: "21px", fontWeight: 800, letterSpacing: "-0.02em", whiteSpace: "nowrap" }}>
            {MONTHS[viewMonth]} {viewYear}
          </p>
          <button
            onClick={nextMonth}
            disabled={!canGoForward}
            className="grid place-items-center transition-transform hover:scale-105 disabled:opacity-30
              disabled:hover:scale-100"
            style={{
              width: "42px",
              height: "42px",
              borderRadius: "14px",
              background: "hsl(var(--card))",
              border: "1px solid hsl(var(--border))",
              color: "#a855f7",
              boxShadow: "0 2px 6px -3px rgba(60,40,110,0.25)",
            }}
            aria-label="Next month"
          >
            <ChevronRight className="w-5 h-5" />
          </button>
        </div>

        {/* Day headers — color-coded across the rainbow */}
        <div className="grid grid-cols-7 mb-1">
          {DAYS.map((d, idx) => (
            <div
              key={d}
              className="text-center py-1"
              style={{
                fontSize: "11px",
                fontWeight: 800,
                letterSpacing: "0.07em",
                textTransform: "uppercase",
                color: WEEKDAY_COLORS[idx],
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
            if (dayNum < 1 || dayNum > daysInMonth) return <div key={i} style={{ aspectRatio: "1" }} />;

            const dateStr = `${viewYear}-${String(viewMonth + 1).padStart(2, "0")}-${String(dayNum).padStart(2, "0")}`;
            const isPast = dateStr < todayStr;
            const isToday = dateStr === todayStr;
            const puzzle = puzzleByDate[dateStr];
            const result = puzzle ? resultByPuzzleId[puzzle.id] : null;
            const hasPuzzle = !!puzzle;
            const isClickable = isPast && hasPuzzle;

            return (
              <button
                key={i}
                onClick={() => handleDayClick(dateStr)}
                disabled={!isClickable}
                className={`relative w-full flex flex-col items-center justify-center transition-all duration-150
                  ${isClickable ? "hover:-translate-y-px hover:shadow-md" : ""}`}
                style={{
                  aspectRatio: "1",
                  borderRadius: "14px",
                  gap: "4px",
                  background: isToday
                    ? "rgba(168,85,247,0.12)"
                    : hasPuzzle && isPast
                      ? "hsl(var(--secondary))"
                      : "transparent",
                  border: isToday
                    ? "1px solid rgba(168,85,247,0.5)"
                    : hasPuzzle && isPast
                      ? "1px solid hsl(var(--border))"
                      : "1px solid transparent",
                  cursor: isClickable ? "pointer" : "default",
                  opacity: !isPast && !isToday ? 0.4 : 1,
                }}
              >
                <span
                  style={{
                    fontSize: "16px",
                    fontWeight: isToday ? 800 : 600,
                    fontVariantNumeric: "tabular-nums",
                    color: "hsl(var(--foreground))",
                    lineHeight: 1,
                  }}
                >
                  {dayNum}
                </span>
                {/* Won = gold star · Played = purple dot · else keep the row height */}
                <span style={{ height: "15px", display: "flex", alignItems: "center" }}>
                  {result ? (
                    result.won ? (
                      <StarIcon size={15} fill="#eab308" stroke="#eab308" />
                    ) : (
                      <span
                        style={{
                          width: "7px",
                          height: "7px",
                          borderRadius: "999px",
                          background: "#a855f7",
                        }}
                      />
                    )
                  ) : null}
                </span>
              </button>
            );
          })}
        </div>

        {/* Legend — pills */}
        <div className="flex items-center gap-2.5 mt-4 justify-center">
          <span
            className="inline-flex items-center gap-1.5"
            style={{
              padding: "6px 13px",
              borderRadius: "999px",
              background: "hsl(var(--secondary))",
              border: "1px solid hsl(var(--border))",
              fontSize: "12.5px",
              fontWeight: 600,
              color: "hsl(var(--muted-foreground))",
            }}
          >
            <StarIcon size={14} fill="#eab308" stroke="#eab308" /> Won
          </span>
          <span
            className="inline-flex items-center gap-1.5"
            style={{
              padding: "6px 13px",
              borderRadius: "999px",
              background: "hsl(var(--secondary))",
              border: "1px solid hsl(var(--border))",
              fontSize: "12.5px",
              fontWeight: 600,
              color: "hsl(var(--muted-foreground))",
            }}
          >
            <span style={{ width: "9px", height: "9px", borderRadius: "999px", background: "#a855f7" }} /> Played
          </span>
        </div>
      </div>
    </div>
  );

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

        {/* Calendar first, free puzzles below — full archive is free for all */}
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
      </div>
      {modals}
      <SiteFooter />
    </div>
  );
}
