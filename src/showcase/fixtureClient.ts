/**
 * The showcase's stand-in for src/integrations/supabase/client.ts.
 *
 * vite.showcase.config.ts aliases the real client module to this file, so the
 * showcase bundle contains no Supabase URL, no key and no network code: every
 * call below is answered in memory from src/showcase/fixtures.ts, with the
 * same response shapes the real RPCs return. A visitor starts as a guest
 * (saves use the app's normal per-browser storage, as a real guest's do) and
 * can switch to a fictional signed-in "Demo Player" (setShowcaseSignedIn) to
 * see account-only parts such as the post-game rating. Plays, saves, follows
 * and ratings last for the visit.
 */
import { CREATORS, CURATION, DEMO_GROUPS, DEMO_OWNED, DEMO_PLAYER, PUZZLES, puzzle, type ShowcasePuzzle } from "./fixtures";
import { validEmojiList, validSizes } from "@/lib/creatorCover";
import { COVER_BACKGROUND_KEYS } from "@/lib/coverBackgrounds";

// The Demo Player's own puzzles join the visit's puzzles (only the listed one shows in Community).
PUZZLES.push(...DEMO_OWNED);
CREATORS.push(DEMO_PLAYER);

type Result = { data: unknown; error: { message: string; code?: string } | null };
const ok = (data: unknown): Result => ({ data, error: null });
const unavailable = (what: string): Result => ({ data: null, error: { message: `${what} isn't part of this showcase` } });

const plays = new Map(PUZZLES.map((p) => [p.key, p.plays]));
/** Signed-in saves per puzzle (the Most Liked count); the demo player's own saves add to it. */
const likes = new Map(PUZZLES.map((p) => [p.key, p.favorites]));
const wins = new Map(PUZZLES.map((p) => [p.key, Math.round(p.plays * 0.7)]));
const guessTotals = new Map(PUZZLES.map((p) => [p.key, Math.round(p.plays * 0.7) * 6]));
const runs = new Set<string>();
/** Puzzles this visit has finished (the finish record a rating needs). */
const finished = new Set<string>();

// ── The fictional signed-in Demo Player (in memory only) ────────────────────
const DEMO_USER = { id: "fixture-demo-player", aud: "authenticated", role: "authenticated", email: "demo-player@example.invalid", app_metadata: {}, user_metadata: { full_name: "Demo Player" }, created_at: "2026-11-01T00:00:00Z" };
let session: { user: typeof DEMO_USER; access_token: string; refresh_token: string; token_type: string; expires_in: number; expires_at: number } | null = null;
const authListeners = new Set<(event: string, s: typeof session) => void>();
const myFavorites = new Set<string>();
const myFollows = new Set<string>();
const myRatings = new Map<string, number>();
/** The Demo Player's public name: earlier bylines keep the name they were saved with. */
const demoName: { name: string; renamedAt: number | null } = { name: "Demo Player", renamedAt: null };
const COOLDOWN_MS = 720 * 3600 * 1000;

export function showcaseSignedIn(): boolean {
  return session !== null;
}

/** Switches between the guest and the fictional signed-in Demo Player. */
export function setShowcaseSignedIn(on: boolean): void {
  session = on ? { user: DEMO_USER, access_token: "showcase-only", refresh_token: "showcase-only", token_type: "bearer", expires_in: 86400, expires_at: Math.floor(Date.now() / 1000) + 86400 } : null;
  for (const fn of authListeners) fn(on ? "SIGNED_IN" : "SIGNED_OUT", session);
}

const byCode = (code: unknown) => PUZZLES.find((p) => p.shortCode === code);
const byShare = (id: unknown) => PUZZLES.find((p) => p.shareId === id);
/** Not in Community this visit: link-only and private puzzles (owners can list and unlist theirs). */
const unlisted = new Set(PUZZLES.filter((p) => p.unlisted || p.visibility === "private").map((p) => p.key));
const listed = () => PUZZLES.filter((p) => !unlisted.has(p.key));
const mine = (p: ShowcasePuzzle | undefined) => !!(p && session && p.ownedByDemo);
const isPublic = (p: ShowcasePuzzle) => p.visibility !== "private";
const newestFirst = (list: ShowcasePuzzle[]) => [...list].sort((a, b) => b.listedAt.localeCompare(a.listedAt) || a.shortCode.localeCompare(b.shortCode));

function card(p: ShowcasePuzzle) {
  return {
    title: p.title,
    creator_name: p.byline ?? p.creator.name,
    creator_slug: p.creator.slug,
    mode: p.mode,
    short_code: p.shortCode,
    finished_plays: plays.get(p.key) ?? 0,
    favorite_count: likes.get(p.key) ?? 0,
    listed_at: p.listedAt,
    cover_emoji: p.cover?.emojis[0] ?? null,
    cover_emoji_2: p.cover?.emojis[1] ?? null,
    cover_emoji_3: p.cover?.emojis[2] ?? null,
    cover_background: p.cover?.background ?? null,
    cover_sizes: p.cover?.sizes ?? null,
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
    creator_name: p.byline ?? p.creator.name,
    visibility: p.visibility ?? "public",
    content: content(p),
    creator_slug: p.creator.slug,
    favorite_count: likes.get(p.key) ?? 0,
    favorited_by_me: session !== null && myFavorites.has(p.key),
    cover_emoji: p.cover?.emojis[0] ?? null,
    cover_emoji_2: p.cover?.emojis[1] ?? null,
    cover_emoji_3: p.cover?.emojis[2] ?? null,
    cover_background: p.cover?.background ?? null,
    cover_sizes: p.cover?.sizes ?? null,
  };
}

function creatorJson(c: (typeof CREATORS)[number]) {
  return {
    display_name: c === DEMO_PLAYER ? demoName.name : c.name,
    public_slug: c.slug,
    listed_count: listed().filter((p) => p.creator === c).length,
    follower_count: c.followers + (session !== null && myFollows.has(c.slug) ? 1 : 0),
    followed_by_me: session !== null && myFollows.has(c.slug),
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
      // Same order as the server: the chosen count, then newest listing, then short code.
      const tie = (x: ShowcasePuzzle, y: ShowcasePuzzle) => y.listedAt.localeCompare(x.listedAt) || x.shortCode.localeCompare(y.shortCode);
      list = a._sort === "plays" ? [...list].sort((x, y) => (plays.get(y.key) ?? 0) - (plays.get(x.key) ?? 0) || tie(x, y))
        : a._sort === "likes" ? [...list].sort((x, y) => (likes.get(y.key) ?? 0) - (likes.get(x.key) ?? 0) || tie(x, y))
        : newestFirst(list);
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
      const mine = newestFirst(PUZZLES.filter((p) => p.creator === c && isPublic(p)));
      return ok({
        display_name: c === DEMO_PLAYER ? demoName.name : c.name, public_slug: c.slug, puzzle_count: mine.length,
        total_plays: mine.reduce((n, p) => n + (plays.get(p.key) ?? 0), 0),
        total_favorites: mine.reduce((n, p) => n + (likes.get(p.key) ?? 0), 0),
        puzzles: mine.map((p) => ({ title: p.title, mode: p.mode, short_code: p.shortCode, finished_plays: plays.get(p.key) ?? 0, favorite_count: likes.get(p.key) ?? 0, created_at: p.listedAt })),
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
      finished.add(p.key);
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
      return ok(session ? PUZZLES.filter((p) => myFavorites.has(p.key)).map(card) : []);
    // ── Signed-in Demo Player only ──
    case "has_role":
      return ok(false);
    case "get_my_custom_puzzle_listing": {
      const p = byShare(a._share_id);
      if (!p) return ok(null);
      if (!mine(p)) return ok({ owned: false });
      return ok({ owned: true, listed: !unlisted.has(p.key), can_list: isPublic(p), visibility: p.visibility ?? "public" });
    }
    // ── My Puzzles: the Demo Player's own library and owner actions ──
    case "rename_custom_puzzle": {
      const p = byShare(a._share_id);
      const title = typeof a._title === "string" ? a._title.trim() : "";
      if (!session) return { data: null, error: { message: "sign in to rename your puzzles" } };
      if (!title) return { data: null, error: { message: "a puzzle needs a title" } };
      if (title.length > 100) return { data: null, error: { message: "title is too long (max 100 characters)" } };
      if (!p) return { data: null, error: { message: "puzzle not found" } };
      if (!mine(p)) return { data: null, error: { message: "only the puzzle's creator can rename it" } };
      p.title = title;
      return ok({ title });
    }
    case "get_my_custom_puzzle_source": {
      const p = byShare(a._share_id);
      if (!session) return { data: null, error: { message: "sign in to copy your puzzles" } };
      if (!p) return { data: null, error: { message: "puzzle not found" } };
      if (!mine(p)) return { data: null, error: { message: "only the puzzle's creator can copy it" } };
      return ok({ title: p.title, creator_name: p.creator.name, visibility: p.visibility ?? "public", content: content(p) });
    }
    // The demo's Create (used for Duplicate & Edit copies): an in-memory puzzle,
    // never listed unless the visitor lists it, owned by the Demo Player.
    case "create_custom_puzzle": {
      const c = (a._content ?? {}) as { mode?: string; groups?: { category: string; words: string[] }[]; word_order?: string[] | null; rainbow_herring?: string[] | null; rainbow_category_name?: string | null };
      const title = typeof a._title === "string" ? a._title.trim() : "";
      if (!title) return { data: null, error: { message: "a puzzle needs a title" } };
      if (title.length > 100) return { data: null, error: { message: "title is too long (max 100 characters)" } };
      if (!Array.isArray(c.groups) || c.groups.length !== 4) return { data: null, error: { message: "a puzzle needs four categories" } };
      demoCount++;
      const key = `made${demoCount}`;
      const now = new Date().toISOString();
      const made = puzzle({
        key, title, creator: session ? DEMO_PLAYER : { userId: "fixture-guest", slug: "", name: String(a._creator_name ?? "Guest"), followers: 0 },
        ...(session ? { byline: demoName.name } : {}),
        shortCode: `DemoNew${String(demoCount).padStart(3, "0")}`, mode: c.mode === "rainbow" ? "rainbow" : "classic",
        groups: c.groups.map((g) => ({ category: g.category, words: g.words })),
        ...(c.mode === "rainbow" && c.rainbow_herring ? { rainbow: { name: c.rainbow_category_name ?? "", herring: c.rainbow_herring } } : {}),
        listedAt: now, createdAt: now, plays: 0, favorites: 0, ownedByDemo: !!session, unlisted: true,
        visibility: a._visibility === "private" ? "private" : "public",
      });
      if (Array.isArray(c.word_order) && c.word_order.length === 16) made.wordOrder = c.word_order;
      PUZZLES.push(made);
      unlisted.add(key);
      plays.set(key, 0);
      likes.set(key, 0);
      return ok({ puzzle_id: `id-${key}`, share_id: made.shareId, short_code: made.shortCode });
    }
    case "list_my_custom_puzzles": {
      if (!session) return { data: null, error: { message: "sign in to see your puzzles" } };
      const own = PUZZLES.filter((p) => p.ownedByDemo)
        .sort((x, y) => (y.createdAt ?? y.listedAt).localeCompare(x.createdAt ?? x.listedAt) || x.shortCode.localeCompare(y.shortCode));
      const pg = page(own, a._limit, a._offset);
      return ok({
        ...pg,
        total: own.length,
        items: pg.items.map((p) => ({
          share_id: p.shareId, short_code: p.shortCode, title: p.title, creator_name: p.byline ?? p.creator.name, mode: p.mode,
          visibility: p.visibility ?? "public", hidden: false, listed: !unlisted.has(p.key), can_list: isPublic(p),
          cover_emoji: p.cover?.emojis[0] ?? null, cover_emoji_2: p.cover?.emojis[1] ?? null, cover_emoji_3: p.cover?.emojis[2] ?? null,
          cover_background: p.cover?.background ?? null,
    cover_sizes: p.cover?.sizes ?? null, created_at: p.createdAt ?? p.listedAt,
        })),
      });
    }
    case "set_custom_puzzle_community_listing": {
      const p = byShare(a._share_id);
      if (!session) return { data: null, error: { message: "sign in to list a puzzle in Community" } };
      if (!p) return { data: null, error: { message: "puzzle not found" } };
      if (!mine(p)) return { data: null, error: { message: "only the puzzle's creator can change its Community listing" } };
      if (a._listed && !isPublic(p)) return { data: null, error: { message: "private puzzles cannot be listed in Community" } };
      if (a._listed) {
        // First listing time is kept, as on the server: re-listing never bumps Newest.
        if (p.unlisted && unlisted.has(p.key) && !p.listedAtSet) { p.listedAt = new Date().toISOString(); p.listedAtSet = true; }
        unlisted.delete(p.key);
      } else unlisted.add(p.key);
      return ok({ listed: !!a._listed });
    }
    // ── Per-emoji sizes (0014) and the public name (0013), in memory ──
    case "set_custom_puzzle_cover_sized": {
      const p = byShare(a._share_id);
      if (!session) return { data: null, error: { message: "sign in to add a cover" } };
      if (!p) return { data: null, error: { message: "puzzle not found" } };
      if (!mine(p)) return { data: null, error: { message: "only the puzzle's creator can change its cover" } };
      if (a._emojis == null) {
        delete p.cover;
        return ok({ cover_emoji: null, cover_emoji_2: null, cover_emoji_3: null, cover_background: null, cover_sizes: null });
      }
      const emojis = Array.isArray(a._emojis) ? validEmojiList(a._emojis) : null;
      if (!emojis || typeof a._background !== "string" || !COVER_BACKGROUND_KEYS.includes(a._background)) return { data: null, error: { message: "that cover isn't available" } };
      const sizes = a._sizes == null ? null : validSizes(a._sizes, emojis.length);
      if (a._sizes != null && !sizes) return { data: null, error: { message: "an emoji size is from 50% to 250%" } };
      p.cover = { emojis, background: a._background, ...(sizes && sizes.some((v) => v !== 100) ? { sizes } : {}) };
      return ok({ cover_emoji: emojis[0], cover_emoji_2: emojis[1] ?? null, cover_emoji_3: emojis[2] ?? null, cover_background: a._background, cover_sizes: p.cover.sizes ?? null });
    }
    case "ensure_my_creator_profile":
      return session ? ok({ public_slug: DEMO_PLAYER.slug }) : { data: null, error: { message: "sign in to manage your puzzles" } };
    case "get_my_creator_name":
      if (!session) return { data: null, error: { message: "sign in to manage your public name" } };
      return ok({ display_name: demoName.name, next_change_at: demoName.renamedAt ? new Date(demoName.renamedAt + COOLDOWN_MS).toISOString() : null, chosen: true, outcome: "ready" });
    case "set_my_creator_name": {
      if (!session) return { data: null, error: { message: "sign in to manage your public name" } };
      const raw = typeof a._name === "string" ? a._name : "";
      const clean = raw.replace(/\s+/g, " ").trim();
      const next = () => (demoName.renamedAt ? new Date(demoName.renamedAt + COOLDOWN_MS).toISOString() : null);
      // eslint-disable-next-line no-control-regex -- refuses control characters, as the server does
      if (!clean || clean.length > 60 || /[@\u0000-\u001f]/.test(raw)) return ok({ outcome: "invalid" });
      if (clean === demoName.name) return ok({ outcome: "unchanged", chosen: true, display_name: demoName.name, next_change_at: next() });
      if (demoName.renamedAt && demoName.renamedAt + COOLDOWN_MS > Date.now()) return ok({ outcome: "cooldown", chosen: true, display_name: demoName.name, next_change_at: next() });
      // The first rename is immediate and starts the 30-day wait.
      demoName.name = clean;
      demoName.renamedAt = Date.now();
      return ok({ outcome: "saved", chosen: true, display_name: clean, next_change_at: next() });
    }
    case "set_custom_puzzle_cover_emojis": {
      const p = byShare(a._share_id);
      if (!session) return { data: null, error: { message: "sign in to set a cover" } };
      if (!p) return { data: null, error: { message: "puzzle not found" } };
      if (!mine(p)) return { data: null, error: { message: "only the puzzle's creator can change its cover" } };
      if (a._emojis == null) {
        delete p.cover;
      } else {
        const emojis = Array.isArray(a._emojis) ? validEmojiList(a._emojis) : null;
        if (!emojis || typeof a._background !== "string" || !COVER_BACKGROUND_KEYS.includes(a._background)) return { data: null, error: { message: "that cover isn't available" } };
        p.cover = { emojis, background: a._background };
      }
      return ok({ cover_emoji: p.cover?.emojis[0] ?? null, cover_emoji_2: p.cover?.emojis[1] ?? null, cover_emoji_3: p.cover?.emojis[2] ?? null, cover_background: p.cover?.background ?? null });
    }
    case "set_custom_puzzle_favorite": {
      const p = byShare(a._share_id);
      if (!session || !p) return unavailable("Saving to an account");
      const had = myFavorites.has(p.key);
      if (a._favorite && !had) { myFavorites.add(p.key); likes.set(p.key, (likes.get(p.key) ?? 0) + 1); }
      if (!a._favorite && had) { myFavorites.delete(p.key); likes.set(p.key, Math.max(0, (likes.get(p.key) ?? 0) - 1)); }
      return ok({ favorited: myFavorites.has(p.key), favorite_count: likes.get(p.key) ?? 0 });
    }
    case "set_creator_follow": {
      const c = CREATORS.find((x) => x.slug === a._slug);
      if (!session || !c) return unavailable("Following");
      if (a._follow) myFollows.add(c.slug); else myFollows.delete(c.slug);
      return ok({ following: myFollows.has(c.slug), follower_count: c.followers + (myFollows.has(c.slug) ? 1 : 0) });
    }
    case "get_following_feed": {
      const mine = newestFirst(listed().filter((p) => session && myFollows.has(p.creator.slug)));
      const pg = page(mine, a._limit, a._offset);
      return ok({ ...pg, items: pg.items.map(card), creators: session ? CREATORS.filter((c) => myFollows.has(c.slug)).map(creatorJson) : [] });
    }
    case "get_my_custom_puzzle_rating": {
      const p = byShare(a._share_id);
      return ok({ rating: (p && session && myRatings.get(p.key)) || null, can_rate: !!(p && session) });
    }
    case "set_custom_puzzle_rating": {
      const p = byShare(a._share_id);
      const r = a._rating;
      if (!session) return { data: null, error: { message: "sign in to rate puzzles" } };
      if (typeof r !== "number" || !Number.isInteger(r) || r < 1 || r > 5) return { data: null, error: { message: "a rating is a whole number from 1 to 5" } };
      if (!p) return { data: null, error: { message: "puzzle not found" } };
      if (!finished.has(p.key)) return { data: null, error: { message: "finish the puzzle to rate it" } };
      myRatings.set(p.key, r);
      return ok({ rating: r });
    }
    default:
      return unavailable(name);
  }
}

/**
 * The showcase's "publish": adds a fictional puzzle by a fictional creator to
 * this visit's Newest, with the cover the visitor picked. Nothing is stored.
 */
let demoCount = 0;
export function publishDemoPuzzle(title: string, cover: { emojis: string[]; background: string } | null): string {
  demoCount++;
  const code = `DemoPuz${String(demoCount).padStart(3, "0")}`;
  const you = { userId: "fixture-you", slug: "you-demo-a1b2", name: "You (demo)", followers: 0 };
  if (!CREATORS.some((c) => c.slug === you.slug)) CREATORS.push(you);
  PUZZLES.push(puzzle({
    key: `demo${demoCount}`, title: title.trim().slice(0, 100) || "My Demo Puzzle", creator: CREATORS.find((c) => c.slug === you.slug)!,
    shortCode: code, mode: "classic", groups: DEMO_GROUPS, listedAt: new Date().toISOString(), plays: 0, favorites: 0, ownedByDemo: true,
    ...(cover ? { cover } : {}),
  }));
  plays.set(`demo${demoCount}`, 0);
  likes.set(`demo${demoCount}`, 0);
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

const currentSession = () => ({ data: { session }, error: null });

export const supabase = {
  rpc: (name: string, args?: Record<string, unknown>) => Promise.resolve(rpc(name, args)),
  from: () => emptyQuery(),
  storage: { from: () => ({ getPublicUrl: () => ({ data: { publicUrl: "" } }), list: () => Promise.resolve({ data: [], error: null }) }) },
  auth: {
    getSession: () => Promise.resolve(currentSession()),
    getUser: () => Promise.resolve({ data: { user: session?.user ?? null }, error: null }),
    onAuthStateChange: (fn: (event: string, s: typeof session) => void) => {
      authListeners.add(fn);
      return { data: { subscription: { unsubscribe: () => { authListeners.delete(fn); } } } };
    },
    signOut: () => { setShowcaseSignedIn(false); return Promise.resolve({ error: null }); },
    refreshSession: () => Promise.resolve(currentSession()),
    exchangeCodeForSession: () => Promise.resolve({ data: { session: null }, error: { message: "Signing in isn't part of this showcase" } }),
    signInWithOAuth: () => Promise.resolve({ data: null, error: { message: "Signing in isn't part of this showcase" } }),
    setSession: () => Promise.resolve(currentSession()),
  },
  channel: () => ({ on: () => ({ subscribe: () => ({}) }), subscribe: () => ({}), unsubscribe: () => {} }),
  removeChannel: () => {},
} as const;

export type { Result };
