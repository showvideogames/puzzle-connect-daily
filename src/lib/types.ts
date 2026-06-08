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
  isFreePuzzle?: boolean | null;
  freePuzzleOrder?: number | null;
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
}
