import { useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { GameHeader } from "@/components/GameHeader";
import { SiteFooter } from "@/components/SiteFooter";
import { SEO } from "@/components/SEO";
import { CommunityPuzzleCard } from "@/components/CommunityPuzzleCard";
import { getCreatorProfile, type CreatorProfile, type CreatorSort } from "@/lib/customPuzzles";

const SORTS: { value: CreatorSort; label: string }[] = [
  { value: "newest", label: "Newest" },
  { value: "plays", label: "Most Played" },
  { value: "favorites", label: "Most Favorited" },
];

interface CreatorProfileViewProps {
  profile: CreatorProfile | null;
  loading: boolean;
  notFound: boolean;
  sort: CreatorSort;
  onSort: (sort: CreatorSort) => void;
}

/** The creator page body, separate from data loading so it can be rendered from fixtures. */
export function CreatorProfileView({ profile, loading, notFound, sort, onSort }: CreatorProfileViewProps) {
  return (
    <main className="w-full max-w-[840px] px-4 flex-1">
        {loading && !profile ? (
          <p className="text-center text-muted-foreground animate-pulse py-12">Loading…</p>
        ) : notFound || !profile ? (
          <div className="text-center py-12">
            <p className="text-lg font-medium">Creator not found.</p>
            <Link to="/create" className="text-sm mt-3 inline-block underline underline-offset-2 text-muted-foreground">
              Create your own puzzle
            </Link>
          </div>
        ) : (
          <>
            <h1 className="font-tile font-extrabold tracking-tight text-foreground text-3xl break-words">
              {profile.displayName}
            </h1>
            <p className="text-sm text-muted-foreground mt-1">Puzzle creator</p>

            <dl className="grid grid-cols-3 gap-2 sm:gap-3 mt-4" data-testid="creator-totals">
              {[
                ["Puzzles", profile.puzzleCount],
                ["Plays", profile.totalPlays],
                ["Favorites", profile.totalFavorites],
              ].map(([label, value]) => (
                <div key={label as string} className="rounded-xl border border-border bg-card p-3 text-center min-w-0">
                  <dd className="text-2xl font-bold tabular-nums">{value}</dd>
                  <dt className="text-[11px] uppercase tracking-wide text-muted-foreground">{label}</dt>
                </div>
              ))}
            </dl>

            {profile.puzzles.length > 0 && (
              <div className="mt-5 flex flex-wrap gap-1.5" role="group" aria-label="Sort puzzles">
                {SORTS.map((s) => (
                  <button
                    key={s.value}
                    type="button"
                    aria-pressed={sort === s.value}
                    onClick={() => onSort(s.value)}
                    className={`h-8 px-3 rounded-full border text-xs sm:text-sm font-semibold transition-colors
                      focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring
                      ${sort === s.value
                        ? "bg-primary text-primary-foreground border-transparent"
                        : "bg-card border-border text-foreground hover:bg-secondary"}`}
                  >
                    {s.label}
                  </button>
                ))}
              </div>
            )}

            {profile.puzzles.length === 0 ? (
              <div className="mt-8 text-center text-muted-foreground">
                <p className="text-base font-medium">No public puzzles yet.</p>
                <p className="text-sm mt-1">When {profile.displayName} shares a public puzzle, it will show up here.</p>
              </div>
            ) : (
              <ul className={`mt-4 grid grid-cols-1 sm:grid-cols-2 gap-3 ${loading ? "opacity-60" : ""}`}>
                {profile.puzzles.map((p) => (
                  <CommunityPuzzleCard
                    key={p.shortCode}
                    title={p.title}
                    shortCode={p.shortCode}
                    mode={p.mode}
                    finishedPlays={p.finishedPlays}
                    favoriteCount={p.favoriteCount}
                  />
                ))}
              </ul>
            )}
          </>
        )}
    </main>
  );
}

/** Public creator page: display name, totals, and only Public, non-moderated puzzles (filtered in the database). */
export default function CreatorProfilePage() {
  const { publicSlug } = useParams<{ publicSlug: string }>();
  const [sort, setSort] = useState<CreatorSort>("newest");
  const [profile, setProfile] = useState<CreatorProfile | null>(null);
  const [loading, setLoading] = useState(true);
  const [notFound, setNotFound] = useState(false);

  useEffect(() => {
    if (!publicSlug) { setNotFound(true); setLoading(false); return; }
    let cancelled = false;
    setLoading(true);
    getCreatorProfile(publicSlug, sort).then((p) => {
      if (cancelled) return;
      if (!p) setNotFound(true);
      else { setProfile(p); setNotFound(false); }
      setLoading(false);
    });
    return () => { cancelled = true; };
  }, [publicSlug, sort]);

  return (
    <div className="min-h-screen flex flex-col items-center pt-2 pb-12">
      <SEO title={profile ? `${profile.displayName} — Rainbow Connect` : "Creator — Rainbow Connect"} description="Puzzles by a Rainbow Connect creator." path={`/creator/${publicSlug ?? ""}`} noIndex />
      <GameHeader user={null} onSignOut={() => {}} simplifiedIcons wideHeader />
      <div className="w-full max-w-[840px] border-b border-border mb-4" />

      <CreatorProfileView profile={profile} loading={loading} notFound={notFound} sort={sort} onSort={setSort} />
      <SiteFooter />
    </div>
  );
}
