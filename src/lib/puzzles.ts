import { supabase } from "@/integrations/supabase/client";
import { Puzzle } from "./types";
import { getFormat, type PuzzleFormat, type PuzzleFormatId } from "./puzzleFormat";

/**
 * The puzzle's display identifier WITH "Puzzle" spelled out in front — for
 * a context with no other framing to lean on, like the share-text header
 * copied to the clipboard.
 *
 * Admins already include their own numbering convention IN the title text
 * itself (Admin.tsx's title field is plain free text, "e.g. Monday
 * Mashup" — and in practice every numbered puzzle is titled "#50", "#102",
 * "Emoji #5", etc., "#" included). So this never tries to detect or
 * reformat a bare number; it only ever prepends the word "Puzzle" to
 * whatever the admin typed, verbatim — "#50" becomes "Puzzle #50", "Monday
 * Mashup" becomes "Puzzle Monday Mashup". Null when there is no title at
 * all, so the caller's own generic fallback applies instead.
 */
export function puzzleFullLabel(title: string | null | undefined): string | null {
  const trimmed = title?.trim();
  return trimmed ? `Puzzle ${trimmed}` : null;
}

const OFFICIAL_DESIGNER_FALLBACK = "Sam West";

/**
 * Resolves the header byline's display name: trims incidental whitespace and
 * falls back to the official designer when the stored value is blank or
 * missing entirely (a database without this column, e.g. mid-migration).
 * The database itself defaults and trims the same way (see
 * admin_save_puzzle) — this is the client-side mirror of that same rule, so
 * a puzzle loaded from a not-yet-migrated database still renders a name
 * instead of "by ".
 */
export function resolveDesignerName(name: string | null | undefined): string {
  const trimmed = name?.trim();
  return trimmed ? trimmed : OFFICIAL_DESIGNER_FALLBACK;
}

const PUZZLE_SELECT = "*, puzzle_groups(*)";

/**
 * Today's published puzzle OF THIS FORMAT.
 *
 * Full and Mini are sibling Dailies: each has its own published puzzle for a
 * date (enforced by the puzzles_date_format_key unique index), and neither
 * may ever show the other's. `format` defaults to "full", so every existing
 * caller keeps exactly its current meaning.
 */
export async function getTodaysPuzzle(format: PuzzleFormatId = "full"): Promise<Puzzle | null> {
  const today = new Date().toLocaleDateString("en-CA"); // YYYY-MM-DD in local time

  // Try today's puzzle first, then the most recent published one
  const { data, error } = await supabase
    .from("puzzles")
    .select(PUZZLE_SELECT)
    .eq("is_published", true)
    .eq("format", format)
    .lte("date", today)
    .order("date", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error || !data) return null;

  return mapPuzzle(data);
}

export async function getPuzzleById(id: string, format: PuzzleFormatId = "full"): Promise<Puzzle | null> {
  const { data, error } = await supabase
    .from("puzzles")
    .select(PUZZLE_SELECT)
    .eq("id", id)
    .eq("is_published", true)
    .eq("format", format)
    .maybeSingle();

  if (error || !data) return null;
  return mapPuzzle(data);
}

// Beta playtesting — /beta and /beta/:puzzleId. Mirrors getTodaysPuzzle/
// getPuzzleById exactly, filtered on is_beta instead of is_published. Never
// overlaps with the published read paths above: the mutual-exclusion CHECK
// constraint on puzzles guarantees no row is ever both.
//
// Deliberately NOT format-filtered: the Beta library is one unlisted list of
// everything being playtested, and a Mini in it renders as a Mini from its own
// row (see mapPuzzle). Splitting it would add a second unlisted route for no
// product reason.
export async function getBetaPuzzles(): Promise<Puzzle[]> {
  const { data, error } = await supabase
    .from("puzzles")
    .select(PUZZLE_SELECT)
    .eq("is_beta", true)
    .order("date", { ascending: false });

  if (error || !data) return [];
  return data.map(mapPuzzle);
}

export async function getBetaPuzzleById(id: string): Promise<Puzzle | null> {
  const { data, error } = await supabase
    .from("puzzles")
    .select(PUZZLE_SELECT)
    .eq("id", id)
    .eq("is_beta", true)
    .single();

  if (error || !data) return null;
  return mapPuzzle(data);
}

export async function getPuzzleByDate(date: string, format: PuzzleFormatId = "full"): Promise<Puzzle | null> {
  const { data, error } = await supabase
    .from("puzzles")
    .select(PUZZLE_SELECT)
    .eq("date", date)
    .eq("is_published", true)
    .eq("format", format)
    .maybeSingle();

  if (error || !data) return null;
  return mapPuzzle(data);
}

/** The format a loaded puzzle row declares — Full for anything that does not. */
export function puzzleFormatOfRow(data: unknown): PuzzleFormat {
  return getFormat((data as { format?: unknown } | null)?.format);
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function mapPuzzle(data: any): Puzzle {
  const groups = [...(data.puzzle_groups || [])]
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    .sort((a: any, b: any) => a.sort_order - b.sort_order)
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    .map((g: any) => ({
      category: g.category,
      words: g.words as string[],
      difficulty: g.difficulty as 1 | 2 | 3 | 4,
      hintWord: g.hint_word ?? null,
      categoryEmoji: g.category_emoji ?? null,
    }));

  return {
    id: data.id,
    date: data.date,
    // getFormat resolves anything unrecognised to Full — which is what a row
    // written before the format column existed means, and what the column's
    // own NOT NULL DEFAULT 'full' already guarantees for every live row.
    format: getFormat(data.format).id,
    title: data.title ?? null,
    designerName: resolveDesignerName(data.designer_name),
    groups,
    wordOrder: data.word_order || null,
    rainbowHerring: data.rainbow_herring || null,
    rainbowCategoryName: data.rainbow_category_name || null,
    rainbowHintWord: data.rainbow_hint_word ?? null,
    rainbowCategoryEmoji: data.rainbow_category_emoji ?? null,
    isEmojiPuzzle: data.is_emoji_puzzle ?? false,
    emojiPuzzleIcon: data.emoji_puzzle_icon ?? null,
    isFreePuzzle: data.is_free_puzzle ?? false,
    freePuzzleOrder: data.free_puzzle_order ?? null,
    theme: data.theme ?? null,
    // Missing on a database without this migration applied, or on a puzzle
    // saved before it existed — both read as true, matching the column's
    // own default and validate_puzzle_content's canonicalisation.
    alphabetizeCompleted: data.alphabetize_completed ?? true,
    // Comes along free with the existing `select("*")` — no extra query, no
    // join, and no new RPC on the path that loads a playable board. That is
    // deliberate: puzzles/puzzle_groups stay the live read path exactly as
    // before, so the availability-first rule is untouched and a puzzle still
    // loads even if everything version-related were unreachable. The
    // immutable copy of this same content lives in puzzle_versions, written
    // in the same transaction by admin_save_puzzle.
    //
    // Undefined on a database without the versioning migration, which
    // resolves to "nothing pinned" everywhere downstream.
    versionId: data.current_version_id ?? null,
  };
}
