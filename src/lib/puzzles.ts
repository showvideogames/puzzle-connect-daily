import { Puzzle } from "./types";

// Sample puzzles — in the future these come from a backend
const PUZZLES: Puzzle[] = [
  {
    id: "2026-03-22",
    date: "2026-03-22",
    groups: [
      { category: "Coffee Drinks", words: ["LATTE", "MOCHA", "ESPRESSO", "CORTADO"], difficulty: 1 },
      { category: "Card Games", words: ["BRIDGE", "POKER", "HEARTS", "SPADES"], difficulty: 2 },
      { category: "___ Break", words: ["LUNCH", "SPRING", "JAIL", "COMMERCIAL"], difficulty: 3 },
      { category: "Things That Are Pitched", words: ["TENT", "IDEA", "BASEBALL", "VOICE"], difficulty: 4 },
    ],
  },
  {
    id: "2026-03-21",
    date: "2026-03-21",
    groups: [
      { category: "Pasta Shapes", words: ["PENNE", "RIGATONI", "FUSILLI", "ORZO"], difficulty: 1 },
      { category: "Ways to Say Goodbye", words: ["ADIOS", "CIAO", "CHEERIO", "FAREWELL"], difficulty: 2 },
      { category: "Things in a Wallet", words: ["CASH", "LICENSE", "RECEIPT", "PHOTO"], difficulty: 3 },
      { category: "Double ___", words: ["DUTCH", "TAKE", "CHECK", "AGENT"], difficulty: 4 },
    ],
  },
  {
    id: "2026-03-20",
    date: "2026-03-20",
    groups: [
      { category: "Citrus Fruits", words: ["LEMON", "LIME", "ORANGE", "GRAPEFRUIT"], difficulty: 1 },
      { category: "Musical Instruments", words: ["DRUMS", "VIOLIN", "TRUMPET", "PIANO"], difficulty: 2 },
      { category: "Shades of Blue", words: ["NAVY", "COBALT", "TEAL", "CERULEAN"], difficulty: 3 },
      { category: "Things That Ring", words: ["BELL", "PHONE", "ALARM", "BOXING"], difficulty: 4 },
    ],
  },
];

export function getTodaysPuzzle(): Puzzle {
  // Return the first puzzle as "today's"
  return PUZZLES[0];
}

export function getPuzzleById(id: string): Puzzle | undefined {
  return PUZZLES.find((p) => p.id === id);
}

export function getAllPuzzles(): Puzzle[] {
  return PUZZLES;
}
