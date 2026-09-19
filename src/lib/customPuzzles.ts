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
 * The four RPCs this calls (create_custom_puzzle, get_custom_puzzle,
 * submit_custom_puzzle_result, get_custom_puzzle_stats) are not yet in the
 * generated Database type (that migration has not been applied to the
 * project this codegen ran against), so calls to them go through `rpc`
 * below — a thin `as any` shim, exactly as narrow as the untyped call itself.
 * Once the migration is applied and types are regenerated, this shim can be
 * deleted and every call site here switches back to the normal typed
 * `supabase.rpc`.
 */
import { supabase } from "@/integrations/supabase/client";
import { Puzzle, PuzzleGroup } from "./types";
import { ensureDeviceIdentity } from "./gameStats";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const rpc = (fn: string, args: Record<string, unknown>) => (supabase.rpc as any)(fn, args);

export type CustomPuzzleMode = "classic" | "rainbow";
export type CustomPuzzleVisibility = "public" | "private";

export interface CustomGroupInput {
  category: string;
  words: string[];
  hintWord: string | null;
}

export interface CustomPuzzleContentInput {
  mode: CustomPuzzleMode;
  groups: CustomGroupInput[];
  wordOrder: string[];
  rainbowHerring: string[] | null;
  rainbowCategoryName: string | null;
  rainbowHintWord: string | null;
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
}

function contentPayload(content: CustomPuzzleContentInput) {
  return {
    mode: content.mode,
    groups: content.groups.map((g) => ({
      category: g.category,
      words: g.words,
      hint_word: g.hintWord,
    })),
    word_order: content.wordOrder,
    rainbow_herring: content.mode === "rainbow" ? content.rainbowHerring : null,
    rainbow_category_name: content.mode === "rainbow" ? content.rainbowCategoryName : null,
    rainbow_hint_word: content.mode === "rainbow" ? content.rainbowHintWord : null,
    alphabetize_completed: content.alphabetizeCompleted,
  };
}

/** Throws on failure (the caller — the /create page — needs the real message to show near the right field). */
export async function createCustomPuzzle(input: CreateCustomPuzzleInput): Promise<CreateCustomPuzzleResult> {
  const { data, error } = await rpc("create_custom_puzzle", {
    _creator_name: input.creatorName,
    _title: input.title,
    _visibility: input.visibility,
    _content: contentPayload(input.content),
  });
  if (error) throw error;
  const row = (data ?? {}) as { puzzle_id?: string; share_id?: string };
  if (!row.puzzle_id || !row.share_id) throw new Error("Puzzle was not created.");
  return { puzzleId: row.puzzle_id, shareId: row.share_id };
}

export interface CustomPlayablePuzzle {
  puzzle: Puzzle;
  visibility: CustomPuzzleVisibility;
}

interface CustomPuzzleRow {
  id: string;
  share_id: string;
  title: string;
  creator_name: string;
  visibility: CustomPuzzleVisibility;
  content: {
    mode: CustomPuzzleMode;
    groups: { category: string; words: string[]; hint_word: string | null; sort_order: number }[];
    word_order: string[] | null;
    rainbow_herring: string[] | null;
    rainbow_category_name: string | null;
    rainbow_hint_word: string | null;
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
    isEmojiPuzzle: false,
    isFreePuzzle: false,
    theme: null,
    alphabetizeCompleted: row.content.alphabetize_completed ?? true,
    versionId: null,
  };
}

export async function getCustomPuzzleByShareId(shareId: string): Promise<CustomPlayablePuzzle | null> {
  const { data, error } = await rpc("get_custom_puzzle", { _share_id: shareId });
  if (error || !data) return null;
  const row = data as unknown as CustomPuzzleRow;
  if (!row.id) return null;
  return { puzzle: mapRowToPuzzle(row), visibility: row.visibility };
}

/**
 * Records this device's finished result for a custom puzzle.
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
  won: boolean;
  totalGuesses: number;
}): Promise<void> {
  try {
    const identity = await ensureDeviceIdentity();
    if (!identity) return;
    const { error } = await rpc("submit_custom_puzzle_result", {
      _share_id: params.shareId,
      _device_id: identity.deviceId,
      _device_token: identity.deviceToken,
      _won: params.won,
      _total_guesses: params.totalGuesses,
    });
    if (error) console.error("submitCustomPuzzleResult failed:", error);
  } catch (err) {
    console.error("submitCustomPuzzleResult error:", err);
  }
}

export interface CustomPuzzleStats {
  finishedPlays: number;
  wins: number;
  losses: number;
  avgGuesses: number;
  /** Keyed by total_guesses (as a string), value = count of finished plays with that many guesses. */
  guessDistribution: Record<string, number>;
}

export async function getCustomPuzzleStats(shareId: string): Promise<CustomPuzzleStats | null> {
  const { data, error } = await rpc("get_custom_puzzle_stats", { _share_id: shareId });
  if (error || !data) return null;
  const row = data as {
    finished_plays?: number;
    wins?: number;
    losses?: number;
    avg_guesses?: number;
    guess_distribution?: Record<string, number>;
  };
  return {
    finishedPlays: row.finished_plays ?? 0,
    wins: row.wins ?? 0,
    losses: row.losses ?? 0,
    avgGuesses: row.avg_guesses ?? 0,
    guessDistribution: row.guess_distribution ?? {},
  };
}
