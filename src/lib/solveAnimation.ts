/**
 * Timings for GameBoard's correct-guess solve animation, in three beats:
 *
 *   1. GATHER — the guessed tiles swap into the top row of the board (only
 *      the tiles that have to move do; see gatherIntoFirstRow below).
 *   2. BAR — the solved bar fades in exactly over that row, at its final
 *      width and position, while the gathered tiles fade out beneath it.
 *      The bar box itself never scales or moves; only its text settles in.
 *   3. SETTLE — the row is removed and the remaining tiles (and everything
 *      below the board) slide up into the space it leaves.
 *
 * Reduced motion skips all three: the bar simply appears and the row goes.
 */
export const SOLVE_GATHER_MS = 380;
export const SOLVE_BAR_FADE_MS = 200;
/**
 * The gathered tiles fade out faster than the bar fades in over them, so the
 * tiles' own words are gone before the bar's text arrives (no two sets of
 * words ghosting over each other), and the strip of tile below the shorter
 * bar is gone well before the settle.
 */
export const SOLVE_TILE_FADE_MS = 140;
export const SOLVE_SETTLE_MS = 320;
/** Must match .animate-solved-content-land in index.css. */
export const SOLVE_CONTENT_LAND_MS = 360;
/** Shared easing for the gather and settle slides. */
export const SOLVE_EASE = "cubic-bezier(0.2, 0, 0, 1)";

/**
 * Where each tile goes when a correctly guessed category "gathers" into the
 * top row of the board, just before that row becomes its solved bar (the
 * first beat of GameBoard's solve animation — the NYT Connections move).
 *
 * Only tiles that have to move do: a solved word already in the top row
 * stays put, and every other solved word SWAPS places with one top-row word
 * that isn't part of the category. Nothing else on the board moves, so the
 * gather reads as a few clean swaps rather than the whole grid reshuffling.
 *
 * Which solved word takes which free top-row slot is chosen to keep the
 * paths short and uncrossed (the pairing with the least total grid
 * distance, ties going to reading order). With at most four words to place
 * that is at most 24 pairings to compare.
 *
 * Returns a NEW array in the new reading order, or the same order unchanged
 * when the input can't be gathered into one row (a category that isn't
 * exactly one row wide, or words missing from the board) — the caller then
 * simply skips the gather beat.
 */
export function gatherIntoFirstRow(
  order: readonly string[],
  group: readonly string[],
  columns: number,
): string[] {
  const result = [...order];
  if (columns <= 0 || group.length !== columns || order.length < columns) return result;
  const inGroup = new Set(group);
  if (!group.every((w) => order.includes(w))) return result;

  // Top-row slots that a non-category word is sitting in, and category words
  // sitting below the top row — the same count by construction.
  const freeSlots: number[] = [];
  for (let i = 0; i < columns; i++) if (!inGroup.has(order[i])) freeSlots.push(i);
  const incoming: number[] = [];
  for (let i = columns; i < order.length; i++) if (inGroup.has(order[i])) incoming.push(i);
  if (freeSlots.length === 0 || freeSlots.length !== incoming.length) return result;

  const pos = (i: number) => ({ row: Math.floor(i / columns), col: i % columns });
  const distance = (a: number, b: number) => {
    const pa = pos(a), pb = pos(b);
    return Math.hypot(pa.row - pb.row, pa.col - pb.col);
  };

  // Best assignment of incoming words to free slots (permutations are tried
  // in lexicographic order, so the first best one found keeps reading order).
  let best: number[] = incoming.map((_, k) => k);
  let bestCost = Infinity;
  const permute = (prefix: number[], rest: number[]) => {
    if (rest.length === 0) {
      const cost = prefix.reduce((sum, inc, k) => sum + distance(incoming[inc], freeSlots[k]), 0);
      if (cost < bestCost - 1e-9) { bestCost = cost; best = prefix; }
      return;
    }
    rest.forEach((r, i) => permute([...prefix, r], [...rest.slice(0, i), ...rest.slice(i + 1)]));
  };
  permute([], incoming.map((_, k) => k));

  best.forEach((inc, k) => {
    const from = incoming[inc];
    const to = freeSlots[k];
    [result[to], result[from]] = [result[from], result[to]];
  });
  return result;
}
