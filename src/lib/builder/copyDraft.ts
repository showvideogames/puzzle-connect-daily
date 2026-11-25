import { builderStateFromLoad, type LoadBuilderInput } from "@/hooks/useBuilderForm";
import type { Difficulty } from "@/lib/puzzleFormat";
import type { MyPuzzleSource } from "@/lib/customPuzzles";
import type { CreatorDraft } from "./creatorDraft";

const MAX_TITLE = 100;

type StoredGroup = { category?: unknown; words?: unknown; hint_word?: unknown; category_emoji?: unknown; category_emoji_hint_only?: unknown };
const text = (v: unknown) => (typeof v === "string" ? v : "");
const words = (v: unknown) => (Array.isArray(v) ? v.filter((w): w is string => typeof w === "string") : null);

/** "Copy of <title>", within the 100-character title rule. */
export function copyTitle(title: string): string {
  return `Copy of ${title.trim()}`.slice(0, MAX_TITLE).trim();
}

/**
 * A new, unpublished draft from the owner's own saved puzzle, through the
 * builder's existing loader: same categories, words, hints, emoji, starting
 * board order and (separately) Rainbow word order, Classic/Rainbow style and
 * visibility. A Private puzzle's copy stays Private. Listing in Community is
 * never part of a draft (Create asks every time, off by default).
 */
export function draftFromSource(source: MyPuzzleSource): CreatorDraft {
  const c = source.content;
  if (c.format !== undefined && c.format !== "full") throw new Error("Only full-size puzzles can be copied into Create.");
  const groups = Array.isArray(c.groups) ? (c.groups as StoredGroup[]) : [];
  const parsed = groups.map((g, i) => ({
    category: text(g.category),
    words: words(g.words) ?? [],
    difficulty: (i + 1) as Difficulty,
    hintWord: text(g.hint_word) || null,
    categoryEmoji: text(g.category_emoji) || null,
    categoryEmojiHintOnly: g.category_emoji_hint_only === true,
  }));
  if (parsed.length !== 4 || parsed.some((g) => g.words.length !== 4)) throw new Error("Couldn't read this puzzle's board.");
  const rainbow = c.mode === "rainbow";
  const input: LoadBuilderInput = {
    groups: parsed,
    wordOrder: words(c.word_order),
    rainbowHerring: rainbow ? words(c.rainbow_herring) : null,
    rainbowCategoryName: rainbow ? text(c.rainbow_category_name) : "",
    rainbowHintWord: rainbow ? text(c.rainbow_hint_word) : "",
    rainbowCategoryEmoji: rainbow ? text(c.rainbow_category_emoji) : "",
    rainbowCategoryEmojiHintOnly: rainbow && c.rainbow_category_emoji_hint_only === true,
    theme: "",
    alphabetizeCompleted: c.alphabetize_completed !== false,
    style: rainbow ? "rainbow" : "classic",
    format: "full",
  };
  return {
    title: copyTitle(source.title),
    designer: source.creatorName,
    visibility: source.visibility === "private" ? "private" : "public",
    builder: builderStateFromLoad(input),
  };
}
