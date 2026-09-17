/**
 * Puzzle content versioning — the client half.
 *
 * WHAT PROBLEM THIS SOLVES
 *
 * An admin may edit a live puzzle: swap a word, move one between categories,
 * fix a category name, reorder difficulties, change the Rainbow answer. The
 * newest saved version becomes canonical immediately, and new players get it.
 *
 * A player who is ALREADY PLAYING the older wording must still be able to
 * finish it. Before versioning they could not: the board lives in React
 * state, so the first refresh re-fetched the new definition while
 * localStorage restored the old board, and the words they still needed no
 * longer belonged to any group — their remaining correct answers became
 * literally unsubmittable.
 *
 * THE MECHANISM, IN ONE LINE
 *
 * The moment a game becomes real (the first guess or hint, the same trigger
 * that creates the durable session), the exact content on that player's
 * board is written into their local progress blob alongside the server-side
 * `puzzle_version_id` pin. Every later mount plays THAT snapshot, not
 * whatever is current now.
 *
 * Why local rather than re-fetching the pinned version from the server: it
 * is synchronous, so a resumed board never flickers through the wrong
 * content; it works offline; and it needs no extra request on the critical
 * load path, which is what keeps the availability-first rule intact. The
 * server still holds the same snapshot immutably in `puzzle_versions` — this
 * is a cache of a durable record, not a second source of truth.
 *
 * WHAT IS DELIBERATELY *NOT* PINNED
 *
 * Only gameplay content. Title, date and Archive placement are metadata:
 * they are read from the current puzzle even on a resumed board, because
 * correcting a title has never been able to break a game.
 *
 * And once a game is COMPLETE the pin stops applying to the solution
 * display: a finished player revisiting the Archive sees the newest
 * corrected answers, per the product rule, rather than the version they
 * happened to play. The one thing that still reads the pin after completion
 * is the share/result grid — see loadPlayedDifficulties below — because that
 * is a record of what the player did, not a statement about what the puzzle
 * says today.
 */
import type { Puzzle, PuzzleGroup } from "./types";
import { loadProgress } from "./gameProgress";

/**
 * The gameplay-defining content of one puzzle version, as stored locally.
 *
 * This list is the client-side mirror of the server's canonical content (see
 * validate_puzzle_content in the versioning migration). Every field here is
 * something that can decide whether a submitted group is correct, or what
 * the board and its answers look like while being played:
 *
 *   groups              all 16 words, their category membership, the category
 *                       names, the per-group difficulty/colour order, and the
 *                       per-group hint word
 *   wordOrder           the starting tile layout
 *   rainbowHerring      the Rainbow answer itself
 *   rainbowCategoryName the Rainbow's displayed answer name
 *   rainbowHintWord     the Rainbow hint
 *   theme               drives the bonus category's colours and its default
 *                       name when rainbowCategoryName is unset
 *   isEmojiPuzzle       changes how every tile renders
 *
 * Metadata that is intentionally absent: title, date, emojiPuzzleIcon,
 * isFreePuzzle, freePuzzleOrder.
 */
export interface PinnedPuzzleContent {
  versionId: string;
  groups: PuzzleGroup[];
  wordOrder: string[] | null;
  rainbowHerring: string[] | null;
  rainbowCategoryName: string | null;
  rainbowHintWord: string | null;
  theme: string | null;
  isEmojiPuzzle: boolean;
}

/**
 * Snapshot the content of the puzzle currently on the board.
 *
 * Returns null when the puzzle carries no version id at all — a database
 * that has not had the versioning migration applied yet. Pinning cannot be
 * faked in that case, and inventing an id would make a later resume believe
 * it had a snapshot it does not have, so nothing is pinned and the game
 * behaves exactly as it did before this feature.
 */
export function pinnedContentFrom(puzzle: Puzzle): PinnedPuzzleContent | null {
  if (!puzzle.versionId) return null;
  return {
    versionId: puzzle.versionId,
    // Deep-copied: the stored snapshot must not alias live React state, or a
    // later render could mutate the record of what was played.
    groups: puzzle.groups.map((g) => ({
      category: g.category,
      words: [...g.words],
      difficulty: g.difficulty,
      hintWord: g.hintWord ?? null,
    })),
    wordOrder: puzzle.wordOrder ? [...puzzle.wordOrder] : null,
    rainbowHerring: puzzle.rainbowHerring ? [...puzzle.rainbowHerring] : null,
    rainbowCategoryName: puzzle.rainbowCategoryName ?? null,
    rainbowHintWord: puzzle.rainbowHintWord ?? null,
    theme: puzzle.theme ?? null,
    isEmojiPuzzle: puzzle.isEmojiPuzzle ?? false,
  };
}

/**
 * Is this blob a usable snapshot?
 *
 * Checked rather than trusted because it comes from localStorage, which a
 * player can edit, an old build can have written, and a half-finished write
 * can truncate. A malformed snapshot falls back to the current version,
 * which is always playable — the one outcome that must never happen is
 * building a board out of a partially-valid snapshot.
 */
function isUsableSnapshot(value: unknown): value is PinnedPuzzleContent {
  if (!value || typeof value !== "object") return false;
  const s = value as Partial<PinnedPuzzleContent>;
  if (typeof s.versionId !== "string" || s.versionId.length === 0) return false;
  if (!Array.isArray(s.groups) || s.groups.length !== 4) return false;
  return s.groups.every(
    (g) =>
      !!g &&
      typeof g.category === "string" &&
      Array.isArray(g.words) &&
      g.words.length === 4 &&
      g.words.every((w) => typeof w === "string") &&
      typeof g.difficulty === "number"
  );
}

/** Rebuild a playable Puzzle: pinned gameplay content, current metadata. */
export function applyPinnedContent(current: Puzzle, pinned: PinnedPuzzleContent): Puzzle {
  return {
    ...current,
    // Identity and metadata always come from the live row. The puzzle is the
    // same puzzle; only its content is being held at an earlier version.
    id: current.id,
    date: current.date,
    title: current.title,
    emojiPuzzleIcon: current.emojiPuzzleIcon,
    isFreePuzzle: current.isFreePuzzle,
    freePuzzleOrder: current.freePuzzleOrder,
    groups: pinned.groups,
    wordOrder: pinned.wordOrder,
    rainbowHerring: pinned.rainbowHerring,
    rainbowCategoryName: pinned.rainbowCategoryName,
    rainbowHintWord: pinned.rainbowHintWord,
    theme: pinned.theme,
    isEmojiPuzzle: pinned.isEmojiPuzzle,
    versionId: pinned.versionId,
  };
}

/**
 * The version this player should actually be playing.
 *
 * Called by the pages that load a puzzle, before the board is built. Three
 * cases, in order:
 *
 *   1. No saved progress, or no pinned snapshot in it -> the current
 *      version. This is every new player, and every player whose game began
 *      before versioning existed.
 *
 *   2. Saved progress pinned to the version that is still current -> the
 *      current version. The common case after any edit that did not change
 *      gameplay, and after no edit at all.
 *
 *   3. Saved progress pinned to an EARLIER version -> that snapshot, so the
 *      half-finished board still matches the answers it will be judged
 *      against. Exactly the case that used to strand a player.
 *
 * A COMPLETED game is case 1 regardless of its pin: the board is over, and
 * the product rule is that a finished player revisiting the Archive sees the
 * newest corrected solution.
 */
export function resolvePlayablePuzzle(current: Puzzle): Puzzle {
  const saved = loadProgress(current.id);
  if (!saved) return current;
  // Finished games show today's answers, not the ones they were played
  // against. See loadPlayedDifficulties for the one thing that still does.
  if (saved.isComplete) return current;

  const pinned = saved.puzzleSnapshot;
  if (!isUsableSnapshot(pinned)) return current;
  if (pinned.versionId === current.versionId) return current;
  return applyPinnedContent(current, pinned);
}

/**
 * The difficulty (i.e. the colour) of each group as the player actually
 * played it, or null when nothing is pinned.
 *
 * This is the one thing the pin still answers after a game is complete, and
 * it exists to keep one promise: a share grid is a record of what somebody
 * did. Those grids are drawn by mapping each guess's stored group indices to
 * a difficulty colour, so re-deriving them from a newer version — where the
 * admin may have reordered difficulties — would silently recolour a finished
 * player's saved result into a game they never played.
 *
 * It changes only which colour a square is drawn in. It rewrites nothing:
 * the stored guesses keep their real words, order and outcomes, and the
 * server-side share_grid saved at completion is never regenerated at all.
 */
export function loadPlayedDifficulties(puzzleId: string): number[] | null {
  const pinned = loadProgress(puzzleId)?.puzzleSnapshot;
  if (!isUsableSnapshot(pinned)) return null;
  return pinned.groups.map((g) => g.difficulty);
}
