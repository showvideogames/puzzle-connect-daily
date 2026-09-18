import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { FlaskConical, ChevronRight } from "lucide-react";
import { GameHeader } from "@/components/GameHeader";
import { SiteFooter } from "@/components/SiteFooter";
import { SEO } from "@/components/SEO";
import { PuzzleModeBadge } from "@/components/PuzzleModeBadge";
import { getBetaPuzzles } from "@/lib/puzzles";
import { Puzzle } from "@/lib/types";
import { supabase } from "@/integrations/supabase/client";
import type { User } from "@supabase/supabase-js";

function formatDate(dateStr: string): string {
  const [y, m, d] = dateStr.split("-").map(Number);
  return new Date(y, m - 1, d).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}

export default function BetaLibrary() {
  const navigate = useNavigate();
  const [user, setUser] = useState<User | null>(null);
  const [puzzles, setPuzzles] = useState<Puzzle[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session } }) => setUser(session?.user ?? null));
  }, []);

  useEffect(() => {
    getBetaPuzzles()
      .then(setPuzzles)
      .finally(() => setLoading(false));
  }, []);

  return (
    <div className="min-h-screen flex flex-col items-center pt-2 pb-12">
      <SEO
        title="Beta Playtesting — Rainbow Categories"
        description="An unlisted playtesting area for upcoming Rainbow Categories puzzles."
        path="/beta"
        noIndex
      />

      <GameHeader
        onStatsClick={() => {}}
        onHowToPlayClick={() => {}}
        onSettingsClick={() => {}}
        showHint={false}
        user={user}
        onSignOut={() => supabase.auth.signOut()}
        simplifiedIcons
        wideHeader
      />
      <div className="w-full max-w-[840px] border-b border-border mb-3" />

      <div className="w-full max-w-[840px] px-4 mb-6 text-center">
        <div className="inline-flex items-center gap-2 mb-2">
          <FlaskConical className="w-6 h-6 text-primary" />
          <h1 className="font-tile font-extrabold tracking-tight text-foreground text-3xl sm:text-4xl">
            Beta Playtesting
          </h1>
        </div>
        <p className="text-sm sm:text-base text-muted-foreground max-w-md mx-auto">
          This is an unlisted playtesting area. Puzzles here are still in progress —
          play them, tell us what worked, and results here never touch your
          official stats or streak.
        </p>
      </div>

      <div className="w-full max-w-[840px] px-4">
        {loading ? (
          <p className="text-center text-muted-foreground animate-pulse">Loading playtests…</p>
        ) : puzzles.length === 0 ? (
          <div className="text-center text-muted-foreground py-12">
            <p className="text-base font-medium">No Beta puzzles right now.</p>
            <p className="text-sm mt-1">Check back soon!</p>
          </div>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            {puzzles.map((p) => (
              <button
                key={p.id}
                onClick={() => navigate(`/beta/${p.id}`)}
                className="text-left rounded-xl border border-border bg-card p-4 flex flex-col gap-2
                  hover:border-primary/50 hover:shadow-md transition-all duration-150 active:scale-[0.99]"
              >
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <p className="font-tile font-bold text-lg text-foreground truncate">
                      {p.title?.trim() || formatDate(p.date)}
                    </p>
                    <p className="text-xs text-muted-foreground">by {p.designerName}</p>
                  </div>
                  <PuzzleModeBadge isRainbow={!!p.rainbowHerring} />
                </div>
                <div className="flex items-center justify-between mt-1">
                  <span className="text-xs text-muted-foreground">{formatDate(p.date)}</span>
                  <span className="inline-flex items-center gap-1 text-sm font-semibold text-primary">
                    Playtest <ChevronRight className="w-4 h-4" />
                  </span>
                </div>
              </button>
            ))}
          </div>
        )}
      </div>

      <SiteFooter />
    </div>
  );
}
