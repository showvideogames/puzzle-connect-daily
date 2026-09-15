import { useState, useEffect, Fragment, type ReactNode } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { GameHeader } from "@/components/GameHeader";
import { TutorialModal } from "@/components/TutorialModal";
import { StatsModal } from "@/components/StatsModal";
import { SettingsModal } from "@/components/SettingsModal";
import { FeedbackModal } from "@/components/FeedbackModal";
import { SiteFooter } from "@/components/SiteFooter";
import { SEO } from "@/components/SEO";
import { ChevronLeft, ChevronRight, Grid2x2 } from "lucide-react";
import { loadSettings, saveSettings, GameSettings } from "@/lib/settings";
import { playGiftOpenSound } from "@/lib/sounds";
import { getDeviceId } from "@/lib/gameStats";
import { hasInProgressGame } from "@/hooks/useGame";
import confetti from "canvas-confetti";
import type { User } from "@supabase/supabase-js";

interface ArchivePuzzle {
  id: string;
  date: string;
  title: string | null;
}

interface FreePuzzleItem {
  id: string;
  free_puzzle_order: number;
}

interface EmojiPuzzleItem {
  id: string;
  rainbow_category_name: string | null;
}

// A puzzle's game_sessions rows (there may be several across retries) are
// collapsed to a single best-outcome summary — a win (with rainbow, if any
// attempt found it) always takes priority over a recorded loss.
interface SessionSummary {
  won: boolean;
  foundRainbow: boolean;
}

type ModalName = "stats" | "help" | "settings" | "feedback" | null;
// "none" = not a real calendar day yet (future, or no puzzle published) —
// rendered with the same neutral look as "unplayed" but never clickable.
type DayStatus = "unplayed" | "in-progress" | "won" | "won-rainbow" | "failed" | "none";

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

// Pulls the trailing emoji run off a category name (e.g. "Animals 🦍" -> "🦍")
// — a local copy of GameBoard.tsx's extractTrailingEmojis, used here to give
// each Emoji Puzzles card a real, data-derived "cover" emoji rather than a
// hardcoded one. Not shared/exported since GameBoard.tsx's gameplay code is
// out of scope for this pass.
function extractTrailingEmoji(str: string): string {
  try {
    const segmenter = new Intl.Segmenter();
    const segments = [...segmenter.segment(str)].map((s) => s.segment);
    const emojiRegex = /\p{Emoji}/u;
    const result: string[] = [];
    for (let i = segments.length - 1; i >= 0; i--) {
      const seg = segments[i].trim();
      if (seg === "") continue;
      if (emojiRegex.test(seg)) result.unshift(seg);
      else break;
    }
    return result.join("");
  } catch {
    return "";
  }
}

// A small, fixed set of accent colors for the free-puzzle number badge only
// — the card itself stays neutral (current borders/tokens), so this reads
// as a subtle personality touch rather than a saturated decorative card.
const FREE_ACCENTS = ["#f97316", "#22c55e", "#3b82f6", "#a855f7", "#ec4899"];

// Soft pastel tile backgrounds cycled across Emoji Puzzle cards — literal
// hue/saturation/lightness values borrowed from the site's real category
// colors (yellow/green/blue/red/purple), not the theme-adaptive --group-N
// variables, so this stays a fixed, Archive-local design choice independent
// of the shared dark-mode palette.
const EMOJI_TINTS = [
  "bg-[hsl(5_74%_67%/0.14)] dark:bg-[hsl(5_74%_67%/0.16)]",
  "bg-[hsl(48_89%_69%/0.18)] dark:bg-[hsl(48_89%_69%/0.16)]",
  "bg-[hsl(125_38%_67%/0.16)] dark:bg-[hsl(125_38%_67%/0.16)]",
  "bg-[hsl(203_59%_68%/0.16)] dark:bg-[hsl(203_59%_68%/0.18)]",
  "bg-[hsl(258_90%_66%/0.12)] dark:bg-[hsl(258_90%_66%/0.16)]",
];

// ── Calendar status tints ────────────────────────────────────────────────────
// Whole-cell tints, not badges/dots — literal hue constants (matching the
// site's real category colors) at a deliberately low, "5-15% strength"
// alpha so they read as restrained pastels rather than saturated category
// cards. Dark-mode alphas are bumped slightly since the same tint over a
// darker neutral reads fainter than it does over the light cream page.
const STATUS_CELL_CLASSES: Record<Exclude<DayStatus, "none" | "won-rainbow">, string> = {
  unplayed: "bg-card border-border",
  "in-progress": "bg-[hsl(48_89%_69%/0.20)] dark:bg-[hsl(48_89%_69%/0.20)] border-border",
  won: "bg-[hsl(125_38%_67%/0.18)] dark:bg-[hsl(125_38%_67%/0.20)] border-border",
  failed: "bg-[hsl(5_74%_67%/0.16)] dark:bg-[hsl(5_74%_67%/0.18)] border-border",
};

const RAINBOW_CELL_GRADIENT =
  "linear-gradient(135deg, hsl(48 89% 69% / 0.22), hsl(125 38% 67% / 0.20), hsl(203 59% 68% / 0.20), hsl(258 90% 66% / 0.20), hsl(5 74% 67% / 0.20))";
const RAINBOW_CELL_GRADIENT_DARK =
  "linear-gradient(135deg, hsl(48 89% 69% / 0.26), hsl(125 38% 67% / 0.24), hsl(203 59% 68% / 0.24), hsl(258 90% 66% / 0.26), hsl(5 74% 67% / 0.24))";

// Solid (non-pale) version for the compact legend dots, where a diluted
// tint would be too faint to read as a 8px swatch.
const RAINBOW_LEGEND_GRADIENT =
  "linear-gradient(135deg, hsl(48 89% 69%), hsl(125 38% 67%), hsl(203 59% 68%), hsl(258 90% 66%), hsl(5 74% 67%))";

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
        // only on the small number badge. Soft floating-card elevation
        // (not just a border) so it reads as a tile sitting above the page.
        <div
          className="w-full flex flex-col items-center justify-center gap-2 bg-card border border-border rounded-2xl animate-fade-up
            shadow-[0_2px_8px_rgba(30,25,20,0.05)] dark:shadow-[0_2px_10px_rgba(0,0,0,0.3)]"
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
          className="w-full flex items-center justify-center rounded-2xl bg-secondary
            shadow-[0_2px_8px_rgba(30,25,20,0.05)] dark:shadow-[0_2px_10px_rgba(0,0,0,0.3)]"
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

// ─── EmojiPuzzleCard ─────────────────────────────────────────────────────────

function EmojiPuzzleCard({ puzzle, index }: { puzzle: EmojiPuzzleItem; index: number }) {
  const navigate = useNavigate();
  const emoji = extractTrailingEmoji(puzzle.rainbow_category_name ?? "") || "🧩";
  const tint = EMOJI_TINTS[index % EMOJI_TINTS.length];

  return (
    <button
      onClick={() => navigate(`/archive/${puzzle.id}`)}
      aria-label="Play emoji puzzle"
      className={`w-full flex flex-col items-center justify-center gap-2 rounded-2xl border border-border ${tint}
        shadow-[0_2px_8px_rgba(30,25,20,0.05)] dark:shadow-[0_2px_10px_rgba(0,0,0,0.3)]
        hover:brightness-[0.97] active:scale-95 transition-all`}
      style={{ aspectRatio: "3 / 4" }}
    >
      <span className="text-3xl sm:text-4xl leading-none">{emoji}</span>
      <span className="text-[10px] font-bold tracking-wide text-muted-foreground">PLAY NOW</span>
    </button>
  );
}

// ─── ViewAllCard ─────────────────────────────────────────────────────────────

function ViewAllCard({ onClick }: { onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      aria-label="View all"
      className="w-full flex flex-col items-center justify-center gap-2 rounded-2xl border border-border bg-secondary/50
        shadow-[0_2px_8px_rgba(30,25,20,0.05)] dark:shadow-[0_2px_10px_rgba(0,0,0,0.3)]
        hover:bg-secondary active:scale-95 transition-colors"
      style={{ aspectRatio: "3 / 4" }}
    >
      <Grid2x2 className="w-5 h-5 text-muted-foreground" />
      <span className="text-[11px] font-bold text-foreground">View All</span>
    </button>
  );
}

// ─── CollectionRow ───────────────────────────────────────────────────────────
// Shared "N featured + View All" row used by both Free Puzzles and Emoji
// Puzzles today. A future collection (Sports/Video Games/Pop Culture/etc.)
// only needs its own item list + card renderer — no new layout code.
function CollectionRow<T>({
  title,
  emoji,
  items,
  expanded,
  onExpand,
  getKey,
  renderItem,
}: {
  title: string;
  emoji: string;
  items: T[];
  expanded: boolean;
  onExpand: () => void;
  getKey: (item: T) => string;
  renderItem: (item: T, index: number) => ReactNode;
}) {
  if (items.length === 0) return null;

  const visible = expanded ? items : items.slice(0, 4);
  const showViewAll = !expanded && items.length > 4;

  return (
    <section className="mb-8">
      <div className="flex items-center justify-between mb-3">
        <h3 className="text-base sm:text-lg font-extrabold tracking-tight">
          {title} <span aria-hidden="true">{emoji}</span>
        </h3>
        {showViewAll && (
          <button
            onClick={onExpand}
            className="text-sm font-semibold hover:opacity-75 active:scale-95 transition-all"
            style={{ color: "hsl(258 90% 66%)" }}
          >
            View All <span aria-hidden="true">→</span>
          </button>
        )}
      </div>
      <div className="grid grid-cols-5 gap-2 sm:gap-3">
        {visible.map((item, i) => (
          <Fragment key={getKey(item)}>{renderItem(item, i)}</Fragment>
        ))}
        {showViewAll && <ViewAllCard onClick={onExpand} />}
      </div>
    </section>
  );
}

// ─── Main component ───────────────────────────────────────────────────────────

export default function Archive() {
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const [user, setUser] = useState<User | null>(null);
  const [puzzles, setPuzzles] = useState<ArchivePuzzle[]>([]);
  // Per-puzzle best-outcome summary (won/failed/rainbow) — reuses the same
  // game_sessions table already written by useGame.ts's win AND loss paths
  // (see saveGameStats), so no new tracking is needed to distinguish those
  // states from a bare "a session exists" check.
  const [sessionsByPuzzleId, setSessionsByPuzzleId] = useState<Map<string, SessionSummary>>(new Map());
  const [loading, setLoading] = useState(true);
  const [activeModal, setActiveModal] = useState<ModalName>(null);
  const [settings, setSettings] = useState<GameSettings>(loadSettings);

  // Free puzzles — loaded independently, no auth needed
  const [freePuzzles, setFreePuzzles] = useState<FreePuzzleItem[]>([]);
  const [openedOrders, setOpenedOrders] = useState<number[]>(() => loadOpenedOrders());
  const [freeExpanded, setFreeExpanded] = useState(false);
  const [totalPuzzleCount, setTotalPuzzleCount] = useState(0);

  // Emoji puzzles — same public, no-auth pattern as free puzzles.
  const [emojiPuzzles, setEmojiPuzzles] = useState<EmojiPuzzleItem[]>([]);
  const [emojiExpanded, setEmojiExpanded] = useState(false);

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
        ? supabase.from("game_sessions").select("puzzle_id, won, found_rainbow").or(`user_id.eq.${user.id},device_id.eq.${deviceId}`)
        : supabase.from("game_sessions").select("puzzle_id, won, found_rainbow").eq("device_id", deviceId);
      const { data: sessionRows } = await sessionsQuery;

      const summaries = new Map<string, SessionSummary>();
      for (const row of (sessionRows ?? []) as { puzzle_id: string; won: boolean; found_rainbow: boolean | null }[]) {
        const prev = summaries.get(row.puzzle_id);
        const foundRainbow = !!row.found_rainbow;
        if (!prev) {
          summaries.set(row.puzzle_id, { won: row.won, foundRainbow });
        } else if (row.won && !prev.won) {
          summaries.set(row.puzzle_id, { won: true, foundRainbow });
        } else if (row.won && prev.won && foundRainbow && !prev.foundRainbow) {
          summaries.set(row.puzzle_id, { won: true, foundRainbow: true });
        }
      }
      setSessionsByPuzzleId(summaries);

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

  // Emoji puzzles (public, no auth) — most recent first, same as the calendar.
  useEffect(() => {
    async function loadEmoji() {
      const { data } = await supabase
        .from("puzzles")
        .select("id, rainbow_category_name")
        .eq("is_emoji_puzzle", true)
        .eq("is_published", true)
        .order("date", { ascending: false })
        .limit(24);
      setEmojiPuzzles((data as EmojiPuzzleItem[]) || []);
    }
    loadEmoji();
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
  // A recorded session (won or lost) always takes priority over that local
  // in-progress flag, since a finished game session naturally leaves it be.
  function getDayStatus(dateStr: string, isPast: boolean): DayStatus {
    if (!isPast) return "none";
    const puzzle = puzzleByDate[dateStr];
    if (!puzzle) return "none";
    const session = sessionsByPuzzleId.get(puzzle.id);
    if (session) return session.won ? (session.foundRainbow ? "won-rainbow" : "won") : "failed";
    if (hasInProgressGame(puzzle.id)) return "in-progress";
    return "unplayed";
  }

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
    </>
  );

  const titleBlock = (
    <div className="text-center mb-6 sm:mb-8 mt-2">
      <h2 className="text-3xl sm:text-4xl font-extrabold tracking-tight">Archive</h2>
      <p className="text-sm sm:text-base text-muted-foreground mt-1">Browse and play past puzzles.</p>
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

  // Floating pill month selector — visually separate from (and elevated
  // above) the calendar card below it.
  const monthSelector = (
    <div className="flex justify-center mb-4 sm:mb-5">
      <div
        className="inline-flex items-center gap-3 sm:gap-4 bg-card border border-border rounded-full pl-2 pr-2 py-2
          shadow-[0_1px_2px_rgba(30,25,20,0.04),0_4px_14px_rgba(30,25,20,0.07)]
          dark:shadow-[0_1px_2px_rgba(0,0,0,0.25),0_4px_14px_rgba(0,0,0,0.4)]"
      >
        <button
          onClick={prevMonth}
          disabled={!canGoBack}
          className="w-9 h-9 sm:w-10 sm:h-10 shrink-0 grid place-items-center rounded-full bg-secondary/70 text-foreground
            hover:bg-secondary transition-colors active:scale-95 disabled:opacity-30 disabled:hover:bg-secondary/70"
          aria-label="Previous month"
        >
          <ChevronLeft className="w-4 h-4 sm:w-5 sm:h-5" />
        </button>
        <p className="text-base sm:text-lg font-bold tracking-tight whitespace-nowrap px-1 min-w-[9.5rem] sm:min-w-[11rem] text-center">
          {MONTHS[viewMonth]} {viewYear}
        </p>
        <button
          onClick={nextMonth}
          disabled={!canGoForward}
          className="w-9 h-9 sm:w-10 sm:h-10 shrink-0 grid place-items-center rounded-full bg-secondary/70 text-foreground
            hover:bg-secondary transition-colors active:scale-95 disabled:opacity-30 disabled:hover:bg-secondary/70"
          aria-label="Next month"
        >
          <ChevronRight className="w-4 h-4 sm:w-5 sm:h-5" />
        </button>
      </div>
    </div>
  );

  const calendarBlock = (
    <div
      className="w-full bg-card border border-border/70 rounded-[28px] px-3 sm:px-5 pt-4 sm:pt-5 pb-4 sm:pb-5
        shadow-[0_1px_2px_rgba(30,25,20,0.03),0_8px_24px_rgba(30,25,20,0.045)]
        dark:shadow-[0_1px_2px_rgba(0,0,0,0.22),0_8px_24px_rgba(0,0,0,0.4)]"
    >
      {/* Weekday headers */}
      <div className="grid grid-cols-7 mb-1.5">
        {DAYS.map((d) => (
          <div key={d} className="text-center py-1 text-[10px] sm:text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
            {d}
          </div>
        ))}
      </div>

      {/* Calendar grid — every cell (real or blank) is the same aspect-square
          size, so numbers never shift and rows always line up. Status is
          communicated purely by the cell's own fill/gradient; the date
          number's position never changes to make room for a marker. */}
      <div className="grid grid-cols-7 gap-1 sm:gap-1.5">
        {Array.from({ length: totalCells }).map((_, i) => {
          const dayNum = i - firstDay + 1;
          if (dayNum < 1 || dayNum > daysInMonth) {
            return <div key={i} className="aspect-square" />;
          }

          const dateStr = `${viewYear}-${String(viewMonth + 1).padStart(2, "0")}-${String(dayNum).padStart(2, "0")}`;
          const isPast = dateStr < todayStr;
          const isToday = dateStr === todayStr;
          const hasPuzzle = !!puzzleByDate[dateStr];
          const isClickable = isPast && hasPuzzle;
          const status = getDayStatus(dateStr, isPast);
          const isRainbow = status === "won-rainbow";
          const cellClass = isRainbow ? "border-border" : STATUS_CELL_CLASSES[status === "none" ? "unplayed" : status];

          return (
            <button
              key={i}
              onClick={() => handleDayClick(dateStr)}
              disabled={!isClickable}
              className={`relative aspect-square w-full grid place-items-center rounded-lg sm:rounded-xl border transition-[filter] duration-150
                ${cellClass}
                ${isToday ? "ring-2 ring-inset ring-ink" : ""}
                ${isClickable ? "hover:brightness-[0.96] cursor-pointer active:scale-95" : "cursor-default"}`}
              style={isRainbow ? { backgroundImage: RAINBOW_CELL_GRADIENT } : undefined}
            >
              {/* Dark mode gets its own slightly stronger gradient overlay
                  (painted on top, same rounding) rather than swapping the
                  base style — Tailwind's dark: variant can't conditionally
                  pick between two inline-style values. */}
              {isRainbow && (
                <span
                  className="absolute inset-0 rounded-lg sm:rounded-xl hidden dark:block"
                  style={{ backgroundImage: RAINBOW_CELL_GRADIENT_DARK }}
                  aria-hidden="true"
                />
              )}
              <span className="relative text-sm sm:text-base font-semibold tabular-nums leading-none text-foreground">
                {dayNum}
              </span>
            </button>
          );
        })}
      </div>

      {/* Legend — compact, wraps to two lines on very small screens rather
          than competing with the calendar for space. */}
      <div className="flex flex-wrap items-center justify-center gap-x-4 gap-y-2 mt-4 pt-3.5 border-t border-border/70 text-[11px] sm:text-xs text-muted-foreground">
        <span className="inline-flex items-center gap-1.5">
          <span className="w-2.5 h-2.5 rounded-full shrink-0" style={{ background: "hsl(125 38% 60%)" }} /> Completed
        </span>
        <span className="inline-flex items-center gap-1.5">
          <span className="w-2.5 h-2.5 rounded-full shrink-0" style={{ backgroundImage: RAINBOW_LEGEND_GRADIENT }} /> Rainbow
        </span>
        <span className="inline-flex items-center gap-1.5">
          <span className="w-2.5 h-2.5 rounded-full shrink-0" style={{ background: "hsl(45 85% 58%)" }} /> In progress
        </span>
        <span className="inline-flex items-center gap-1.5">
          <span className="w-2.5 h-2.5 rounded-full shrink-0" style={{ background: "hsl(5 70% 62%)" }} /> Failed
        </span>
        <span className="inline-flex items-center gap-1.5">
          <span className="w-2.5 h-2.5 rounded-full shrink-0 border border-border bg-card" /> Unplayed
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
        {titleBlock}
        {monthSelector}
        {calendarBlock}

        {freePuzzles.length > 0 && (
          <div className="mt-8">
            <CollectionRow
              title="Free Puzzles"
              emoji="🎁"
              items={freePuzzles}
              expanded={freeExpanded}
              onExpand={() => setFreeExpanded(true)}
              getKey={(p) => p.id}
              renderItem={(p) => (
                <GiftBox puzzle={p} isOpened={openedOrders.includes(p.free_puzzle_order)} onOpen={handleBoxOpen} />
              )}
            />
          </div>
        )}

        {emojiPuzzles.length > 0 && (
          <CollectionRow
            title="Emoji Puzzles"
            emoji="😊"
            items={emojiPuzzles}
            expanded={emojiExpanded}
            onExpand={() => setEmojiExpanded(true)}
            getKey={(p) => p.id}
            renderItem={(p, i) => <EmojiPuzzleCard puzzle={p} index={i} />}
          />
        )}
      </div>
      {modals}
      <SiteFooter />
    </div>
  );
}
