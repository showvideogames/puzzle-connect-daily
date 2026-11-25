/**
 * Public custom puzzles — the network layer for /create and /custom/:shareId.
 *
 * Mirrors lib/betaPlaytest.ts in spirit: a deliberately small, separate write
 * path rather than a reuse of the official puzzles/game_sessions machinery.
 * A custom puzzle never touches puzzles, puzzle_groups, puzzle_versions,
 * game_sessions, guess_events, hint_events, game_results, user_streaks,
 * puzzle_aggregates or beta_playtests/beta_feedback — see the
 * 20260919000000 migration's access model.
 *
 * The five RPCs this module calls (create_custom_puzzle, get_custom_puzzle,
 * submit_custom_puzzle_result, get_custom_puzzle_stats,
 * admin_set_custom_puzzle_status) are in the generated Database type as of
 * the 20260919000000 migration — this goes through the normal typed
 * `supabase.rpc`, no shim needed.
 */
import { supabase } from "@/integrations/supabase/client";
import { Puzzle, PuzzleGroup } from "./types";
import { ensureDeviceIdentity } from "./gameStats";
import { getFormat, type Difficulty, type PuzzleFormatId } from "./puzzleFormat";
import { parseCover, type CreatorCover } from "./creatorCover";

export type CustomPuzzleMode = "classic" | "rainbow";
export type CustomPuzzleVisibility = "public" | "private";

export interface CustomGroupInput {
  category: string;
  words: string[];
  hintWord: string | null;
  categoryEmoji?: string | null;
  /** Hint Only — see PuzzleGroup.categoryEmojiHintOnly. */
  categoryEmojiHintOnly?: boolean | null;
}

export interface CustomPuzzleContentInput {
  /**
   * The board format. OMITTED for Full — validate_custom_puzzle_content
   * treats an absent format as Full and emits no format key, so every custom
   * puzzle already stored canonicalises exactly as it does today and every
   * existing /p/:shortCode and /custom/:shareId URL is unaffected.
   */
  format?: PuzzleFormatId;
  mode: CustomPuzzleMode;
  groups: CustomGroupInput[];
  wordOrder: string[];
  rainbowHerring: string[] | null;
  rainbowCategoryName: string | null;
  rainbowHintWord: string | null;
  rainbowCategoryEmoji?: string | null;
  rainbowCategoryEmojiHintOnly?: boolean | null;
  alphabetizeCompleted: boolean;
}

export interface CreateCustomPuzzleInput {
  creatorName: string;
  title: string;
  visibility: CustomPuzzleVisibility;
  content: CustomPuzzleContentInput;
}

export interface CreateCustomPuzzleResult {
  puzzleId: string;
  shareId: string;
  /** The short /p/:shortCode code; null only against a database that predates it. */
  shortCode: string | null;
}

function contentPayload(content: CustomPuzzleContentInput) {
  const format = getFormat(content.format);
  return {
    // Full sends no format key at all — see CustomPuzzleContentInput.format.
    ...(format.id === "full" ? {} : { format: format.id }),
    mode: content.mode,
    groups: content.groups.map((g) => ({
      category: g.category,
      words: g.words,
      hint_word: g.hintWord,
      category_emoji: g.categoryEmoji?.trim() || null,
      // Emitted only when there is an emoji to withhold — see
      // buildContentPayload's hintOnly, and validate_custom_puzzle_content,
      // which drops a stray flag the same way.
      ...(g.categoryEmojiHintOnly && (g.categoryEmoji?.trim() || null) !== null
        ? { category_emoji_hint_only: true as const }
        : {}),
    })),
    word_order: content.wordOrder,
    rainbow_herring: content.mode === "rainbow" ? content.rainbowHerring : null,
    rainbow_category_name: content.mode === "rainbow" ? content.rainbowCategoryName : null,
    rainbow_hint_word: content.mode === "rainbow" ? content.rainbowHintWord : null,
    rainbow_category_emoji: content.mode === "rainbow" ? content.rainbowCategoryEmoji?.trim() || null : null,
    ...(content.mode === "rainbow" && content.rainbowCategoryEmojiHintOnly && (content.rainbowCategoryEmoji?.trim() || null) !== null
      ? { rainbow_category_emoji_hint_only: true as const }
      : {}),
    alphabetize_completed: content.alphabetizeCompleted,
  };
}

/** Throws on failure (the caller — the /create page — needs the real message to show near the right field). */
export async function createCustomPuzzle(input: CreateCustomPuzzleInput): Promise<CreateCustomPuzzleResult> {
  const { data, error } = await supabase.rpc("create_custom_puzzle", {
    _creator_name: input.creatorName,
    _title: input.title,
    _visibility: input.visibility,
    _content: contentPayload(input.content),
  });
  if (error) throw error;
  const row = (data ?? {}) as { puzzle_id?: string; share_id?: string; short_code?: string };
  if (!row.puzzle_id || !row.share_id) throw new Error("Puzzle was not created.");
  return { puzzleId: row.puzzle_id, shareId: row.share_id, shortCode: row.short_code ?? null };
}

export interface CustomPlayablePuzzle {
  puzzle: Puzzle;
  visibility: CustomPuzzleVisibility;
  /** Present only when a signed-in creator made it; anonymous puzzles are never linked. */
  creatorSlug: string | null;
  favoriteCount: number;
  /** Whether the CURRENT signed-in account has favorited it (false for guests). */
  favoritedByMe: boolean;
  /** Its creator cover, or null for none (Community preview; absent before 0008). */
  cover: CreatorCover | null;
}

interface CustomPuzzleRow {
  id: string;
  share_id: string;
  short_code?: string | null;
  creator_slug?: string | null;
  favorite_count?: number;
  favorited_by_me?: boolean;
  cover_emoji?: string | null;
  cover_emoji_2?: string | null;
  cover_emoji_3?: string | null;
  cover_background?: string | null;
  title: string;
  creator_name: string;
  visibility: CustomPuzzleVisibility;
  content: {
    format?: PuzzleFormatId;
    mode: CustomPuzzleMode;
    groups: {
      category: string;
      words: string[];
      hint_word: string | null;
      category_emoji?: string | null;
      category_emoji_hint_only?: boolean | null;
      sort_order: number;
    }[];
    word_order: string[] | null;
    rainbow_herring: string[] | null;
    rainbow_category_name: string | null;
    rainbow_hint_word: string | null;
    rainbow_category_emoji?: string | null;
    rainbow_category_emoji_hint_only?: boolean | null;
    alphabetize_completed: boolean;
  };
}

function mapRowToPuzzle(row: CustomPuzzleRow): Puzzle {
  // A custom puzzle stores its categories in display order and derives the
  // difficulty/colour from that position. Which colours those are is the
  // FORMAT's business: Full gives Yellow/Green/Blue/Red (1-4), Mini gives
  // Green/Blue/Red (2-4). An absent format is Full, so every custom puzzle
  // stored before Mini maps exactly as it always has.
  const format = getFormat(row.content.format);
  const groups: PuzzleGroup[] = [...row.content.groups]
    .sort((a, b) => a.sort_order - b.sort_order)
    .map((g, i) => ({
      category: g.category,
      words: g.words,
      difficulty: (format.difficultyOrder[i] ?? format.difficultyOrder[format.difficultyOrder.length - 1]) as Difficulty,
      hintWord: g.hint_word ?? null,
      categoryEmoji: g.category_emoji ?? null,
      // Absent on every custom puzzle stored before Hint Only existed, which
      // means "show it on the solved bar" — exactly how they read today.
      categoryEmojiHintOnly: g.category_emoji_hint_only ?? false,
    }));

  return {
    // The custom puzzle's own share_id doubles as its Puzzle.id — this is
    // what makes useGame's "custom" mode namespace localStorage progress as
    // `custom:<shareId>` and what lib/customPuzzles' completion/stats calls
    // key on, with no separate id plumbing needed anywhere downstream.
    id: row.share_id,
    format: format.id,
    date: "",
    title: row.title,
    designerName: row.creator_name,
    groups,
    wordOrder: row.content.word_order,
    rainbowHerring: row.content.mode === "rainbow" ? row.content.rainbow_herring : null,
    rainbowCategoryName: row.content.mode === "rainbow" ? row.content.rainbow_category_name : null,
    rainbowHintWord: row.content.mode === "rainbow" ? row.content.rainbow_hint_word : null,
    rainbowCategoryEmoji: row.content.mode === "rainbow" ? row.content.rainbow_category_emoji ?? null : null,
    rainbowCategoryEmojiHintOnly:
      row.content.mode === "rainbow" ? row.content.rainbow_category_emoji_hint_only ?? false : false,
    isEmojiPuzzle: false,
    isFreePuzzle: false,
    theme: null,
    alphabetizeCompleted: row.content.alphabetize_completed ?? true,
    versionId: null,
    shortCode: row.short_code ?? null,
  };
}

function toPlayable(data: unknown): CustomPlayablePuzzle | null {
  const row = data as CustomPuzzleRow | null;
  if (!row || !row.id) return null;
  return {
    puzzle: mapRowToPuzzle(row),
    visibility: row.visibility,
    creatorSlug: row.creator_slug ?? null,
    favoriteCount: row.favorite_count ?? 0,
    favoritedByMe: row.favorited_by_me ?? false,
    cover: parseCover(row.cover_emoji, row.cover_background, row.cover_emoji_2, row.cover_emoji_3),
  };
}

/** Long, permanent /custom/:shareId links. */
export async function getCustomPuzzleByShareId(shareId: string): Promise<CustomPlayablePuzzle | null> {
  const { data, error } = await supabase.rpc("get_custom_puzzle", { _share_id: shareId });
  if (error) return null;
  return toPlayable(data);
}

/** Short /p/:shortCode links. Same puzzle, same identity (puzzle.id is still the long share id). */
export async function getCustomPuzzleByShortCode(shortCode: string): Promise<CustomPlayablePuzzle | null> {
  const { data, error } = await supabase.rpc("get_custom_puzzle_by_short_code", { _short_code: shortCode });
  if (error) return null;
  return toPlayable(data);
}

/** The path a puzzle is shared at: the short link when it has one, else the permanent long link. */
export function customPuzzlePath(puzzle: { shortCode?: string | null; id: string }): string {
  return puzzle.shortCode ? `/p/${puzzle.shortCode}` : `/custom/${puzzle.id}`;
}

// ── Favorites ──────────────────────────────────────────────────────────────

export interface FavoriteState {
  favorited: boolean;
  favoriteCount: number;
}

/**
 * Sets (not toggles) the signed-in account's favorite, so a double click or a
 * retry can never flip the state. Returns null for a guest/failed call — the
 * caller falls back to a device-local favorite.
 */
export async function setCustomPuzzleFavorite(shareId: string, favorite: boolean): Promise<FavoriteState | null> {
  const { data, error } = await supabase.rpc("set_custom_puzzle_favorite", { _share_id: shareId, _favorite: favorite });
  if (error || !data) return null;
  const row = data as { favorited?: boolean; favorite_count?: number };
  return { favorited: !!row.favorited, favoriteCount: row.favorite_count ?? 0 };
}

const LOCAL_FAVORITE_PREFIX = "custom-favorite:";

/** Guest favorites live only in this browser, namespaced per puzzle, and never count publicly. */
export function isLocalFavorite(shareId: string): boolean {
  try {
    return localStorage.getItem(LOCAL_FAVORITE_PREFIX + shareId) === "1";
  } catch {
    return false;
  }
}

export function setLocalFavorite(shareId: string, favorite: boolean): void {
  try {
    if (favorite) localStorage.setItem(LOCAL_FAVORITE_PREFIX + shareId, "1");
    else localStorage.removeItem(LOCAL_FAVORITE_PREFIX + shareId);
  } catch {
    // storage blocked: the favorite simply does not persist
  }
}

export interface FavoritePuzzleCard {
  title: string;
  creatorName: string;
  creatorSlug: string | null;
  mode: CustomPuzzleMode;
  shortCode: string;
  favoriteCount: number;
  cover?: CreatorCover | null;
}

export async function getMyFavorites(): Promise<FavoritePuzzleCard[]> {
  const { data, error } = await supabase.rpc("get_my_favorites");
  if (error || !Array.isArray(data)) return [];
  return (
    data as unknown as {
      title: string;
      creator_name: string;
      creator_slug: string | null;
      mode: CustomPuzzleMode;
      short_code: string;
      favorite_count: number;
      cover_emoji?: string | null;
      cover_emoji_2?: string | null;
      cover_emoji_3?: string | null;
      cover_background?: string | null;
    }[]
  ).map((r) => ({
    title: r.title,
    creatorName: r.creator_name,
    creatorSlug: r.creator_slug ?? null,
    mode: r.mode,
    shortCode: r.short_code,
    favoriteCount: r.favorite_count ?? 0,
    cover: parseCover(r.cover_emoji, r.cover_background, r.cover_emoji_2, r.cover_emoji_3),
  }));
}

// ── Creator profiles ───────────────────────────────────────────────────────

export type CreatorSort = "newest" | "plays" | "favorites";

export interface CreatorPuzzleCard {
  title: string;
  mode: CustomPuzzleMode;
  shortCode: string;
  finishedPlays: number;
  favoriteCount: number;
  createdAt: string;
}

export interface CreatorProfile {
  displayName: string;
  publicSlug: string;
  puzzleCount: number;
  totalPlays: number;
  totalFavorites: number;
  puzzles: CreatorPuzzleCard[];
}

export async function getCreatorProfile(slug: string, sort: CreatorSort = "newest"): Promise<CreatorProfile | null> {
  const { data, error } = await supabase.rpc("get_creator_profile", { _slug: slug, _sort: sort });
  if (error || !data) return null;
  const r = data as unknown as {
    display_name: string;
    public_slug: string;
    puzzle_count: number;
    total_plays: number;
    total_favorites: number;
    puzzles: {
      title: string;
      mode: CustomPuzzleMode;
      short_code: string;
      finished_plays: number;
      favorite_count: number;
      created_at: string;
    }[];
  };
  return {
    displayName: r.display_name,
    publicSlug: r.public_slug,
    puzzleCount: r.puzzle_count,
    totalPlays: r.total_plays,
    totalFavorites: r.total_favorites,
    puzzles: r.puzzles.map((p) => ({
      title: p.title,
      mode: p.mode,
      shortCode: p.short_code,
      finishedPlays: p.finished_plays,
      favoriteCount: p.favorite_count,
      createdAt: p.created_at,
    })),
  };
}

/**
 * Records one completed run of a custom puzzle. Every completed run counts
 * once (a completed replay is another play); the run id makes a retry,
 * refresh or remount of the same run a no-op.
 *
 * `totalGuesses` must already be "submitted board guesses only" — the caller
 * (useGame.ts's commitOfficialResult "custom" branch) derives it from the
 * same guessHistory the official path uses, which already excludes hint
 * markers and anything that isn't a real submitted guess.
 *
 * Best-effort, like every other completion write in this app: a failed call
 * logs and returns rather than throwing into the game loop.
 */
export async function submitCustomPuzzleResult(params: {
  shareId: string;
  /** This playthrough's id; a repeat of the same run is a no-op server-side. */
  runId: string;
  won: boolean;
  totalGuesses: number;
}): Promise<void> {
  try {
    const identity = await ensureDeviceIdentity();
    if (!identity) return;
    const { error } = await supabase.rpc("submit_custom_puzzle_result", {
      _share_id: params.shareId,
      _device_id: identity.deviceId,
      _device_token: identity.deviceToken,
      _won: params.won,
      _total_guesses: params.totalGuesses,
      _run_id: params.runId,
    });
    if (error) console.error("submitCustomPuzzleResult failed:", error);
  } catch (err) {
    console.error("submitCustomPuzzleResult error:", err);
  }
}

/** The fixed guess buckets, in display order. Losses are never in them. */
export const GUESS_BUCKETS = ["4", "5", "6", "7", "8+"] as const;
export type GuessBucket = (typeof GUESS_BUCKETS)[number];

export interface CustomPuzzleStats {
  completedPlays: number;
  wins: number;
  losses: number;
  /** Average total guesses over WINS only (0 when there are none). */
  avgGuessesToSolve: number;
  /** Always all five buckets, zeros included. Wins only. */
  guessDistribution: Record<GuessBucket, number>;
}

/** Which bucket a winning run's guess count falls in. */
export function guessBucketFor(totalGuesses: number): GuessBucket {
  if (totalGuesses >= 8) return "8+";
  return String(Math.max(4, totalGuesses)) as GuessBucket;
}

export async function getCustomPuzzleStats(shareId: string): Promise<CustomPuzzleStats | null> {
  const { data, error } = await supabase.rpc("get_custom_puzzle_stats", { _share_id: shareId });
  if (error || !data) return null;
  const row = data as {
    completed_plays?: number;
    finished_plays?: number;
    wins?: number;
    losses?: number;
    avg_guesses?: number;
    guess_distribution?: Record<string, number>;
  };
  const dist = row.guess_distribution ?? {};
  return {
    completedPlays: row.completed_plays ?? row.finished_plays ?? 0,
    wins: row.wins ?? 0,
    losses: row.losses ?? 0,
    avgGuessesToSolve: Number(row.avg_guesses ?? 0),
    guessDistribution: {
      "4": dist["4"] ?? 0,
      "5": dist["5"] ?? 0,
      "6": dist["6"] ?? 0,
      "7": dist["7"] ?? 0,
      "8+": dist["8+"] ?? 0,
    },
  };
}

// ── Community Puzzles (preview; see lib/communityFlag.ts) ──────────────────

export type CommunitySort = "newest" | "plays";

/** One card in the Community feed. Card fields only: the server never sends content, ids or account data. */
export interface CommunityPuzzleListing {
  title: string;
  creatorName: string;
  creatorSlug: string | null;
  mode: CustomPuzzleMode;
  shortCode: string;
  finishedPlays: number;
  favoriteCount: number;
  /** The creator's cover, or null for none. */
  cover?: CreatorCover | null;
}

export interface CommunityPage {
  items: CommunityPuzzleListing[];
  hasMore: boolean;
}

export const COMMUNITY_PAGE_SIZE = 24;

/** Throws on failure so the page can offer Retry rather than showing an empty feed. */
export async function listCommunityPuzzles(params: {
  query?: string;
  sort?: CommunitySort;
  offset?: number;
  limit?: number;
}): Promise<CommunityPage> {
  const { data, error } = await supabase.rpc("list_community_puzzles", {
    _query: params.query?.trim() || undefined,
    _sort: params.sort ?? "newest",
    _limit: params.limit ?? COMMUNITY_PAGE_SIZE,
    _offset: params.offset ?? 0,
  });
  if (error) throw error;
  const r = (data ?? {}) as {
    items?: {
      title: string;
      creator_name: string;
      creator_slug: string | null;
      mode: CustomPuzzleMode;
      short_code: string;
      finished_plays: number;
      favorite_count: number;
      cover_emoji?: string | null;
      cover_emoji_2?: string | null;
      cover_emoji_3?: string | null;
      cover_background?: string | null;
    }[];
    has_more?: boolean;
  };
  return {
    items: (r.items ?? []).map((p) => ({
      title: p.title,
      creatorName: p.creator_name,
      creatorSlug: p.creator_slug ?? null,
      mode: p.mode,
      shortCode: p.short_code,
      finishedPlays: p.finished_plays ?? 0,
      favoriteCount: p.favorite_count ?? 0,
      cover: parseCover(p.cover_emoji, p.cover_background, p.cover_emoji_2, p.cover_emoji_3),
    })),
    hasMore: !!r.has_more,
  };
}

export interface CommunityListingState {
  /** True only when the signed-in caller created this puzzle. */
  owned: boolean;
  listed: boolean;
  /** Public and not hidden by moderation. */
  canList: boolean;
}

/** The caller's own puzzle's Community state; null for a guest, an error, or someone else's puzzle. */
export async function getMyCommunityListing(shareId: string): Promise<CommunityListingState | null> {
  const { data, error } = await supabase.rpc("get_my_custom_puzzle_listing", { _share_id: shareId });
  if (error || !data) return null;
  const r = data as { owned?: boolean; listed?: boolean; can_list?: boolean };
  if (!r.owned) return null;
  return { owned: true, listed: !!r.listed, canList: !!r.can_list };
}

/** Sets (not toggles) the listing. Ownership and eligibility are enforced server-side; throws with the server's message. */
export async function setCommunityListing(shareId: string, listed: boolean): Promise<boolean> {
  const { data, error } = await supabase.rpc("set_custom_puzzle_community_listing", { _share_id: shareId, _listed: listed });
  if (error) throw error;
  return !!(data as { listed?: boolean } | null)?.listed;
}

// ── Community part 2: creators, Follow, Following, bookmark lookups ────────
// Saving still goes through the existing Favorites contracts above: an
// account's set_custom_puzzle_favorite / get_my_favorites, and a guest's
// device-only `custom-favorite:<shareId>` flags. Nothing here stores a save.

type CardRow = {
  title: string;
  creator_name: string;
  creator_slug: string | null;
  mode: CustomPuzzleMode;
  short_code: string;
  finished_plays: number;
  favorite_count: number;
  cover_emoji?: string | null;
  cover_emoji_2?: string | null;
  cover_emoji_3?: string | null;
  cover_background?: string | null;
};

function mapCard(p: CardRow): CommunityPuzzleListing {
  return {
    title: p.title,
    creatorName: p.creator_name,
    creatorSlug: p.creator_slug ?? null,
    mode: p.mode,
    shortCode: p.short_code,
    finishedPlays: p.finished_plays ?? 0,
    favoriteCount: p.favorite_count ?? 0,
    cover: parseCover(p.cover_emoji, p.cover_background, p.cover_emoji_2, p.cover_emoji_3),
  };
}

/** A creator as Community shows them: public identity and aggregate counts only. */
export interface CommunityCreator {
  displayName: string;
  publicSlug: string;
  /** Puzzles in Community right now. */
  listedCount: number;
  followerCount: number;
  /** Whether the CURRENT account follows them (false for guests). */
  followedByMe: boolean;
  isMe: boolean;
}

type CreatorRow = {
  display_name: string;
  public_slug: string;
  listed_count: number;
  follower_count: number;
  followed_by_me: boolean;
  is_me: boolean;
};

function mapCreator(c: CreatorRow): CommunityCreator {
  return {
    displayName: c.display_name,
    publicSlug: c.public_slug,
    listedCount: c.listed_count ?? 0,
    followerCount: c.follower_count ?? 0,
    followedByMe: !!c.followed_by_me,
    isMe: !!c.is_me,
  };
}

/** Creators with at least one puzzle in Community, by public name or slug. Throws on failure. */
export async function searchCommunityCreators(params: { query?: string; offset?: number; limit?: number }): Promise<{ items: CommunityCreator[]; hasMore: boolean }> {
  const { data, error } = await supabase.rpc("search_community_creators", {
    _query: params.query?.trim() || undefined,
    _limit: params.limit ?? COMMUNITY_PAGE_SIZE,
    _offset: params.offset ?? 0,
  });
  if (error) throw error;
  const r = (data ?? {}) as { items?: CreatorRow[]; has_more?: boolean };
  return { items: (r.items ?? []).map(mapCreator), hasMore: !!r.has_more };
}

export interface CreatorCommunity extends CommunityCreator {
  puzzles: CommunityPuzzleListing[];
}

/** The Community side of a creator page; null when the slug is unknown or the call fails. */
export async function getCreatorCommunity(slug: string): Promise<CreatorCommunity | null> {
  const { data, error } = await supabase.rpc("get_creator_community", { _slug: slug });
  if (error || !data) return null;
  const r = data as CreatorRow & { puzzles?: CardRow[] };
  return { ...mapCreator(r), puzzles: (r.puzzles ?? []).map(mapCard) };
}

/** Sets (not toggles) a one-way follow. Throws with the server's message. */
export async function setCreatorFollow(slug: string, follow: boolean): Promise<{ following: boolean; followerCount: number }> {
  const { data, error } = await supabase.rpc("set_creator_follow", { _slug: slug, _follow: follow });
  if (error) throw error;
  const r = (data ?? {}) as { following?: boolean; follower_count?: number };
  return { following: !!r.following, followerCount: r.follower_count ?? 0 };
}

export interface FollowingFeed {
  items: CommunityPuzzleListing[];
  hasMore: boolean;
  /** Who the caller follows. Private to the caller. */
  creators: CommunityCreator[];
}

/** The signed-in account's Following. Throws on failure (including for guests). */
export async function getFollowingFeed(params: { offset?: number; limit?: number } = {}): Promise<FollowingFeed> {
  const { data, error } = await supabase.rpc("get_following_feed", {
    _limit: params.limit ?? COMMUNITY_PAGE_SIZE,
    _offset: params.offset ?? 0,
  });
  if (error) throw error;
  const r = (data ?? {}) as { items?: CardRow[]; has_more?: boolean; creators?: CreatorRow[] };
  return { items: (r.items ?? []).map(mapCard), hasMore: !!r.has_more, creators: (r.creators ?? []).map(mapCreator) };
}

/** Share ids of every puzzle this browser saved as a guest (the existing device-only flags). */
export function listLocalFavorites(): string[] {
  const ids: string[] = [];
  try {
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      if (key?.startsWith(LOCAL_FAVORITE_PREFIX) && localStorage.getItem(key) === "1") ids.push(key.slice(LOCAL_FAVORITE_PREFIX.length));
    }
  } catch {
    // storage blocked: nothing saved on this device
  }
  return ids;
}

/** Card fields for share ids this browser already holds (guest bookmarks). Throws on failure. */
export async function getCustomPuzzleCards(shareIds: string[]): Promise<(CommunityPuzzleListing & { shareId: string })[]> {
  if (shareIds.length === 0) return [];
  const { data, error } = await supabase.rpc("get_custom_puzzle_cards", { _share_ids: shareIds.slice(0, 200) });
  if (error) throw error;
  // share_id is our own input echoed back by the server, to pair each save with its card.
  const rows = (Array.isArray(data) ? data : []) as unknown as (CardRow & { share_id: string })[];
  return rows.map((r) => ({ ...mapCard(r), shareId: r.share_id }));
}

const shareIdCache = new Map<string, string>();

/** The permanent share id the Favorites contracts key on, for a card's short code. */
export async function resolveShareId(shortCode: string): Promise<string | null> {
  const cached = shareIdCache.get(shortCode);
  if (cached) return cached;
  const { data, error } = await supabase.rpc("custom_puzzle_share_id", { _short_code: shortCode });
  if (error || typeof data !== "string" || !data) return null;
  shareIdCache.set(shortCode, data);
  return data;
}

// ── Community part 3: curated Explore, keyset Newest, admin curation ────────

export interface CommunityExplore {
  /** Admin-chosen, and only while it is in Community right now; null otherwise. */
  featured: CommunityPuzzleListing | null;
  picks: CommunityPuzzleListing[];
}

/** The curated shelf. Throws on failure so the page can fall back to Newest alone. */
export async function getCommunityExplore(): Promise<CommunityExplore> {
  const { data, error } = await supabase.rpc("get_community_explore");
  if (error) throw error;
  const r = (data ?? {}) as { featured?: CardRow | null; picks?: CardRow[] };
  return { featured: r.featured ? mapCard(r.featured) : null, picks: (r.picks ?? []).map(mapCard) };
}

/** Where the next Newest page starts: the last item's first-listing time and short code. */
export interface NewestCursor {
  listedAt: string;
  shortCode: string;
}

/**
 * Every puzzle in Community by first listing time, newest first. Keyset-paged,
 * so listings that change between pages never repeat or skip the rest.
 */
export async function listCommunityNewest(params: { limit?: number; after?: NewestCursor | null } = {}): Promise<{ items: CommunityPuzzleListing[]; hasMore: boolean; cursor: NewestCursor | null }> {
  const { data, error } = await supabase.rpc("list_community_newest", {
    _limit: params.limit ?? COMMUNITY_PAGE_SIZE,
    _before_listed_at: params.after?.listedAt,
    _before_short_code: params.after?.shortCode,
  });
  if (error) throw error;
  const r = (data ?? {}) as { items?: (CardRow & { listed_at: string })[]; has_more?: boolean };
  const rows = r.items ?? [];
  const last = rows[rows.length - 1];
  return { items: rows.map(mapCard), hasMore: !!r.has_more, cursor: last ? { listedAt: last.listed_at, shortCode: last.short_code } : null };
}

export interface CurationEntry {
  slot: "featured" | "pick";
  position: number;
  shortCode: string;
  title: string;
  creatorName: string;
  /** Whether Explore is showing it right now. */
  shown: boolean;
  hiddenReason: string | null;
}

/** Admin only (enforced by the server). Throws with the server's message. */
export async function adminGetCuration(): Promise<CurationEntry[]> {
  const { data, error } = await supabase.rpc("admin_get_community_curation");
  if (error) throw error;
  return ((Array.isArray(data) ? data : []) as unknown as {
    slot: "featured" | "pick"; position: number; short_code: string; title: string; creator_name: string; shown: boolean; hidden_reason: string | null;
  }[]).map((r) => ({ slot: r.slot, position: r.position, shortCode: r.short_code, title: r.title, creatorName: r.creator_name, shown: r.shown, hiddenReason: r.hidden_reason }));
}

/** Replaces the whole curation: one Featured (or none) and up to six ordered Picks. Admin only. */
export async function adminSetCuration(featured: string | null, picks: string[]): Promise<CurationEntry[]> {
  const { error } = await supabase.rpc("admin_set_community_curation", { _featured: featured, _picks: picks });
  if (error) throw error;
  return adminGetCuration();
}

// ── Community part 4: creator covers (one emoji + one preset background) ────

/**
 * Sets (or, with null, removes) a puzzle's cover: one to three emoji keys and
 * one preset background. Only its signed-in creator may; the server accepts
 * only allowlisted keys, 1-3 distinct emoji, and preset backgrounds. Throws
 * with the server's message.
 */
export async function setCustomPuzzleCover(shareId: string, cover: CreatorCover | null): Promise<CreatorCover | null> {
  const { data, error } = await supabase.rpc("set_custom_puzzle_cover_emojis", {
    _share_id: shareId,
    _emojis: cover?.emojis ?? null,
    _background: cover?.background ?? null,
  });
  if (error) throw error;
  const r = (data ?? {}) as { cover_emoji?: string | null; cover_emoji_2?: string | null; cover_emoji_3?: string | null; cover_background?: string | null };
  return parseCover(r.cover_emoji, r.cover_background, r.cover_emoji_2, r.cover_emoji_3);
}
