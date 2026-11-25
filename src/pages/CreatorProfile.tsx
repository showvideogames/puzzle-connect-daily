import { useEffect, useState } from "react";
import { Link, useParams, useSearchParams } from "react-router-dom";
import { GameHeader } from "@/components/GameHeader";
import { SiteFooter } from "@/components/SiteFooter";
import { SEO } from "@/components/SEO";
import { CommunityPuzzleCard } from "@/components/CommunityPuzzleCard";
import { getCreatorCommunity, getCreatorProfile, type CreatorCommunity, type CreatorProfile, type CreatorSort } from "@/lib/customPuzzles";
import { communityPuzzlesOn } from "@/lib/communityFlag";
import { CreatorAvatar } from "@/components/community/CreatorAvatar";
import { FollowButton } from "@/components/community/FollowButton";
import { useCommunitySaves } from "@/hooks/useCommunitySaves";
import { supabase } from "@/integrations/supabase/client";
import { signOutOfRainbow } from "@/lib/platformSignIn";
import type { User } from "@supabase/supabase-js";

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
  /** Community preview: the page above already shows the name, so the view drops its own heading. */
  hideHeading?: boolean;
}

/** The creator page body, separate from data loading so it can be rendered from fixtures. */
export function CreatorProfileView({ profile, loading, notFound, sort, onSort, hideHeading = false }: CreatorProfileViewProps) {
  // Embedded under the Community header (hideHeading), it is part of that page's <main>.
  const Wrapper = hideHeading ? "div" : "main";
  return (
    <Wrapper className={hideHeading ? "w-full" : "w-full max-w-[840px] px-4 flex-1"}>
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
            {!hideHeading && (
              <>
                <h1 className="font-tile font-bold tracking-tight text-foreground text-3xl break-words">
                  {profile.displayName}
                </h1>
                <p className="text-sm text-muted-foreground mt-1">Puzzle creator</p>
              </>
            )}

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
    </Wrapper>
  );
}

const focusRing = "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background";
const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

/**
 * Community preview additions to the existing creator page: avatar, public
 * name, aggregate follower count, Follow, and an "In Community" view of only
 * their opted-in puzzles. The default view (no ?view=) is still the historical
 * page: every Public puzzle with totals and sorts.
 */
function CreatorCommunitySection({ slug, user, profile, loading, notFound, sort, onSort }: { slug: string; user: User | null | undefined } & Omit<CreatorProfileViewProps, "hideHeading">) {
  const [params] = useSearchParams();
  const view = params.get("view") === "community" ? "community" : "all";
  const [community, setCommunity] = useState<CreatorCommunity | null | undefined>(undefined);
  const saves = useCommunitySaves(user === undefined ? undefined : user?.id ?? null);
  const [counts, setCounts] = useState<Record<string, number>>({});

  useEffect(() => {
    if (user === undefined) return;
    let cancelled = false;
    getCreatorCommunity(slug).then((c) => { if (!cancelled) setCommunity(c); });
    return () => { cancelled = true; };
  }, [slug, user]);

  if (notFound || (!profile && !loading)) return <CreatorProfileView profile={profile} loading={loading} notFound={notFound} sort={sort} onSort={onSort} />;
  const name = community?.displayName ?? profile?.displayName ?? "";
  const showFollow = !!community && !community.isMe && (community.listedCount > 0 || community.followedByMe);

  return (
    <main className="w-full max-w-[840px] px-4 flex-1">
      {name && (
        <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex min-w-0 items-center gap-3">
            <CreatorAvatar name={name} slug={slug} size={64} />
            <div className="min-w-0">
              <h1 className="font-tile font-bold tracking-tight text-foreground text-3xl break-words">{name}</h1>
              <p className="text-sm text-muted-foreground tabular-nums" data-testid="creator-community-counts">
                Puzzle creator{community ? ` · ${plural(community.followerCount, "follower", "followers")}` : ""}
              </p>
            </div>
          </div>
          {showFollow && community && (
            <FollowButton slug={slug} name={name} following={community.followedByMe} signedIn={user === undefined ? undefined : !!user}
              onChange={(st) => setCommunity({ ...community, followedByMe: st.following, followerCount: st.followerCount })} />
          )}
        </div>
      )}

      <nav aria-label="Creator puzzles" className="mt-5">
        <ul className="inline-grid grid-cols-2 gap-1 rounded-2xl border border-border bg-secondary/60 p-1 dark:bg-card">
          {([["community", `In Community${community ? ` (${community.listedCount})` : ""}`], ["all", `All puzzles${profile ? ` (${profile.puzzleCount})` : ""}`]] as const).map(([v, label]) => (
            <li key={v}>
              <Link to={v === "community" ? `/creator/${slug}?view=community` : `/creator/${slug}`} replace aria-current={view === v ? "page" : undefined}
                className={`flex h-11 items-center justify-center whitespace-nowrap rounded-xl px-4 text-sm font-extrabold ${focusRing}
                  ${view === v ? "bg-card text-foreground shadow-sm dark:bg-muted" : "text-muted-foreground hover:text-foreground"}`}>
                {label}
              </Link>
            </li>
          ))}
        </ul>
      </nav>

      {view === "all" ? (
        <CreatorProfileView profile={profile} loading={loading} notFound={notFound} sort={sort} onSort={onSort} hideHeading />
      ) : community === undefined ? (
        <p className="text-center text-muted-foreground animate-pulse py-12">Loading…</p>
      ) : !community || community.puzzles.length === 0 ? (
        <div className="mt-8 text-center text-muted-foreground">
          <p className="text-base font-medium">No puzzles in Community right now.</p>
          {profile && profile.puzzleCount > 0 && <p className="text-sm mt-1">Their shared puzzles are under All puzzles.</p>}
        </div>
      ) : (
        <ul className="mt-4 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3" data-testid="creator-community-grid">
          {community.puzzles.map((p) => (
            <CommunityPuzzleCard
              key={p.shortCode}
              title={p.title}
              shortCode={p.shortCode}
              mode={p.mode}
              finishedPlays={p.finishedPlays}
              favoriteCount={counts[p.shortCode] ?? p.favoriteCount}
              community={{ bookmark: { saved: saves.saved.has(p.shortCode), onToggle: () => { void saves.toggle({ ...p, favoriteCount: counts[p.shortCode] ?? p.favoriteCount }).then((n) => { if (n !== null) setCounts((m) => ({ ...m, [p.shortCode]: n })); }); } } }}
            />
          ))}
        </ul>
      )}
      <div role="status" aria-live="polite" className="pointer-events-none fixed inset-x-0 bottom-4 z-40 flex justify-center px-4">
        {saves.note && <span className="rounded-full bg-primary px-4 py-2 text-sm font-bold text-primary-foreground shadow-lg">{saves.note}</span>}
      </div>
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
  const community = communityPuzzlesOn();
  const [user, setUser] = useState<User | null | undefined>(undefined);

  useEffect(() => {
    if (!community) return;
    supabase.auth.getSession().then(({ data: { session } }) => setUser(session?.user ?? null));
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_e, session) => setUser(session?.user ?? null));
    return () => subscription.unsubscribe();
  }, [community]);

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
      <GameHeader user={community ? user ?? null : null} onSignOut={community ? () => signOutOfRainbow() : () => {}} simplifiedIcons wideHeader />
      <div className="w-full max-w-[840px] border-b border-border mb-4" />

      {community && publicSlug ? (
        <CreatorCommunitySection slug={publicSlug} user={user} profile={profile} loading={loading} notFound={notFound} sort={sort} onSort={setSort} />
      ) : (
        <CreatorProfileView profile={profile} loading={loading} notFound={notFound} sort={sort} onSort={setSort} />
      )}
      <SiteFooter />
    </div>
  );
}
