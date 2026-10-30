import type { Puzzle } from "./types";
import { formatOf, oneAwayThreshold } from "./puzzleFormat";

/** Missing versions are pre-three-mistake saves. Never shorten an existing run. */
export function mistakeBudget(puzzle: Puzzle, saved?: { rulesVersion?: 1 | 2 } | null): number {
  if (formatOf(puzzle).id !== "mini") return formatOf(puzzle).maxMistakes;
  return saved && saved.rulesVersion !== 2 ? 4 : 3;
}

/** Only ordinary Mini near-misses reveal a category; Rainbow precedence stays at the caller. */
export function miniOneAwayColor(puzzle: Puzzle, words: string[], solvedGroups: number[]) {
  const format = formatOf(puzzle);
  if (format.id !== "mini" || words.length !== format.answersPerCategory) return null;
  // Server history normalizes word casing. Require every distinct selected
  // tile to map unambiguously; incomplete/changed legacy content earns no color.
  const normalize = (word: string) => word.trim().toUpperCase();
  const selected = words.map(normalize);
  if (new Set(selected).size !== format.answersPerCategory) return null;
  const memberships = selected.map(word => puzzle.groups
    .map((g, i) => g.words.some(w => normalize(w) === word) ? i : -1)
    .filter(i => i !== -1));
  if (memberships.some(indices => indices.length !== 1)) return null;
  const group = puzzle.groups.find((g, i) => !solvedGroups.includes(i) &&
    memberships.filter(indices => indices[0] === i).length === oneAwayThreshold(format));
  const colors = { 2: { square: "🟩", name: "Green" }, 3: { square: "🟦", name: "Blue" }, 4: { square: "🟥", name: "Red" } };
  return group ? colors[group.difficulty as keyof typeof colors] ?? null : null;
}
