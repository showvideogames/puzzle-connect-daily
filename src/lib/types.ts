import type { PuzzleFormatId } from "./puzzleFormat";

export interface PuzzleGroup {
  category: string;
  words: string[];
  // The category's difficulty/colour slot: 1=Yellow, 2=Green, 3=Blue, 4=Red.
  // A Full puzzle uses all four; a Mini uses 2, 3 and 4 (Green/Blue/Red), so
  // one colour table serves both formats — see lib/puzzleFormat.ts.
  difficulty: 1 | 2 | 3 | 4;
  hintWord?: string | null;
  // Explicit Category Emoji, kept literally. Absent/null on puzzles saved
  // before the field existed; those fall back to the title's trailing emoji
  // (lib/categoryVisual.ts).
  categoryEmoji?: string | null;
  /**
   * Hint Only: show this category's emoji in the Full Hint, but do NOT append
   * it to the category name on the solved colour bar.
   *
   * For a visual that only reads as a clue — "___ 💬" pointing at a
   * "High ___" category — where the solved bar should simply say "HIGH ___".
   *
   * Only ever suppresses the EXPLICIT categoryEmoji above. An emoji typed
   * into the category NAME is part of the name and is always shown as
   * written; nothing here edits or strips a name.
   *
   * Absent/null (every puzzle saved before this field existed) means false,
   * so existing puzzles display exactly as they always have.
   */
  categoryEmojiHintOnly?: boolean | null;
}

export interface Puzzle {
  id: string;
  date: string;
  /**
   * The board shape this puzzle is played on — see lib/puzzleFormat.ts.
   *
   * OPTIONAL on purpose. Every puzzle that existed before Mini is a Full
   * 4×4 puzzle, and `formatOf()` resolves undefined/null to Full, so nothing
   * that predates this field (a database column that has not been migrated
   * yet, an older progress snapshot, a fixture) has to be touched to keep
   * behaving exactly as it always did.
   */
  format?: PuzzleFormatId | null;
  title?: string | null;
  // Display name for the "by <designerName>" header byline. Metadata, not
  // gameplay content — see lib/puzzles.ts's resolveDesignerName. Always a
  // non-empty, trimmed string; falls back to the official default when the
  // stored value is blank or the column predates this field.
  designerName: string;
  groups: PuzzleGroup[];
  wordOrder?: string[] | null;
  rainbowHerring?: string[] | null;
  rainbowCategoryName?: string | null;
  rainbowHintWord?: string | null;
  rainbowCategoryEmoji?: string | null;
  /** Hint Only for the Rainbow's emoji — see PuzzleGroup.categoryEmojiHintOnly. */
  rainbowCategoryEmojiHintOnly?: boolean | null;
  isEmojiPuzzle?: boolean | null;
  // Manually-entered emoji shown on this puzzle's card in the Emoji Puzzles
  // section (admin-editable, only meaningful when isEmojiPuzzle is true).
  emojiPuzzleIcon?: string | null;
  isFreePuzzle?: boolean | null;
  freePuzzleOrder?: number | null;
  // Optional visual theme key for the bonus category (null = default rainbow).
  theme?: string | null;
  // Whether the solved-category bar (SolvedGroup.tsx) shows a category's
  // answers alphabetically once solved, or in the creator's authored
  // comma-separated order. Gameplay content — versioned like any other
  // field, see admin_save_puzzle. Always resolved to a real boolean by
  // mapPuzzle (missing/legacy = true), never left undefined here.
  alphabetizeCompleted: boolean;
  /**
   * The puzzle_versions snapshot this content came from — puzzles
   * .current_version_id for a freshly loaded puzzle, or the pinned earlier
   * version for a resumed in-progress board (see lib/puzzleVersion.ts).
   *
   * The puzzle IDENTITY is still `id` above, and that is what every stat,
   * official result and aggregate keys on. This is a finer coordinate on the
   * same puzzle, used for two things only: pinning a new session to the
   * content its player is actually looking at, and resuming that content
   * later.
   *
   * Absent/null when the database has not had the versioning migration
   * applied, in which case nothing is pinned and the game behaves exactly as
   * it did before this feature.
   */
  versionId?: string | null;
  /** Custom puzzles only: the short /p/:shortCode code, used to build the share link. */
  shortCode?: string | null;
}

export interface GameStats {
  gamesPlayed: number;
  gamesWon: number;
  currentStreak: number;
  maxStreak: number;
  lastPlayedDate: string | null;
  guessDistribution: number[]; // mistakes 0-4
  rainbowSpotRate: number | null; // % of rainbow-eligible games where rainbow was found; null if no eligible games
  rainbowSpottedCount: number; // raw count of games where rainbow was found
  hardestFirstCount: number; // games where solve_order[0] === "red" (difficulty 4)
  perfectGamesCount: number; // wins with zero mistakes
  noHintsUsedCount: number; // wins where hints_used is false
  // Wins solved in ascending order. For non-Rainbow (4-groups-only) puzzles:
  // Yellow->Green->Blue->Red. For Rainbow puzzles: Rainbow->Yellow->Green
  // ->Blue->Red OR Yellow->Green->Blue->Red->Rainbow — the Rainbow must be
  // found at one end, not in the middle. This relies on
  // game_sessions.rainbow_solve_index (added going forward; see the
  // migration comment on that column), so Rainbow-eligible rows saved
  // before that column existed can never qualify here — they are left out
  // entirely rather than guessed at from found_rainbow alone.
  inOrderCount: number;
  // Wins solved in descending order, mirroring inOrderCount: for Rainbow
  // puzzles only, Rainbow->Red->Blue->Green->Yellow OR Red->Blue->Green
  // ->Yellow->Rainbow (Rainbow at one end, not the middle). A 4-groups-only
  // puzzle can never qualify. Same rainbow_solve_index dependency/historical
  // limitation as inOrderCount above.
  reverseRainbowCount: number;
  averageMistakes: number; // mean mistakes across gamesPlayed (0 when gamesPlayed is 0)
}

export interface GuessAttempt {
  words: string[];
  groupIndices: number[]; // which group each word belongs to (by difficulty)
  isCorrect: boolean;
  isRainbow?: boolean;
  // True when this guess was shaped like a Rainbow attempt, independent of
  // success — an in-game guess with one word per category, or a bonus-modal
  // submission (isRainbow above only ever flags the successful reveal).
  isRainbowAttempt?: boolean;
  isOneAway?: boolean;
  isAlmostRainbow?: boolean;
  isHintMarker?: boolean;
  hintType?: "small" | "full";
  // Real wall-clock time this guess was submitted (ISO 8601, captured via
  // new Date().toISOString() at the moment submitGuess/handleSpotResult
  // runs — NOT when it's later bulk-inserted into guess_events). Absent on
  // guessHistory entries saved before this field existed (see
  // useGame.ts's toGuessEventInputs, which writes guessed_at as NULL rather
  // than a fabricated timestamp for those) and on
  // hint markers, which are never persisted to guess_events.
  guessedAt?: string;
}

export interface GameState {
  puzzleId: string;
  solvedGroups: number[];
  mistakes: number;
  maxMistakes: number;
  selectedWords: string[];
  isComplete: boolean;
  isWon: boolean;
  guessHistory: GuessAttempt[];
  gotRainbow: boolean;
  // How many groups were already solved when the rainbow was found — lets
  // the board and share grid place the rainbow at the right spot in the
  // solve order instead of always pinning it to the top.
  rainbowSolveIndex: number | null;
}
