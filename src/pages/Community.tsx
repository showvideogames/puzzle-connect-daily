import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { ChevronLeft, Plus, Search, X } from "lucide-react";
import { SiteFooter } from "@/components/SiteFooter";
import { SEO } from "@/components/SEO";
import { CommunityHeader } from "@/components/community/CommunityHeader";
import { CommunityCreatorCard } from "@/components/community/CommunityCreatorCard";
import { CreatorAvatar } from "@/components/community/CreatorAvatar";
import { CoverCard, FeaturedCard, NewestRow, type CardArt, type ExploreCard } from "@/components/community/ExploreCards";
import { cv } from "@/lib/communityStyle";
import { useCommunitySaves, type SavedCard } from "@/hooks/useCommunitySaves";
import { useGamePageTheme } from "@/hooks/useGamePageTheme";
import { usePaged } from "@/hooks/usePaged";
import { supabase } from "@/integrations/supabase/client";
import { loadSettings } from "@/lib/settings";
import {
  COMMUNITY_PAGE_SIZE,
  getCommunityExplore,
  getFollowingFeed,
  listCommunityNewest,
  listCommunityPuzzles,
  searchCommunityCreators,
  type CommunityCreator,
  type CommunityExplore,
  type CommunityPuzzleListing,
  type CommunitySort,
  type NewestCursor,
} from "@/lib/customPuzzles";
import type { User } from "@supabase/supabase-js";

export type CommunityTab = "explore" | "following" | "favorites";
export type ExploreMode = "puzzles" | "creators";
type ExploreView = "home" | "newest" | "search";

const TABS: { value: CommunityTab; label: string }[] = [
  { value: "explore", label: "Explore" },
  { value: "following", label: "Following" },
  { value: "favorites", label: "Favorites" },
];
const SORTS: { value: CommunitySort; label: string }[] = [
  { value: "newest", label: "Newest" },
  { value: "plays", label: "Most Played" },
  { value: "likes", label: "Most Liked" },
];
const SORT_TITLES: Record<CommunitySort, string> = { newest: "Newest", plays: "Most Played", likes: "Most Liked" };
const SORT_NOTES: Record<CommunitySort, string> = {
  newest: "Every Community puzzle, newest listing first.",
  plays: "Every Community puzzle, most finished plays first.",
  likes: "Every Community puzzle, most saved to signed-in Favorites first.",
};
const orderOf = (params: URLSearchParams): CommunitySort => (params.get("order") === "plays" ? "plays" : params.get("order") === "likes" ? "likes" : "newest");

/**
 * One page of the browse list. Newest is keyset-paged on first listing time;
 * Most Played and Most Liked are sorted over the whole listed pool on the
 * server, then paged, with deterministic ties.
 */
async function browsePage(order: CommunitySort, limit: number, offset: number, after: NewestCursor | null) {
  if (order === "newest") return listCommunityNewest({ limit, after });
  const page = await listCommunityPuzzles({ sort: order, offset, limit });
  return { ...page, cursor: null as NewestCursor | null };
}
const MODES: { value: ExploreMode; label: string }[] = [
  { value: "puzzles", label: "Puzzles" },
  { value: "creators", label: "Creators" },
];
/** How many Newest rows Explore's home shows before "See all". */
const NEWEST_PREVIEW = 6;

const pillButton = `inline-flex h-11 items-center rounded-full border border-border bg-card px-5 text-sm font-bold text-foreground hover:bg-secondary disabled:opacity-60 ${cv.focus}`;
/** Equal two-column covers on phones once they fit (360px and up); one column below. */
const coverGrid = "mt-3 grid grid-cols-1 gap-3 min-[360px]:grid-cols-2 md:grid-cols-3";
/** Editor's Picks on desktop: two horizontal cards per row (the approved Arcade Shelf / Make A Cover layout). */
const PICK_COLUMNS: Record<number, string> = { 1: "md:grid-cols-2", 2: "md:grid-cols-2", 3: "md:grid-cols-2", 4: "md:grid-cols-2", 5: "md:grid-cols-2", 6: "md:grid-cols-2" };

function Notice({ title, children, role }: { title: string; children?: ReactNode; role?: "alert" }) {
  return (
    <div className="mt-5 rounded-2xl bg-violet-50 px-5 py-6 text-center dark:bg-white/5" role={role}>
      <p className={`text-base font-extrabold break-words ${cv.ink}`}>{title}</p>
      {children}
    </div>
  );
}

function Skeleton({ rows = false }: { rows?: boolean }) {
  return rows ? (
    <ul className="mt-2" aria-hidden="true" data-testid="community-loading">
      {Array.from({ length: 4 }, (_, i) => <li key={i} className="my-3 h-[60px] animate-pulse rounded-xl bg-muted" />)}
    </ul>
  ) : (
    <ul className={coverGrid} aria-hidden="true" data-testid="community-loading">
      {Array.from({ length: 4 }, (_, i) => <li key={i} className="h-[220px] animate-pulse rounded-2xl bg-muted" />)}
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

function Segmented<T extends string>({ label, options, value, onChange }: { label: string; options: { value: T; label: string }[]; value: T; onChange: (v: T) => void }) {
  return (
    <div role="group" aria-label={label} className="inline-flex shrink-0 rounded-full bg-violet-50 p-1 dark:bg-white/5">
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          aria-pressed={value === o.value}
          onClick={() => onChange(o.value)}
          className={`h-9 rounded-full px-4 text-sm font-extrabold transition-colors ${cv.focus}
            ${value === o.value ? cv.play : `${cv.ink} hover:bg-white dark:hover:bg-white/10`}`}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

/** The bookmark on every card is the existing Favorites (see useCommunitySaves). */
interface Saves {
  saved: Set<string>;
  toggle: (card: SavedCard) => Promise<number | null>;
}
const bookmarkFor = (saves: Saves, p: SavedCard) => ({ saved: saves.saved.has(p.shortCode), onToggle: () => { void saves.toggle(p); } });
const asCard = (p: SavedCard): ExploreCard => ({ title: p.title, shortCode: p.shortCode, mode: p.mode, creatorName: p.creatorName, creatorSlug: p.creatorSlug, finishedPlays: p.finishedPlays, cover: p.cover ?? null });

function CoverGrid({ items, saves, testId, className = coverGrid, art = "creator", rowOnDesktop = false }: { items: SavedCard[]; saves: Saves; testId: string; className?: string; art?: CardArt; rowOnDesktop?: boolean }) {
  return (
    <ul className={className} data-testid={testId}>
      {items.map((p) => <CoverCard key={p.shortCode} card={asCard(p)} bookmark={bookmarkFor(saves, p)} art={art} rowOnDesktop={rowOnDesktop} />)}
    </ul>
  );
}

function NewestList({ items, saves, testId }: { items: SavedCard[]; saves: Saves; testId: string }) {
  return (
    <ul className="divide-y divide-border" data-testid={testId}>
      {items.map((p) => <NewestRow key={p.shortCode} card={asCard(p)} bookmark={bookmarkFor(saves, p)} />)}
    </ul>
  );
}

function SectionHeading({ id, children, action }: { id: string; children: ReactNode; action?: ReactNode }) {
  return (
    <div className="mt-7 flex items-end justify-between gap-3">
      <h2 id={id} className={`text-[22px] font-black tracking-tight sm:text-2xl ${cv.ink}`}>{children}</h2>
      {action}
    </div>
  );
}

function BackToExplore() {
  return (
    <Link to="/community" className={`mt-4 inline-flex h-11 items-center gap-1 rounded-full pr-3 text-sm font-extrabold ${cv.ink} ${cv.focus}`}>
      <ChevronLeft aria-hidden="true" className="h-5 w-5" /> Explore
    </Link>
  );
}

function CreateLink() {
  return (
    <p className="mt-8 text-center">
      <Link to="/create" className={`inline-flex h-11 items-center gap-1 rounded-full px-3 text-base ${cv.link} ${cv.focus}`}>
        <Plus aria-hidden="true" className="h-4 w-4" strokeWidth={3} /> Create A Puzzle
      </Link>
    </p>
  );
}

/**
 * Explore's home: one human-chosen Featured Puzzle (only when there is one),
 * a small Editor's Picks shelf (only when there are picks), and Newest, which
 * is independent of both: every listed puzzle by first listing time.
 */
function ExploreHome({ saves, order, onOrder }: { saves: Saves; order: CommunitySort; onOrder: (o: CommunitySort) => void }) {
  const [curated, setCurated] = useState<CommunityExplore | null | undefined>(undefined);
  const newest = usePaged<CommunityPuzzleListing>(`home-${order}`, true, () => browsePage(order, NEWEST_PREVIEW, 0, null), (p) => p.shortCode);

  useEffect(() => {
    let cancelled = false;
    // If curation can't load, Explore simply shows Newest: no empty shells.
    getCommunityExplore().then((c) => { if (!cancelled) setCurated(c); }, () => { if (!cancelled) setCurated(null); });
    return () => { cancelled = true; };
  }, []);

  const featured = curated?.featured ?? null;
  const picks = curated?.picks ?? [];
  const busy = curated === undefined || newest.status === "loading";

  return (
    <section aria-label="Explore" data-testid="community-panel" aria-busy={busy}>
      <h1 className={`mt-5 text-[32px] font-black leading-[1.05] tracking-tight sm:text-[40px] ${cv.ink}`}>Community Puzzles</h1>
      <p className="mt-1 text-base text-muted-foreground sm:text-lg">Play puzzles made by other Rainbow players.</p>

      {featured && <FeaturedCard card={asCard(featured)} bookmark={bookmarkFor(saves, featured)} />}

      {picks.length > 0 && (
        <section aria-labelledby="picks-heading" data-testid="editors-picks">
          <SectionHeading id="picks-heading">Editor's Picks</SectionHeading>
          <CoverGrid items={picks} saves={saves} testId="picks-grid" art="editorial" rowOnDesktop className={`mt-3 grid grid-cols-1 gap-3 min-[360px]:grid-cols-2 ${PICK_COLUMNS[picks.length]}`} />
        </section>
      )}

      <section aria-labelledby="newest-heading" data-testid="newest-section">
        <SectionHeading id="newest-heading" action={
          newest.items.length > 0 ? <Link to={`/community?view=newest${order === "newest" ? "" : `&order=${order}`}`} className={`inline-flex h-11 items-center rounded-full px-2 text-base ${cv.link} ${cv.focus}`}>See all<span className="sr-only"> {SORT_TITLES[order].toLowerCase()} puzzles</span></Link> : null
        }>{SORT_TITLES[order]}</SectionHeading>
        <div className="mt-2">
          <Segmented label="Sort puzzles" options={SORTS} value={order} onChange={onOrder} />
        </div>
        {newest.status === "error" ? (
          <Notice title="Couldn't load the newest puzzles." role="alert">
            <button type="button" onClick={newest.retry} className={`mt-4 ${pillButton}`}>Retry</button>
          </Notice>
        ) : newest.status === "loading" && newest.items.length === 0 ? (
          <Skeleton rows />
        ) : newest.items.length === 0 ? (
          <Notice title="No Community puzzles yet.">
            <p className="mt-1 text-sm text-muted-foreground">Make one and choose “List in Community” to share it here.</p>
          </Notice>
        ) : (
          <NewestList items={newest.items} saves={saves} testId="newest-list" />
        )}
      </section>

      <CreateLink />
    </section>
  );
}

/**
 * See all: every listed puzzle in the chosen order. Newest (the default) is
 * keyset-paged so pages never repeat or skip; Most Played and Most Liked are
 * sorted on the server over the whole pool before paging.
 */
function NewestView({ saves, order, onOrder }: { saves: Saves; order: CommunitySort; onOrder: (o: CommunitySort) => void }) {
  const [items, setItems] = useState<CommunityPuzzleListing[]>([]);
  const [status, setStatus] = useState<"loading" | "ready" | "error">("loading");
  const [cursor, setCursor] = useState<NewestCursor | null>(null);
  const [hasMore, setHasMore] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [moreError, setMoreError] = useState(false);
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    let cancelled = false;
    setStatus("loading");
    browsePage(order, COMMUNITY_PAGE_SIZE, 0, null).then(
      (page) => { if (cancelled) return; setItems(page.items); setCursor(page.cursor); setHasMore(page.hasMore); setStatus("ready"); },
      () => { if (!cancelled) setStatus("error"); }
    );
    return () => { cancelled = true; };
  }, [attempt, order]);

  const more = useCallback(() => {
    setLoadingMore(true);
    setMoreError(false);
    browsePage(order, COMMUNITY_PAGE_SIZE, items.length, cursor).then(
      (page) => {
        setItems((prev) => {
          const seen = new Set(prev.map((p) => p.shortCode));
          return [...prev, ...page.items.filter((p) => !seen.has(p.shortCode))];
        });
        setCursor(page.cursor ?? cursor);
        setHasMore(page.hasMore);
        setLoadingMore(false);
      },
      () => { setMoreError(true); setLoadingMore(false); }
    );
  }, [cursor, order, items.length]);

  return (
    <section aria-label={SORT_TITLES[order]} data-testid="community-panel" aria-busy={status === "loading" || loadingMore}>
      <BackToExplore />
      <h1 className={`mt-1 text-[30px] font-black tracking-tight ${cv.ink}`}>{SORT_TITLES[order]}</h1>
      <p className="text-sm text-muted-foreground">{SORT_NOTES[order]}</p>
      <div className="mt-3">
        <Segmented label="Sort puzzles" options={SORTS} value={order} onChange={onOrder} />
      </div>
      {status === "error" ? (
        <Notice title="Couldn't load the newest puzzles." role="alert">
          <button type="button" onClick={() => setAttempt((n) => n + 1)} className={`mt-4 ${pillButton}`}>Retry</button>
        </Notice>
      ) : status === "loading" ? (
        <Skeleton rows />
      ) : items.length === 0 ? (
        <Notice title="No Community puzzles yet." />
      ) : (
        <>
          <NewestList items={items} saves={saves} testId="newest-all-list" />
          <MoreButton hasMore={hasMore} loadingMore={loadingMore} moreError={moreError} onMore={more} what="puzzles" />
        </>
      )}
    </section>
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

/** Search: Puzzles (title or creator; Newest, Most Played or Most Liked) or Creators (public name or slug). */
function SearchView({ params, setParams, saves, signedIn }: { params: URLSearchParams; setParams: ReturnType<typeof useSearchParams>[1]; saves: Saves; signedIn: boolean | undefined }) {
  const mode: ExploreMode = params.get("mode") === "creators" ? "creators" : "puzzles";
  const sort: CommunitySort = params.get("sort") === "plays" ? "plays" : params.get("sort") === "likes" ? "likes" : "newest";
  const { query, setQuery, debounced } = useUrlQuery(params, setParams);
  const q = debounced.trim();
  const input = useRef<HTMLInputElement>(null);
  useEffect(() => {
    // Arriving from the header's search button: straight into the box.
    if (params.get("view") === "search") input.current?.focus();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

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
    <section aria-label="Search" data-testid="community-panel" aria-busy={list.status === "loading" || list.loadingMore}>
      <BackToExplore />
      <h1 className={`mt-1 text-[30px] font-black tracking-tight ${cv.ink}`}>Search</h1>
      <div className="mt-3 flex flex-col gap-3 sm:flex-row sm:items-center">
        <Segmented label="Search for" options={MODES} value={mode} onChange={(m) => {
          const next = new URLSearchParams(params);
          if (m === "creators") { next.set("mode", "creators"); next.delete("sort"); } else next.delete("mode");
          setParams(next, { replace: true });
        }} />
        <form role="search" className="relative min-w-0 flex-1" onSubmit={(e) => e.preventDefault()}>
          <label htmlFor="community-search" className="sr-only">{mode === "puzzles" ? "Search puzzles" : "Search creators"}</label>
          <Search aria-hidden="true" className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <input
            ref={input}
            id="community-search"
            type="search"
            value={query}
            maxLength={60}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={mode === "puzzles" ? "Search puzzles" : "Search creators"}
            autoComplete="off"
            className={`h-11 w-full rounded-full border border-input bg-card pl-10 pr-10 text-base text-foreground placeholder:text-muted-foreground [&::-webkit-search-cancel-button]:hidden ${cv.focus}`}
          />
          {query && (
            <button type="button" onClick={() => setQuery("")} aria-label="Clear search"
              className={`absolute right-1 top-1/2 inline-flex h-9 w-9 -translate-y-1/2 items-center justify-center rounded-full text-muted-foreground hover:bg-secondary hover:text-foreground ${cv.focus}`}>
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
        <Skeleton />
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
          <CoverGrid items={puzzles.items} saves={saves} testId="community-grid" />
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

const panelTitle = (text: string) => <h1 className={`mt-5 text-[30px] font-black tracking-tight ${cv.ink}`}>{text}</h1>;

function FollowingPanel({ user, saves }: { user: User | null | undefined; saves: Saves }) {
  const [creators, setCreators] = useState<CommunityCreator[]>([]);
  const feed = usePaged<CommunityPuzzleListing>(`f|${user?.id}`, !!user,
    (offset) => getFollowingFeed({ offset }).then((page) => { if (offset === 0) setCreators(page.creators); return page; }), (p) => p.shortCode);

  if (user === undefined) return <section aria-label="Following" data-testid="community-panel" aria-busy="true">{panelTitle("Following")}<Skeleton /></section>;
  if (!user) {
    return (
      <section aria-label="Following" data-testid="community-panel" aria-busy="false">
        {panelTitle("Following")}
        <Notice title="Follow creators to see their newest puzzles here.">
          <p className="mt-1 text-sm text-muted-foreground">Sign in to follow creators. Explore, search and play stay open to everyone.</p>
          <Link to="/community?mode=creators" className={`mt-4 ${pillButton}`}>Find creators</Link>
        </Notice>
      </section>
    );
  }
  return (
    <section aria-label="Following" data-testid="community-panel" aria-busy={feed.status === "loading" || feed.loadingMore}>
      {panelTitle("Following")}
      {feed.status === "error" ? (
        <Notice title="Couldn't load Following." role="alert">
          <button type="button" onClick={feed.retry} className={`mt-4 ${pillButton}`}>Retry</button>
        </Notice>
      ) : feed.status === "loading" && feed.items.length === 0 ? (
        <Skeleton />
      ) : (
        <>
          {creators.length > 0 && (
            <div className="mt-3">
              <h2 className={`text-sm font-extrabold ${cv.ink}`}>You follow</h2>
              <p className="text-xs text-muted-foreground">Only you can see who you follow.</p>
              <ul className="mt-2 flex flex-wrap gap-2" data-testid="following-creators">
                {creators.map((c) => (
                  <li key={c.publicSlug}>
                    <Link to={`/creator/${c.publicSlug}?view=community`} className={`inline-flex h-11 items-center gap-2 rounded-full bg-violet-50 pl-1.5 pr-4 text-sm dark:bg-white/5 ${cv.focus}`}>
                      <CreatorAvatar name={c.displayName} slug={c.publicSlug} size={32} />
                      <span className={cv.link}>{c.displayName}</span>
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
              <SectionHeading id="following-heading">Newest from creators you follow</SectionHeading>
              <CoverGrid items={feed.items} saves={saves} testId="following-grid" />
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
      {panelTitle("Favorites")}
      <p className="mt-1 text-sm text-muted-foreground">
        {user ? "Only you can see your Favorites." : "Saved on this device only, and only you can see them. Sign in to keep Favorites with your account."}
      </p>
      {saves.status === "error" ? (
        <Notice title="Couldn't load your Favorites." role="alert">
          <button type="button" onClick={saves.retry} className={`mt-4 ${pillButton}`}>Retry</button>
        </Notice>
      ) : busy ? (
        <Skeleton />
      ) : saves.items.length === 0 ? (
        <Notice title="No favorites yet.">
          <p className="mt-1 text-sm text-muted-foreground">Tap the bookmark on any puzzle to save it here.</p>
        </Notice>
      ) : (
        <CoverGrid items={saves.items} saves={saves} testId="favorites-grid" />
      )}
    </section>
  );
}

/** /community — Explore, Following and Favorites (preview; see lib/communityFlag.ts). Guests may explore, search and play. */
export default function CommunityPage() {
  // A true-white page in light mode, the same theme the game pages use.
  useGamePageTheme();
  const [params, setParams] = useSearchParams();
  const tab: CommunityTab = params.get("tab") === "following" ? "following" : params.get("tab") === "favorites" ? "favorites" : "explore";
  // Old search links (?q=, ?mode=creators, ?sort=plays) still open search.
  const view: ExploreView = params.get("view") === "newest" ? "newest"
    : params.get("view") === "search" || params.has("q") || params.has("mode") || params.has("sort") ? "search" : "home";
  const [user, setUser] = useState<User | null | undefined>(undefined);
  const saves = useCommunitySaves(user === undefined ? undefined : user?.id ?? null);
  // The browse order (Explore's list and See all); Newest is the default and leaves no parameter.
  const setOrder = (o: CommunitySort) => {
    const next = new URLSearchParams(params);
    if (o === "newest") next.delete("order"); else next.set("order", o);
    setParams(next, { replace: true });
  };

  useEffect(() => {
    document.documentElement.classList.toggle("dark", loadSettings().darkMode);
  }, []);
  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session } }) => setUser(session?.user ?? null));
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_e, session) => setUser(session?.user ?? null));
    return () => subscription.unsubscribe();
  }, []);

  return (
    <div className="min-h-screen flex flex-col items-center bg-background pt-1 pb-12">
      <SEO title="Community Puzzles — Rainbow Connect" description="Play puzzles made by other Rainbow players." path="/community" noIndex />
      <CommunityHeader user={user ?? null} />
      <nav aria-label="Community sections" className="w-full max-w-[840px] px-4">
        <ul className="flex justify-center gap-2 border-b border-border min-[360px]:gap-6 sm:gap-10">
          {TABS.map((t) => (
            <li key={t.value}>
              <Link
                to={t.value === "explore" ? "/community" : `/community?tab=${t.value}`}
                aria-current={tab === t.value ? "page" : undefined}
                className={`relative flex h-12 items-center px-2 text-base transition-colors rounded-t-md ${cv.focus}
                  ${tab === t.value
                    ? `font-black ${cv.ink} after:absolute after:inset-x-0 after:-bottom-px after:h-[3px] after:rounded-full after:bg-violet-600 dark:after:bg-violet-300`
                    : "font-semibold text-foreground/75 hover:text-foreground"}`}
              >
                {t.label}
              </Link>
            </li>
          ))}
        </ul>
      </nav>
      <main className="w-full max-w-[840px] px-4 flex-1">
        {tab === "explore" && view === "home" && <ExploreHome saves={saves} order={orderOf(params)} onOrder={setOrder} />}
        {tab === "explore" && view === "newest" && <NewestView saves={saves} order={orderOf(params)} onOrder={setOrder} />}
        {tab === "explore" && view === "search" && <SearchView params={params} setParams={setParams} saves={saves} signedIn={user === undefined ? undefined : !!user} />}
        {tab === "following" && <FollowingPanel user={user} saves={saves} />}
        {tab === "favorites" && <FavoritesPanel user={user} saves={saves} />}

        <div role="status" aria-live="polite" className="pointer-events-none fixed inset-x-0 bottom-4 z-40 flex justify-center px-4">
          {saves.note && <span className="rounded-full bg-[#2b0a5e] px-4 py-2 text-sm font-bold text-white shadow-lg dark:bg-violet-200 dark:text-[#1e0a45]">{saves.note}</span>}
        </div>
      </main>
      <SiteFooter />
    </div>
  );
}
