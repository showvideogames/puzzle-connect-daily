export interface PuzzleGroup {
  category: string;
  words: string[];
  difficulty: 1 | 2 | 3 | 4; // 1=easiest, 4=hardest
}

export interface Puzzle {
  id: string;
  date: string;
  title?: string | null;
  groups: PuzzleGroup[];
  wordOrder?: string[] | null;
  rainbowHerring?: string[] | null;
}

export interface GameStats {
  gamesPlayed: number;
  gamesWon: number;
  currentStreak: number;
  maxStreak: number;
  lastPlayedDate: string | null;
  guessDistribution: number[]; // mistakes 0-4
}

export interface GuessAttempt {
  words: string[];
  groupIndices: number[]; // which group each word belongs to (by difficulty)
  isCorrect: boolean;
  isRainbow?: boolean;
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
