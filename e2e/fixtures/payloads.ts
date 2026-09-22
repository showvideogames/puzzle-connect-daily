/**
 * Fixture → RPC payload.
 *
 * These reuse the APPLICATION's own payload builders rather than
 * reimplementing the shape, so a fixture is written exactly the way the real
 * Admin builder and the real /create page write a puzzle. If the payload
 * contract ever changes, the seed breaks in the same release the app does —
 * which is the point.
 */

import { buildContentPayload } from "../../src/lib/builder/contentPayload.ts";
import type { CustomPuzzleFixture, OfficialPuzzleFixture } from "./catalog.ts";

export interface OfficialMetadata {
  date: string;
  title: string | null;
  is_published: boolean;
  is_beta: boolean;
  designer_name: string | null;
  emoji_puzzle_icon: string | null;
  is_free_puzzle: boolean;
  free_puzzle_order: number | null;
}

/** The `_metadata` argument of `admin_save_puzzle`, exactly as Admin.tsx sends it. */
export function officialMetadata(fixture: OfficialPuzzleFixture): OfficialMetadata {
  return {
    date: fixture.date,
    title: fixture.title || null,
    is_published: fixture.isPublished,
    is_beta: false,
    designer_name: fixture.designerName || null,
    emoji_puzzle_icon: null,
    is_free_puzzle: false,
    free_puzzle_order: null,
  };
}

/** The `_content` argument of `admin_save_puzzle`. */
export function officialContent(fixture: OfficialPuzzleFixture) {
  return buildContentPayload({
    format: fixture.format,
    groups: fixture.groups.map((g) => ({
      category: g.category,
      words: g.words,
      difficulty: g.difficulty,
      hintWord: g.hintWord,
      categoryEmoji: g.categoryEmoji,
    })),
    wordOrder: fixture.wordOrder,
    rainbowHerring: fixture.rainbowHerring,
    rainbowCategoryName: fixture.rainbowCategoryName,
    rainbowHintWord: fixture.rainbowHintWord,
    rainbowCategoryEmoji: fixture.rainbowCategoryEmoji,
    theme: null,
    isEmojiPuzzle: false,
    alphabetizeCompleted: fixture.alphabetizeCompleted,
  });
}

/**
 * The `_content` argument of `create_custom_puzzle`.
 *
 * Built here rather than through lib/customPuzzles.ts because that module's
 * only entry point also performs the network call through the app's browser
 * Supabase client. The shape is small and is re-validated by
 * `validate_custom_puzzle_content` on the server, which is the real contract.
 */
export function customContent(fixture: CustomPuzzleFixture) {
  const isFull = fixture.format === "full";
  return {
    ...(isFull ? {} : { format: fixture.format }),
    mode: fixture.mode,
    groups: fixture.groups.map((g) => ({
      category: g.category,
      words: g.words,
      hint_word: g.hintWord,
      category_emoji: g.categoryEmoji,
    })),
    word_order: fixture.wordOrder,
    rainbow_herring: fixture.mode === "rainbow" ? fixture.rainbowHerring : null,
    rainbow_category_name: fixture.mode === "rainbow" ? fixture.rainbowCategoryName : null,
    rainbow_hint_word: fixture.mode === "rainbow" ? fixture.rainbowHintWord : null,
    rainbow_category_emoji: fixture.mode === "rainbow" ? fixture.rainbowCategoryEmoji : null,
    alphabetize_completed: fixture.alphabetizeCompleted,
  };
}
