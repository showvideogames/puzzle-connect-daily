import { useState, useEffect, useMemo } from "react";
import { useAuth } from "@/hooks/useAuth";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { LogOut, Save, ArrowLeft, RotateCcw, ArrowLeftRight, ChevronLeft, ChevronRight } from "lucide-react";
import { Link } from "react-router-dom";
import { ArchiveAccessManager } from "@/components/ArchiveAccessManager";
import { CustomEmojiManager } from "@/components/admin/CustomEmojiManager";
import { FeedbackList } from "@/components/admin/FeedbackList";
import { AdminLogin, AdminNoAccess } from "@/components/admin/AdminLogin";
import { PuzzleListItem } from "@/components/admin/PuzzleListItem";
import { useDraftPersistence, type GroupForm, type DraftData } from "@/hooks/useDraftPersistence";
import { toast } from "sonner";

const PUZZLES_PER_PAGE = 50;

const emptyGroup = (): GroupForm => ({ category: "", words: "", difficulty: 1, hintWord: "" });
const normalizeWord = (w: string): string => {
  const trimmed = w.trim();
  return /^img:/i.test(trimmed) ? trimmed.toLowerCase() : trimmed.toUpperCase();
};
const parseWords = (value: string) =>
  value
    .split(",")
    .map(normalizeWord)
    .filter(Boolean);

// ─── Mini Calendar ──────────────────────────────────────────────────────────

const MINI_DAYS = ["S", "M", "T", "W", "T", "F", "S"];
const MINI_MONTHS = ["January","February","March","April","May","June","July","August","September","October","November","December"];

interface MiniCalendarProps {
  puzzles: any[];
  onDateClick: (dateStr: string) => void;
}

function MiniCalendar({ puzzles, onDateClick }: MiniCalendarProps) {
  const today = new Date();
  const [viewYear, setViewYear] = useState(today.getFullYear());
  const [viewMonth, setViewMonth] = useState(today.getMonth());

  // Build lookup: date string → "published" | "draft"
  const statusByDate = useMemo(() => {
    const map: Record<string, "published" | "draft"> = {};
    for (const p of puzzles) {
      map[p.date] = p.is_published ? "published" : "draft";
    }
    return map;
  }, [puzzles]);

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

  // Tap-to-swap selection state
  const [selectedGroupIdx, setSelectedGroupIdx] = useState<number | null>(null);
  const [selectedTileIdx, setSelectedTileIdx] = useState<number | null>(null);
  const [selectedRainbowIdx, setSelectedRainbowIdx] = useState<number | null>(null);

  // Puzzle form
  const [puzzleDate, setPuzzleDate] = useState("");
  const [puzzleTitle, setPuzzleTitle] = useState("");
  const [rainbowHerring, setRainbowHerring] = useState<(string | null)[]>([null, null, null, null]);
  const [rainbowCategoryName, setRainbowCategoryName] = useState("");
  const [rainbowHintWord, setRainbowHintWord] = useState("");
  const [isEmojiPuzzle, setIsEmojiPuzzle] = useState(false);
  const [isFreePuzzle, setIsFreePuzzle] = useState(false);
  const [freePuzzleOrder, setFreePuzzleOrder] = useState<number | null>(null);
  const [groups, setGroups] = useState<GroupForm[]>([
    { ...emptyGroup(), difficulty: 1 },
    { ...emptyGroup(), difficulty: 2 },
    { ...emptyGroup(), difficulty: 3 },
    { ...emptyGroup(), difficulty: 4 },
  ]);
  const [isPublished, setIsPublished] = useState(false);
  const [saving, setSaving] = useState(false);
  const [wordOrder, setWordOrder] = useState<string[]>([]);

  // Rainbow word reordering
  const [rainbowWordOrder, setRainbowWordOrder] = useState<string[]>([]);

  // Existing puzzles list
  const [puzzles, setPuzzles] = useState<any[]>([]);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [expandedStatsId, setExpandedStatsId] = useState<string | null>(null);
  const [puzzleStats, setPuzzleStats] = useState<Record<string, any>>({});

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

  // Update rainbow word order whenever rainbow herring changes
  useEffect(() => {
    if (rainbowHerring.every(Boolean)) {
      setRainbowWordOrder(rainbowHerring.filter(Boolean) as string[]);
    } else {
      setRainbowWordOrder([]);
    }
  }, [rainbowHerring]);

  const draftValues: DraftData = {
    puzzleDate,
    puzzleTitle,
    groups,
    isPublished,
    wordOrder,
    rainbowHerring,
    rainbowCategoryName,
    rainbowHintWord,
    rainbowWordOrder,
    isEmojiPuzzle,
    isFreePuzzle,
    freePuzzleOrder,
    editingId,
  };

  const { draftRestored, setDraftRestored, saveDraft, clearDraft, getCurrentDraft, handleBlurSave } = useDraftPersistence({
    enabled: isAdmin,
    editingId,
    values: draftValues,
    applyDraft: (draft) => {
      setPuzzleDate(draft.puzzleDate);
      setPuzzleTitle(draft.puzzleTitle);
      setGroups(draft.groups);
      setIsPublished(draft.isPublished);
      setWordOrder(draft.wordOrder);
      setRainbowHerring(draft.rainbowHerring);
      setRainbowCategoryName(draft.rainbowCategoryName ?? "");
      setRainbowHintWord(draft.rainbowHintWord ?? "");
      setRainbowWordOrder(draft.rainbowWordOrder ?? []);
      setIsEmojiPuzzle(draft.isEmojiPuzzle ?? false);
      setIsFreePuzzle(draft.isFreePuzzle ?? false);
      setFreePuzzleOrder(draft.freePuzzleOrder ?? null);
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
  }

  function updateGroup(idx: number, field: keyof GroupForm, value: string | number) {
    setGroups((g) => g.map((gr, i) => (i === idx ? { ...gr, [field]: value } : gr)));
  }

 function swapGroups(a: number, b: number) {
  if (a === b) return;
  setGroups((prev) => {
    const next = [...prev];
    [next[a], next[b]] = [next[b], next[a]];
    // Reassign difficulties to match position
    return next.map((g, i) => ({ ...g, difficulty: (i + 1) as 1 | 2 | 3 | 4 }));
  });
    setRainbowHerring((prev) => {
      const next = [...prev];
      [next[a], next[b]] = [next[b], next[a]];
      return next;
    });
  }

  function handleGroupTap(i: number) {
    if (selectedGroupIdx === null) {
      setSelectedGroupIdx(i);
    } else if (selectedGroupIdx === i) {
      setSelectedGroupIdx(null);
    } else {
      swapGroups(selectedGroupIdx, i);
      setSelectedGroupIdx(null);
    }
  }

  // Compute all words from groups
  const allWords = groups.flatMap((g) => parseWords(g.words));
  const hasAll16 = allWords.length === 16 && new Set(allWords).size === 16;

  function generateWordOrder() {
    setWordOrder([...allWords]);
  }

  function handleTileTap(vIdx: number) {
    if (selectedTileIdx === null) {
      setSelectedTileIdx(vIdx);
    } else if (selectedTileIdx === vIdx) {
      setSelectedTileIdx(null);
    } else {
      setWordOrder((prev) => {
        const next = [...prev];
        [next[selectedTileIdx], next[vIdx]] = [next[vIdx], next[selectedTileIdx]];
        return next;
      });
      setSelectedTileIdx(null);
    }
  }

  // Calendar date click — populate the date field in the form
  function handleCalendarDateClick(dateStr: string) {
    const existingPuzzle = puzzles.find((p) => p.date === dateStr);
    if (existingPuzzle) {
      editPuzzle(existingPuzzle);
    } else {
      resetForm();
      setPuzzleDate(dateStr);
      window.scrollTo({ top: 0, behavior: "smooth" });
    }
  }

  function handleRainbowTap(vIdx: number) {
    if (selectedRainbowIdx === null) {
      setSelectedRainbowIdx(vIdx);
    } else if (selectedRainbowIdx === vIdx) {
      setSelectedRainbowIdx(null);
    } else {
      setRainbowWordOrder((prev) => {
        const next = [...prev];
        [next[selectedRainbowIdx], next[vIdx]] = [next[vIdx], next[selectedRainbowIdx]];
        return next;
      });
      setSelectedRainbowIdx(null);
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

    const normalizedGroups = groups.map((g, index) => ({
      category: g.category.trim(),
      words: parseWords(g.words),
      difficulty: g.difficulty,
      sort_order: index,
      hint_word: g.hintWord.trim() || null,
    }));

    for (let i = 0; i < normalizedGroups.length; i++) {
      const group = normalizedGroups[i];
      if (!group.category || group.words.length !== 4) {
        toast.error(`Group ${i + 1}: needs a category and exactly 4 comma-separated words.`);
        return;
      }
    }

    if (new Set(normalizedGroups.flatMap((group) => group.words)).size !== 16) {
      toast.error("Each puzzle needs 16 unique words.");
      return;
    }

    const existingPuzzleForDate = puzzles.find((p) => p.date === puzzleDate && p.id !== editingId);
    if (existingPuzzleForDate) {
      toast.error("A puzzle already exists for this date.");
      return;
    }

    setSaving(true);
    try {
      let puzzleId = editingId;
      // Use rainbowWordOrder if it has been customized, otherwise fall back to rainbowHerring
      const rainbowArr = rainbowWordOrder.length === 4 ? rainbowWordOrder : (rainbowHerring.every(Boolean) ? (rainbowHerring as string[]) : null);

      if (editingId) {
        const { error } = await supabase
          .from("puzzles")
          .update({
            date: puzzleDate,
            title: puzzleTitle || null,
            is_published: isPublished,
            word_order: wordOrder.length === 16 ? wordOrder : null,
            rainbow_herring: rainbowArr,
            rainbow_category_name: rainbowCategoryName.trim() || null,
            rainbow_hint_word: rainbowHintWord.trim() || null,
            is_emoji_puzzle: isEmojiPuzzle,
            is_free_puzzle: isFreePuzzle,
            free_puzzle_order: isFreePuzzle ? freePuzzleOrder : null,
          })
          .eq("id", editingId);
        if (error) throw error;

        const { error: delError } = await supabase.from("puzzle_groups").delete().eq("puzzle_id", editingId);
        if (delError) throw delError;
      } else {
        const { data, error } = await supabase
          .from("puzzles")
          .insert({
            date: puzzleDate,
            title: puzzleTitle || null,
            is_published: isPublished,
            created_by: user!.id,
            word_order: wordOrder.length === 16 ? wordOrder : null,
            rainbow_herring: rainbowArr,
            rainbow_category_name: rainbowCategoryName.trim() || null,
            rainbow_hint_word: rainbowHintWord.trim() || null,
            is_emoji_puzzle: isEmojiPuzzle,
            is_free_puzzle: isFreePuzzle,
            free_puzzle_order: isFreePuzzle ? freePuzzleOrder : null,
          })
          .select("id")
          .single();
        if (error) throw error;
        puzzleId = data.id;
      }

      const { error: groupError } = await supabase.from("puzzle_groups").insert(
        normalizedGroups.map((group) => ({
          puzzle_id: puzzleId!,
          category: group.category,
          words: group.words,
          difficulty: group.difficulty,
          sort_order: group.sort_order,
          hint_word: group.hint_word,
        }))
      );
      if (groupError) throw groupError;

      toast.success(editingId ? "Puzzle updated!" : "Puzzle created!");
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

  function resetForm() {
    setEditingId(null);
    setPuzzleDate("");
    setPuzzleTitle("");
    setGroups([
      { ...emptyGroup(), difficulty: 1 },
      { ...emptyGroup(), difficulty: 2 },
      { ...emptyGroup(), difficulty: 3 },
      { ...emptyGroup(), difficulty: 4 },
    ]);
    setIsPublished(false);
    setWordOrder([]);
    setRainbowHerring([null, null, null, null]);
    setRainbowCategoryName("");
    setRainbowHintWord("");
    setRainbowWordOrder([]);
    setIsEmojiPuzzle(false);
    setIsFreePuzzle(false);
    setFreePuzzleOrder(null);
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
    setIsPublished(p.is_published);
    const sorted = [...(p.puzzle_groups || [])].sort((a: any, b: any) => a.sort_order - b.sort_order);
    setGroups(
      sorted.map((g: any) => ({
        category: g.category,
        words: g.words.join(", "),
        difficulty: g.difficulty as 1 | 2 | 3 | 4,
        hintWord: g.hint_word ?? "",
      }))
    );
    setWordOrder(p.word_order || []);
    if (p.rainbow_herring && p.rainbow_herring.length === 4) {
      setRainbowHerring(p.rainbow_herring);
      setRainbowWordOrder(p.rainbow_herring); // Set the custom order from saved data
    } else {
      setRainbowHerring([null, null, null, null]);
      setRainbowWordOrder([]);
    }
    setRainbowCategoryName(p.rainbow_category_name || "");
    setRainbowHintWord(p.rainbow_hint_word || "");
    setIsEmojiPuzzle(p.is_emoji_puzzle ?? false);
    setIsFreePuzzle(p.is_free_puzzle ?? false);
    setFreePuzzleOrder(p.free_puzzle_order ?? null);
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
    await supabase.from("puzzles").update({ is_published: !current }).eq("id", id);
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

  const difficultyLabels = ["Easiest", "Easy", "Hard", "Hardest"];
  const difficultyColors = [
    "bg-[hsl(var(--group-1))]",
    "bg-[hsl(var(--group-2))]",
    "bg-[hsl(var(--group-3))]",
    "bg-[hsl(var(--group-4))]",
  ];

  return (
    <div className="min-h-screen pb-16">
      <header className="border-b border-border px-4 py-3 flex items-center justify-between max-w-3xl mx-auto">
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

      <main className="max-w-3xl mx-auto px-4 mt-6 space-y-8">
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
              <MiniCalendar puzzles={puzzles} onDateClick={handleCalendarDateClick} />
            )}
          </div>
        )}

        <section className="space-y-4">
          <h2 className="text-lg font-semibold">{editingId ? "Edit Puzzle" : "Create New Puzzle"}</h2>

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

          <p className="text-xs text-muted-foreground">
            Tap the swap icon to select a group, then tap another to swap them.
          </p>
          <div className="space-y-3">
            {groups.map((g, i) => {
              const isSelected = selectedGroupIdx === i;
              return (
                <div
                  key={i}
                  className={`rounded-lg p-4 space-y-2 ${difficultyColors[i]} bg-opacity-30 transition-all duration-150
                    ${isSelected ? "ring-2 ring-primary ring-offset-1 scale-[1.01]" : ""}
                  `}
                >
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                      Group {i + 1} — {difficultyLabels[i]}
                    </span>
                    <button
                      type="button"
                      onClick={() => handleGroupTap(i)}
                      aria-label={`Select group ${i + 1} to swap`}
                      className="cursor-pointer active:scale-95 p-1 -m-1 rounded hover:bg-secondary transition-colors"
                    >
                      <ArrowLeftRight className="w-4 h-4 text-muted-foreground/70" />
                    </button>
                  </div>
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <Label className="text-xs">Category Name</Label>
                      <Input
                        value={g.category}
                        onChange={(e) => updateGroup(i, "category", e.target.value)}
                        onBlur={handleBlurSave}
                        placeholder="e.g. Coffee Drinks"
                      />
                    </div>
                    <div>
                      <Label className="text-xs">4 Words (comma-separated)</Label>
                      <Input
                        value={g.words}
                        onChange={(e) => updateGroup(i, "words", e.target.value)}
                        onBlur={handleBlurSave}
                        placeholder="LATTE, MOCHA, ESPRESSO, CORTADO"
                      />
                    </div>
                  </div>
                  <div>
                    <Label className="text-xs">Hint Word (optional)</Label>
                    <Input
                      value={g.hintWord}
                      onChange={(e) => updateGroup(i, "hintWord", e.target.value)}
                      onBlur={handleBlurSave}
                      placeholder="Extra example word shown as a Small Hint"
                    />
                  </div>
                </div>
              );
            })}
          </div>

          {/* Grid Order Editor */}
          {hasAll16 && (
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <h3 className="text-sm font-semibold">Grid Layout Order</h3>
                <Button variant="outline" size="sm" onClick={generateWordOrder}>
                  {wordOrder.length === 16 ? "Reset Order" : "Customize Order"}
                </Button>
              </div>
              {wordOrder.length === 16 && (
                <>
                  <p className="text-xs text-muted-foreground">
                    Tap a tile to select it, then tap another to swap them.
                  </p>
                  <div className="grid grid-cols-4 gap-2">
                    {wordOrder.map((word, vIdx) => {
                      const groupIdx = groups.findIndex((g) =>
                        g.words.split(",").map(normalizeWord).includes(word)
                      );
                      const diffColors = [
                        "bg-[hsl(var(--group-1)/0.3)]",
                        "bg-[hsl(var(--group-2)/0.3)]",
                        "bg-[hsl(var(--group-3)/0.3)]",
                        "bg-[hsl(var(--group-4)/0.3)]",
                      ];
                      const isSelected = selectedTileIdx === vIdx;

                      return (
                        <div
                          key={word}
                          onClick={() => handleTileTap(vIdx)}
                          className={`rounded-lg px-2 py-3 text-xs font-semibold uppercase tracking-wide text-center
                            transition-all duration-100 select-none cursor-pointer active:scale-95
                            ${diffColors[groupIdx] || "bg-muted"}
                            ${isSelected ? "ring-2 ring-primary scale-105 shadow-md" : ""}
                          `}
                        >
                          {word}
                        </div>
                      );
                    })}
                  </div>
                </>
              )}
            </div>
          )}

          {/* Rainbow Herring Editor */}
          {hasAll16 && (
            <div className="space-y-3">
              <h3 className="text-sm font-semibold">🌈 Rainbow Herring (optional)</h3>
              <p className="text-xs text-muted-foreground">Pick one word from each group. If a player guesses all 4, the tiles turn rainbow and they don't lose a mistake.</p>
              <div>
                <Label className="text-xs">Rainbow Category Title</Label>
                <input
                  type="text"
                  value={rainbowCategoryName}
                  onChange={(e) => setRainbowCategoryName(e.target.value)}
                  onBlur={handleBlurSave}
                  placeholder="e.g. Synonyms for Fast ⏱️"
                  className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm mt-1"
                />
              </div>
              <div>
                <Label className="text-xs">Rainbow Hint Word (optional)</Label>
                <input
                  type="text"
                  value={rainbowHintWord}
                  onChange={(e) => setRainbowHintWord(e.target.value)}
                  onBlur={handleBlurSave}
                  placeholder="Extra example word shown as a Small Hint"
                  className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm mt-1"
                />
              </div>
              <div className="grid grid-cols-2 gap-3">
                {groups.map((g, i) => {
                  const groupWords = g.words.split(",").map(normalizeWord).filter(Boolean);
                  return (
                    <div key={i}>
                      <Label className="text-xs">{g.category || `Group ${i + 1}`}</Label>
                      <select
                        value={rainbowHerring[i] || ""}
                        onChange={(e) => {
                          setRainbowHerring((prev) => {
                            const next = [...prev];
                            next[i] = e.target.value || null;
                            return next;
                          });
                        }}
                        onBlur={handleBlurSave}
                        className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm"
                      >
                        <option value="">— none —</option>
                        {groupWords.map((w) => (
                          <option key={w} value={w}>{w}</option>
                        ))}
                      </select>
                    </div>
                  );
                })}
              </div>
              {rainbowHerring.every(w => w) && (
                <>
                  <div className="flex gap-2 flex-wrap">
                    <span className="text-xs text-muted-foreground">Selected:</span>
                    {rainbowHerring.map((w, i) => (
                      <span key={i} className="rainbow-tile text-white text-xs font-semibold px-2 py-0.5 rounded">{w}</span>
                    ))}
                  </div>

                  {/* Rainbow Word Order Editor */}
                  <div className="space-y-2 pt-2 border-t border-border/50">
                    <div className="flex items-center justify-between">
                      <h4 className="text-xs font-semibold">Display Order</h4>
                      <button
                        onClick={() => setRainbowWordOrder(rainbowHerring.filter(Boolean) as string[])}
                        className="text-xs text-muted-foreground hover:text-foreground transition-colors"
                      >
                        Reset to default
                      </button>
                    </div>
                    <p className="text-xs text-muted-foreground">
                      Tap to select, then tap another to swap.
                    </p>
                    <div className="grid grid-cols-4 gap-2">
                      {rainbowWordOrder.map((word, vIdx) => {
                        const isSelected = selectedRainbowIdx === vIdx;
                        return (
                          <div
                            key={word}
                            onClick={() => handleRainbowTap(vIdx)}
                            className={`rainbow-tile text-white rounded-lg px-2 py-2 text-xs font-semibold uppercase tracking-wide text-center
                              transition-all duration-100 select-none cursor-pointer active:scale-95
                              ${isSelected ? "ring-2 ring-white scale-105 shadow-lg" : ""}
                            `}
                          >
                            {word}
                          </div>
                        );
                      })}
                    </div>
                  </div>
                </>
              )}
            </div>
          )}

          <div className="flex items-center gap-6 flex-wrap">
            <label className="flex items-center gap-2 cursor-pointer">
              <input
                type="checkbox"
                checked={isPublished}
                onChange={(e) => {
                  setIsPublished(e.target.checked);
                  if (!editingId) {
                    saveDraft({ ...getCurrentDraft(), isPublished: e.target.checked });
                  }
                }}
                className="rounded border-border"
              />
              <span className="text-sm font-medium">Publish immediately</span>
            </label>
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

          <div className="flex gap-3">
            <Button onClick={handleSave} disabled={saving}>
              <Save className="w-4 h-4 mr-1" /> {saving ? "Saving…" : editingId ? "Update Puzzle" : "Create Puzzle"}
            </Button>
            {editingId && (
              <Button variant="outline" onClick={resetForm}>Cancel Edit</Button>
            )}
          </div>
        </section>

        <ArchiveAccessManager />

        <CustomEmojiManager />

        <FeedbackList />

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
