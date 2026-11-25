/**
 * The showcase's stand-in for src/integrations/supabase/client.ts.
 *
 * vite.showcase.config.ts aliases the real client module to this file, so the
 * showcase bundle contains no Supabase URL, no key and no network code: every
 * call below is answered in memory from src/showcase/fixtures.ts, with the
 * same response shapes the real RPCs return. Guest only: nobody can sign in.
 * Plays and saves last for the visit (saves use the app's normal per-browser
 * storage, as a real guest's do).
 */
import { CREATORS, CURATION, DEMO_GROUPS, PUZZLES, puzzle, type ShowcasePuzzle } from "./fixtures";

type Result = { data: unknown; error: { message: string; code?: string } | null };
const ok = (data: unknown): Result => ({ data, error: null });
const unavailable = (what: string): Result => ({ data: null, error: { message: `${what} isn't part of this showcase` } });

const plays = new Map(PUZZLES.map((p) => [p.key, p.plays]));
const wins = new Map(PUZZLES.map((p) => [p.key, Math.round(p.plays * 0.7)]));
const guessTotals = new Map(PUZZLES.map((p) => [p.key, Math.round(p.plays * 0.7) * 6]));
const runs = new Set<string>();

const byCode = (code: unknown) => PUZZLES.find((p) => p.shortCode === code);
const byShare = (id: unknown) => PUZZLES.find((p) => p.shareId === id);
const listed = () => PUZZLES; // every showcase puzzle is listed in Community
const newestFirst = (list: ShowcasePuzzle[]) => [...list].sort((a, b) => b.listedAt.localeCompare(a.listedAt) || a.shortCode.localeCompare(b.shortCode));

function card(p: ShowcasePuzzle) {
  return {
    title: p.title,
    creator_name: p.creator.name,
    creator_slug: p.creator.slug,
    mode: p.mode,
    short_code: p.shortCode,
    finished_plays: plays.get(p.key) ?? 0,
    favorite_count: p.favorites,
    listed_at: p.listedAt,
    cover_emoji: p.cover?.emoji ?? null,
    cover_background: p.cover?.background ?? null,
  };
}

function content(p: ShowcasePuzzle) {
  return {
    mode: p.mode,
    groups: p.groups.map((g, i) => ({ category: g.category, words: g.words, hint_word: null, category_emoji: null, sort_order: i })),
    word_order: p.wordOrder,
    rainbow_herring: p.rainbow?.herring ?? null,
    rainbow_category_name: p.rainbow?.name ?? null,
    rainbow_hint_word: null,
    rainbow_category_emoji: null,
    alphabetize_completed: true,
  };
}

function full(p: ShowcasePuzzle) {
  return {
    id: `id-${p.key}`,
    share_id: p.shareId,
    short_code: p.shortCode,
    title: p.title,
    creator_name: p.creator.name,
    visibility: "public",
    content: content(p),
    creator_slug: p.creator.slug,
    favorite_count: p.favorites,
    favorited_by_me: false,
    cover_emoji: p.cover?.emoji ?? null,
    cover_background: p.cover?.background ?? null,
  };
}

function creatorJson(c: (typeof CREATORS)[number]) {
  return {
    display_name: c.name,
    public_slug: c.slug,
    listed_count: listed().filter((p) => p.creator === c).length,
    follower_count: c.followers,
    followed_by_me: false,
    is_me: false,
  };
}

function matches(q: unknown, ...fields: string[]) {
  const needle = typeof q === "string" ? q.trim().toLowerCase().slice(0, 60) : "";
  return !needle || fields.some((f) => f.toLowerCase().includes(needle));
}

function page<T>(items: T[], limit: unknown, offset: unknown) {
  const lim = Math.min(Math.max(Number(limit ?? 24) || 24, 1), 48);
  const off = Math.min(Math.max(Number(offset ?? 0) || 0, 0), 2000);
  return { items: items.slice(off, off + lim), has_more: items.length > off + lim, limit: lim, offset: off };
}

function rpc(name: string, a: Record<string, unknown> = {}): Result {
  switch (name) {
    case "get_community_explore": {
      const featured = PUZZLES.find((p) => p.key === CURATION.featured);
      return ok({ featured: featured ? card(featured) : null, picks: CURATION.picks.map((k) => card(PUZZLES.find((p) => p.key === k)!)) });
    }
    case "list_community_newest": {
      const all = newestFirst(listed());
      const lim = Math.min(Math.max(Number(a._limit ?? 24) || 24, 1), 48);
      const start = a._before_listed_at
        ? all.findIndex((p) => p.listedAt < String(a._before_listed_at) || (p.listedAt === a._before_listed_at && p.shortCode > String(a._before_short_code ?? "")))
        : 0;
      const rest = start < 0 ? [] : all.slice(start);
      return ok({ items: rest.slice(0, lim).map(card), has_more: rest.length > lim, limit: lim });
    }
    case "list_community_puzzles": {
      let list = listed().filter((p) => matches(a._query, p.title, p.creator.name));
      list = a._sort === "plays" ? [...list].sort((x, y) => (plays.get(y.key) ?? 0) - (plays.get(x.key) ?? 0) || y.listedAt.localeCompare(x.listedAt)) : newestFirst(list);
      const pg = page(list, a._limit, a._offset);
      return ok({ ...pg, items: pg.items.map(card) });
    }
    case "search_community_creators": {
      const list = CREATORS.filter((c) => listed().some((p) => p.creator === c) && matches(a._query, c.name, c.slug));
      const pg = page(list, a._limit, a._offset);
      return ok({ ...pg, items: pg.items.map(creatorJson) });
    }
    case "get_creator_community": {
      const c = CREATORS.find((x) => x.slug === a._slug);
      return ok(c ? { ...creatorJson(c), puzzles: newestFirst(listed().filter((p) => p.creator === c)).map(card) } : null);
    }
    case "get_creator_profile": {
      const c = CREATORS.find((x) => x.slug === a._slug);
      if (!c) return ok(null);
      const mine = newestFirst(PUZZLES.filter((p) => p.creator === c));
      return ok({
        display_name: c.name, public_slug: c.slug, puzzle_count: mine.length,
        total_plays: mine.reduce((n, p) => n + (plays.get(p.key) ?? 0), 0),
        total_favorites: mine.reduce((n, p) => n + p.favorites, 0),
        puzzles: mine.map((p) => ({ title: p.title, mode: p.mode, short_code: p.shortCode, finished_plays: plays.get(p.key) ?? 0, favorite_count: p.favorites, created_at: p.listedAt })),
      });
    }
    case "get_custom_puzzle_by_short_code": {
      const p = byCode(a._short_code);
      return ok(p ? full(p) : null);
    }
    case "get_custom_puzzle": {
      const p = byShare(a._share_id);
      return ok(p ? full(p) : null);
    }
    case "custom_puzzle_share_id":
      return ok(byCode(a._short_code)?.shareId ?? null);
    case "get_custom_puzzle_cards": {
      const ids = Array.isArray(a._share_ids) ? (a._share_ids as string[]).slice(0, 200) : [];
      return ok(ids.flatMap((id) => { const p = byShare(id); return p ? [{ share_id: id, ...card(p) }] : []; }));
    }
    case "create_device_identity":
      return ok([{ device_id: "showcase-device", device_token: "showcase-only" }]);
    case "submit_custom_puzzle_result": {
      const p = byShare(a._share_id);
      const run = String(a._run_id ?? "");
      if (!p || runs.has(run)) return ok(false);
      runs.add(run);
      plays.set(p.key, (plays.get(p.key) ?? 0) + 1);
      if (a._won) {
        wins.set(p.key, (wins.get(p.key) ?? 0) + 1);
        guessTotals.set(p.key, (guessTotals.get(p.key) ?? 0) + Number(a._total_guesses ?? 0));
      }
      return ok(true);
    }
    case "get_custom_puzzle_stats": {
      const p = byShare(a._share_id);
      if (!p) return ok(null);
      const total = plays.get(p.key) ?? 0;
      const w = Math.min(wins.get(p.key) ?? 0, total);
      return ok({
        completed_plays: total, finished_plays: total, wins: w, losses: total - w,
        avg_guesses: w ? Math.round(((guessTotals.get(p.key) ?? 0) / w) * 100) / 100 : 0,
        guess_distribution: { "4": Math.round(w * 0.2), "5": Math.round(w * 0.3), "6": Math.round(w * 0.25), "7": Math.round(w * 0.15), "8+": w - Math.round(w * 0.2) - Math.round(w * 0.3) - Math.round(w * 0.25) - Math.round(w * 0.15) },
      });
    }
    // Guest-only reads that a signed-out player gets nothing back from.
    case "get_own_completed_sessions":
    case "get_own_streak":
    case "get_own_personal_stats_history":
      return ok([]);
    case "get_my_favorites":
      return ok([]);
    default:
      return unavailable(name);
  }
}

/**
 * The showcase's "publish": adds a fictional puzzle by a fictional creator to
 * this visit's Newest, with the cover the visitor picked. Nothing is stored.
 */
let demoCount = 0;
export function publishDemoPuzzle(title: string, cover: { emoji: string; background: string } | null): string {
  demoCount++;
  const code = `DemoPuz${String(demoCount).padStart(3, "0")}`;
  const you = { userId: "fixture-you", slug: "you-demo-a1b2", name: "You (demo)", followers: 0 };
  if (!CREATORS.some((c) => c.slug === you.slug)) CREATORS.push(you);
  PUZZLES.push(puzzle({
    key: `demo${demoCount}`, title: title.trim().slice(0, 100) || "My Demo Puzzle", creator: CREATORS.find((c) => c.slug === you.slug)!,
    shortCode: code, mode: "classic", groups: DEMO_GROUPS, listedAt: new Date().toISOString(), plays: 0, favorites: 0,
    ...(cover ? { cover } : {}),
  }));
  plays.set(`demo${demoCount}`, 0);
  return code;
}

/** A thenable query builder that answers every table read with no rows. */
function emptyQuery(): unknown {
  const result = Promise.resolve({ data: [], error: null, count: 0 });
  const builder: Record<string, unknown> = new Proxy({}, {
    get(_t, prop) {
      if (prop === "then") return result.then.bind(result);
      if (prop === "catch") return result.catch.bind(result);
      if (prop === "single" || prop === "maybeSingle") return () => Promise.resolve({ data: null, error: null });
      return () => builder;
    },
  });
  return builder;
}

const noSession = { data: { session: null }, error: null };

export const supabase = {
  rpc: (name: string, args?: Record<string, unknown>) => Promise.resolve(rpc(name, args)),
  from: () => emptyQuery(),
  storage: { from: () => ({ getPublicUrl: () => ({ data: { publicUrl: "" } }), list: () => Promise.resolve({ data: [], error: null }) }) },
  auth: {
    getSession: () => Promise.resolve(noSession),
    getUser: () => Promise.resolve({ data: { user: null }, error: null }),
    onAuthStateChange: () => ({ data: { subscription: { unsubscribe: () => {} } } }),
    signOut: () => Promise.resolve({ error: null }),
    refreshSession: () => Promise.resolve(noSession),
    exchangeCodeForSession: () => Promise.resolve({ data: { session: null }, error: { message: "Signing in isn't part of this showcase" } }),
    signInWithOAuth: () => Promise.resolve({ data: null, error: { message: "Signing in isn't part of this showcase" } }),
    setSession: () => Promise.resolve(noSession),
  },
  channel: () => ({ on: () => ({ subscribe: () => ({}) }), subscribe: () => ({}), unsubscribe: () => {} }),
  removeChannel: () => {},
} as const;

export type { Result };
