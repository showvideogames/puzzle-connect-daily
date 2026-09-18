import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";

interface BetaPlaytestRow {
  id: string;
  puzzle_id: string;
  puzzle_version_id: string;
  status: string;
  won: boolean | null;
  hints_used: boolean;
  is_reset: boolean;
  started_at: string;
}

interface BetaFeedbackRow {
  id: string;
  puzzle_id: string;
  puzzle_version_id: string;
  tester_name: string | null;
  fun_rating: number;
  difficulty_rating: number;
  rainbow_fairness_rating: number | null;
  confusing_or_incorrect: string | null;
  additional_comments: string | null;
  would_play_again: boolean;
  created_at: string;
}

interface AdminPuzzleRow {
  id: string;
  date: string;
  title: string | null;
  is_beta?: boolean;
}

const avg = (nums: number[]) => (nums.length === 0 ? null : nums.reduce((a, b) => a + b, 0) / nums.length);

export function BetaPlaytestPanel({ puzzles }: { puzzles: AdminPuzzleRow[] }) {
  const [playtests, setPlaytests] = useState<BetaPlaytestRow[]>([]);
  const [feedback, setFeedback] = useState<BetaFeedbackRow[]>([]);
  const [versionNumbers, setVersionNumbers] = useState<Record<string, number>>({});
  const [loading, setLoading] = useState(true);
  const [expandedPuzzleId, setExpandedPuzzleId] = useState<string | null>(null);

  useEffect(() => {
    void (async () => {
      const [playtestsRes, feedbackRes, versionsRes] = await Promise.all([
        supabase.from("beta_playtests").select("*").order("started_at", { ascending: false }),
        supabase.from("beta_feedback").select("*").order("created_at", { ascending: false }),
        supabase.from("puzzle_versions").select("id, version_number"),
      ]);
      setPlaytests(((playtestsRes.data ?? []) as unknown) as BetaPlaytestRow[]);
      setFeedback(((feedbackRes.data ?? []) as unknown) as BetaFeedbackRow[]);
      const versionMap: Record<string, number> = {};
      for (const v of (versionsRes.data ?? []) as { id: string; version_number: number }[]) {
        versionMap[v.id] = v.version_number;
      }
      setVersionNumbers(versionMap);
      setLoading(false);
    })();
  }, []);

  // Every puzzle id that has EITHER a current Beta status OR any playtest/
  // feedback history — so a promoted puzzle's playtest data stays visible
  // for review rather than disappearing the moment it goes live.
  const puzzleIds = useMemo(() => {
    const ids = new Set<string>();
    for (const p of puzzles) if (p.is_beta) ids.add(p.id);
    for (const r of playtests) ids.add(r.puzzle_id);
    for (const r of feedback) ids.add(r.puzzle_id);
    return Array.from(ids);
  }, [puzzles, playtests, feedback]);

  const puzzleById = useMemo(() => {
    const map: Record<string, AdminPuzzleRow> = {};
    for (const p of puzzles) map[p.id] = p;
    return map;
  }, [puzzles]);

  if (loading) {
    return (
      <section className="space-y-4">
        <h2 className="text-lg font-semibold">Beta Playtesting</h2>
        <p className="text-sm text-muted-foreground">Loading…</p>
      </section>
    );
  }

  return (
    <section className="space-y-4">
      <h2 className="text-lg font-semibold">Beta Playtesting</h2>
      {puzzleIds.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          No Beta puzzles yet. Set a puzzle's status to Beta above to start collecting playtests.
        </p>
      ) : (
        <div className="space-y-2">
          {puzzleIds.map((puzzleId) => {
            const puzzle = puzzleById[puzzleId];
            const runs = playtests.filter((r) => r.puzzle_id === puzzleId);
            const notes = feedback.filter((r) => r.puzzle_id === puzzleId);
            const completions = runs.filter((r) => r.status === "completed");
            const wins = completions.filter((r) => r.won === true).length;
            const losses = completions.filter((r) => r.won === false).length;
            const resets = runs.filter((r) => r.is_reset).length;
            const funAvg = avg(notes.map((n) => n.fun_rating));
            const difficultyAvg = avg(notes.map((n) => n.difficulty_rating));
            const wouldPlayAgainPct =
              notes.length > 0
                ? Math.round((notes.filter((n) => n.would_play_again).length / notes.length) * 100)
                : null;
            const expanded = expandedPuzzleId === puzzleId;

            return (
              <div key={puzzleId} className="rounded-lg border border-border bg-card overflow-hidden">
                <button
                  onClick={() => setExpandedPuzzleId(expanded ? null : puzzleId)}
                  className="w-full flex items-center justify-between p-3 text-left hover:bg-secondary/40 transition-colors"
                >
                  <div>
                    <span className="font-medium">
                      {puzzle?.title || puzzle?.date || puzzleId.slice(0, 8)}
                    </span>
                    {puzzle && !puzzle.is_beta && (
                      <span className="ml-2 text-xs font-medium px-2 py-0.5 rounded-full bg-muted text-muted-foreground">
                        no longer Beta
                      </span>
                    )}
                  </div>
                  <div className="flex gap-4 text-xs text-muted-foreground">
                    <span>{runs.length} starts</span>
                    <span>{completions.length} completions</span>
                    <span>{notes.length} feedback</span>
                  </div>
                </button>

                {expanded && (
                  <div className="border-t border-border px-4 py-3 bg-secondary/30 space-y-4">
                    <div className="flex flex-wrap gap-x-6 gap-y-2 text-sm">
                      <div><span className="font-semibold">{runs.length}</span> <span className="text-muted-foreground">starts</span></div>
                      <div><span className="font-semibold">{completions.length}</span> <span className="text-muted-foreground">completions</span></div>
                      <div><span className="font-semibold">{wins}</span> <span className="text-muted-foreground">wins</span></div>
                      <div><span className="font-semibold">{losses}</span> <span className="text-muted-foreground">losses</span></div>
                      <div><span className="font-semibold">{resets}</span> <span className="text-muted-foreground">resets</span></div>
                      <div>
                        <span className="font-semibold">{funAvg !== null ? funAvg.toFixed(1) : "—"}</span>{" "}
                        <span className="text-muted-foreground">avg fun</span>
                      </div>
                      <div>
                        <span className="font-semibold">{difficultyAvg !== null ? difficultyAvg.toFixed(1) : "—"}</span>{" "}
                        <span className="text-muted-foreground">avg difficulty</span>
                      </div>
                      <div>
                        <span className="font-semibold">{wouldPlayAgainPct !== null ? `${wouldPlayAgainPct}%` : "—"}</span>{" "}
                        <span className="text-muted-foreground">would play again</span>
                      </div>
                    </div>

                    {notes.length === 0 ? (
                      <p className="text-sm text-muted-foreground">No written feedback yet.</p>
                    ) : (
                      <div className="space-y-2">
                        {notes.map((n) => (
                          <div key={n.id} className="rounded-md border border-border/60 bg-card p-3 space-y-1">
                            <div className="flex items-center justify-between gap-2 flex-wrap">
                              <span className="text-sm font-medium">{n.tester_name?.trim() || "Anonymous"}</span>
                              <span className="text-xs text-muted-foreground">
                                v{versionNumbers[n.puzzle_version_id] ?? "?"} · {new Date(n.created_at).toLocaleDateString("en-US", { month: "short", day: "numeric" })}
                              </span>
                            </div>
                            <div className="flex flex-wrap gap-3 text-xs text-muted-foreground">
                              <span>Fun {n.fun_rating}/5</span>
                              <span>Difficulty {n.difficulty_rating}/5</span>
                              {n.rainbow_fairness_rating !== null && <span>Rainbow fairness {n.rainbow_fairness_rating}/5</span>}
                              <span>{n.would_play_again ? "Would play again" : "Would not play again"}</span>
                            </div>
                            {n.confusing_or_incorrect && (
                              <p className="text-sm"><span className="font-medium">Confusing/incorrect:</span> {n.confusing_or_incorrect}</p>
                            )}
                            {n.additional_comments && (
                              <p className="text-sm"><span className="font-medium">Comments:</span> {n.additional_comments}</p>
                            )}
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </section>
  );
}
