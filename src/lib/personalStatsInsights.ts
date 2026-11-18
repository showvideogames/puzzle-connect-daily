import { SOLVE_ORDER_NAME, type CategoryColor, type PuzzleFormat } from './puzzleFormat';

export interface PersonalStatsInsights {
  rainbowTiming: { first: number; last: number; unknown: number };
  startingColors: { counts: Partial<Record<CategoryColor, number>>; leaders: CategoryColor[]; known: number; excluded: number };
}

/** Input is the ownership- and format-filtered completed official history. */
export function personalStatsInsights(rows: readonly { found_rainbow: unknown; rainbow_source: unknown; solve_order: unknown }[], format: PuzzleFormat): PersonalStatsInsights {
  const rainbowTiming = { first: 0, last: 0, unknown: 0 };
  const counts: Partial<Record<CategoryColor, number>> = {};
  format.colorOrder.forEach(color => { counts[color] = 0; });
  let known = 0;
  const storedNames = format.difficultyOrder.map(d => SOLVE_ORDER_NAME[d]);
  for (const row of rows) {
    if (row.found_rainbow === true) {
      if (row.rainbow_source === 'in_game') rainbowTiming.first++;
      else if (row.rainbow_source === 'post_game') rainbowTiming.last++;
      else rainbowTiming.unknown++;
    }
    const order = row.solve_order;
    // A partial order is valid after a loss; unknown, repeated, non-category,
    // or wrong-format entries make the recorded order unsuitable to count.
    if (!Array.isArray(order) || order.length === 0 || order.length > format.categoryCount ||
        new Set(order).size !== order.length || !order.every(name => storedNames.includes(name))) continue;
    const color = format.colorOrder[storedNames.indexOf(order[0])];
    counts[color] = (counts[color] ?? 0) + 1;
    known++;
  }
  const maximum = Math.max(0, ...Object.values(counts));
  return {
    rainbowTiming,
    startingColors: { counts, known, excluded: rows.length - known,
      leaders: maximum > 0 ? format.colorOrder.filter(color => counts[color] === maximum) : [] },
  };
}
