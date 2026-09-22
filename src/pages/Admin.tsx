import { useState, useEffect, useMemo } from "react";
import { COMPLETED_STATUSES } from "@/lib/gameStats";
import { useAuth } from "@/hooks/useAuth";
import { supabase } from "@/integrations/supabase/client";
import type { Json } from "@/integrations/supabase/types";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { LogOut, Save, ArrowLeft, RotateCcw, ChevronLeft, ChevronRight, Image as ImageIcon } from "lucide-react";
import { Link } from "react-router-dom";
import { ArchiveAccessManager } from "@/components/ArchiveAccessManager";
import { CustomEmojiManager } from "@/components/admin/CustomEmojiManager";
import { FeedbackList } from "@/components/admin/FeedbackList";
import { BetaPlaytestPanel } from "@/components/admin/BetaPlaytestPanel";
import { AdminLogin, AdminNoAccess } from "@/components/admin/AdminLogin";
import { PuzzleListItem, type RatingSummary } from "@/components/admin/PuzzleListItem";
import { useDraftPersistence, type DraftData } from "@/hooks/useDraftPersistence";
import { useBuilderForm, type LoadBuilderInput } from "@/hooks/useBuilderForm";
import { CategoryEditor } from "@/components/builder/CategoryEditor";
import { CategoryList } from "@/components/builder/CategoryList";
import { StyleSelector } from "@/components/builder/StyleSelector";
import { StartOverButton } from "@/components/builder/StartOverButton";
import { StartingBoardArranger } from "@/components/builder/StartingBoardArranger";
import { RainbowPanel } from "@/components/builder/RainbowPanel";
import { splitAnswerField } from "@/lib/builder/answerIdentity";
import { buildContentPayload, builderContentInput, parseWords } from "@/lib/builder/contentPayload";
import { FormatSelector } from "@/components/builder/FormatSelector";
import { categoryColorLabels, difficultyLabels, getFormat, type Difficulty, type PuzzleFormatId } from "@/lib/puzzleFormat";
import { toast } from "sonner";

const PUZZLES_PER_PAGE = 50;

// Per-format editorial placeholders. Positional, easiest category first.
const PLACEHOLDERS: Record<PuzzleFormatId, { category: string[]; answers: string[]; hint: string[] }> = {
  full: {
    category: [
      "Colors of the Rainbow 🌈",
      "Parts of a Car 🚘",
      "Last Names of Famous Singers 🎤🎶",
      "___ House 🏠",
    ],
    answers: [
      "Blue, Green, Red, Yellow",
      "Battery, Hood, Tire, Trunk",
      "Houston, Mars, Mercury, Swift",
      "Bird, Dog, Tree, White",
    ],
    hint: ["Purple", "Wheel", "Gaga", "Haunted"],
  },
  mini: {
    category: [
      "Parts of a Car 🚘",
      "Last Names of Famous Singers 🎤🎶",
      "___ House 🏠",
    ],
    answers: [
      "Hood, Tire, Trunk",
      "Mars, Mercury, Swift",
      "Bird, Dog, White",
    ],
    hint: ["Wheel", "Gaga", "Haunted"],
  },
};

// ─── Mini Calendar ──────────────────────────────────────────────────────────

const MINI_DAYS = ["S", "M", "T", "W", "T", "F", "S"];
const MINI_MONTHS = ["January","February","March","April","May","June","July","August","September","October","November","December"];

interface MiniCalendarProps {
  puzzles: any[];
  onDateClick: (dateStr: string) => void;
  /**
   * Which format this calendar is showing. Full and Mini can each have a
   * puzzle on the same date, so a single date -> status map would silently
   * let one hide the other.
   */
  format: PuzzleFormatId;
}

function MiniCalendar({ puzzles, onDateClick, format }: MiniCalendarProps) {
  const today = new Date();
  const [viewYear, setViewYear] = useState(today.getFullYear());
  const [viewMonth, setViewMonth] = useState(today.getMonth());

  // Build lookup: date string → "published" | "beta" | "draft"
  const statusByDate = useMemo(() => {
    const map: Record<string, "published" | "beta" | "draft"> = {};
    for (const p of puzzles) {
      if (getFormat(p.format).id !== format) continue;
      map[p.date] = p.is_published ? "published" : p.is_beta ? "beta" : "draft";
    }
    return map;
  }, [puzzles, format]);

  const firstDay = new Date(viewYear, viewMonth, 1).getDay();
  const daysInMonth = new Date(viewYear, viewMonth + 1, 0).getDate();
  const totalCells = Math.ceil((firstDay + daysInMonth) / 7) * 7;

  function prevMonth() {
    if (viewMonth === 0) { setViewYear((y) => y - 1); setViewMonth(11); }
    else setViewMonth((m) => m - 1);
  }
  function nextMonth() {
    if (viewMonth === 11) { setViewYear((y) => y + 1); setViewMonth(0); }
    else setViewMonth((m) => m + 1);
  }

  return (
    <div className="rounded-lg border border-border bg-card p-3" style={{ maxWidth: "280px" }}>
      {/* Month navigation */}
      <div className="flex items-center justify-between mb-2">
        <button onClick={prevMonth} className="p-1 rounded hover:bg-secondary transition-colors" aria-label="Previous month">
          <ChevronLeft className="w-3.5 h-3.5" />
        </button>
        <span className="text-xs font-semibold">{MINI_MONTHS[viewMonth]} {viewYear}</span>
        <button onClick={nextMonth} className="p-1 rounded hover:bg-secondary transition-colors" aria-label="Next month">
          <ChevronRight className="w-3.5 h-3.5" />
        </button>
      </div>

      {/* Day headers */}
      <div className="grid grid-cols-7 mb-0.5">
        {MINI_DAYS.map((d, i) => (
          <div key={i} className="text-center py-0.5" style={{ fontSize: "9px", fontWeight: 600, color: "hsl(var(--muted-foreground))" }}>
            {d}
          </div>
        ))}
      </div>

      {/* Day cells */}
      <div className="grid grid-cols-7 gap-0.5">
        {Array.from({ length: totalCells }).map((_, i) => {
          const dayNum = i - firstDay + 1;
          if (dayNum < 1 || dayNum > daysInMonth) return <div key={i} />;

          const dateStr = `${viewYear}-${String(viewMonth + 1).padStart(2, "0")}-${String(dayNum).padStart(2, "0")}`;
          const status = statusByDate[dateStr];

          return (
            <button
              key={i}
              onClick={() => onDateClick(dateStr)}
              className="flex items-center justify-center rounded transition-colors hover:ring-1 hover:ring-primary/30"
              style={{
                width: "100%",
                aspectRatio: "1",
                fontSize: "10px",
                fontWeight: 500,
                background: status === "published"
                  ? "hsl(142 71% 45% / 0.2)"
                  : status === "beta"
                  ? "hsl(262 83% 58% / 0.2)"
                  : status === "draft"
                  ? "hsl(45 93% 47% / 0.25)"
                  : "transparent",
                color: status
                  ? "hsl(var(--foreground))"
                  : "hsl(var(--muted-foreground))",
                border: "none",
                cursor: "pointer",
              }}
            >
              {dayNum}
            </button>
          );
        })}
      </div>

      {/* Legend */}
      <div className="flex items-center gap-3 mt-2 pt-2 border-t border-border">
        <div className="flex items-center gap-1">
          <div className="w-2.5 h-2.5 rounded-sm" style={{ background: "hsl(142 71% 45% / 0.35)" }} />
          <span style={{ fontSize: "9px", color: "hsl(var(--muted-foreground))" }}>Published</span>
        </div>
        <div className="flex items-center gap-1">
          <div className="w-2.5 h-2.5 rounded-sm" style={{ background: "hsl(45 93% 47% / 0.4)" }} />
          <span style={{ fontSize: "9px", color: "hsl(var(--muted-foreground))" }}>Draft</span>
        </div>
      </div>
    </div>
  );
}

// ─── Pagination ─────────────────────────────────────────────────────────────

interface PaginationProps {
  currentPage: number;
  totalPages: number;
  onPageChange: (page: number) => void;
}

function Pagination({ currentPage, totalPages, onPageChange }: PaginationProps) {
  if (totalPages <= 1) return null;

  // Build page numbers with ellipsis
  const pages: (number | "...")[] = [];
  for (let i = 1; i <= totalPages; i++) {
    if (i === 1 || i === totalPages || (i >= currentPage - 1 && i <= currentPage + 1)) {
      pages.push(i);
    } else if (pages[pages.length - 1] !== "...") {
      pages.push("...");
    }
  }

  return (
    <div className="flex items-center justify-center gap-1 mt-4">
      <button
        onClick={() => onPageChange(currentPage - 1)}
        disabled={currentPage === 1}
        className="px-2 py-1 text-xs rounded hover:bg-secondary transition-colors disabled:opacity-30"
      >
        ‹ Prev
      </button>
      {pages.map((p, i) =>
        p === "..." ? (
          <span key={`ellipsis-${i}`} className="px-1.5 py-1 text-xs text-muted-foreground">…</span>
        ) : (
          <button
            key={p}
            onClick={() => onPageChange(p)}
            className={`px-2.5 py-1 text-xs rounded transition-colors ${
              p === currentPage
                ? "bg-foreground text-background font-semibold"
                : "hover:bg-secondary text-muted-foreground"
            }`}
          >
            {p}
          </button>
        )
      )}
      <button
        onClick={() => onPageChange(currentPage + 1)}
        disabled={currentPage === totalPages}
        className="px-2 py-1 text-xs rounded hover:bg-secondary transition-colors disabled:opacity-30"
      >
        Next ›
      </button>
    </div>
  );
}

// ─── Main Admin Component ───────────────────────────────────────────────────

export default function Admin() {
  const { user, loading, isAdmin, signOut } = useAuth();

  // Puzzle form
  const [puzzleDate, setPuzzleDate] = useState("");
  const [puzzleTitle, setPuzzleTitle] = useState("");
  // Defaults to the official fallback for a brand-new puzzle (resetForm
  // restores this same default); editPuzzle overwrites it with the loaded
  // puzzle's own designer_name. Metadata, not gameplay content — travels in
  // admin_save_puzzle's _metadata argument and never creates a new version.
  const [designerName, setDesignerName] = useState("Sam West");
  const [isEmojiPuzzle, setIsEmojiPuzzle] = useState(false);
  const [emojiPuzzleIcon, setEmojiPuzzleIcon] = useState("");
  const [isFreePuzzle, setIsFreePuzzle] = useState(false);
  const [freePuzzleOrder, setFreePuzzleOrder] = useState<number | null>(null);
  // Purely a display toggle for the Rainbow panel — both "styles" are the
  // same engine capability (a puzzle either has a Rainbow selection or it
  // doesn't), so this is never sent to admin_save_puzzle. Toggling to
  // Classic hides the panel without clearing anything already filled in.

  // Category editing, Rainbow selection and starting-board order — the
  // reusable builder core. See hooks/useBuilderForm.ts.
  const builder = useBuilderForm();
  // Rainbow (default for a new puzzle) / Classic lives in the shared builder.
  const styleTab = builder.style;
  // The format the form is currently building. Everything positional below —
  // card colours, labels, placeholders, the preview grid — reads from it, so
  // Admin has ONE builder implementation for Full and Mini, not two.
  const builderFormat = builder.format;
  const categoryLabels = useMemo(() => categoryColorLabels(builderFormat), [builderFormat]);
  const difficultyCardLabels = useMemo(() => difficultyLabels(builderFormat), [builderFormat]);
  const placeholders = PLACEHOLDERS[builderFormat.id];

  const [isPublished, setIsPublished] = useState(false);
  // One clear status selector: Draft / Beta / Published. isPublished and
  // isBeta stay as two booleans (matching the DB's two columns and the
  // mutual-exclusion CHECK constraint) rather than a single status field,
  // but every place that sets one now sets both together — see
  // applyStatus below — so the UI never produces the invalid combination.
  const [isBeta, setIsBeta] = useState(false);
  const [saving, setSaving] = useState(false);

  // Existing puzzles list
  const [puzzles, setPuzzles] = useState<any[]>([]);
  const [editingId, setEditingId] = useState<string | null>(null);
  /**
   * The version number currently live for each puzzle, so the editor can say
   * which version the next save would create.
   *
   * Kept out of the puzzles row deliberately: the version number is derived
   * from puzzle_versions, and denormalising it onto puzzles would create a
   * second copy that could drift from the immutable table it describes.
   * This is one extra small query on the Admin screen only, and nothing on
   * the player-facing load path changed at all.
   */
  const [currentVersionNumbers, setCurrentVersionNumbers] = useState<Record<string, number>>({});
  /**
   * The gameplay content of the puzzle being edited, exactly as it was
   * loaded. Compared against the live form to tell the admin, before they
   * save, whether this edit will create a new version.
   *
   * Advisory only. The database makes the real decision (canonical jsonb
   * equality inside admin_save_puzzle) and reports what it actually did, so
   * a mismatch here can never cause a wrong version to be written — at worst
   * the hint is pessimistic and the toast afterwards corrects it.
   */
  const [loadedContent, setLoadedContent] = useState<string | null>(null);
  const [expandedStatsId, setExpandedStatsId] = useState<string | null>(null);
  const [puzzleStats, setPuzzleStats] = useState<Record<string, any>>({});
  const [puzzleRatings, setPuzzleRatings] = useState<Record<string, RatingSummary>>({});

  // Global stats
  const [globalStats, setGlobalStats] = useState<{
    totalSessions: number;
    wonSessions: number;
    rainbowSessions: number;
    registeredUsers: number;
    highestCurrentStreak: number;
    highestLongestStreak: number;
  } | null>(null);
  const [globalStatsLoading, setGlobalStatsLoading] = useState(false);
  /** Closed by default: the emoji library is only fetched once this opens. */
  const [showEmojiManager, setShowEmojiManager] = useState(false);

  // Calendar visibility
  const [calendarOpen, setCalendarOpen] = useState(true);

  // Pagination
  const [currentPage, setCurrentPage] = useState(1);
  const totalPages = Math.max(1, Math.ceil(puzzles.length / PUZZLES_PER_PAGE));
  const paginatedPuzzles = useMemo(() => {
    const start = (currentPage - 1) * PUZZLES_PER_PAGE;
    return puzzles.slice(start, start + PUZZLES_PER_PAGE);
  }, [puzzles, currentPage]);

  // Reset to page 1 if puzzles change and current page is out of range
  useEffect(() => {
    if (currentPage > totalPages) setCurrentPage(1);
  }, [totalPages, currentPage]);

  useEffect(() => {
    if (isAdmin) void loadPuzzles();
  }, [isAdmin]);

  // Draft persistence works in plain text (word lists, not the builder's
  // internal stable ids) — see hooks/useDraftPersistence.ts. The builder's
  // own load() reconstructs ids from text the same way editPuzzle does.
  const draftValues: DraftData = {
    puzzleDate,
    puzzleTitle,
    designerName,
    groups: builder.groups.map((g) => ({
      category: g.category,
      words: g.answersRaw,
      difficulty: g.difficulty,
      hintWord: g.hintWord,
      categoryEmoji: g.categoryEmoji,
    })),
    isPublished,
    isBeta,
    wordOrder: builder.textsFor(builder.wordOrderIds),
    rainbowHerring: builder.rainbowHerringIds.map((id) => (id ? builder.slotById.get(id)?.text ?? null : null)),
    rainbowCategoryName: builder.rainbowCategoryName,
    rainbowHintWord: builder.rainbowHintWord,
    rainbowCategoryEmoji: builder.rainbowCategoryEmoji,
    rainbowWordOrder: builder.textsFor(builder.rainbowWordOrderIds),
    theme: builder.theme,
    isEmojiPuzzle,
    emojiPuzzleIcon,
    isFreePuzzle,
    freePuzzleOrder,
    alphabetizeCompleted: builder.alphabetizeCompleted,
    style: builder.style,
    format: builderFormat.id,
    editingId,
  };

  // The single source of truth for "what gameplay content does the form
  // currently describe?" — used both by the version hint below and by
  // handleSave, so the two can never disagree about what is about to be
  // saved.
  function currentContentInput() {
    return builderContentInput(builder, isEmojiPuzzle);
  }

  /**
   * A one-line, always-visible answer to "will saving this create a new
   * version?" — so an admin is never surprised by what a save did.
   *
   * Advisory. admin_save_puzzle makes the real decision by comparing
   * canonical content in the database, and its result drives the toast
   * afterwards, so a disagreement here shows up as a hint that was slightly
   * pessimistic — never as a version written that should not have been.
   *
   * Nothing is shown while creating a brand-new puzzle: "this will be
   * Version 1" is not information an admin needs.
   */
  const versionHint = useMemo(() => {
    if (!editingId || loadedContent === null) return null;
    const current = currentVersionNumbers[editingId];
    const next = JSON.stringify(buildContentPayload(currentContentInput()));
    if (next === loadedContent) {
      return current
        ? `No gameplay changes — saving keeps this on Version ${current}. Anyone playing it is unaffected.`
        : "No gameplay changes — saving will not create a new version.";
    }
    return current
      ? `Gameplay changed — saving creates Version ${current + 1}. Anyone already playing Version ${current} keeps that board and can finish it.`
      : "Gameplay changed — saving creates a new version. Anyone already playing keeps the board they started.";
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    editingId,
    loadedContent,
    currentVersionNumbers,
    builder.groups,
    builder.wordOrderIds,
    builder.rainbowWordOrderIds,
    builder.rainbowComplete,
    builder.rainbowCategoryName,
    builder.rainbowHintWord,
    builder.rainbowCategoryEmoji,
    builder.theme,
    builder.alphabetizeCompleted,
    isEmojiPuzzle,
  ]);

  const { draftRestored, setDraftRestored, saveDraft, clearDraft, getCurrentDraft, handleBlurSave } = useDraftPersistence({
    enabled: isAdmin,
    editingId,
    values: draftValues,
    applyDraft: (draft) => {
      setPuzzleDate(draft.puzzleDate);
      setPuzzleTitle(draft.puzzleTitle);
      setDesignerName(draft.designerName ?? "Sam West");
      setIsPublished(draft.isPublished);
      setIsBeta(draft.isBeta ?? false);
      setIsEmojiPuzzle(draft.isEmojiPuzzle ?? false);
      setEmojiPuzzleIcon(draft.emojiPuzzleIcon ?? "");
      setIsFreePuzzle(draft.isFreePuzzle ?? false);
      setFreePuzzleOrder(draft.freePuzzleOrder ?? null);
      builder.load({
        groups: draft.groups.map((g) => ({
          category: g.category,
          words: splitAnswerField(g.words),
          difficulty: g.difficulty,
          hintWord: g.hintWord,
          categoryEmoji: g.categoryEmoji ?? "",
        })),
        wordOrder: draft.wordOrder,
        rainbowHerring: draft.rainbowHerring.every(Boolean) ? (draft.rainbowHerring as string[]) : null,
        rainbowCategoryName: draft.rainbowCategoryName ?? "",
        rainbowHintWord: draft.rainbowHintWord ?? "",
        rainbowCategoryEmoji: draft.rainbowCategoryEmoji ?? "",
        theme: draft.theme ?? "",
        alphabetizeCompleted: draft.alphabetizeCompleted ?? true,
        // A draft without a stored style leaves the current style alone.
        style: draft.style,
        // A draft saved before Mini existed has no format and restores as
        // Full, which is what it is.
        format: draft.format,
      });
    },
  });

  async function loadPuzzles() {
    const { data, error } = await supabase
      .from("puzzles")
      .select("*, puzzle_groups(*)")
      .order("date", { ascending: false });

    if (error) {
      console.error("Load puzzles error:", error);
      toast.error("Couldn't load puzzles.");
      setPuzzles([]);
      return;
    }

    setPuzzles(data || []);

    // Which version each puzzle is currently on, so the editor can name the
    // version the next save would create. Deliberately selects only the two
    // tiny key columns — never `content`, which would pull every snapshot of
    // every puzzle into the browser for a label.
    const { data: versionRows, error: versionError } = await supabase
      .from("puzzle_versions")
      .select("id, version_number");

    if (versionError) {
      // Non-fatal by design: this only powers an informational label, and
      // the puzzle list itself is already loaded. A database that has not
      // had the versioning migration applied lands here and the editor
      // simply shows no version hint.
      console.warn("Load puzzle versions failed:", versionError);
      setCurrentVersionNumbers({});
      return;
    }

    const numberById = new Map(
      ((versionRows ?? []) as { id: string; version_number: number }[]).map((v) => [v.id, v.version_number])
    );
    const byPuzzle: Record<string, number> = {};
    for (const p of data || []) {
      const n = p.current_version_id ? numberById.get(p.current_version_id) : undefined;
      if (n !== undefined) byPuzzle[p.id] = n;
    }
    setCurrentVersionNumbers(byPuzzle);
  }

  async function loadGlobalStats() {
    setGlobalStatsLoading(true);
    try {
      const [
        { count: totalSessions },
        { count: wonSessions },
        { count: rainbowSessions },
        { data: streakSummary },
      ] = await Promise.all([
        // COMPLETED sessions only, so these admin totals keep meaning
        // "games finished" rather than silently becoming "games opened"
        // now that a session row is created on the first gameplay action.
        supabase.from("game_sessions").select("*", { count: "exact", head: true }).in("status", COMPLETED_STATUSES as unknown as string[]),
        supabase.from("game_sessions").select("*", { count: "exact", head: true }).in("status", COMPLETED_STATUSES as unknown as string[]).eq("won", true),
        supabase.from("game_sessions").select("*", { count: "exact", head: true }).in("status", COMPLETED_STATUSES as unknown as string[]).eq("found_rainbow", true),
        // user_streaks is no longer directly readable: it was world-readable
        // and world-writable, so all client access moved behind RPCs. This
        // one is admin-gated and returns three integers, never a row.
        //
        // These numbers are now CORRECT. The direct reads they replace were
        // silently filtered by the old SELECT policy to the admin's own row
        // plus anonymous rows, so "registered users with streaks" has always
        // undercounted.
        supabase.rpc("get_streak_admin_summary"),
      ]);

      const streaks = (Array.isArray(streakSummary) ? streakSummary[0] : streakSummary) as {
        accounts_with_streaks?: number;
        max_current_streak?: number;
        max_longest_streak?: number;
      } | null;

      setGlobalStats({
        totalSessions: totalSessions ?? 0,
        wonSessions: wonSessions ?? 0,
        rainbowSessions: rainbowSessions ?? 0,
        registeredUsers: streaks?.accounts_with_streaks ?? 0,
        highestCurrentStreak: streaks?.max_current_streak ?? 0,
        highestLongestStreak: streaks?.max_longest_streak ?? 0,
      });
    } catch (err) {
      console.error("Global stats error:", err);
      toast.error("Couldn't load global stats.");
    } finally {
      setGlobalStatsLoading(false);
    }
  }

  /**
   * Switch the form between Full and Mini.
   *
   * The two formats have different category counts, answer counts and board
   * positions, so there is no honest way to carry typed content across —
   * changeFormat always produces a blank form in the new size. So anything
   * already entered is confirmed first, and the local draft is dropped along
   * with it, because a draft describes the format it was typed in.
   */
  function handleFormatChange(next: PuzzleFormatId) {
    if (next === builderFormat.id) return;
    if (
      builder.isDirty &&
      !confirm(
        `Switching to ${getFormat(next).name} ${getFormat(next).sizeLabel} clears the categories and answers you have entered. Continue?`
      )
    ) {
      return;
    }
    builder.changeFormat(next);
    if (!editingId) {
      clearDraft();
      setDraftRestored(false);
    }
  }

  // Calendar date click — populate the date field in the form
  function handleCalendarDateClick(dateStr: string) {
    // The puzzle of the format currently being edited — a date can hold one
    // Full and one Mini.
    const existingPuzzle = puzzles.find(
      (p) => p.date === dateStr && getFormat(p.format).id === builderFormat.id
    );
    if (existingPuzzle) {
      editPuzzle(existingPuzzle);
    } else {
      resetForm();
      setPuzzleDate(dateStr);
      window.scrollTo({ top: 0, behavior: "smooth" });
    }
  }

  async function handleSave() {
    if (loading) {
      toast.error("Still restoring your session. Please try again in a second.");
      return;
    }

    if (!user || !isAdmin) {
      toast.error("You need admin access before you can save puzzles.");
      return;
    }

    if (!puzzleDate) {
      toast.error("Please set a date for the puzzle.");
      return;
    }

    const normalizedGroups = builder.groups.map((g, index) => ({
      category: g.category.trim(),
      words: parseWords(g.answersRaw),
      difficulty: g.difficulty,
      sort_order: index,
      hint_word: g.hintWord.trim() || null,
    }));

    // Every count below comes from the format being built, so a Mini is
    // checked as 3 groups of 3 and a Full as 4 of 4 — the same check, not
    // two.
    if (normalizedGroups.length !== builderFormat.categoryCount) {
      toast.error(`A ${builderFormat.name} ${builderFormat.sizeLabel} puzzle needs exactly ${builderFormat.categoryCount} categories.`);
      return;
    }

    for (let i = 0; i < normalizedGroups.length; i++) {
      const group = normalizedGroups[i];
      if (!group.category || group.words.length !== builderFormat.answersPerCategory) {
        toast.error(`Group ${i + 1}: needs a category and exactly ${builderFormat.answersPerCategory} comma-separated words.`);
        return;
      }
    }

    if (new Set(normalizedGroups.flatMap((group) => group.words)).size !== builderFormat.tileCount) {
      toast.error(`Each ${builderFormat.sizeLabel} puzzle needs ${builderFormat.tileCount} unique words.`);
      return;
    }

    // A Rainbow puzzle needs one answer picked from EVERY category. Without
    // this, builderContentInput sends rainbow_herring: null for a partly
    // filled selection (see contentPayload.ts) and the save silently lands as
    // a Classic puzzle — discarding the Rainbow name, hint, emoji and
    // whichever answers WERE chosen, with a success toast. The count comes
    // from the format, so a Mini needs three and a Full four.
    if (builder.style === "rainbow" && !builder.rainbowComplete) {
      toast.error(
        `A Rainbow ${builderFormat.name} needs one Rainbow answer from each of its ${builderFormat.categoryCount} categories. Pick the missing one, or switch the Style to Classic.`
      );
      return;
    }

    // One puzzle per date PER FORMAT: Full and Mini are sibling Dailies, so
    // the same date legitimately holds one of each.
    const existingPuzzleForDate = puzzles.find(
      (p) => p.date === puzzleDate && p.id !== editingId && getFormat(p.format).id === builderFormat.id
    );
    if (existingPuzzleForDate) {
      toast.error("A puzzle already exists for this date.");
      return;
    }

    setSaving(true);
    try {
      // ── One call, one transaction ──
      // This used to be three separate round trips: UPDATE the puzzle, DELETE
      // every puzzle_groups row, then INSERT the new ones. Between the delete
      // and the insert the puzzle existed with NO WORDS AT ALL, and if the
      // insert failed it stayed that way — so a save that went wrong could
      // leave a live puzzle unplayable.
      //
      // admin_save_puzzle does all of it atomically, and in the same
      // transaction writes the immutable version snapshot, so the current
      // puzzle can never hold half-old and half-new groups.
      //
      // It also owns the versioning decision: a new version is created only
      // when the canonical gameplay content actually changed, so a
      // metadata-only edit and a re-save of untouched content create none.
      // The result says what really happened, which is what the toast
      // reports — the editor never guesses.
      const { data, error } = await supabase.rpc("admin_save_puzzle", {
        _puzzle_id: editingId,
        _metadata: {
          date: puzzleDate,
          title: puzzleTitle || null,
          is_published: isPublished,
          is_beta: isBeta,
          // Blank/whitespace-only reverts to the official "Sam West"
          // fallback — admin_save_puzzle does the trim-and-default itself,
          // this just avoids sending an untrimmed value.
          designer_name: designerName.trim() || null,
          emoji_puzzle_icon: isEmojiPuzzle ? (emojiPuzzleIcon.trim() || null) : null,
          is_free_puzzle: isFreePuzzle,
          free_puzzle_order: isFreePuzzle ? freePuzzleOrder : null,
        },
        // Cast because the generated Json type describes arbitrary JSON,
        // while this is a specific well-known object shape. The database
        // re-validates it anyway — validate_puzzle_content is the real
        // contract, not this type.
        _content: buildContentPayload(currentContentInput()) as unknown as Json,
      });
      if (error) throw error;

      const result = (data ?? {}) as {
        version_number?: number;
        created_version?: boolean;
      };
      if (result.created_version) {
        toast.success(
          `${editingId ? "Puzzle updated" : "Puzzle created"} — saved as Version ${result.version_number ?? "?"}.`
        );
      } else {
        toast.success(
          `Puzzle updated — no gameplay changes, still Version ${result.version_number ?? "?"}.`
        );
      }
      clearDraft();
      setDraftRestored(false);
      resetForm();
      void loadPuzzles();
    } catch (err: any) {
      console.error("Save puzzle error:", err);
      if (err?.code === "23505") {
        toast.error("A puzzle already exists for this date.");
      } else {
        toast.error(err.message || "Failed to save puzzle.");
      }
    } finally {
      setSaving(false);
    }
  }

  /** Sets isPublished/isBeta together so the UI can never produce the one combination the DB rejects. */
  type PuzzleStatus = "draft" | "beta" | "published";
  function applyStatus(status: PuzzleStatus) {
    const nextPublished = status === "published";
    const nextBeta = status === "beta";
    setIsPublished(nextPublished);
    setIsBeta(nextBeta);
    if (!editingId) {
      saveDraft({ ...getCurrentDraft(), isPublished: nextPublished, isBeta: nextBeta });
    }
  }
  const puzzleStatus: PuzzleStatus = isBeta ? "beta" : isPublished ? "published" : "draft";

  function resetForm() {
    setEditingId(null);
    setPuzzleDate("");
    setPuzzleTitle("");
    setDesignerName("Sam West");
    builder.reset();
    setIsPublished(false);
    setIsBeta(false);
    setIsEmojiPuzzle(false);
    setEmojiPuzzleIcon("");
    setIsFreePuzzle(false);
    setFreePuzzleOrder(null);
    setLoadedContent(null);
  }

  // Start Over: clears the form but keeps the designer name. For a NEW puzzle it
  // also drops the saved local draft and restores every new-puzzle default. For
  // an EXISTING puzzle it only clears the form (the visible Date included):
  // editingId, the hidden identity, is kept and the stored puzzle is untouched,
  // so nothing is deleted or overwritten until Update Puzzle is pressed.
  function handleStartOver() {
    setPuzzleTitle("");
    setPuzzleDate("");
    builder.reset();
    if (!editingId) {
      clearDraft();
      setDraftRestored(false);
      setIsPublished(false);
      setIsBeta(false);
      setIsEmojiPuzzle(false);
      setEmojiPuzzleIcon("");
      setIsFreePuzzle(false);
      setFreePuzzleOrder(null);
    }
  }

  function handleClearDraft() {
    clearDraft();
    setDraftRestored(false);
    resetForm();
    toast.success("Draft cleared.");
  }

  function editPuzzle(p: any) {
    setEditingId(p.id);
    setPuzzleDate(p.date);
    setPuzzleTitle(p.title || "");
    setDesignerName(p.designer_name || "Sam West");
    setIsPublished(p.is_published);
    setIsBeta(p.is_beta ?? false);
    const sorted = [...(p.puzzle_groups || [])].sort((a: any, b: any) => a.sort_order - b.sort_order);
    const loadedGroups = sorted.map((g: any) => ({
      category: g.category as string,
      words: g.words as string[],
      difficulty: g.difficulty as Difficulty,
      hintWord: (g.hint_word ?? null) as string | null,
      categoryEmoji: (g.category_emoji ?? null) as string | null,
    }));
    // The puzzle's OWN stored format, never the one the form happened to be
    // on. A row with no format column (pre-migration) or a null value is a
    // Full puzzle and loads back as one — opening an existing puzzle can
    // never silently change its size.
    const loadedFormat = getFormat(p.format);
    // A stored Rainbow is one answer per category, so a COMPLETE one is
    // exactly categoryCount long — four on a Full, three on a Mini. This was
    // a literal 4, which silently loaded every Mini Rainbow back as Classic
    // and would have dropped its selections on the next save.
    const hasStoredRainbow =
      !!p.rainbow_herring && p.rainbow_herring.length === loadedFormat.categoryCount;
    const loadInput: LoadBuilderInput = {
      format: loadedFormat.id,
      groups: loadedGroups,
      wordOrder: p.word_order ?? null,
      rainbowHerring: hasStoredRainbow ? p.rainbow_herring : null,
      rainbowCategoryName: p.rainbow_category_name || "",
      rainbowHintWord: p.rainbow_hint_word || "",
      rainbowCategoryEmoji: p.rainbow_category_emoji || "",
      theme: p.theme || "",
      alphabetizeCompleted: p.alphabetize_completed ?? true,
      // An existing puzzle keeps the style it was saved with.
      style: hasStoredRainbow ? "rainbow" : "classic",
    };
    builder.load(loadInput);
    setIsEmojiPuzzle(p.is_emoji_puzzle ?? false);
    setEmojiPuzzleIcon(p.emoji_puzzle_icon ?? "");
    setIsFreePuzzle(p.is_free_puzzle ?? false);
    setFreePuzzleOrder(p.free_puzzle_order ?? null);
    // The baseline the version hint compares against: this puzzle's gameplay
    // content exactly as it is stored right now.
    setLoadedContent(
      JSON.stringify(
        buildContentPayload({
          format: loadedFormat.id,
          groups: loadedGroups,
          wordOrder: p.word_order ?? null,
          rainbowHerring: p.rainbow_herring ?? null,
          rainbowCategoryName: p.rainbow_category_name ?? null,
          rainbowHintWord: p.rainbow_hint_word ?? null,
          rainbowCategoryEmoji: p.rainbow_category_emoji ?? null,
          theme: p.theme ?? null,
          isEmojiPuzzle: p.is_emoji_puzzle ?? false,
          alphabetizeCompleted: p.alphabetize_completed ?? true,
        })
      )
    );
    setDraftRestored(false);
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  async function deletePuzzle(id: string) {
    if (!confirm("Delete this puzzle?")) return;
    await supabase.from("puzzles").delete().eq("id", id);
    toast.success("Puzzle deleted.");
    loadPuzzles();
  }

  async function togglePublish(id: string, current: boolean) {
    // Always clears is_beta alongside is_published: this is the ONLY quick
    // action on the list row (no 3-way selector there — see the editor form
    // for that), and Beta -> Published is a valid transition through it, so
    // it must never try to set both flags true at once and trip the
    // puzzles_not_beta_and_published check constraint.
    await supabase.from("puzzles").update({ is_published: !current, is_beta: false }).eq("id", id);
    loadPuzzles();
  }

  async function toggleStats(id: string) {
    if (expandedStatsId === id) {
      setExpandedStatsId(null);
      return;
    }
    setExpandedStatsId(id);
    if (!puzzleStats[id]) {
      const { data } = await supabase.rpc("get_puzzle_stats", { _puzzle_id: id });
      setPuzzleStats((prev) => ({ ...prev, [id]: data }));
    }
    if (!puzzleRatings[id]) {
      const { data: ratingRows } = await supabase
        .from("puzzle_ratings")
        .select("rating")
        .eq("puzzle_id", id);
      const rows = (ratingRows ?? []) as { rating: number }[];
      const breakdown: Record<1 | 2 | 3 | 4 | 5, number> = { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 };
      let sum = 0;
      for (const r of rows) {
        const stars = Math.max(1, Math.min(5, Math.round(r.rating))) as 1 | 2 | 3 | 4 | 5;
        breakdown[stars]++;
        sum += r.rating;
      }
      const summary: RatingSummary = {
        count: rows.length,
        average: rows.length > 0 ? sum / rows.length : 0,
        breakdown,
      };
      setPuzzleRatings((prev) => ({ ...prev, [id]: summary }));
    }
  }

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="animate-pulse text-muted-foreground">Loading…</div>
      </div>
    );
  }

  if (!user) return <AdminLogin />;
  if (!isAdmin) return <AdminNoAccess />;

  // Tile colour comes from the owning category's DIFFICULTY, not its
  // position. Identical to the old position+1 for Full (where they are always
  // the same); on a Mini it is what makes the three cards Green/Blue/Red
  // instead of Yellow/Green/Blue.
  const tileFor = (id: string) => {
    const slot = builder.slotById.get(id);
    const group = builder.groups.find((g) => g.answers.some((a) => a.id === id));
    return { id, text: slot?.text ?? "", colorIndex: group?.difficulty ?? builderFormat.difficultyOrder[0] };
  };
  const boardTiles = builder.wordOrderIds.map(tileFor);
  const rainbowDisplayTiles = builder.rainbowWordOrderIds.map(tileFor);

  return (
    <div className="min-h-screen pb-16">
      <header className="border-b border-border px-4 py-3 flex items-center justify-between max-w-5xl mx-auto">
        <div className="flex items-center gap-3">
          <Link to="/" className="text-sm text-muted-foreground hover:text-foreground transition-colors inline-flex items-center gap-1">
            <ArrowLeft className="w-4 h-4" /> Game
          </Link>
          <h1 className="text-lg font-bold">Puzzle Admin</h1>
        </div>
        <Button variant="ghost" size="sm" onClick={() => signOut()}>
          <LogOut className="w-4 h-4 mr-1" /> Sign out
        </Button>
      </header>

      <main className="max-w-5xl mx-auto px-4 mt-6 space-y-8">
        {draftRestored && (
          <div className="flex items-center justify-between rounded-lg border border-border bg-muted/50 px-4 py-3 text-sm">
            <span className="text-muted-foreground">✏️ Draft restored from your last session.</span>
            <button
              onClick={handleClearDraft}
              className="flex items-center gap-1.5 text-muted-foreground hover:text-foreground transition-colors"
            >
              <RotateCcw className="w-3.5 h-3.5" /> Clear draft
            </button>
          </div>
        )}

        {/* Mini calendar at top */}
        {puzzles.length > 0 && (
          <div>
            <button
              onClick={() => setCalendarOpen((v) => !v)}
              className="text-xs font-medium text-muted-foreground hover:text-foreground transition-colors mb-2 inline-flex items-center gap-1"
            >
              {calendarOpen ? "▾ Hide calendar" : "▸ Show calendar"}
            </button>
            {calendarOpen && (
              <MiniCalendar puzzles={puzzles} onDateClick={handleCalendarDateClick} format={builderFormat.id} />
            )}
          </div>
        )}

        <section className="space-y-4">
          <h2 className="text-lg font-semibold">{editingId ? "Edit Puzzle" : "Create a Puzzle"}</h2>

          <div className="lg:grid lg:grid-cols-[minmax(0,1fr)_320px] lg:gap-8 lg:items-start">
            {/* ── Editor column ── */}
            <div className="space-y-5 min-w-0">
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <Label htmlFor="pdate">Date</Label>
                  <Input
                    id="pdate"
                    type="date"
                    value={puzzleDate}
                    onChange={(e) => setPuzzleDate(e.target.value)}
                    onBlur={handleBlurSave}
                  />
                </div>
                <div>
                  <Label htmlFor="ptitle">Title (optional)</Label>
                  <Input
                    id="ptitle"
                    value={puzzleTitle}
                    onChange={(e) => setPuzzleTitle(e.target.value)}
                    onBlur={handleBlurSave}
                    placeholder="e.g. Monday Mashup"
                  />
                </div>
              </div>

              <div>
                <Label htmlFor="pdesigner">Designer name</Label>
                <Input
                  id="pdesigner"
                  value={designerName}
                  onChange={(e) => setDesignerName(e.target.value)}
                  onBlur={handleBlurSave}
                  placeholder="Sam West"
                />
                <p className="text-xs text-muted-foreground mt-1">
                  Shown in the puzzle header as "by {designerName.trim() || "Sam West"}". Leaving this blank saves it as "Sam West". Metadata only — never creates a new version.
                </p>
              </div>

              <div className="flex flex-wrap gap-6">
                <FormatSelector
                  value={builderFormat.id}
                  onChange={handleFormatChange}
                  // An existing puzzle's format is fixed: its saved content,
                  // its players' pinned boards and its statistics all assume
                  // one shape, and re-shaping it in place would invalidate
                  // all three. Create a new puzzle instead.
                  lockedReason={editingId ? "An existing puzzle keeps the size it was saved with. Start a new puzzle to build the other size." : undefined}
                />
                {/* Offered on any format that CAN carry a bonus category —
                    both sizes today. A new Full starts on Rainbow and a new
                    Mini on Classic (format.defaultBuilderStyle); either can
                    be switched here, per puzzle. */}
                {builderFormat.hasRainbow && (
                  <StyleSelector value={builder.style} onChange={builder.setStyle} />
                )}
              </div>

              <label className="flex items-center gap-2 cursor-pointer">
                <input
                  type="checkbox"
                  checked={builder.alphabetizeCompleted}
                  onChange={(e) => {
                    builder.setAlphabetizeCompleted(e.target.checked);
                    if (!editingId) {
                      saveDraft({ ...getCurrentDraft(), alphabetizeCompleted: e.target.checked });
                    }
                  }}
                  className="rounded border-border"
                />
                <span className="text-sm font-medium text-ink">Automatically alphabetize answers in completed categories</span>
              </label>

              <CategoryList
                keys={builder.groups.map((g) => g.poolIds[0])}
                labels={categoryLabels}
                onMove={builder.moveGroup}
                renderCard={(i, dnd) => {
                  const g = builder.groups[i];
                  return (
                    <CategoryEditor
                      colorIndex={g.difficulty}
                      label={categoryLabels[i]}
                      difficultyLabel={difficultyCardLabels[i]}
                      category={g.category}
                      onCategoryChange={(v) => builder.updateCategoryName(i, v)}
                      categoryEmoji={g.categoryEmoji}
                      onCategoryEmojiChange={(v) => builder.updateCategoryEmoji(i, v)}
                      categoryPlaceholder={placeholders.category[i]}
                      answersRaw={g.answersRaw}
                      onAnswersRawChange={(v) => builder.updateAnswersRaw(i, v)}
                      answersLabel={`${builderFormat.answersPerCategory} answers, separated by commas`}
                      answersPlaceholder={placeholders.answers[i]}
                      hintWord={g.hintWord}
                      onHintWordChange={(v) => builder.updateHintWord(i, v)}
                      hintPlaceholder={placeholders.hint[i]}
                      onFieldBlur={handleBlurSave}
                      dragHandle={dnd.handle}
                      isDragging={dnd.isDragging}
                    />
                  );
                }}
              />

              {styleTab === "rainbow" && builder.hasAll16 && (
                <RainbowPanel
                  groups={builder.groups.map((g, i) => ({
                    colorIndex: g.difficulty,
                    label: g.category || categoryLabels[i],
                    answers: g.answers,
                    selectedId: builder.rainbowHerringIds[i],
                  }))}
                  onSelect={builder.selectRainbowAnswer}
                  categoryName={builder.rainbowCategoryName}
                  onCategoryNameChange={builder.setRainbowCategoryName}
                  categoryEmoji={builder.rainbowCategoryEmoji}
                  onCategoryEmojiChange={builder.setRainbowCategoryEmoji}
                  hintWord={builder.rainbowHintWord}
                  onHintWordChange={builder.setRainbowHintWord}
                  theme={builder.theme}
                  onThemeChange={builder.setTheme}
                  displayOrderTiles={rainbowDisplayTiles}
                  onReorderDisplay={builder.setRainbowWordOrderIds}
                  onFieldBlur={handleBlurSave}
                />
              )}

              <p className="text-xs text-muted-foreground">
                Using a custom emoji?{" "}
                <button
                  type="button"
                  onClick={() => {
                    setShowEmojiManager(true);
                    requestAnimationFrame(() =>
                      document.getElementById("custom-emoji-manager")?.scrollIntoView({ behavior: "smooth", block: "start" })
                    );
                  }}
                  className="underline hover:text-foreground transition-colors"
                >
                  View available emoji codes ↗
                </button>
                <br />
                Enter a code such as <code className="text-[11px]">:caveman:</code> in an answer field.
              </p>

              <div className="flex items-center gap-2 flex-wrap">
                <span className="text-sm font-medium mr-1">Status</span>
                <div className="inline-flex rounded-lg border border-border p-0.5 bg-secondary/50">
                  {(["draft", "beta", "published"] as const).map((status) => (
                    <button
                      key={status}
                      type="button"
                      onClick={() => applyStatus(status)}
                      className={`px-3 py-1.5 rounded-md text-xs font-semibold capitalize transition-colors
                        ${puzzleStatus === status ? "bg-card text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground"}`}
                    >
                      {status}
                    </button>
                  ))}
                </div>
                {puzzleStatus === "beta" && (
                  <span className="text-xs text-muted-foreground">
                    Unlisted — playable at /beta, never on the Daily homepage or Archive.
                  </span>
                )}
              </div>

              {/* Emoji Puzzles and Free Puzzles are the FULL archive's own
                  curated collections (see pages/Archive.tsx) and their cards
                  link to /archive/:id, which serves Full puzzles only. Hiding
                  them for any other format is what stops an admin creating a
                  Mini that is advertised on a page it cannot be opened from. */}
              {builderFormat.id === "full" && (
              <div className="flex items-center gap-6 flex-wrap">
                <label className="flex items-center gap-2 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={isEmojiPuzzle}
                    onChange={(e) => {
                      setIsEmojiPuzzle(e.target.checked);
                      if (!editingId) {
                        saveDraft({ ...getCurrentDraft(), isEmojiPuzzle: e.target.checked });
                      }
                    }}
                    className="rounded border-border"
                  />
                  <span className="text-sm font-medium">Emoji Puzzle 🎨</span>
                </label>
                {isEmojiPuzzle && (
                  <div className="flex items-center gap-2">
                    <label className="text-sm font-medium whitespace-nowrap">Emoji Puzzle Icon</label>
                    <input
                      type="text"
                      value={emojiPuzzleIcon}
                      onChange={(e) => {
                        setEmojiPuzzleIcon(e.target.value);
                        if (!editingId) {
                          saveDraft({ ...getCurrentDraft(), emojiPuzzleIcon: e.target.value });
                        }
                      }}
                      placeholder="🐶"
                      className="w-20 rounded border-border px-2 py-1 text-sm"
                    />
                  </div>
                )}
                <label className="flex items-center gap-2 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={isFreePuzzle}
                    onChange={(e) => {
                      setIsFreePuzzle(e.target.checked);
                      if (!e.target.checked) setFreePuzzleOrder(null);
                      if (!editingId) {
                        saveDraft({ ...getCurrentDraft(), isFreePuzzle: e.target.checked, freePuzzleOrder: e.target.checked ? freePuzzleOrder : null });
                      }
                    }}
                    className="rounded border-border"
                  />
                  <span className="text-sm font-medium">Free Puzzle 🆓</span>
                </label>
                {isFreePuzzle && (
                  <div className="flex items-center gap-2">
                    <label className="text-sm font-medium whitespace-nowrap">Order (1–10)</label>
                    <input
                      type="number"
                      min={1}
                      max={10}
                      value={freePuzzleOrder ?? ""}
                      onChange={(e) => {
                        const raw = parseInt(e.target.value, 10);
                        setFreePuzzleOrder(isNaN(raw) ? null : Math.min(10, Math.max(1, raw)));
                      }}
                      onBlur={handleBlurSave}
                      placeholder="1"
                      className="w-16 rounded-md border border-border bg-background px-2 py-1.5 text-sm"
                    />
                  </div>
                )}
              </div>
              )}

              {/* Version hint.
                  Informational, and intentionally low-key: versioning PROTECTS
                  players who are mid-game (their board keeps working on the
                  version they started), so editing an old puzzle is a normal,
                  safe thing to do and must not be dressed up as dangerous. */}
              {versionHint && (
                <p className="text-xs text-muted-foreground -mt-2">{versionHint}</p>
              )}

              <div className="flex gap-3">
                <Button onClick={handleSave} disabled={saving}>
                  <Save className="w-4 h-4 mr-1" /> {saving ? "Saving…" : editingId ? "Update Puzzle" : "Create Puzzle"}
                </Button>
                {editingId && (
                  <Button variant="outline" onClick={resetForm}>Cancel Edit</Button>
                )}
                <StartOverButton
                  onConfirm={handleStartOver}
                  description={
                    editingId
                      ? "This clears the form only. The saved puzzle is not changed until you press Update Puzzle."
                      : undefined
                  }
                />
              </div>
            </div>

            {/* ── Starting-board column ── */}
            <div className="mt-6 lg:mt-0 lg:sticky lg:top-4">
              {/* Always shown, even for a brand-new blank puzzle — the 16
                  board positions and their random opening arrangement exist
                  from the moment the form does (see blankState() in
                  useBuilderForm), so the preview fills in incrementally as
                  answers are typed rather than staying hidden until the
                  puzzle is complete. */}
              <StartingBoardArranger
                tiles={boardTiles}
                onReorder={builder.setWordOrderIds}
                onRandomize={builder.randomizeWordOrder}
                title={puzzleTitle}
                designerName={designerName}
                isRainbow={builder.style === "rainbow"}
                columns={builderFormat.columns}
                showModeBadge={builderFormat.hasRainbow}
              />
            </div>
          </div>
        </section>

        <ArchiveAccessManager />

        {/*
          Mounted only on demand. Previously this rendered on every Admin
          page load and pulled the entire emoji bucket (38 files, ~33 MB)
          whether or not anyone intended to manage emoji. Gating the mount is
          what makes ordinary puzzle editing cost nothing here.
        */}
        <section className="space-y-4">
          <Button
            variant="outline"
            onClick={() => setShowEmojiManager((v) => !v)}
            aria-expanded={showEmojiManager}
            aria-controls="custom-emoji-manager"
          >
            <ImageIcon className="w-4 h-4 mr-1" />
            {showEmojiManager ? "Hide Custom Emoji" : "Manage Custom Emoji"}
          </Button>
          {showEmojiManager && (
            <div id="custom-emoji-manager">
              <CustomEmojiManager />
            </div>
          )}
        </section>

        <FeedbackList />

        <BetaPlaytestPanel puzzles={puzzles} />

        {/* Global Stats */}
        <section className="space-y-4">
          <div className="flex items-center justify-between">
            <h2 className="text-lg font-semibold">Global Stats</h2>
            <Button variant="outline" size="sm" onClick={loadGlobalStats} disabled={globalStatsLoading}>
              {globalStatsLoading ? "Loading…" : globalStats ? "Refresh" : "Load Stats"}
            </Button>
          </div>
          {globalStats && (
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
              {[
                { label: "Total Sessions", value: globalStats.totalSessions.toLocaleString() },
                { label: "Won", value: globalStats.wonSessions.toLocaleString() },
                { label: "Win Rate", value: globalStats.totalSessions > 0 ? `${((globalStats.wonSessions / globalStats.totalSessions) * 100).toFixed(1)}%` : "—" },
                { label: "Rainbows Found", value: globalStats.rainbowSessions.toLocaleString() },
                { label: "Rainbow Rate", value: globalStats.totalSessions > 0 ? `${((globalStats.rainbowSessions / globalStats.totalSessions) * 100).toFixed(1)}%` : "—" },
                { label: "Registered Users", value: globalStats.registeredUsers.toLocaleString() },
                { label: "Best Current Streak", value: globalStats.highestCurrentStreak.toLocaleString() },
                { label: "Best Longest Streak", value: globalStats.highestLongestStreak.toLocaleString() },
              ].map((stat) => (
                <div key={stat.label} className="rounded-lg border border-border bg-card p-3 text-center">
                  <p className="text-2xl font-bold">{stat.value}</p>
                  <p className="text-xs text-muted-foreground mt-1">{stat.label}</p>
                </div>
              ))}
            </div>
          )}
        </section>

        {/* Mini calendar + puzzle list */}
        <section className="space-y-4">
          <h2 className="text-lg font-semibold">All Puzzles ({puzzles.length})</h2>

          {puzzles.length === 0 && (
            <p className="text-sm text-muted-foreground">No puzzles yet. Create your first one above!</p>
          )}
          <div className="space-y-2">
            {paginatedPuzzles.map((p) => (
              <PuzzleListItem
                key={p.id}
                puzzle={p}
                expanded={expandedStatsId === p.id}
                stats={puzzleStats[p.id]}
                ratings={puzzleRatings[p.id]}
                onToggleStats={toggleStats}
                onTogglePublish={togglePublish}
                onEdit={editPuzzle}
                onDelete={deletePuzzle}
              />
            ))}
          </div>

          <Pagination
            currentPage={currentPage}
            totalPages={totalPages}
            onPageChange={setCurrentPage}
          />
        </section>
      </main>
    </div>
  );
}
