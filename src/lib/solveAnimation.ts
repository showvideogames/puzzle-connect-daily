/**
 * Timings for GameBoard's correct-guess solve animation. Modelled on NYT
 * Connections' own solve (measured frame by frame from a recording): two
 * tightly linked but clearly separate beats.
 *
 *   1. GATHER — the guessed tiles swap into the top row of the board (only
 *      the tiles that have to move do; see gatherIntoFirstRow below), and
 *      the completed dark row holds for a moment (NYT: ~90ms).
 *   2. SWAP + POP — the row is replaced, in a single frame, by its solved
 *      bar: tiles hidden and the bar fully opaque in the same render, no
 *      opacity transition on either (any crossfade, even 60ms, showed up in
 *      recordings as tiles ghosting through a translucent bar). The bar is
 *      exactly one tile row (index.css .solved-bar). It arrives compressed
 *      and pops out toward the viewer as one rigid card — scale, lift and
 *      shadow together, the feel of the original Rainbow Categories pop —
 *      then settles to its exact size (.animate-solved-pop). Its words
 *      start arriving straight away as it pops.
 *   3. SETTLE — once the pop has finished, the row leaves the grid and the
 *      bar takes its place in the page, in the same spot (never mid-pop:
 *      that render stalled frames and made the card freeze, then jump).
 *      Because the bar is the row's size, the rest of the board has nothing
 *      to close up; any leftover difference glides rather than jumps.
 *
 * Reduced motion skips all of it: the bar simply appears and the row goes.
 */
export const SOLVE_GATHER_MS = 380;
/**
 * Extra hold before the swap, on top of the gather's own slow finish (its
 * easing spends its last ~100ms all but still). Together they give NYT's
 * ~90–100ms of a visibly complete row — short, so the two beats still read
 * as cause and effect.
 */
export const SOLVE_GATHER_HOLD_MS = 40;
/**
 * The bar's pop, from the swap. Must match .animate-solved-pop in index.css:
 * arrives compressed, pops out toward the viewer (peak ~135ms in, with a
 * lift and a deeper shadow), then a spring-like settle to exactly its size.
 */
export const SOLVE_POP_MS = 420;
export const SOLVE_SETTLE_MS = 320;
/** Must match .animate-solved-content-land in index.css. */
export const SOLVE_CONTENT_LAND_MS = 260;
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
