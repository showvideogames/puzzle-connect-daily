import { useState, useEffect } from "react";
import { supabase } from "@/integrations/supabase/client";
import { GameBoard } from "@/components/GameBoard";
import { GameHeader } from "@/components/GameHeader";
import { StatsModal } from "@/components/StatsModal";
import { HowToPlayModal } from "@/components/HowToPlayModal";
import { DailyStatsModal } from "@/components/DailyStatsModal";
import { getPuzzleById } from "@/lib/puzzles";
import { Puzzle } from "@/lib/types";
import { ArrowLeft, Lock, Calendar } from "lucide-react";
import { Link } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { PlayerAuth } from "@/components/PlayerAuth";
import type { User } from "@supabase/supabase-js";

interface ArchivePuzzle {
  id: string;
  date: string;
  title: string | null;
}

export default function Archive() {
  const [user, setUser] = useState<User | null>(null);
  const [hasAccess, setHasAccess] = useState<boolean | null>(null);
  const [puzzles, setPuzzles] = useState<ArchivePuzzle[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedPuzzle, setSelectedPuzzle] = useState<Puzzle | null>(null);
  const [loadingPuzzle, setLoadingPuzzle] = useState(false);

  const [showStats, setShowStats] = useState(false);
  const [showHelp, setShowHelp] = useState(false);
  const [showDailyStats, setShowDailyStats] = useState(false);

  useEffect(() => {
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      setUser(session?.user ?? null);
    });
    supabase.auth.getSession().then(({ data: { session } }) => {
      setUser(session?.user ?? null);
    });
    return () => subscription.unsubscribe();
  }, []);

  useEffect(() => {
    if (!user) {
      setHasAccess(null);
      setPuzzles([]);
      setLoading(false);
      return;
    }

    async function checkAccess() {
      setLoading(true);
      const { data } = await supabase.rpc("has_archive_access", { _user_id: user!.id });
      setHasAccess(!!data);

      if (data) {
        const { data: archiveData } = await supabase.rpc("get_archive_puzzles");
        setPuzzles((archiveData as ArchivePuzzle[]) || []);
      }
      setLoading(false);
    }

    checkAccess();
  }, [user]);

  async function loadPuzzle(id: string) {
    setLoadingPuzzle(true);
    const p = await getPuzzleById(id);
    setSelectedPuzzle(p);
    setLoadingPuzzle(false);
  }

  // Not logged in
  if (!user) {
    return (
      <div className="min-h-screen flex flex-col items-center pt-2 pb-12">
        <GameHeader
          onStatsClick={() => setShowStats(true)}
          onHowToPlayClick={() => setShowHelp(true)}
          onDailyStatsClick={() => setShowDailyStats(true)}
          user={user}
          onSignOut={() => supabase.auth.signOut()}
        />
        <div className="w-full max-w-lg border-b border-border mb-4" />
        <div className="flex-1 flex items-center justify-center px-4">
          <div className="text-center space-y-4 max-w-sm">
            <Lock className="w-10 h-10 mx-auto text-muted-foreground" />
            <h2 className="text-xl font-bold">Puzzle Archive</h2>
            <p className="text-sm text-muted-foreground">Sign in to access the archive of past puzzles.</p>
            <PlayerAuth user={null} onSignOut={() => {}} />
          </div>
        </div>
        <StatsModal open={showStats} onClose={() => setShowStats(false)} />
        <HowToPlayModal open={showHelp} onClose={() => setShowHelp(false)} />
      </div>
    );
  }

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <p className="text-muted-foreground animate-pulse">Loading…</p>
      </div>
    );
  }

  // No access
  if (!hasAccess) {
    return (
      <div className="min-h-screen flex flex-col items-center pt-2 pb-12">
        <GameHeader
          onStatsClick={() => setShowStats(true)}
          onHowToPlayClick={() => setShowHelp(true)}
          onDailyStatsClick={() => setShowDailyStats(true)}
          user={user}
          onSignOut={() => supabase.auth.signOut()}
        />
        <div className="w-full max-w-lg border-b border-border mb-4" />
        <div className="flex-1 flex items-center justify-center px-4">
          <div className="text-center space-y-4 max-w-sm">
            <Lock className="w-10 h-10 mx-auto text-muted-foreground" />
            <h2 className="text-xl font-bold">Archive Access Required</h2>
            <p className="text-sm text-muted-foreground">
              The puzzle archive is a premium feature. Contact the site owner to get access, or subscribe to unlock it.
            </p>
            <Link to="/">
              <Button variant="outline" className="mt-2">
                <ArrowLeft className="w-4 h-4 mr-2" /> Back to today's puzzle
              </Button>
            </Link>
          </div>
        </div>
        <StatsModal open={showStats} onClose={() => setShowStats(false)} />
        <HowToPlayModal open={showHelp} onClose={() => setShowHelp(false)} />
      </div>
    );
  }

  // Playing a specific puzzle
  if (selectedPuzzle) {
    return (
      <div className="min-h-screen flex flex-col items-center pt-2 pb-12">
        <GameHeader
          onStatsClick={() => setShowStats(true)}
          onHowToPlayClick={() => setShowHelp(true)}
          onDailyStatsClick={() => setShowDailyStats(true)}
          user={user}
          onSignOut={() => supabase.auth.signOut()}
        />
        <div className="w-full max-w-lg border-b border-border mb-4" />
        <div className="w-full max-w-lg px-2 mb-3">
          <button
            onClick={() => setSelectedPuzzle(null)}
            className="text-sm text-muted-foreground hover:text-foreground transition-colors inline-flex items-center gap-1"
          >
            <ArrowLeft className="w-4 h-4" /> Back to archive
          </button>
          <p className="text-xs text-muted-foreground mt-1">
            {selectedPuzzle.date}
          </p>
        </div>
        <GameBoard puzzle={selectedPuzzle} />
        <StatsModal open={showStats} onClose={() => setShowStats(false)} />
        <HowToPlayModal open={showHelp} onClose={() => setShowHelp(false)} />
        <DailyStatsModal puzzleId={selectedPuzzle.id} open={showDailyStats} onClose={() => setShowDailyStats(false)} />
      </div>
    );
  }

  // Puzzle list
  const today = new Date().toISOString().split("T")[0];
  const pastPuzzles = puzzles.filter((p) => p.date < today);

  return (
    <div className="min-h-screen flex flex-col items-center pt-2 pb-12">
      <GameHeader
        onStatsClick={() => setShowStats(true)}
        onHowToPlayClick={() => setShowHelp(true)}
        onDailyStatsClick={() => setShowDailyStats(true)}
        user={user}
        onSignOut={() => supabase.auth.signOut()}
      />
      <div className="w-full max-w-lg border-b border-border mb-4" />

      <div className="w-full max-w-lg px-4 space-y-4">
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-bold">Puzzle Archive</h2>
          <Link to="/" className="text-sm text-muted-foreground hover:text-foreground transition-colors inline-flex items-center gap-1">
            <ArrowLeft className="w-4 h-4" /> Today's puzzle
          </Link>
        </div>

        {pastPuzzles.length === 0 ? (
          <p className="text-sm text-muted-foreground py-8 text-center">No archived puzzles yet.</p>
        ) : (
          <div className="space-y-1.5">
            {pastPuzzles.map((p) => (
              <button
                key={p.id}
                onClick={() => loadPuzzle(p.id)}
                disabled={loadingPuzzle}
                className="w-full text-left rounded-lg border border-border bg-card px-4 py-3 hover:bg-secondary/50 transition-colors duration-150 active:scale-[0.98] flex items-center gap-3"
              >
                <Calendar className="w-4 h-4 text-muted-foreground shrink-0" />
                <div className="min-w-0">
                  <span className="font-medium text-sm">{p.date}</span>
                  {p.title && <span className="text-muted-foreground text-sm ml-2">— {p.title}</span>}
                </div>
              </button>
            ))}
          </div>
        )}
      </div>

      <StatsModal open={showStats} onClose={() => setShowStats(false)} />
      <HowToPlayModal open={showHelp} onClose={() => setShowHelp(false)} />
    </div>
  );
}
