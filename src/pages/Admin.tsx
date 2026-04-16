import { useState, useEffect, useCallback, useRef } from "react";
import { useAuth } from "@/hooks/useAuth";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Plus, Trash2, LogOut, Save, Eye, EyeOff, ArrowLeft, Pencil, BarChart3, RotateCcw, GripVertical } from "lucide-react";
import { Link } from "react-router-dom";
import { ArchiveAccessManager } from "@/components/ArchiveAccessManager";
import { toast } from "sonner";

interface GroupForm {
  category: string;
  words: string;
  difficulty: 1 | 2 | 3 | 4;
}

const DRAFT_KEY = "admin-puzzle-draft";

const emptyGroup = (): GroupForm => ({ category: "", words: "", difficulty: 1 });
const parseWords = (value: string) =>
  value
    .split(",")
    .map((w) => w.trim().toUpperCase())
    .filter(Boolean);

interface DraftData {
  puzzleDate: string;
  puzzleTitle: string;
  groups: GroupForm[];
  isPublished: boolean;
  wordOrder: string[];
  rainbowHerring: (string | null)[];
  rainbowCategoryName: string;
  isEmojiPuzzle: boolean;
  editingId: string | null;
}

function saveDraft(data: DraftData) {
  try {
    localStorage.setItem(DRAFT_KEY, JSON.stringify(data));
  } catch {}
}

function loadDraft(): DraftData | null {
  try {
    const raw = localStorage.getItem(DRAFT_KEY);
    if (!raw) return null;
    return JSON.parse(raw) as DraftData;
  } catch {
    return null;
  }
}

function clearDraft() {
  try {
    localStorage.removeItem(DRAFT_KEY);
  } catch {}
}

export default function Admin() {
  const { user, loading, isAdmin, signIn, signOut } = useAuth();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loginLoading, setLoginLoading] = useState(false);
  const [isSignUp, setIsSignUp] = useState(false);
  const [showForgotPassword, setShowForgotPassword] = useState(false);
  const [resetSent, setResetSent] = useState(false);

  // Puzzle form
  const [puzzleDate, setPuzzleDate] = useState("");
  const [puzzleTitle, setPuzzleTitle] = useState("");
  const [rainbowHerring, setRainbowHerring] = useState<(string | null)[]>([null, null, null, null]);
  const [rainbowCategoryName, setRainbowCategoryName] = useState("");
  const [isEmojiPuzzle, setIsEmojiPuzzle] = useState(false);
  const [groups, setGroups] = useState<GroupForm[]>([
    { ...emptyGroup(), difficulty: 1 },
    { ...emptyGroup(), difficulty: 2 },
    { ...emptyGroup(), difficulty: 3 },
    { ...emptyGroup(), difficulty: 4 },
  ]);
  const [isPublished, setIsPublished] = useState(false);
  const [saving, setSaving] = useState(false);
  const [wordOrder, setWordOrder] = useState<string[]>([]);
  const [draftRestored, setDraftRestored] = useState(false);
  const [dragGroupIdx, setDragGroupIdx] = useState<number | null>(null);
  const [dragOverGroupIdx, setDragOverGroupIdx] = useState<number | null>(null);
  const touchDragGroupIdx = useRef<number | null>(null);
  const [dragTileIdx, setDragTileIdx] = useState<number | null>(null);
  const [hoverIdx, setHoverIdx] = useState<number | null>(null);
  const touchDragTileIdx = useRef<number | null>(null);

  // Existing puzzles list
  const [puzzles, setPuzzles] = useState<any[]>([]);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [expandedStatsId, setExpandedStatsId] = useState<string | null>(null);
  const [puzzleStats, setPuzzleStats] = useState<Record<string, any>>({});

  // Restore draft on mount (only if not editing an existing puzzle)
  useEffect(() => {
    if (isAdmin) {
      void loadPuzzles();
      const draft = loadDraft();
      if (draft && !draft.editingId) {
        setPuzzleDate(draft.puzzleDate);
        setPuzzleTitle(draft.puzzleTitle);
        setGroups(draft.groups);
        setIsPublished(draft.isPublished);
        setWordOrder(draft.wordOrder);
        setRainbowHerring(draft.rainbowHerring);
        setRainbowCategoryName(draft.rainbowCategoryName ?? "");
        setIsEmojiPuzzle(draft.isEmojiPuzzle ?? false);
        setDraftRestored(true);
      }
    }
  }, [isAdmin]);

  // Build current draft data from state
  const getCurrentDraft = useCallback((): DraftData => ({
    puzzleDate,
    puzzleTitle,
    groups,
    isPublished,
    wordOrder,
    rainbowHerring,
    rainbowCategoryName,
    isEmojiPuzzle,
    editingId,
  }), [puzzleDate, puzzleTitle, groups, isPublished, wordOrder, rainbowHerring, rainbowCategoryName, isEmojiPuzzle, editingId]);

  // Called onBlur from any field — saves draft silently
  const handleBlurSave = useCallback(() => {
    // Only save drafts for new puzzles, not edits (edits are already in the DB)
    if (!editingId) {
      saveDraft(getCurrentDraft());
    }
  }, [editingId, getCurrentDraft]);

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

  async function handleLogin(e: React.FormEvent) {
    e.preventDefault();
    setLoginLoading(true);
    if (isSignUp) {
      const { error } = await supabase.auth.signUp({ email, password });
      if (error) toast.error(error.message);
      else toast.success("Account created! Ask an existing admin to grant you the admin role.");
    } else {
      const { error } = await signIn(email, password);
      if (error) toast.error(error.message);
    }
    setLoginLoading(false);
  }

  async function handleForgotPassword(e: React.FormEvent) {
    e.preventDefault();
    setLoginLoading(true);
    const { error } = await supabase.auth.resetPasswordForEmail(email, {
      redirectTo: `${window.location.origin}/reset-password`,
    });
    if (error) {
      toast.error(error.message);
    } else {
      setResetSent(true);
    }
    setLoginLoading(false);
  }

  function updateGroup(idx: number, field: keyof GroupForm, value: string | number) {
    setGroups((g) => g.map((gr, i) => (i === idx ? { ...gr, [field]: value } : gr)));
  }

  function swapGroups(a: number, b: number) {
    if (a === b) return;
    setGroups((prev) => {
      const next = [...prev];
      [next[a], next[b]] = [next[b], next[a]];
      return next;
    });
    setRainbowHerring((prev) => {
      const next = [...prev];
      [next[a], next[b]] = [next[b], next[a]];
      return next;
    });
  }

  function handleGroupDragStart(i: number) {
    setDragGroupIdx(i);
  }

  function handleGroupDragOver(e: React.DragEvent, i: number) {
    e.preventDefault();
    setDragOverGroupIdx(i);
  }

  function handleGroupDrop(i: number) {
    if (dragGroupIdx !== null) swapGroups(dragGroupIdx, i);
    setDragGroupIdx(null);
    setDragOverGroupIdx(null);
  }

  function handleGroupDragEnd() {
    setDragGroupIdx(null);
    setDragOverGroupIdx(null);
  }

  function handleGroupTouchStart(i: number) {
    touchDragGroupIdx.current = i;
  }

  function handleGroupTouchEnd(e: React.TouchEvent) {
    const touch = e.changedTouches[0];
    const el = document.elementFromPoint(touch.clientX, touch.clientY);
    const groupEl = el?.closest("[data-group-idx]");
    const targetIdx = groupEl ? parseInt(groupEl.getAttribute("data-group-idx")!, 10) : null;
    if (touchDragGroupIdx.current !== null && targetIdx !== null) {
      swapGroups(touchDragGroupIdx.current, targetIdx);
    }
    touchDragGroupIdx.current = null;
  }

  // Compute all words from groups
  const allWords = groups.flatMap((g) => parseWords(g.words));
  const hasAll16 = allWords.length === 16 && new Set(allWords).size === 16;

  function generateWordOrder() {
    setWordOrder([...allWords]);
  }

  // Derive the live preview order: dragged tile moves to hoverIdx, others shift around it
  function computeTilePreview(order: string[], from: number, to: number): string[] {
    if (from === to) return order;
    const next = [...order];
    const [moved] = next.splice(from, 1);
    next.splice(to, 0, moved);
    return next;
  }

  const tileDisplayOrder =
    dragTileIdx !== null && hoverIdx !== null
      ? computeTilePreview(wordOrder, dragTileIdx, hoverIdx)
      : wordOrder;

  const ghostWord = dragTileIdx !== null ? wordOrder[dragTileIdx] : null;

  function handleTileDragStart(vIdx: number) {
    setDragTileIdx(vIdx);
    setHoverIdx(vIdx);
  }

  function handleTileDragOver(e: React.DragEvent, vIdx: number) {
    e.preventDefault();
    setHoverIdx(vIdx);
  }

  function handleTileDrop() {
    if (dragTileIdx !== null && hoverIdx !== null) {
      setWordOrder(computeTilePreview(wordOrder, dragTileIdx, hoverIdx));
    }
    setDragTileIdx(null);
    setHoverIdx(null);
  }

  function handleTileDragEnd() {
    setDragTileIdx(null);
    setHoverIdx(null);
  }

  function handleTileTouchStart(vIdx: number) {
    touchDragTileIdx.current = vIdx;
  }

  function handleTileTouchEnd(e: React.TouchEvent) {
    const touch = e.changedTouches[0];
    const el = document.elementFromPoint(touch.clientX, touch.clientY);
    const tileEl = el?.closest("[data-tile-idx]");
    const targetIdx = tileEl ? parseInt(tileEl.getAttribute("data-tile-idx")!, 10) : null;
    if (touchDragTileIdx.current !== null && targetIdx !== null) {
      setWordOrder(computeTilePreview(wordOrder, touchDragTileIdx.current, targetIdx));
    }
    touchDragTileIdx.current = null;
    setHoverIdx(null);
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
      const rainbowArr = rainbowHerring.every(Boolean) ? (rainbowHerring as string[]) : null;

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
            is_emoji_puzzle: isEmojiPuzzle,
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
            is_emoji_puzzle: isEmojiPuzzle,
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
    setIsEmojiPuzzle(false);
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
      }))
    );
    setWordOrder(p.word_order || []);
    if (p.rainbow_herring && p.rainbow_herring.length === 4) {
      setRainbowHerring(p.rainbow_herring);
    } else {
      setRainbowHerring([null, null, null, null]);
    }
    setRainbowCategoryName(p.rainbow_category_name || "");
    setIsEmojiPuzzle(p.is_emoji_puzzle ?? false);
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

  // Login screen
  if (!user) {
    if (showForgotPassword) {
      return (
        <div className="min-h-screen flex items-center justify-center px-4">
          <div className="w-full max-w-sm space-y-6">
            <div>
              <button onClick={() => { setShowForgotPassword(false); setResetSent(false); }} className="text-sm text-muted-foreground hover:text-foreground transition-colors inline-flex items-center gap-1 mb-6">
                <ArrowLeft className="w-4 h-4" /> Back to login
              </button>
              <h1 className="text-2xl font-bold tracking-tight">Reset Password</h1>
              <p className="text-sm text-muted-foreground mt-1">Enter your email and we'll send you a reset link.</p>
            </div>
            {resetSent ? (
              <div className="rounded-lg border border-border bg-card p-4 text-center space-y-2">
                <p className="font-medium">Check your email</p>
                <p className="text-sm text-muted-foreground">We sent a password reset link to <strong>{email}</strong>.</p>
              </div>
            ) : (
              <form onSubmit={handleForgotPassword} className="space-y-4">
                <div>
                  <Label htmlFor="reset-email">Email</Label>
                  <Input id="reset-email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} required />
                </div>
                <Button type="submit" className="w-full" disabled={loginLoading}>
                  {loginLoading ? "Sending…" : "Send Reset Link"}
                </Button>
              </form>
            )}
          </div>
        </div>
      );
    }

    return (
      <div className="min-h-screen flex items-center justify-center px-4">
        <div className="w-full max-w-sm space-y-6">
          <div>
            <Link to="/" className="text-sm text-muted-foreground hover:text-foreground transition-colors inline-flex items-center gap-1 mb-6">
              <ArrowLeft className="w-4 h-4" /> Back to game
            </Link>
            <h1 className="text-2xl font-bold tracking-tight">{isSignUp ? "Create Admin Account" : "Admin Login"}</h1>
            <p className="text-sm text-muted-foreground mt-1">{isSignUp ? "Sign up, then ask an admin to grant you access." : "Sign in to manage puzzles."}</p>
          </div>
          <form onSubmit={handleLogin} className="space-y-4">
            <div>
              <Label htmlFor="email">Email</Label>
              <Input id="email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} required />
            </div>
            <div>
              <Label htmlFor="password">Password</Label>
              <Input id="password" type="password" value={password} onChange={(e) => setPassword(e.target.value)} required />
            </div>
            <Button type="submit" className="w-full" disabled={loginLoading}>
              {loginLoading ? (isSignUp ? "Creating account…" : "Signing in…") : (isSignUp ? "Sign Up" : "Sign In")}
            </Button>
            {!isSignUp && (
              <button type="button" onClick={() => setShowForgotPassword(true)} className="text-sm text-muted-foreground hover:text-foreground transition-colors w-full text-center">
                Forgot your password?
              </button>
            )}
            <button type="button" onClick={() => setIsSignUp(!isSignUp)} className="text-sm text-muted-foreground hover:text-foreground transition-colors w-full text-center">
              {isSignUp ? "Already have an account? Sign in" : "Need an account? Sign up"}
            </button>
          </form>
        </div>
      </div>
    );
  }

  if (!isAdmin) {
    return (
      <div className="min-h-screen flex items-center justify-center px-4">
        <div className="text-center space-y-4">
          <p className="text-lg font-medium">You don't have admin access.</p>
          <p className="text-sm text-muted-foreground">Contact the site owner to get access.</p>
          <Button variant="outline" onClick={() => signOut()}>
            <LogOut className="w-4 h-4 mr-2" /> Sign Out
          </Button>
        </div>
      </div>
    );
  }

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
        {/* Draft restored notice */}
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

        {/* Puzzle Editor */}
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

          <div className="space-y-3">
            {groups.map((g, i) => {
              const isDragging = dragGroupIdx === i;
              const isDropTarget = dragOverGroupIdx === i && dragGroupIdx !== i;
              return (
                <div
                  key={i}
                  data-group-idx={i}
                  draggable
                  onDragStart={() => handleGroupDragStart(i)}
                  onDragOver={(e) => handleGroupDragOver(e, i)}
                  onDrop={() => handleGroupDrop(i)}
                  onDragEnd={handleGroupDragEnd}
                  onTouchStart={() => handleGroupTouchStart(i)}
                  onTouchEnd={handleGroupTouchEnd}
                  className={`rounded-lg p-4 space-y-2 ${difficultyColors[i]} bg-opacity-30 transition-all duration-150
                    ${isDragging ? "opacity-40" : ""}
                    ${isDropTarget ? "ring-2 ring-primary ring-offset-1 scale-[1.01]" : ""}
                  `}
                >
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                      Group {i + 1} — {difficultyLabels[i]}
                    </span>
                    <GripVertical className="w-4 h-4 text-muted-foreground/50 cursor-grab active:cursor-grabbing" />
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
                  <p className="text-xs text-muted-foreground">Drag tiles to reorder them. This is how the puzzle will appear to players before they shuffle.</p>
                  <div className="grid grid-cols-4 gap-2">
                    {tileDisplayOrder.map((word, vIdx) => {
                      const groupIdx = groups.findIndex((g) =>
                        g.words.split(",").map((w) => w.trim().toUpperCase()).includes(word)
                      );
                      const diffColors = [
                        "bg-[hsl(var(--group-1)/0.3)]",
                        "bg-[hsl(var(--group-2)/0.3)]",
                        "bg-[hsl(var(--group-3)/0.3)]",
                        "bg-[hsl(var(--group-4)/0.3)]",
                      ];
                      const isGhost = word === ghostWord;
                      return (
                        <div
                          key={word}
                          data-tile-idx={vIdx}
                          draggable
                          onDragStart={() => handleTileDragStart(vIdx)}
                          onDragOver={(e) => handleTileDragOver(e, vIdx)}
                          onDrop={handleTileDrop}
                          onDragEnd={handleTileDragEnd}
                          onTouchStart={() => handleTileTouchStart(vIdx)}
                          onTouchEnd={handleTileTouchEnd}
                          className={`rounded-lg px-2 py-3 text-xs font-semibold uppercase tracking-wide text-center
                            transition-all duration-100 cursor-grab active:cursor-grabbing select-none
                            ${diffColors[groupIdx] || "bg-muted"}
                            ${isGhost ? "opacity-30 ring-2 ring-primary ring-dashed" : ""}
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
              <div className="grid grid-cols-2 gap-3">
                {groups.map((g, i) => {
                  const groupWords = g.words.split(",").map((w) => w.trim().toUpperCase()).filter(Boolean);
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
                <div className="flex gap-2 flex-wrap">
                  <span className="text-xs text-muted-foreground">Selected:</span>
                  {rainbowHerring.map((w, i) => (
                    <span key={i} className="rainbow-tile text-white text-xs font-semibold px-2 py-0.5 rounded">{w}</span>
                  ))}
                </div>
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
                  // Save draft immediately on checkbox change since there's no blur event
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

        {/* Existing puzzles list */}
        <ArchiveAccessManager />

        {/* All Puzzles */}
        <section className="space-y-4">
          <h2 className="text-lg font-semibold">All Puzzles ({puzzles.length})</h2>
          {puzzles.length === 0 && (
            <p className="text-sm text-muted-foreground">No puzzles yet. Create your first one above!</p>
          )}
          <div className="space-y-2">
            {puzzles.map((p) => (
              <div
                key={p.id}
                className="rounded-lg border border-border bg-card overflow-hidden"
              >
                <div className="flex items-center justify-between p-3">
                  <div>
                    <span className="font-medium">{p.date}</span>
                    {p.title && <span className="text-muted-foreground ml-2">— {p.title}</span>}
                    <span className={`ml-3 text-xs font-medium px-2 py-0.5 rounded-full ${p.is_published ? "bg-green-100 text-green-700" : "bg-muted text-muted-foreground"}`}>
                      {p.is_published ? "Published" : "Draft"}
                    </span>
                  </div>
                  <div className="flex items-center gap-1">
                    <Button variant="ghost" size="icon" onClick={() => toggleStats(p.id)} title="View stats">
                      <BarChart3 className={`w-4 h-4 ${expandedStatsId === p.id ? "text-primary" : ""}`} />
                    </Button>
                    <Button variant="ghost" size="icon" onClick={() => togglePublish(p.id, p.is_published)} title={p.is_published ? "Unpublish" : "Publish"}>
                      {p.is_published ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                    </Button>
                    <Button variant="ghost" size="icon" onClick={() => editPuzzle(p)}>
                      <Pencil className="w-4 h-4" />
                    </Button>
                    <Button variant="ghost" size="icon" onClick={() => deletePuzzle(p.id)}>
                      <Trash2 className="w-4 h-4 text-destructive" />
                    </Button>
                  </div>
                </div>
                {expandedStatsId === p.id && (
                  <div className="border-t border-border px-4 py-3 bg-secondary/30">
                    {!puzzleStats[p.id] ? (
                      <p className="text-sm text-muted-foreground animate-pulse">Loading stats…</p>
                    ) : puzzleStats[p.id].total_players === 0 ? (
                      <p className="text-sm text-muted-foreground">No completions yet.</p>
                    ) : (
                      <div className="space-y-3">
                        <div className="flex gap-6 text-sm">
                          <div><span className="font-semibold">{puzzleStats[p.id].total_players}</span> <span className="text-muted-foreground">players</span></div>
                          <div><span className="font-semibold">{puzzleStats[p.id].wins}</span> <span className="text-muted-foreground">wins</span></div>
                          <div><span className="font-semibold">{puzzleStats[p.id].losses}</span> <span className="text-muted-foreground">losses</span></div>
                          <div><span className="font-semibold">{puzzleStats[p.id].total_players > 0 ? Math.round((puzzleStats[p.id].wins / puzzleStats[p.id].total_players) * 100) : 0}%</span> <span className="text-muted-foreground">win rate</span></div>
                        </div>
                        <div>
                          <p className="text-xs font-semibold text-muted-foreground mb-1">Mistakes when winning:</p>
                          <div className="flex gap-4 text-xs">
                            {[0, 1, 2, 3].map((m) => (
                              <div key={m} className="flex items-center gap-1">
                                <span className="text-muted-foreground">{m}:</span>
                                <span className="font-semibold">{puzzleStats[p.id].guess_distribution?.[String(m)] || 0}</span>
                              </div>
                            ))}
                          </div>
                        </div>
                      </div>
                    )}
                  </div>
                )}
              </div>
            ))}
          </div>
        </section>
      </main>
    </div>
  );
}
