import type { BuilderForm } from "@/hooks/useBuilderForm";
import { FULL_FORMAT, getFormat, type PuzzleFormat, type PuzzleFormatId } from "@/lib/puzzleFormat";
import { normalizeWord } from "./wordNormalization";

export const parseWords = (value: string) =>
  value
    .split(",")
    .map(normalizeWord)
    .filter(Boolean);

/**
 * The gameplay content of a puzzle, in the exact shape admin_save_puzzle
 * expects — and in a fixed key order, so JSON.stringify of two of these is a
 * usable "is this the same puzzle?" comparison. Mirrors
 * validate_puzzle_content() in the versioning migration.
 *
 * `format` is emitted ONLY for a non-Full puzzle. That is what keeps every
 * existing Full puzzle's canonical content byte-identical to what it already
 * is: re-saving an untouched Full puzzle must not look like a gameplay change
 * and must not mint a pointless new version. The server canonicalises the
 * same way (an absent format means Full).
 */
export interface PuzzleContentPayload {
  format?: PuzzleFormatId;
  groups: { category: string; words: string[]; difficulty: number; hint_word: string | null; category_emoji: string | null; sort_order: number }[];
  word_order: string[] | null;
  rainbow_herring: string[] | null;
  rainbow_category_name: string | null;
  rainbow_hint_word: string | null;
  rainbow_category_emoji: string | null;
  theme: string | null;
  is_emoji_puzzle: boolean;
  alphabetize_completed: boolean;
}

export interface ContentInput {
  format?: PuzzleFormatId;
  groups: { category: string; words: string[]; difficulty: number; hintWord: string | null; categoryEmoji?: string | null }[];
  wordOrder: string[] | null;
  rainbowHerring: string[] | null;
  rainbowCategoryName: string | null;
  rainbowHintWord: string | null;
  rainbowCategoryEmoji?: string | null;
  theme: string | null;
  isEmojiPuzzle: boolean;
  alphabetizeCompleted: boolean;
}

export function buildContentPayload(input: ContentInput): PuzzleContentPayload {
  const format = getFormat(input.format);
  const blankToNull = (v: string | null | undefined) => {
    const t = (v ?? "").trim();
    return t === "" ? null : t;
  };
  return {
    // Key order matters for the version-comparison stringify, and Full omits
    // this key entirely — see the interface doc.
    ...(format.id === "full" ? {} : { format: format.id }),
    groups: input.groups.map((g, index) => ({
      category: g.category.trim(),
      words: g.words,
      difficulty: g.difficulty,
      hint_word: blankToNull(g.hintWord),
      category_emoji: blankToNull(g.categoryEmoji),
      sort_order: index,
    })),
    word_order: input.wordOrder && input.wordOrder.length === format.tileCount ? input.wordOrder : null,
    // A format with no bonus category never sends Rainbow content, whatever
    // the form happens to be holding.
    rainbow_herring:
      format.hasRainbow && input.rainbowHerring && input.rainbowHerring.length === format.categoryCount
        ? input.rainbowHerring
        : null,
    rainbow_category_name: format.hasRainbow ? blankToNull(input.rainbowCategoryName) : null,
    rainbow_hint_word: format.hasRainbow ? blankToNull(input.rainbowHintWord) : null,
    rainbow_category_emoji: format.hasRainbow ? blankToNull(input.rainbowCategoryEmoji) : null,
    theme: blankToNull(input.theme),
    is_emoji_puzzle: input.isEmojiPuzzle,
    alphabetize_completed: input.alphabetizeCompleted,
  };
}

type BuilderContentSource = Pick<
  BuilderForm,
  | "format"
  | "groups"
  | "textsFor"
  | "wordOrderIds"
  | "rainbowComplete"
  | "rainbowWordOrderIds"
  | "rainbowCategoryName"
  | "rainbowHintWord"
  | "rainbowCategoryEmoji"
  | "theme"
  | "alphabetizeCompleted"
>;

/**
 * The one place a shell turns live builder state into the content it saves.
 *
 * Every word in the payload — the groups' words, word_order and
 * rainbow_herring — must go through the SAME normalizeWord, because
 * validate_puzzle_content compares them case-sensitively. The groups already
 * did (parseWords), but word_order and rainbow_herring are resolved from
 * answer ids to each slot's RAW typed text (textsFor), so a word typed
 * "Club" was sent as "Club" in rainbow_herring against "CLUB" in its group
 * and rejected: `rainbow_herring word "Club" is not one of this puzzle's 16
 * words`. (Words loaded from the database are already uppercase, which is why
 * only a freshly retyped, mixed-case answer ever hit it.)
 */
export function builderContentInput(builder: BuilderContentSource, isEmojiPuzzle: boolean): ContentInput {
  const format: PuzzleFormat = builder.format ?? FULL_FORMAT;
  return {
    format: format.id,
    groups: builder.groups.map((g) => ({
      category: g.category,
      words: parseWords(g.answersRaw),
      difficulty: g.difficulty,
      hintWord: g.hintWord,
      categoryEmoji: g.categoryEmoji,
    })),
    wordOrder: builder.textsFor(builder.wordOrderIds).map(normalizeWord),
    rainbowHerring: builder.rainbowComplete
      ? builder.textsFor(builder.rainbowWordOrderIds).map(normalizeWord)
      : null,
    rainbowCategoryName: builder.rainbowCategoryName,
    rainbowHintWord: builder.rainbowHintWord,
    rainbowCategoryEmoji: builder.rainbowCategoryEmoji,
    theme: builder.theme,
    isEmojiPuzzle,
    alphabetizeCompleted: builder.alphabetizeCompleted,
  };
}
