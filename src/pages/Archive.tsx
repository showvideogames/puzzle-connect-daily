import { useState, useEffect, useMemo } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { GameHeader } from "@/components/GameHeader";
import { TutorialModal } from "@/components/TutorialModal";
import { StatsModal } from "@/components/StatsModal";
import { SettingsModal } from "@/components/SettingsModal";
import { FeedbackModal } from "@/components/FeedbackModal";
import { SiteFooter } from "@/components/SiteFooter";
import { SEO } from "@/components/SEO";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { loadSettings, saveSettings, GameSettings } from "@/lib/settings";
import { playGiftOpenSound } from "@/lib/sounds";
import { getDeviceId } from "@/lib/gameStats";
import { hasInProgressGame } from "@/hooks/useGame";
import confetti from "canvas-confetti";
import type { User } from "@supabase/supabase-js";

// Standalone rainbow-gradient checkmark for "Completed" — the gradient
// itself is the checkmark's stroke (not a rainbow ring around a plain
// check), using the same brand stops as the custom result grid
// (ResultGrid.tsx), with a thin fixed Ink outline layered behind it so it
// stays legible at the ~16-20px the calendar renders it at.
function RainbowCheckIcon({ size = 16 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <defs>
        <linearGradient id="archive-rainbow-check" x1="3" y1="18" x2="21" y2="5" gradientUnits="userSpaceOnUse">
          <stop offset="0%" stopColor="#F6D968" />
          <stop offset="18%" stopColor="#F6D968" />
          <stop offset="34%" stopColor="#8CCB91" />
          <stop offset="54%" stopColor="#7DB9DD" />
          <stop offset="74%" stopColor="#9B7BE5" />
          <stop offset="100%" stopColor="#E9786D" />
        </linearGradient>
      </defs>
      <path
        d="M4.5 12.5L9.5 17.5L19.5 6.5"
        stroke="#292825"
        strokeWidth="5.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <path
        d="M4.5 12.5L9.5 17.5L19.5 6.5"
        stroke="url(#archive-rainbow-check)"
        strokeWidth="4"
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

interface FreePuzzleItem {
  id: string;
  free_puzzle_order: number;
}

type ModalName = "stats" | "help" | "settings" | "feedback" | null;
type DayStatus = "completed" | "in-progress" | "unplayed" | "none";

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

function monthParam(year: number, month: number) {
  return `${year}-${String(month + 1).padStart(2, "0")}`;
}

// A small, fixed set of accent colors for the free-puzzle number badge only
// — the card itself stays neutral (current borders/tokens), so this reads
// as a subtle personality touch rather than a saturated decorative card.
const FREE_ACCENTS = ["#f97316", "#22c55e", "#3b82f6", "#a855f7", "#ec4899"];

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
  const accent = FREE_ACCENTS[(puzzle.free_puzzle_order - 1) % FREE_ACCENTS.length];

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
        // Opened: restrained card — neutral background, accent color kept
        // only on the small number badge.
        <div
          className="w-full flex flex-col items-center justify-center gap-2 bg-card border border-border rounded-xl animate-fade-up"
          style={{ aspectRatio: "3 / 4" }}
        >
          <div
            className="flex items-center justify-center font-extrabold text-white"
            style={{ width: "34px", height: "34px", borderRadius: "999px", background: accent, fontSize: "15px" }}
          >
            {puzzle.free_puzzle_order}
          </div>
          <span className="text-[10px] font-bold tracking-wide text-muted-foreground">
            PLAY NOW
          </span>
        </div>
      ) : (
        // Unopened: gift box (tap to unwrap) — keeps the surprise
        <div
          className="w-full flex items-center justify-center rounded-xl bg-secondary"
          style={{
            aspectRatio: "3 / 4",
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
        <span className="text-xs font-semibold leading-none text-muted-foreground">
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
      <h3 className="text-sm font-bold tracking-tight mb-3">Free Puzzles 🎁</h3>
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
  const [searchParams, setSearchParams] = useSearchParams();
  const [user, setUser] = useState<User | null>(null);
  const [puzzles, setPuzzles] = useState<ArchivePuzzle[]>([]);
  // Completed status works for signed-in AND anonymous players — reuses the
  // same game_sessions table + device-id fallback already established in
  // gameStats.ts (hasExistingSession/loadStatsFromSupabase), rather than
  // the old game_results table, which only ever worked when logged in.
  const [completedPuzzleIds, setCompletedPuzzleIds] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(true);
  const [activeModal, setActiveModal] = useState<ModalName>(null);
  const [settings, setSettings] = useState<GameSettings>(loadSettings);

  // Free puzzles — loaded independently, no auth needed
  const [freePuzzles, setFreePuzzles] = useState<FreePuzzleItem[]>([]);
  const [openedOrders, setOpenedOrders] = useState<number[]>(() => loadOpenedOrders());
  const [totalPuzzleCount, setTotalPuzzleCount] = useState(0);

  // Calendar navigation — the viewed month lives in the URL (?month=YYYY-MM)
  // rather than local state, so it's naturally part of browser history: a
  // "Back to Archive" link can point straight at it, and browser Back just
  // works without any special-casing. Falls back to the current month when
  // the param is absent/invalid.
  const today = new Date();
  const rawMonth = searchParams.get("month");
  const validMonth = rawMonth && /^\d{4}-\d{2}$/.test(rawMonth) ? rawMonth : null;
  const viewYear = validMonth ? parseInt(validMonth.slice(0, 4), 10) : today.getFullYear();
  const viewMonth = validMonth ? parseInt(validMonth.slice(5, 7), 10) - 1 : today.getMonth();

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

      const deviceId = getDeviceId();
      const sessionsQuery = user
        ? supabase.from("game_sessions").select("puzzle_id").or(`user_id.eq.${user.id},device_id.eq.${deviceId}`)
        : supabase.from("game_sessions").select("puzzle_id").eq("device_id", deviceId);
      const { data: sessionRows } = await sessionsQuery;
      setCompletedPuzzleIds(new Set((sessionRows ?? []).map((r: { puzzle_id: string }) => r.puzzle_id)));

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
    const newMonth = viewMonth === 0 ? 11 : viewMonth - 1;
    const newYear = viewMonth === 0 ? viewYear - 1 : viewYear;
    setSearchParams({ month: monthParam(newYear, newMonth) }, { replace: true });
  }
  function nextMonth() {
    const newMonth = viewMonth === 11 ? 0 : viewMonth + 1;
    const newYear = viewMonth === 11 ? viewYear + 1 : viewYear;
    setSearchParams({ month: monthParam(newYear, newMonth) }, { replace: true });
  }

  // "In progress" is local, device-persisted gameplay state (the same
  // hasInProgressGame/progressKey source useGame.ts already writes to only
  // after a real guess/hint — see the mount-guard fix in useGame.ts).
  // Opening a puzzle and closing it again without playing never sets this.
  function getDayStatus(dateStr: string, isPast: boolean): DayStatus {
    if (!isPast) return "none";
    const puzzle = puzzleByDate[dateStr];
    if (!puzzle) return "none";
    if (completedPuzzleIds.has(puzzle.id)) return "completed";
    if (hasInProgressGame(puzzle.id)) return "in-progress";
    return "unplayed";
  }

  const monthSummary = useMemo(() => {
    let played = 0;
    let completed = 0;
    for (let day = 1; day <= daysInMonth; day++) {
      const dateStr = `${viewYear}-${String(viewMonth + 1).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
      if (dateStr >= todayStr) continue;
      const status = getDayStatus(dateStr, true);
      if (status === "completed") { completed++; played++; }
      else if (status === "in-progress") played++;
    }
    return { played, completed };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [viewYear, viewMonth, daysInMonth, todayStr, puzzleByDate, completedPuzzleIds]);

  function handleDayClick(dateStr: string) {
    if (dateStr >= todayStr) return;
    const puzzle = puzzleByDate[dateStr];
    if (!puzzle) return;
    navigate(`/archive/${puzzle.id}`, {
      state: { archiveReturnPath: `/archive?month=${monthParam(viewYear, viewMonth)}` },
    });
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
        simplifiedIcons
      />
      <div className="w-full max-w-lg border-b border-border mb-4" />
    </>
  );

  const titleRow = (
    <div className="flex items-start justify-between gap-3 mb-4">
      <div>
        <h2 className="text-2xl font-bold tracking-tight">Puzzle Archive</h2>
        <p className="text-sm text-muted-foreground mt-0.5">Browse and play past puzzles.</p>
      </div>
      <button
        onClick={() => navigate("/")}
        className="flex-shrink-0 bg-foreground text-background text-xs font-semibold rounded-full px-3 py-1.5
          hover:opacity-90 transition-opacity active:scale-95"
      >
        Today's Puzzle →
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
        showMenuLinks
        onHowToPlayClick={() => setActiveModal("help")}
        user={user}
        onSignOut={() => supabase.auth.signOut()}
      />
      <FeedbackModal
        open={activeModal === "feedback"}
        onClose={() => setActiveModal(null)}
        user={null}
      />
    </>
  );

  const calendarBlock = (
    <div className="w-full bg-card border border-border rounded-2xl px-4 pt-4 pb-4">
      {/* Month navigation */}
      <div className="flex items-center justify-between mb-1">
        <button
          onClick={prevMonth}
          disabled={!canGoBack}
          className="w-9 h-9 grid place-items-center rounded-full border border-border text-foreground
            hover:bg-secondary transition-colors active:scale-95 disabled:opacity-30 disabled:hover:bg-transparent"
          aria-label="Previous month"
        >
          <ChevronLeft className="w-4 h-4" />
        </button>
        <p className="text-lg font-bold tracking-tight whitespace-nowrap">
          {MONTHS[viewMonth]} {viewYear}
        </p>
        <button
          onClick={nextMonth}
          disabled={!canGoForward}
          className="w-9 h-9 grid place-items-center rounded-full border border-border text-foreground
            hover:bg-secondary transition-colors active:scale-95 disabled:opacity-30 disabled:hover:bg-transparent"
          aria-label="Next month"
        >
          <ChevronRight className="w-4 h-4" />
        </button>
      </div>
      <p className="text-center text-xs text-muted-foreground mb-4">
        {monthSummary.played} played · {monthSummary.completed} completed
      </p>

      {/* Weekday headers */}
      <div className="grid grid-cols-7 mb-1">
        {DAYS.map((d) => (
          <div key={d} className="text-center py-1 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
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
          const hasPuzzle = !!puzzleByDate[dateStr];
          const isClickable = isPast && hasPuzzle;
          const status = getDayStatus(dateStr, isPast);

          return (
            <button
              key={i}
              onClick={() => handleDayClick(dateStr)}
              disabled={!isClickable}
              className={`relative aspect-square w-full flex flex-col items-center justify-center gap-1 rounded-lg border transition-colors duration-150
                ${hasPuzzle && isPast ? "bg-secondary border-border" : "bg-transparent border-transparent"}
                ${isToday ? "ring-2 ring-foreground/60" : ""}
                ${isClickable ? "hover:bg-muted cursor-pointer" : "cursor-default"}
                ${!isPast && !isToday ? "opacity-40" : ""}`}
            >
              <span className={`text-sm tabular-nums leading-none text-foreground ${isToday ? "font-bold" : "font-medium"}`}>
                {dayNum}
              </span>
              <span className="h-4 flex items-center justify-center">
                {status === "completed" && <RainbowCheckIcon size={16} />}
                {status === "in-progress" && (
                  <span
                    className="w-[7px] h-[7px] rounded-full"
                    style={{ background: "hsl(var(--brand-purple-to))" }}
                  />
                )}
              </span>
            </button>
          );
        })}
      </div>

      {/* Legend */}
      <div className="flex items-center justify-center flex-wrap gap-x-4 gap-y-1.5 mt-4 text-xs text-muted-foreground">
        <span className="inline-flex items-center gap-1.5">
          <RainbowCheckIcon size={14} /> Completed
        </span>
        <span className="inline-flex items-center gap-1.5">
          <span className="w-[7px] h-[7px] rounded-full" style={{ background: "hsl(var(--brand-purple-to))" }} /> In progress
        </span>
        <span className="inline-flex items-center gap-1.5">
          <span className="font-medium text-foreground">12</span> Unplayed
        </span>
      </div>
    </div>
  );

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <p className="animate-pulse text-muted-foreground">Loading…</p>
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
