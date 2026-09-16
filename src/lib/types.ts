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
  // gameStats.ts's saveGameStats for the legacy DB-insert fallback) and on
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
