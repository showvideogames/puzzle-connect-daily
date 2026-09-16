export interface PuzzleGroup {
  category: string;
  words: string[];
  difficulty: 1 | 2 | 3 | 4; // 1=easiest, 4=hardest
  hintWord?: string | null;
}

export interface Puzzle {
  id: string;
  date: string;
  title?: string | null;
  groups: PuzzleGroup[];
  wordOrder?: string[] | null;
  rainbowHerring?: string[] | null;
  rainbowCategoryName?: string | null;
  rainbowHintWord?: string | null;
  isEmojiPuzzle?: boolean | null;
  // Manually-entered emoji shown on this puzzle's card in the Emoji Puzzles
  // section (admin-editable, only meaningful when isEmojiPuzzle is true).
  emojiPuzzleIcon?: string | null;
  isFreePuzzle?: boolean | null;
  freePuzzleOrder?: number | null;
  // Optional visual theme key for the bonus category (null = default rainbow).
  theme?: string | null;
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
  // Wins where the 4 normal categories were solved Yellow->Green->Blue->Red
  // (ascending difficulty). Deliberately scoped to puzzles with NO rainbow
  // herring only, even though the product definition also wants this for
  // Rainbow puzzles when the rainbow was found "at one end" of the solve
  // sequence (before all 4, or after all 4 — not in the middle).
  //
  // That rainbow-timing condition can't be verified from game_sessions:
  // useGame.ts computes it live as state.rainbowSolveIndex (0-3 for a
  // mid-game herring guess, always 4 for the post-completion "Spot the
  // Rainbow" bonus), but saveGameStats() never included it in the
  // game_sessions insert, so no historical row records it — found_rainbow
  // only says whether the rainbow was found at all, not when. Counting
  // rainbow-eligible wins here based on found_rainbow alone would silently
  // include "found in the middle" games that the product definition
  // explicitly excludes, so those puzzles are left out of this count
  // entirely instead of guessing. To close this gap: persist
  // rainbowSolveIndex on game_sessions (new nullable column + one extra
  // field in saveGameStats' insert) going forward; historical rows would
  // stay unable to qualify for the rainbow case, which is accurate, not
  // approximated.
  inOrderCount: number;
  // Not implemented — no equivalent field exists yet. "Reverse Rainbow"
  // (Red->Blue->Green->Yellow with the rainbow found at one end) depends
  // entirely on rainbow puzzles and hits the exact same un-persisted
  // rainbowSolveIndex gap described above, with no non-rainbow subset to
  // fall back on the way inOrderCount has. Needs the same tracking fix
  // before it can be added.
  averageMistakes: number; // mean mistakes across gamesPlayed (0 when gamesPlayed is 0)
}

export interface GuessAttempt {
  words: string[];
  groupIndices: number[]; // which group each word belongs to (by difficulty)
  isCorrect: boolean;
  isRainbow?: boolean;
  isOneAway?: boolean;
  isAlmostRainbow?: boolean;
  isHintMarker?: boolean;
  hintType?: "small" | "full";
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
