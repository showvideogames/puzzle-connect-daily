import { useCallback, useEffect, useRef, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { Plus, Search, X } from "lucide-react";
import { GameHeader } from "@/components/GameHeader";
import { SiteFooter } from "@/components/SiteFooter";
import { SEO } from "@/components/SEO";
import { CommunityPuzzleCard } from "@/components/CommunityPuzzleCard";
import { supabase } from "@/integrations/supabase/client";
import { signOutOfRainbow } from "@/lib/platformSignIn";
import { loadSettings } from "@/lib/settings";
import {
  COMMUNITY_PAGE_SIZE,
  listCommunityPuzzles,
  type CommunityPuzzleListing,
  type CommunitySort,
} from "@/lib/customPuzzles";
import type { User } from "@supabase/supabase-js";

const SORTS: { value: CommunitySort; label: string }[] = [
  { value: "newest", label: "Newest" },
  { value: "plays", label: "Most Played" },
];

const focusRing = "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background";

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

type Status = "loading" | "ready" | "error";

interface CommunityViewProps {
  query: string;
  onQuery: (q: string) => void;
  sort: CommunitySort;
  onSort: (s: CommunitySort) => void;
  status: Status;
  items: CommunityPuzzleListing[];
  hasMore: boolean;
  loadingMore: boolean;
  moreError: boolean;
  onRetry: () => void;
  onMore: () => void;
  /** The query the shown results are for, so "no matches" names what was searched. */
  shownQuery: string;
}

/** The Community page body, separate from data loading so it can be rendered from fixtures. */
export function CommunityView({ query, onQuery, sort, onSort, status, items, hasMore, loadingMore, moreError, onRetry, onMore, shownQuery }: CommunityViewProps) {
  const searching = shownQuery.trim() !== "";
  return (
    <main className="w-full max-w-[840px] px-4 flex-1" aria-busy={status === "loading" || loadingMore}>
      <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div className="flex min-w-0 items-center gap-3">
          <CommunityMotif />
          <div className="min-w-0">
            <h1 className="font-tile text-[28px] font-bold leading-tight tracking-tight text-foreground sm:text-3xl">Community Puzzles</h1>
            <p className="mt-0.5 text-sm text-muted-foreground sm:text-base">Play puzzles made by other Rainbow players.</p>
          </div>
        </div>
        <Link
          to="/create"
          className={`inline-flex h-11 shrink-0 items-center justify-center gap-1.5 rounded-full bg-primary px-5 text-sm font-bold text-primary-foreground transition-transform active:scale-95 hover:opacity-90 ${focusRing}`}
        >
          <Plus aria-hidden="true" className="h-4 w-4" strokeWidth={2.5} />
          Create A Puzzle
        </Link>
      </div>

      <div className="mt-5 flex flex-col gap-3 sm:flex-row sm:items-center">
        <form role="search" className="relative min-w-0 flex-1" onSubmit={(e) => e.preventDefault()}>
          <label htmlFor="community-search" className="sr-only">Search puzzles or creators</label>
          <Search aria-hidden="true" className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <input
            id="community-search"
            type="search"
            value={query}
            maxLength={60}
            onChange={(e) => onQuery(e.target.value)}
            placeholder="Search puzzles or creators"
            autoComplete="off"
            className={`h-11 w-full rounded-full border border-input bg-card pl-10 pr-10 text-base text-foreground placeholder:text-muted-foreground [&::-webkit-search-cancel-button]:hidden ${focusRing}`}
          />
          {query && (
            <button
              type="button"
              onClick={() => onQuery("")}
              aria-label="Clear search"
              className={`absolute right-1 top-1/2 inline-flex h-9 w-9 -translate-y-1/2 items-center justify-center rounded-full text-muted-foreground hover:bg-secondary hover:text-foreground ${focusRing}`}
            >
              <X aria-hidden="true" className="h-4 w-4" />
            </button>
          )}
        </form>
        <div role="group" aria-label="Sort puzzles" className="inline-flex shrink-0 self-start rounded-full border border-border bg-secondary/60 p-1 sm:self-auto">
          {SORTS.map((s) => (
            <button
              key={s.value}
              type="button"
              aria-pressed={sort === s.value}
              onClick={() => onSort(s.value)}
              className={`h-9 rounded-full px-4 text-sm font-bold transition-colors ${focusRing}
                ${sort === s.value ? "bg-primary text-primary-foreground shadow-sm" : "text-foreground hover:bg-card"}`}
            >
              {s.label}
            </button>
          ))}
        </div>
      </div>

      <div aria-live="polite" className="sr-only">
        {status === "loading" ? "Loading puzzles" : status === "error" ? "Couldn't load puzzles" : `${items.length}${hasMore ? " or more" : ""} ${items.length === 1 ? "puzzle" : "puzzles"}`}
      </div>

      {status === "error" ? (
        <div className="mt-8 rounded-2xl border border-border bg-card p-6 text-center" role="alert">
          <p className="text-base font-bold text-foreground">Couldn't load Community puzzles.</p>
          <p className="mt-1 text-sm text-muted-foreground">Check your connection and try again.</p>
          <button type="button" onClick={onRetry} className={`mt-4 inline-flex h-11 items-center rounded-full border border-border bg-card px-5 text-sm font-bold text-foreground hover:bg-secondary ${focusRing}`}>
            Retry
          </button>
        </div>
      ) : status === "loading" && items.length === 0 ? (
        <ul className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3" aria-hidden="true" data-testid="community-loading">
          {Array.from({ length: 6 }, (_, i) => (
            <li key={i} className="h-[104px] animate-pulse rounded-xl border border-border bg-card" />
          ))}
        </ul>
      ) : items.length === 0 ? (
        <div className="mt-8 rounded-2xl border border-border bg-card p-6 text-center">
          {searching ? (
            <>
              <p className="text-base font-bold text-foreground break-words">No puzzles match “{shownQuery.trim()}”.</p>
              <p className="mt-1 text-sm text-muted-foreground">Try a different title or creator name.</p>
              <button type="button" onClick={() => onQuery("")} className={`mt-4 inline-flex h-11 items-center rounded-full border border-border bg-card px-5 text-sm font-bold text-foreground hover:bg-secondary ${focusRing}`}>
                Clear search
              </button>
            </>
          ) : (
            <>
              <p className="text-base font-bold text-foreground">No Community puzzles yet.</p>
              <p className="mt-1 text-sm text-muted-foreground">Make one and choose “List in Community” to share it here.</p>
            </>
          )}
        </div>
      ) : (
        <>
          <ul className={`mt-4 grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3 transition-opacity ${status === "loading" ? "opacity-60" : ""}`} data-testid="community-grid">
            {items.map((p) => (
              <CommunityPuzzleCard
                key={p.shortCode}
                title={p.title}
                shortCode={p.shortCode}
                mode={p.mode}
                designerName={p.creatorName}
                creatorSlug={p.creatorSlug}
                finishedPlays={p.finishedPlays}
                favoriteCount={p.favoriteCount}
              />
            ))}
          </ul>
          {(hasMore || moreError) && (
            <div className="mt-5 flex flex-col items-center gap-2">
              {moreError && <p className="text-sm text-muted-foreground" role="alert">Couldn't load more puzzles.</p>}
              <button
                type="button"
                onClick={onMore}
                disabled={loadingMore}
                className={`inline-flex h-11 items-center rounded-full border border-border bg-card px-5 text-sm font-bold text-foreground hover:bg-secondary disabled:opacity-60 ${focusRing}`}
              >
                {loadingMore ? "Loading…" : moreError ? "Retry" : "Show more puzzles"}
              </button>
            </div>
          )}
        </>
      )}
    </main>
  );
}

/** /community — the opt-in browse feed (preview; see lib/communityFlag.ts). Guests may browse and play. */
export default function CommunityPage() {
  const [params, setParams] = useSearchParams();
  const sort: CommunitySort = params.get("sort") === "plays" ? "plays" : "newest";
  const urlQuery = params.get("q") ?? "";
  const [query, setQuery] = useState(urlQuery);
  const [debounced, setDebounced] = useState(urlQuery);
  const [user, setUser] = useState<User | null>(null);
  const [status, setStatus] = useState<Status>("loading");
  const [items, setItems] = useState<CommunityPuzzleListing[]>([]);
  const [hasMore, setHasMore] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [moreError, setMoreError] = useState(false);
  const [shownQuery, setShownQuery] = useState(urlQuery);
  const [attempt, setAttempt] = useState(0);
  // Only the newest request may write the page: a slow earlier search or sort
  // never overwrites a later one.
  const request = useRef(0);

  useEffect(() => {
    document.documentElement.classList.toggle("dark", loadSettings().darkMode);
  }, []);

  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session } }) => setUser(session?.user ?? null));
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_e, session) => setUser(session?.user ?? null));
    return () => subscription.unsubscribe();
  }, []);

  useEffect(() => {
    const t = setTimeout(() => setDebounced(query), 300);
    return () => clearTimeout(t);
  }, [query]);

  // Keep the search and sort in the URL, so Back from a puzzle returns here.
  useEffect(() => {
    const next = new URLSearchParams(params);
    if (debounced.trim()) next.set("q", debounced.trim()); else next.delete("q");
    if (next.toString() !== params.toString()) setParams(next, { replace: true });
  }, [debounced, params, setParams]);

  useEffect(() => {
    const mine = ++request.current;
    setStatus("loading");
    setMoreError(false);
    listCommunityPuzzles({ query: debounced, sort, offset: 0, limit: COMMUNITY_PAGE_SIZE }).then(
      (page) => {
        if (mine !== request.current) return;
        setItems(page.items);
        setHasMore(page.hasMore);
        setShownQuery(debounced);
        setStatus("ready");
      },
      () => {
        if (mine !== request.current) return;
        setItems([]);
        setHasMore(false);
        setStatus("error");
      }
    );
  }, [debounced, sort, attempt]);

  const handleMore = useCallback(() => {
    const mine = request.current;
    setLoadingMore(true);
    setMoreError(false);
    listCommunityPuzzles({ query: debounced, sort, offset: items.length, limit: COMMUNITY_PAGE_SIZE }).then(
      (page) => {
        if (mine !== request.current) return;
        setItems((prev) => {
          const seen = new Set(prev.map((p) => p.shortCode));
          return [...prev, ...page.items.filter((p) => !seen.has(p.shortCode))];
        });
        setHasMore(page.hasMore);
        setLoadingMore(false);
      },
      () => {
        if (mine !== request.current) return;
        setMoreError(true);
        setLoadingMore(false);
      }
    );
  }, [debounced, sort, items.length]);

  const handleSort = (s: CommunitySort) => {
    const next = new URLSearchParams(params);
    if (s === "newest") next.delete("sort"); else next.set("sort", s);
    setParams(next, { replace: true });
  };

  return (
    <div className="min-h-screen flex flex-col items-center pt-2 pb-12">
      <SEO title="Community Puzzles — Rainbow Connect" description="Play puzzles made by other Rainbow players." path="/community" noIndex />
      <GameHeader user={user} onSignOut={() => signOutOfRainbow()} simplifiedIcons wideHeader />
      <div className="w-full max-w-[840px] border-b border-border mb-4" />
      <CommunityView
        query={query}
        onQuery={setQuery}
        sort={sort}
        onSort={handleSort}
        status={status}
        items={items}
        hasMore={hasMore}
        loadingMore={loadingMore}
        moreError={moreError}
        onRetry={() => setAttempt((n) => n + 1)}
        onMore={handleMore}
        shownQuery={shownQuery}
      />
      <SiteFooter />
    </div>
  );
}
