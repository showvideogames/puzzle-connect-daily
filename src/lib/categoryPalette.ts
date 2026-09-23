/**
 * The category colours a board can be painted with — ONE list, derived from
 * the puzzle format.
 *
 * Both colouring interfaces read this:
 *   • Color Palette Mode's swatch row (GameBoard.tsx)
 *   • the per-tile double-tap colour picker (WordTile.tsx)
 *
 * They used to disagree. The palette row mapped over `format.difficultyOrder`
 * and so correctly offered Mini only Green/Blue/Red, while the picker mapped
 * over its own hardcoded four-entry array and offered Yellow on a board that
 * has no yellow category. Deriving both from the format is what stops that
 * drifting apart again: a format that uses difficulties 2-4 gets exactly
 * three swatches in both places, with nothing here special-casing Mini.
 *
 * `swatchClass` is bg-group-N — the SAME CSS custom property the solved
 * category bars use (SolvedGroup.tsx, index.css's --group-1..4), not a
 * separately hardcoded hex. Since --group-1..4 deliberately has no .dark
 * override, a swatch is the same colour in both themes with no dark: variant.
 */

import {
  DIFFICULTY_COLOR_NAME,
  type CategoryColor,
  type Difficulty,
  type PuzzleFormat,
} from "@/lib/puzzleFormat";

export interface CategorySwatch {
  /** The difficulty slot this colour belongs to (1-4). */
  difficulty: Difficulty;
  /** "yellow" | "green" | "blue" | "red". */
  color: CategoryColor;
  /** Capitalised for aria-labels and copy — "Yellow". */
  label: string;
  /** Tailwind background class, shared with the solved bars. */
  swatchClass: string;
}

/** Tailwind fill class per difficulty. The only place these are written down. */
const SWATCH_CLASS: Record<Difficulty, string> = {
  1: "bg-group-1",
  2: "bg-group-2",
  3: "bg-group-3",
  4: "bg-group-4",
};

/**
 * The colours this format offers, EASIEST FIRST — Full:
 * Yellow/Green/Blue/Red, Mini: Green/Blue/Red.
 */
export function categorySwatches(format: PuzzleFormat): CategorySwatch[] {
  return format.difficultyOrder.map((difficulty) => {
    const color = DIFFICULTY_COLOR_NAME[difficulty];
    return {
      difficulty,
      color,
      label: color.charAt(0).toUpperCase() + color.slice(1),
      swatchClass: SWATCH_CLASS[difficulty],
    };
  });
}
