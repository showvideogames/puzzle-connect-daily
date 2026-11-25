import { useEffect, useState, type ReactNode } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { Plus, Search, X } from "lucide-react";
import { GameHeader } from "@/components/GameHeader";
import { SiteFooter } from "@/components/SiteFooter";
import { SEO } from "@/components/SEO";
import { CommunityPuzzleCard, communityLink } from "@/components/CommunityPuzzleCard";
import { CommunityCreatorCard } from "@/components/community/CommunityCreatorCard";
import { CreatorAvatar } from "@/components/community/CreatorAvatar";
import { useCommunitySaves, type SavedCard } from "@/hooks/useCommunitySaves";
import { usePaged } from "@/hooks/usePaged";
import { supabase } from "@/integrations/supabase/client";
import { signOutOfRainbow } from "@/lib/platformSignIn";
import { loadSettings } from "@/lib/settings";
import {
  COMMUNITY_PAGE_SIZE,
  getFollowingFeed,
  listCommunityPuzzles,
  searchCommunityCreators,
  type CommunityCreator,
  type CommunityPuzzleListing,
  type CommunitySort,
} from "@/lib/customPuzzles";
import type { User } from "@supabase/supabase-js";

export type CommunityTab = "explore" | "following" | "favorites";
export type ExploreMode = "puzzles" | "creators";

const TABS: { value: CommunityTab; label: string }[] = [
  { value: "explore", label: "Explore" },
  { value: "following", label: "Following" },
  { value: "favorites", label: "Favorites" },
];
const SORTS: { value: CommunitySort; label: string }[] = [
  { value: "newest", label: "Newest" },
  { value: "plays", label: "Most Played" },
];
const MODES: { value: ExploreMode; label: string }[] = [
  { value: "puzzles", label: "Puzzles" },
  { value: "creators", label: "Creators" },
];

const focusRing = "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background";
const pillButton = `inline-flex h-11 items-center rounded-full border border-border bg-card px-5 text-sm font-bold text-foreground hover:bg-secondary disabled:opacity-60 ${focusRing}`;
const gridClass = "mt-4 grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3";

/**
 * Decorative branding only: a fixed 4×4 pattern in the Rainbow strip's four
 * tones. It is the same on every visit and never derived from any puzzle, so
 * it cannot hint at a category or an answer.
 */
const MOTIF = ["#eeb574", "#e9899e", "#8fc3ab", "#a28ad1"];
function CommunityMotif() {
  return (
    <span aria-hidden="true" className="grid max-[359px]:hidden shrink-0 grid-cols-4 gap-[3px] rounded-xl border border-border bg-card p-1.5 shadow-sm">
      {Array.from({ length: 16 }, (_, i) => (
        <span key={i} className="block h-[9px] w-[9px] rounded-[2px] sm:h-[11px] sm:w-[11px]" style={{ backgroundColor: MOTIF[(i + Math.floor(i / 4)) % 4], opacity: i % 3 === 0 ? 1 : 0.55 }} />
      ))}
    </span>
  );
}

function Notice({ title, children, role }: { title: string; children?: ReactNode; role?: "alert" }) {
  return (
    <div className="mt-6 rounded-2xl border border-border bg-card p-6 text-center" role={role}>
      <p className="text-base font-bold text-foreground break-words">{title}</p>
      {children}
    </div>
  );
}

function Skeleton({ tall = false }: { tall?: boolean }) {
  return (
    <ul className={gridClass} aria-hidden="true" data-testid="community-loading">
      {Array.from({ length: 6 }, (_, i) => <li key={i} className={`${tall ? "h-[120px]" : "h-[80px]"} animate-pulse rounded-xl border border-border bg-card`} />)}
    </ul>
  );
}

function MoreButton({ hasMore, loadingMore, moreError, onMore, what }: { hasMore: boolean; loadingMore: boolean; moreError: boolean; onMore: () => void; what: string }) {
  if (!hasMore && !moreError) return null;
  return (
    <div className="mt-5 flex flex-col items-center gap-2">
      {moreError && <p className="text-sm text-muted-foreground" role="alert">Couldn't load more {what}.</p>}
      <button type="button" onClick={onMore} disabled={loadingMore} className={pillButton}>
        {loadingMore ? "Loading…" : moreError ? "Retry" : `Show more ${what}`}
      </button>
    </div>
  );
}

function Segmented<T extends string>({ label, options, value, onChange, small = false }: { label: string; options: { value: T; label: string }[]; value: T; onChange: (v: T) => void; small?: boolean }) {
  return (
    <div role="group" aria-label={label} className="inline-flex shrink-0 rounded-full border border-border bg-secondary/60 p-1">
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          aria-pressed={value === o.value}
          onClick={() => onChange(o.value)}
          className={`${small ? "h-8 px-3.5" : "h-9 px-4"} rounded-full text-sm font-bold transition-colors ${focusRing}
            ${value === o.value ? "bg-primary text-primary-foreground shadow-sm" : "text-foreground hover:bg-card"}`}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

/** Card props shared by every Community list: the bookmark is the existing Favorites. */
interface Saves {
  saved: Set<string>;
  toggle: (card: SavedCard) => Promise<number | null>;
}

function PuzzleGrid({ items, saves, counts, onCount, testId }: {
  items: SavedCard[];
  saves: Saves;
  counts: Record<string, number>;
  onCount: (code: string, n: number) => void;
  testId: string;
}) {
  return (
    <ul className={gridClass} data-testid={testId}>
      {items.map((p) => (
        <CommunityPuzzleCard
          key={p.shortCode}
          title={p.title}
          shortCode={p.shortCode}
          mode={p.mode}
          designerName={p.creatorName}
          creatorSlug={p.creatorSlug}
          finishedPlays={p.finishedPlays}
          favoriteCount={counts[p.shortCode] ?? p.favoriteCount}
          community={{
            bookmark: {
              saved: saves.saved.has(p.shortCode),
              onToggle: () => { void saves.toggle({ ...p, favoriteCount: counts[p.shortCode] ?? p.favoriteCount }).then((n) => { if (n !== null) onCount(p.shortCode, n); }); },
            },
          }}
        />
      ))}
    </ul>
  );
}

/** Debounced search text kept in the URL, so Back from a puzzle returns to the same results. */
function useUrlQuery(params: URLSearchParams, setParams: ReturnType<typeof useSearchParams>[1]) {
  const urlQuery = params.get("q") ?? "";
  const [query, setQuery] = useState(urlQuery);
  const [debounced, setDebounced] = useState(urlQuery);
  useEffect(() => {
    const t = setTimeout(() => setDebounced(query), 300);
    return () => clearTimeout(t);
  }, [query]);
  useEffect(() => {
    const next = new URLSearchParams(params);
    if (debounced.trim()) next.set("q", debounced.trim()); else next.delete("q");
    if (next.toString() !== params.toString()) setParams(next, { replace: true });
  }, [debounced, params, setParams]);
  return { query, setQuery, debounced };
}

function ExplorePanel({ params, setParams, saves, signedIn }: { params: URLSearchParams; setParams: ReturnType<typeof useSearchParams>[1]; saves: Saves; signedIn: boolean | undefined }) {
  const mode: ExploreMode = params.get("mode") === "creators" ? "creators" : "puzzles";
  const sort: CommunitySort = params.get("sort") === "plays" ? "plays" : "newest";
  const { query, setQuery, debounced } = useUrlQuery(params, setParams);
  const [counts, setCounts] = useState<Record<string, number>>({});
  const q = debounced.trim();

  const puzzles = usePaged<CommunityPuzzleListing>(`p|${q}|${sort}`, mode === "puzzles",
    (offset) => listCommunityPuzzles({ query: q, sort, offset, limit: COMMUNITY_PAGE_SIZE }), (p) => p.shortCode);
  const creators = usePaged<CommunityCreator>(`c|${q}|${signedIn}`, mode === "creators" && signedIn !== undefined,
    (offset) => searchCommunityCreators({ query: q, offset, limit: COMMUNITY_PAGE_SIZE }), (c) => c.publicSlug);
  const list = mode === "puzzles" ? puzzles : creators;

  const setParam = (key: string, value: string | null) => {
    const next = new URLSearchParams(params);
    if (value) next.set(key, value); else next.delete(key);
    setParams(next, { replace: true });
  };

  return (
    <section aria-label="Explore" data-testid="community-panel" aria-busy={list.status === "loading" || list.loadingMore}>
      <div className="mt-4 flex flex-col gap-3 sm:flex-row sm:items-center">
        <Segmented label="Search for" options={MODES} value={mode} onChange={(m) => {
          const next = new URLSearchParams(params);
          if (m === "creators") { next.set("mode", "creators"); next.delete("sort"); } else next.delete("mode");
          setParams(next, { replace: true });
        }} small />
        <form role="search" className="relative min-w-0 flex-1" onSubmit={(e) => e.preventDefault()}>
          <label htmlFor="community-search" className="sr-only">{mode === "puzzles" ? "Search puzzles" : "Search creators"}</label>
          <Search aria-hidden="true" className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <input
            id="community-search"
            type="search"
            value={query}
            maxLength={60}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={mode === "puzzles" ? "Search puzzles" : "Search creators"}
            autoComplete="off"
            className={`h-11 w-full rounded-full border border-input bg-card pl-10 pr-10 text-base text-foreground placeholder:text-muted-foreground [&::-webkit-search-cancel-button]:hidden ${focusRing}`}
          />
          {query && (
            <button type="button" onClick={() => setQuery("")} aria-label="Clear search"
              className={`absolute right-1 top-1/2 inline-flex h-9 w-9 -translate-y-1/2 items-center justify-center rounded-full text-muted-foreground hover:bg-secondary hover:text-foreground ${focusRing}`}>
              <X aria-hidden="true" className="h-4 w-4" />
            </button>
          )}
        </form>
      </div>
      {mode === "puzzles" && (
        <div className="mt-3">
          <Segmented label="Sort puzzles" options={SORTS} value={sort} onChange={(s) => setParam("sort", s === "newest" ? null : s)} />
        </div>
      )}

      <div aria-live="polite" className="sr-only">
        {list.status === "loading" ? "Loading" : list.status === "error" ? "Couldn't load" : `${list.items.length}${list.hasMore ? " or more" : ""} ${mode === "puzzles" ? (list.items.length === 1 ? "puzzle" : "puzzles") : (list.items.length === 1 ? "creator" : "creators")}`}
      </div>

      {list.status === "error" ? (
        <Notice title={mode === "puzzles" ? "Couldn't load Community puzzles." : "Couldn't load creators."} role="alert">
          <p className="mt-1 text-sm text-muted-foreground">Check your connection and try again.</p>
          <button type="button" onClick={list.retry} className={`mt-4 ${pillButton}`}>Retry</button>
        </Notice>
      ) : list.status === "loading" && list.items.length === 0 ? (
        <Skeleton tall={mode === "puzzles"} />
      ) : list.items.length === 0 ? (
        q ? (
          <Notice title={`No ${mode} match “${q}”.`}>
            <p className="mt-1 text-sm text-muted-foreground">{mode === "puzzles" ? "Try a different title or creator name." : "Creators appear here once they list a puzzle in Community."}</p>
            <button type="button" onClick={() => setQuery("")} className={`mt-4 ${pillButton}`}>Clear search</button>
          </Notice>
        ) : (
          <Notice title={mode === "puzzles" ? "No Community puzzles yet." : "No creators in Community yet."}>
            <p className="mt-1 text-sm text-muted-foreground">Make one and choose “List in Community” to share it here.</p>
          </Notice>
        )
      ) : mode === "puzzles" ? (
        <div className={`transition-opacity ${list.status === "loading" ? "opacity-60" : ""}`}>
          <PuzzleGrid items={puzzles.items} saves={saves} counts={counts} onCount={(c, n) => setCounts((m) => ({ ...m, [c]: n }))} testId="community-grid" />
        </div>
      ) : (
        <ul className={`mt-4 grid grid-cols-1 gap-3 sm:grid-cols-2 transition-opacity ${list.status === "loading" ? "opacity-60" : ""}`} data-testid="creator-grid">
          {creators.items.map((c) => (
            <CommunityCreatorCard key={c.publicSlug} creator={c} signedIn={signedIn}
              onChange={(nextC) => creators.setItems((all) => all.map((x) => (x.publicSlug === nextC.publicSlug ? nextC : x)))} />
          ))}
        </ul>
      )}
      {list.status === "ready" && (
        <MoreButton hasMore={list.hasMore} loadingMore={list.loadingMore} moreError={list.moreError} onMore={list.more} what={mode} />
      )}
    </section>
  );
}

function FollowingPanel({ user, saves }: { user: User | null | undefined; saves: Saves }) {
  const [creators, setCreators] = useState<CommunityCreator[]>([]);
  const [counts, setCounts] = useState<Record<string, number>>({});
  const feed = usePaged<CommunityPuzzleListing>(`f|${user?.id}`, !!user,
    (offset) => getFollowingFeed({ offset }).then((page) => { if (offset === 0) setCreators(page.creators); return page; }), (p) => p.shortCode);

  if (user === undefined) return <section aria-label="Following" data-testid="community-panel" aria-busy="true"><Skeleton tall /></section>;
  if (!user) {
    return (
      <section aria-label="Following" data-testid="community-panel" aria-busy="false">
        <Notice title="Follow creators to see their newest puzzles here.">
          <p className="mt-1 text-sm text-muted-foreground">Sign in to follow creators. Explore, search and play stay open to everyone.</p>
          <Link to="/community?mode=creators" className={`mt-4 ${pillButton}`}>Find creators</Link>
        </Notice>
      </section>
    );
  }
  return (
    <section aria-label="Following" data-testid="community-panel" aria-busy={feed.status === "loading" || feed.loadingMore}>
      {feed.status === "error" ? (
        <Notice title="Couldn't load Following." role="alert">
          <button type="button" onClick={feed.retry} className={`mt-4 ${pillButton}`}>Retry</button>
        </Notice>
      ) : feed.status === "loading" && feed.items.length === 0 ? (
        <Skeleton tall />
      ) : (
        <>
          {creators.length > 0 && (
            <div className="mt-4">
              <h2 className="text-sm font-bold text-foreground">You follow</h2>
              <p className="text-xs text-muted-foreground">Only you can see who you follow.</p>
              <ul className="mt-2 flex flex-wrap gap-2" data-testid="following-creators">
                {creators.map((c) => (
                  <li key={c.publicSlug}>
                    <Link to={`/creator/${c.publicSlug}?view=community`} className={`inline-flex h-11 items-center gap-2 rounded-full border border-border bg-card pl-1.5 pr-4 text-sm ${focusRing}`}>
                      <CreatorAvatar name={c.displayName} slug={c.publicSlug} size={32} />
                      <span className={communityLink}>{c.displayName}</span>
                    </Link>
                  </li>
                ))}
              </ul>
            </div>
          )}
          {feed.items.length === 0 ? (
            creators.length === 0 ? (
              <Notice title="You're not following anyone yet.">
                <p className="mt-1 text-sm text-muted-foreground">Follow creators from Explore to see their newest puzzles here.</p>
                <Link to="/community?mode=creators" className={`mt-4 ${pillButton}`}>Find creators</Link>
              </Notice>
            ) : (
              <Notice title="No puzzles from creators you follow right now.">
                <p className="mt-1 text-sm text-muted-foreground">New puzzles they list in Community will appear here, newest first.</p>
              </Notice>
            )
          ) : (
            <>
              <h2 className="sr-only">Newest from creators you follow</h2>
              <PuzzleGrid items={feed.items} saves={saves} counts={counts} onCount={(c, n) => setCounts((m) => ({ ...m, [c]: n }))} testId="following-grid" />
              <MoreButton hasMore={feed.hasMore} loadingMore={feed.loadingMore} moreError={feed.moreError} onMore={feed.more} what="puzzles" />
            </>
          )}
        </>
      )}
    </section>
  );
}

function FavoritesPanel({ user, saves }: { user: User | null | undefined; saves: ReturnType<typeof useCommunitySaves> }) {
  const busy = user === undefined || saves.status === "loading";
  return (
    <section aria-label="Favorites" data-testid="community-panel" aria-busy={busy}>
      <p className="mt-4 text-sm text-muted-foreground">
        {user ? "Only you can see your Favorites." : "Saved on this device only, and only you can see them. Sign in to keep Favorites with your account."}
      </p>
      {saves.status === "error" ? (
        <Notice title="Couldn't load your Favorites." role="alert">
          <button type="button" onClick={saves.retry} className={`mt-4 ${pillButton}`}>Retry</button>
        </Notice>
      ) : busy ? (
        <Skeleton tall />
      ) : saves.items.length === 0 ? (
        <Notice title="No favorites yet.">
          <p className="mt-1 text-sm text-muted-foreground">Tap the bookmark on any puzzle to save it here.</p>
        </Notice>
      ) : (
        <PuzzleGrid items={saves.items} saves={saves} counts={{}} onCount={() => {}} testId="favorites-grid" />
      )}
    </section>
  );
}

/** /community — Explore, Following and Favorites (preview; see lib/communityFlag.ts). Guests may explore, search and play. */
export default function CommunityPage() {
  const [params, setParams] = useSearchParams();
  const tab: CommunityTab = params.get("tab") === "following" ? "following" : params.get("tab") === "favorites" ? "favorites" : "explore";
  const [user, setUser] = useState<User | null | undefined>(undefined);
  const saves = useCommunitySaves(user === undefined ? undefined : user?.id ?? null);

  useEffect(() => {
    document.documentElement.classList.toggle("dark", loadSettings().darkMode);
  }, []);
  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session } }) => setUser(session?.user ?? null));
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_e, session) => setUser(session?.user ?? null));
    return () => subscription.unsubscribe();
  }, []);

  return (
    <div className="min-h-screen flex flex-col items-center pt-2 pb-12">
      <SEO title="Community Puzzles — Rainbow Connect" description="Play puzzles made by other Rainbow players." path="/community" noIndex />
      <GameHeader user={user ?? null} onSignOut={() => signOutOfRainbow()} simplifiedIcons wideHeader />
      <div className="w-full max-w-[840px] border-b border-border mb-4" />
      <main className="w-full max-w-[840px] px-4 flex-1">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
          <div className="flex min-w-0 items-center gap-3">
            <CommunityMotif />
            <div className="min-w-0">
              <h1 className="font-tile text-[28px] font-bold leading-tight tracking-tight text-foreground sm:text-3xl">Community Puzzles</h1>
              <p className="mt-0.5 text-sm text-muted-foreground sm:text-base">Play puzzles made by other Rainbow players.</p>
            </div>
          </div>
          <Link to="/create" className={`inline-flex h-11 shrink-0 items-center justify-center gap-1.5 rounded-full bg-primary px-5 text-sm font-bold text-primary-foreground transition-transform active:scale-95 hover:opacity-90 ${focusRing}`}>
            <Plus aria-hidden="true" className="h-4 w-4" strokeWidth={2.5} />
            Create A Puzzle
          </Link>
        </div>

        <nav aria-label="Community sections" className="mt-5">
          <ul className="grid grid-cols-3 gap-1 rounded-2xl border border-border bg-secondary/60 p-1 dark:bg-card sm:inline-grid sm:min-w-[420px]">
            {TABS.map((t) => (
              <li key={t.value}>
                <Link
                  to={t.value === "explore" ? "/community" : `/community?tab=${t.value}`}
                  aria-current={tab === t.value ? "page" : undefined}
                  className={`flex h-11 items-center justify-center rounded-xl px-3 text-sm font-extrabold transition-colors ${focusRing}
                    ${tab === t.value ? "bg-card text-foreground shadow-sm dark:bg-muted" : "text-muted-foreground hover:text-foreground"}`}
                >
                  {t.label}
                </Link>
              </li>
            ))}
          </ul>
        </nav>

        {tab === "explore" && <ExplorePanel params={params} setParams={setParams} saves={saves} signedIn={user === undefined ? undefined : !!user} />}
        {tab === "following" && <FollowingPanel user={user} saves={saves} />}
        {tab === "favorites" && <FavoritesPanel user={user} saves={saves} />}

        <div role="status" aria-live="polite" className="pointer-events-none fixed inset-x-0 bottom-4 z-40 flex justify-center px-4">
          {saves.note && <span className="rounded-full bg-primary px-4 py-2 text-sm font-bold text-primary-foreground shadow-lg">{saves.note}</span>}
        </div>
      </main>
      <SiteFooter />
    </div>
  );
}
