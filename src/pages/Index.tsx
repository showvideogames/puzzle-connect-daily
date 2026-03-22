import { useState, useEffect } from "react";
import { GameHeader } from "@/components/GameHeader";
import { GameBoard } from "@/components/GameBoard";
import { StatsModal } from "@/components/StatsModal";
import { HowToPlayModal } from "@/components/HowToPlayModal";
import { DailyStatsModal } from "@/components/DailyStatsModal";
import { PlayerAuth } from "@/components/PlayerAuth";
import { getTodaysPuzzle } from "@/lib/puzzles";
import { Puzzle } from "@/lib/types";
import { supabase } from "@/integrations/supabase/client";
import type { User } from "@supabase/supabase-js";

export default function Index() {
  const [showStats, setShowStats] = useState(false);
  const [showHelp, setShowHelp] = useState(false);
  const [showDailyStats, setShowDailyStats] = useState(false);
  const [puzzle, setPuzzle] = useState<Puzzle | null>(null);
  const [loading, setLoading] = useState(true);
  const [user, setUser] = useState<User | null>(null);

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
    getTodaysPuzzle().then((p) => {
      setPuzzle(p);
      setLoading(false);
    });
  }, []);

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

      {loading ? (
        <div className="flex-1 flex items-center justify-center">
          <p className="text-muted-foreground animate-pulse">Loading puzzle…</p>
        </div>
      ) : puzzle ? (
        <GameBoard puzzle={puzzle} />
      ) : (
        <div className="flex-1 flex items-center justify-center text-center px-4">
          <div>
            <p className="text-lg font-medium">No puzzle available today.</p>
            <p className="text-sm text-muted-foreground mt-1">Check back soon!</p>
          </div>
        </div>
      )}

      <StatsModal open={showStats} onClose={() => setShowStats(false)} />
      <HowToPlayModal open={showHelp} onClose={() => setShowHelp(false)} />
      {puzzle && (
        <DailyStatsModal
          puzzleId={puzzle.id}
          open={showDailyStats}
          onClose={() => setShowDailyStats(false)}
        />
      )}
    </div>
  );
}
