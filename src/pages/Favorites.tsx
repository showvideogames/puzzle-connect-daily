import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { GameHeader } from "@/components/GameHeader";
import { SiteFooter } from "@/components/SiteFooter";
import { SEO } from "@/components/SEO";
import { CommunityPuzzleCard } from "@/components/CommunityPuzzleCard";
import { supabase } from "@/integrations/supabase/client";
import { getMyFavorites, type FavoritePuzzleCard } from "@/lib/customPuzzles";
import type { User } from "@supabase/supabase-js";

/** The signed-in player's favorited custom puzzles. Guest favorites stay on their device and are not listed here. */
export default function Favorites() {
  const [user, setUser] = useState<User | null | undefined>(undefined);
  const [items, setItems] = useState<FavoritePuzzleCard[] | null>(null);

  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session } }) => setUser(session?.user ?? null));
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_e, session) => setUser(session?.user ?? null));
    return () => subscription.unsubscribe();
  }, []);

  useEffect(() => {
    if (!user) { setItems(null); return; }
    let cancelled = false;
    getMyFavorites().then((rows) => { if (!cancelled) setItems(rows); });
    return () => { cancelled = true; };
  }, [user?.id]);

  return (
    <div className="min-h-screen flex flex-col items-center pt-2 pb-12">
      <SEO title="Favorites — Rainbow Connect" description="Your favorite custom puzzles." path="/favorites" noIndex />
      <GameHeader user={user ?? null} onSignOut={() => supabase.auth.signOut()} simplifiedIcons wideHeader />
      <div className="w-full max-w-[840px] border-b border-border mb-4" />

      <main className="w-full max-w-[840px] px-4 flex-1">
        <h1 className="font-tile font-extrabold tracking-tight text-foreground text-3xl">Favorites</h1>

        {user === undefined ? (
          <p className="text-center text-muted-foreground animate-pulse py-12">Loading…</p>
        ) : !user ? (
          <div className="mt-6 text-muted-foreground text-sm space-y-2">
            <p>Sign in to see the puzzles you have favorited, on every device.</p>
            <p>Puzzles you favorite while signed out are saved on that device only.</p>
          </div>
        ) : items === null ? (
          <p className="text-center text-muted-foreground animate-pulse py-12">Loading…</p>
        ) : items.length === 0 ? (
          <div className="mt-8 text-center text-muted-foreground">
            <p className="text-base font-medium">No favorites yet.</p>
            <p className="text-sm mt-1">Tap ☆ Favorite on any custom puzzle to keep it here.</p>
            <Link to="/create" className="text-sm mt-3 inline-block underline underline-offset-2">
              Create a puzzle
            </Link>
          </div>
        ) : (
          <ul className="mt-4 grid grid-cols-1 sm:grid-cols-2 gap-3">
            {items.map((f) => (
              <CommunityPuzzleCard
                key={f.shortCode}
                title={f.title}
                shortCode={f.shortCode}
                mode={f.mode}
                designerName={f.creatorName}
                creatorSlug={f.creatorSlug}
                favoriteCount={f.favoriteCount}
              />
            ))}
          </ul>
        )}
      </main>
      <SiteFooter />
    </div>
  );
}
