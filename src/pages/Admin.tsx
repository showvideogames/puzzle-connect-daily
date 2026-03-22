import { useState, useEffect } from "react";
import { useAuth } from "@/hooks/useAuth";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Plus, Trash2, LogOut, Save, Eye, EyeOff, ArrowLeft, Pencil, BarChart3 } from "lucide-react";
import { Link } from "react-router-dom";
import { toast } from "sonner";

interface GroupForm {
  category: string;
  words: string;
  difficulty: 1 | 2 | 3 | 4;
}

const emptyGroup = (): GroupForm => ({ category: "", words: "", difficulty: 1 });

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
  const [groups, setGroups] = useState<GroupForm[]>([
    { ...emptyGroup(), difficulty: 1 },
    { ...emptyGroup(), difficulty: 2 },
    { ...emptyGroup(), difficulty: 3 },
    { ...emptyGroup(), difficulty: 4 },
  ]);
  const [isPublished, setIsPublished] = useState(false);
  const [saving, setSaving] = useState(false);
  const [wordOrder, setWordOrder] = useState<string[]>([]);
  const [swapFirst, setSwapFirst] = useState<number | null>(null);

  // Existing puzzles list
  const [puzzles, setPuzzles] = useState<any[]>([]);
  const [editingId, setEditingId] = useState<string | null>(null);

  useEffect(() => {
    if (isAdmin) loadPuzzles();
  }, [isAdmin]);

  async function loadPuzzles() {
    const { data } = await supabase
      .from("puzzles")
      .select("*, puzzle_groups(*)")
      .order("date", { ascending: false });
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

  // Compute all words from groups
  const allWords = groups.flatMap((g) =>
    g.words.split(",").map((w) => w.trim().toUpperCase()).filter(Boolean)
  );
  const hasAll16 = allWords.length === 16 && new Set(allWords).size === 16;

  function generateWordOrder() {
    setWordOrder([...allWords]);
    setSwapFirst(null);
  }

  function handleTileClick(idx: number) {
    if (swapFirst === null) {
      setSwapFirst(idx);
    } else {
      setWordOrder((prev) => {
        const next = [...prev];
        [next[swapFirst], next[idx]] = [next[idx], next[swapFirst]];
        return next;
      });
      setSwapFirst(null);
    }
  }

  async function handleSave() {
    if (!puzzleDate) {
      toast.error("Please set a date for the puzzle.");
      return;
    }
    for (let i = 0; i < 4; i++) {
      const g = groups[i];
      const words = g.words.split(",").map((w) => w.trim().toUpperCase()).filter(Boolean);
      if (!g.category || words.length !== 4) {
        toast.error(`Group ${i + 1}: needs a category and exactly 4 comma-separated words.`);
        return;
      }
    }

    setSaving(true);
    try {
      let puzzleId = editingId;

      if (editingId) {
        // Update existing
        const { error } = await supabase
          .from("puzzles")
          .update({ date: puzzleDate, title: puzzleTitle || null, is_published: isPublished, word_order: wordOrder.length === 16 ? wordOrder : null })
          .eq("id", editingId);
        if (error) throw error;

        // Delete old groups and re-insert
        await supabase.from("puzzle_groups").delete().eq("puzzle_id", editingId);
      } else {
        // Insert new
        const { data, error } = await supabase
          .from("puzzles")
          .insert({ date: puzzleDate, title: puzzleTitle || null, is_published: isPublished, created_by: user!.id, word_order: wordOrder.length === 16 ? wordOrder : null })
          .select("id")
          .single();
        if (error) throw error;
        puzzleId = data.id;
      }

      // Insert groups
      const groupRows = groups.map((g, i) => ({
        puzzle_id: puzzleId!,
        category: g.category,
        words: g.words.split(",").map((w) => w.trim().toUpperCase()).filter(Boolean),
        difficulty: g.difficulty,
        sort_order: i,
      }));
      const { error: gError } = await supabase.from("puzzle_groups").insert(groupRows);
      if (gError) throw gError;

      toast.success(editingId ? "Puzzle updated!" : "Puzzle created!");
      resetForm();
      loadPuzzles();
    } catch (err: any) {
      toast.error(err.message || "Failed to save puzzle.");
    }
    setSaving(false);
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
    setSwapFirst(null);
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
    setSwapFirst(null);
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

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="animate-pulse text-muted-foreground">Loading…</div>
      </div>
    );
  }

  // Login screen
  if (!user) {
    // Forgot password view
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
        {/* Puzzle Editor */}
        <section className="space-y-4">
          <h2 className="text-lg font-semibold">{editingId ? "Edit Puzzle" : "Create New Puzzle"}</h2>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <Label htmlFor="pdate">Date</Label>
              <Input id="pdate" type="date" value={puzzleDate} onChange={(e) => setPuzzleDate(e.target.value)} />
            </div>
            <div>
              <Label htmlFor="ptitle">Title (optional)</Label>
              <Input id="ptitle" value={puzzleTitle} onChange={(e) => setPuzzleTitle(e.target.value)} placeholder="e.g. Monday Mashup" />
            </div>
          </div>

          <div className="space-y-3">
            {groups.map((g, i) => (
              <div key={i} className={`rounded-lg p-4 space-y-2 ${difficultyColors[i]} bg-opacity-30`}>
                <div className="flex items-center justify-between">
                  <span className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                    Group {i + 1} — {difficultyLabels[i]}
                  </span>
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <Label className="text-xs">Category Name</Label>
                    <Input
                      value={g.category}
                      onChange={(e) => updateGroup(i, "category", e.target.value)}
                      placeholder="e.g. Coffee Drinks"
                    />
                  </div>
                  <div>
                    <Label className="text-xs">4 Words (comma-separated)</Label>
                    <Input
                      value={g.words}
                      onChange={(e) => updateGroup(i, "words", e.target.value)}
                      placeholder="LATTE, MOCHA, ESPRESSO, CORTADO"
                    />
                  </div>
                </div>
              </div>
            ))}
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
                  <p className="text-xs text-muted-foreground">Click two tiles to swap their positions. This is how the puzzle will appear to players before they shuffle.</p>
                  <div className="grid grid-cols-4 gap-2">
                    {wordOrder.map((word, idx) => {
                      const groupIdx = groups.findIndex((g) =>
                        g.words.split(",").map((w) => w.trim().toUpperCase()).includes(word)
                      );
                      const diffColors = [
                        "bg-[hsl(var(--group-1)/0.3)]",
                        "bg-[hsl(var(--group-2)/0.3)]",
                        "bg-[hsl(var(--group-3)/0.3)]",
                        "bg-[hsl(var(--group-4)/0.3)]",
                      ];
                      const isSwapSelected = swapFirst === idx;
                      return (
                        <button
                          key={idx}
                          type="button"
                          onClick={() => handleTileClick(idx)}
                          className={`rounded-lg px-2 py-3 text-xs font-semibold uppercase tracking-wide text-center transition-all duration-150 active:scale-95 cursor-pointer border-2 ${
                            isSwapSelected ? "border-primary ring-2 ring-primary/30" : "border-transparent"
                          } ${diffColors[groupIdx] || "bg-muted"}`}
                        >
                          {word}
                        </button>
                      );
                    })}
                  </div>
                </>
              )}
            </div>
          )}

          <div className="flex items-center gap-4">
            <label className="flex items-center gap-2 cursor-pointer">
              <input
                type="checkbox"
                checked={isPublished}
                onChange={(e) => setIsPublished(e.target.checked)}
                className="rounded border-border"
              />
              <span className="text-sm font-medium">Publish immediately</span>
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
        <section className="space-y-4">
          <h2 className="text-lg font-semibold">All Puzzles ({puzzles.length})</h2>
          {puzzles.length === 0 && (
            <p className="text-sm text-muted-foreground">No puzzles yet. Create your first one above!</p>
          )}
          <div className="space-y-2">
            {puzzles.map((p) => (
              <div
                key={p.id}
                className="flex items-center justify-between p-3 rounded-lg border border-border bg-card"
              >
                <div>
                  <span className="font-medium">{p.date}</span>
                  {p.title && <span className="text-muted-foreground ml-2">— {p.title}</span>}
                  <span className={`ml-3 text-xs font-medium px-2 py-0.5 rounded-full ${p.is_published ? "bg-green-100 text-green-700" : "bg-muted text-muted-foreground"}`}>
                    {p.is_published ? "Published" : "Draft"}
                  </span>
                </div>
                <div className="flex items-center gap-1">
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
            ))}
          </div>
        </section>
      </main>
    </div>
  );
}
