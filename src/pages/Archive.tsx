import { useState, useEffect, Fragment, type ReactNode } from "react";
import { useNavigate, useLocation, useSearchParams } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { GameHeader } from "@/components/GameHeader";
import { TutorialModal } from "@/components/TutorialModal";
import { StatsModal } from "@/components/StatsModal";
import { SettingsModal } from "@/components/SettingsModal";
import { FeedbackModal } from "@/components/FeedbackModal";
import { SiteFooter } from "@/components/SiteFooter";
import { SEO } from "@/components/SEO";
import { Grid2x2 } from "lucide-react";
import {
  ArchiveCalendar,
  ArchiveMonthSelector,
  type DayStatus,
} from "@/components/archive/ArchiveCalendar";
import { monthParam } from "@/lib/archiveMonth";
import { FULL_FORMAT, progressStorageId } from "@/lib/puzzleFormat";
import { loadSettings, saveSettings, GameSettings } from "@/lib/settings";
import { playGiftOpenSound } from "@/lib/sounds";
import { getDeviceId, getDeviceToken } from "@/lib/gameStats";
import { hasMeaningfulProgress } from "@/lib/gameProgress";
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
  emoji_puzzle_icon: string | null;
}

// A puzzle's game_sessions rows (there may be several across retries) are
// collapsed to a single best-outcome summary — a win (with rainbow, if any
// attempt found it) always takes priority over a recorded loss.
interface SessionSummary {
  won: boolean;
  foundRainbow: boolean;
}

type ModalName = "stats" | "help" | "settings" | "feedback" | null;

// DayStatus, the weekday/month names, every calendar cell tint and the
// Rainbow gradients now live with the calendar itself in
// components/archive/ArchiveCalendar.tsx, which this page and the Mini
// archive both render.
const OPENED_KEY = "rc-opened-free-boxes";

function loadOpenedOrders(): number[] {
  try { return JSON.parse(localStorage.getItem(OPENED_KEY) || "[]"); }
  catch { return []; }
}
function saveOpenedOrders(orders: number[]) {
  try { localStorage.setItem(OPENED_KEY, JSON.stringify(orders)); }
  catch {}
}

// Whether the Free Puzzles / Emoji Puzzles "View All" row has been expanded
// this tab session — sessionStorage rather than localStorage on purpose: a
// player who taps View All, opens a puzzle, and taps "Back to Archive"
// should land back on the expanded row exactly as they left it, but a
// genuinely new visit (or a new tab) should start collapsed again, matching
// the calendar's default framing of "recent/featured items" rather than
// permanently remembering an expansion from weeks ago. Read once at mount
// via useState's lazy initializer, not re-read on every render.
const EXPANDED_SESSION_KEY = "rc-archive-expanded";

function loadExpanded(key: "free" | "emoji"): boolean {
  try { return sessionStorage.getItem(`${EXPANDED_SESSION_KEY}-${key}`) === "1"; }
  catch { return false; }
}
function saveExpanded(key: "free" | "emoji") {
  try { sessionStorage.setItem(`${EXPANDED_SESSION_KEY}-${key}`, "1"); }
  catch {}
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
  const location = useLocation();
  const [popping, setPopping] = useState(false);
  const accent = FREE_ACCENTS[(puzzle.free_puzzle_order - 1) % FREE_ACCENTS.length];

  function handleClick() {
    if (isOpened) {
      // Same shared archived-puzzle page as the calendar and Emoji Puzzles —
      // there is no separate "free puzzle" page anymore. Passing the current
      // Archive URL (including ?month=, if any) lets that page's "Archive"
      // button return here instead of always resetting to today's month.
      navigate(`/archive/${puzzle.id}`, {
        state: {
          archiveReturnPath: `${location.pathname}${location.search}`,
          // Which collection this play came FROM. The three entry points
          // below all navigate to the same /archive/:id path, so this is
          // the only thing that distinguishes them for entry_context.
          entrySource: "free_collection",
        },
      });
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
      className="w-full flex flex-col items-center focus:outline-none active:scale-95"
    >
      {isOpened ? (
        // Opened: restrained card — neutral background, accent color kept
        // only on the small number badge. Soft floating-card elevation
        // (not just a border) so it reads as a tile sitting above the page —
        // same card family as the Emoji Puzzle / View All cards.
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
        // Unopened: gift box (tap to unwrap) — same solid border/shadow/
        // radius as every other card in the row (the old dashed-border,
        // bg-secondary treatment was the one visual holdout from an earlier
        // pass), so it only reads as "different" via its content, not a
        // different card language.
        <div
          className="w-full flex flex-col items-center justify-center gap-1.5 bg-card border border-border rounded-2xl
            shadow-[0_2px_8px_rgba(30,25,20,0.05)] dark:shadow-[0_2px_10px_rgba(0,0,0,0.3)]"
          style={{
            aspectRatio: "3 / 4",
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
            style={{ width: "44%", height: "44%", objectFit: "contain" }}
            draggable={false}
          />
          <span className="text-[10px] font-bold tracking-wide text-muted-foreground">
            TAP TO OPEN
          </span>
        </div>
      )}
    </button>
  );
}

// ─── EmojiPuzzleCard ─────────────────────────────────────────────────────────

function EmojiPuzzleCard({ puzzle, index }: { puzzle: EmojiPuzzleItem; index: number }) {
  const navigate = useNavigate();
  const location = useLocation();
  // The admin-entered icon is authoritative when present; the trailing-emoji
  // extraction below only exists as a fallback for older Emoji Puzzles saved
  // before this field existed.
  const emoji = puzzle.emoji_puzzle_icon || extractTrailingEmoji(puzzle.rainbow_category_name ?? "") || "🧩";
  const tint = EMOJI_TINTS[index % EMOJI_TINTS.length];

  return (
    <button
      onClick={() =>
        navigate(`/archive/${puzzle.id}`, {
          state: {
            archiveReturnPath: `${location.pathname}${location.search}`,
            entrySource: "emoji_collection",
          },
        })
      }
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
  // (see finalizeGameSession), so no new tracking is needed to distinguish those
  // states from a bare "a session exists" check.
  const [sessionsByPuzzleId, setSessionsByPuzzleId] = useState<Map<string, SessionSummary>>(new Map());
  const [loading, setLoading] = useState(true);
  const [activeModal, setActiveModal] = useState<ModalName>(null);
  const [settings, setSettings] = useState<GameSettings>(loadSettings);

  // Free puzzles — loaded independently, no auth needed
  const [freePuzzles, setFreePuzzles] = useState<FreePuzzleItem[]>([]);
  const [openedOrders, setOpenedOrders] = useState<number[]>(() => loadOpenedOrders());
  const [freeExpanded, setFreeExpanded] = useState(() => loadExpanded("free"));
  const [totalPuzzleCount, setTotalPuzzleCount] = useState(0);

  // Emoji puzzles — same public, no-auth pattern as free puzzles.
  const [emojiPuzzles, setEmojiPuzzles] = useState<EmojiPuzzleItem[]>([]);
  const [emojiExpanded, setEmojiExpanded] = useState(() => loadExpanded("emoji"));

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
      // Scoped to FULL: this is the Full archive, and a Mini Daily published
      // for the same date must not appear in it. The Mini archive is its own
      // route (/mini/archive) rendering the same shared calendar.
      const { data: archiveData } = await supabase
        .from("puzzles")
        .select("id, date, title")
        .eq("is_published", true)
        .eq("format", FULL_FORMAT.id)
        .order("date", { ascending: false });
      setPuzzles((archiveData as ArchivePuzzle[] | null) ?? []);

      const deviceId = getDeviceId();
      // The player's own COMPLETED sessions, via the same RPC My Stats uses.
      //
      // Completed-only matters here: sessions are now created on the first
      // meaningful gameplay action, so a raw table read would return
      // still-in-progress rows and paint every half-played archive puzzle as
      // a red "failed" calendar cell. A genuinely unfinished game is still
      // shown as "in-progress", but from the local progress blob
      // (hasMeaningfulProgress below), which is what has always answered that.
      //
      // Read through the function rather than the table because game_sessions
      // is no longer directly readable by anonymous clients, and because the
      // completed/official/ownership filtering then lives in one place that
      // every caller shares instead of being restated per query.
      const { data: sessionRows } = await supabase.rpc("get_own_completed_sessions", {
        _device_id: deviceId,
        _device_token: getDeviceToken(),
      });

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
        .select("id, rainbow_category_name, emoji_puzzle_icon")
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

  // "In progress" is local, device-persisted gameplay state — but not just
  // "a progress blob exists for this puzzle" (hasInProgressGame's broader
  // question, still used elsewhere for resume purposes). Opening a puzzle,
  // painting a tile out of curiosity, then erasing it again leaves a blob
  // behind with nothing actually solved or colored any more — the tileColors
  // save effect in useGame.ts writes on every color change with no "is there
  // anything left to save" guard, so the blob's mere EXISTENCE outlives its
  // content going back to empty. hasMeaningfulProgress reads what the blob
  // actually says: a solved category, or a tile that is STILL carrying a
  // color mark right now — the two things this calendar cell could actually
  // show the player if they reopened it. Merely opening and closing a
  // puzzle, or opening it and clearing every color, is "unplayed" again.
  // A recorded session (won or lost) always takes priority over that local
  // in-progress flag, since a finished game session naturally leaves it be.
  function getDayStatus(dateStr: string, isPast: boolean): DayStatus {
    const puzzle = puzzleByDate[dateStr];
    if (!puzzle) return "no-puzzle";
    if (!isPast) return "none";
    const session = sessionsByPuzzleId.get(puzzle.id);
    if (session) return session.won ? (session.foundRainbow ? "won-rainbow" : "won") : "failed";
    // The format-namespaced progress key. For Full this IS the bare puzzle
    // id (see progressStorageId), so nothing about existing behaviour
    // changes — it is written this way so the rule is stated once.
    if (hasMeaningfulProgress(progressStorageId(puzzle.id, FULL_FORMAT))) return "in-progress";
    return "unplayed";
  }

  function handleDayClick(dateStr: string) {
    if (dateStr >= todayStr) return;
    const puzzle = puzzleByDate[dateStr];
    if (!puzzle) return;
    navigate(`/archive/${puzzle.id}`, {
      state: {
        archiveReturnPath: `/archive?month=${monthParam(viewYear, viewMonth)}`,
        entrySource: "archive_calendar",
      },
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
    <div className="text-center mb-3 sm:mb-4 mt-1">
      <h2 className="text-3xl sm:text-4xl font-extrabold tracking-tight">Archive</h2>
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

  // Both of these are the SHARED archive calendar (components/archive/
  // ArchiveCalendar.tsx) — the same component the Mini archive renders. This
  // page keeps ownership of everything that actually differs: which puzzles
  // exist, what a day means, and where a click goes.
  const monthSelector = (
    <ArchiveMonthSelector
      viewYear={viewYear}
      viewMonth={viewMonth}
      canGoBack={canGoBack}
      canGoForward={canGoForward}
      onPrev={prevMonth}
      onNext={nextMonth}
    />
  );

  const calendarBlock = (
    <ArchiveCalendar
      viewYear={viewYear}
      viewMonth={viewMonth}
      todayStr={todayStr}
      hasPuzzleOn={(dateStr) => !!puzzleByDate[dateStr]}
      getDayStatus={getDayStatus}
      onDayClick={handleDayClick}
    />
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
              onExpand={() => { setFreeExpanded(true); saveExpanded("free"); }}
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
            onExpand={() => { setEmojiExpanded(true); saveExpanded("emoji"); }}
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
