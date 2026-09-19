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

export type CustomPuzzleMode = "classic" | "rainbow";
export type CustomPuzzleVisibility = "public" | "private";

export interface CustomGroupInput {
  category: string;
  words: string[];
  hintWord: string | null;
  categoryEmoji?: string | null;
}

export interface CustomPuzzleContentInput {
  mode: CustomPuzzleMode;
  groups: CustomGroupInput[];
  wordOrder: string[];
  rainbowHerring: string[] | null;
  rainbowCategoryName: string | null;
  rainbowHintWord: string | null;
  rainbowCategoryEmoji?: string | null;
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
  return {
    mode: content.mode,
    groups: content.groups.map((g) => ({
      category: g.category,
      words: g.words,
      hint_word: g.hintWord,
      category_emoji: g.categoryEmoji?.trim() || null,
    })),
    word_order: content.wordOrder,
    rainbow_herring: content.mode === "rainbow" ? content.rainbowHerring : null,
    rainbow_category_name: content.mode === "rainbow" ? content.rainbowCategoryName : null,
    rainbow_hint_word: content.mode === "rainbow" ? content.rainbowHintWord : null,
    rainbow_category_emoji: content.mode === "rainbow" ? content.rainbowCategoryEmoji?.trim() || null : null,
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
}

interface CustomPuzzleRow {
  id: string;
  share_id: string;
  short_code?: string | null;
  creator_slug?: string | null;
  favorite_count?: number;
  favorited_by_me?: boolean;
  title: string;
  creator_name: string;
  visibility: CustomPuzzleVisibility;
  content: {
    mode: CustomPuzzleMode;
    groups: { category: string; words: string[]; hint_word: string | null; category_emoji?: string | null; sort_order: number }[];
    word_order: string[] | null;
    rainbow_herring: string[] | null;
    rainbow_category_name: string | null;
    rainbow_hint_word: string | null;
    rainbow_category_emoji?: string | null;
    alphabetize_completed: boolean;
  };
}

function mapRowToPuzzle(row: CustomPuzzleRow): Puzzle {
  const groups: PuzzleGroup[] = [...row.content.groups]
    .sort((a, b) => a.sort_order - b.sort_order)
    .map((g, i) => ({
      category: g.category,
      words: g.words,
      difficulty: (i + 1) as 1 | 2 | 3 | 4,
      hintWord: g.hint_word ?? null,
      categoryEmoji: g.category_emoji ?? null,
    }));

  return {
    // The custom puzzle's own share_id doubles as its Puzzle.id — this is
    // what makes useGame's "custom" mode namespace localStorage progress as
    // `custom:<shareId>` and what lib/customPuzzles' completion/stats calls
    // key on, with no separate id plumbing needed anywhere downstream.
    id: row.share_id,
    date: "",
    title: row.title,
    designerName: row.creator_name,
    groups,
    wordOrder: row.content.word_order,
    rainbowHerring: row.content.mode === "rainbow" ? row.content.rainbow_herring : null,
    rainbowCategoryName: row.content.mode === "rainbow" ? row.content.rainbow_category_name : null,
    rainbowHintWord: row.content.mode === "rainbow" ? row.content.rainbow_hint_word : null,
    rainbowCategoryEmoji: row.content.mode === "rainbow" ? row.content.rainbow_category_emoji ?? null : null,
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
    }[]
  ).map((r) => ({
    title: r.title,
    creatorName: r.creator_name,
    creatorSlug: r.creator_slug ?? null,
    mode: r.mode,
    shortCode: r.short_code,
    favoriteCount: r.favorite_count ?? 0,
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
