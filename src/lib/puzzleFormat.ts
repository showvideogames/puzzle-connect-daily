/**
 * Puzzle FORMAT — the one description of a board's shape.
 *
 * Rainbow Categories now ships two sizes of the same game:
 *
 *   Full  4×4 — 4 categories × 4 answers = 16 tiles, Yellow/Green/Blue/Red,
 *               optionally carrying the hidden Rainbow bonus category.
 *   Mini  3×3 — 3 categories × 3 answers =  9 tiles, Green/Blue/Red,
 *               no Rainbow today.
 *
 * They are NOT two implementations. Everything that used to hardcode "4",
 * "16", "four colours" or "three selected means one away" now reads it from
 * here, so a format is a value the shared game system is configured with
 * rather than a branch inside it.
 *
 * ── Why Mini's difficulties are 2, 3, 4 (not 1, 2, 3) ──────────────────────
 *
 * `difficulty` has always been the COLOUR key across this codebase: the share
 * squares, the `--group-N` CSS variables, `bg-group-N`, the solved bars, the
 * paint palette, `MistakeDots`' siblings, the admin preview tiles and the
 * server's `solve_order` names are all keyed on it, with
 * 1=Yellow 2=Green 3=Blue 4=Red.
 *
 * Mini's colours are Green → Blue → Red, which are already difficulties
 * 2, 3 and 4. Numbering Mini 1..3 would have meant Mini's easiest category
 * rendering Yellow everywhere, or a second colour table that had to be kept
 * in sync with the first. So a format declares WHICH difficulty values it
 * uses, in ascending order, and every colour lookup in the app keeps working
 * untouched. It also keeps `validate_puzzle_content`'s existing
 * "difficulty between 1 and 4" rule and the `1 | 2 | 3 | 4` TypeScript type
 * valid for both formats.
 *
 * ── hasRainbow is a capability, not a permanent verdict ────────────────────
 *
 * Mini has no Rainbow today. That is expressed as `hasRainbow: false` on the
 * Mini format and read through `formatOf(puzzle).hasRainbow` at every
 * decision point, rather than as `if (isMini) …` scattered around. Giving
 * Mini a bonus category later is a change to this file plus content, not a
 * re-plumbing of the game.
 */

/** The difficulty/colour slot a category occupies. Shared by both formats. */
export type Difficulty = 1 | 2 | 3 | 4;

export type CategoryColor = "yellow" | "green" | "blue" | "red";

export type PuzzleFormatId = "full" | "mini";

/**
 * Difficulty → colour. The single table; both formats index into it, which is
 * exactly why Mini reuses difficulties 2-4 (see the module comment).
 */
export const DIFFICULTY_COLOR_NAME: Record<Difficulty, CategoryColor> = {
  1: "yellow",
  2: "green",
  3: "blue",
  4: "red",
};

/**
 * Difficulty → the name written into `game_sessions.solve_order`.
 *
 * Difficulty 1 is "orange" here and nowhere else. That is a historical quirk
 * from when the easiest category WAS orange; years of stored solve_order rows
 * say "orange", and `loadStatsFromSupabase` reads them. It is preserved
 * deliberately — renaming it would silently invalidate every player's
 * "In Order" and "Hardest First" statistics.
 */
export const SOLVE_ORDER_NAME: Record<Difficulty, string> = {
  1: "orange",
  2: "green",
  3: "blue",
  4: "red",
};

export interface PuzzleFormat {
  id: PuzzleFormatId;
  /** "Full" / "Mini" — used in copy and in the builder's size selector. */
  name: string;
  /** "4×4" / "3×3" — the canonical size label. */
  sizeLabel: string;
  rows: number;
  columns: number;
  categoryCount: number;
  answersPerCategory: number;
  /** categoryCount × answersPerCategory — the number of tiles on the board. */
  tileCount: number;
  /** The difficulty values this format uses, EASIEST FIRST. */
  difficultyOrder: readonly Difficulty[];
  /** The colours of difficultyOrder, in the same order. */
  colorOrder: readonly CategoryColor[];
  maxMistakes: number;
  /**
   * Whether this format can carry a Rainbow/bonus category AT ALL. False for
   * Mini today; see the module comment on why this is a capability flag.
   */
  hasRainbow: boolean;
  /**
   * localStorage progress-key namespace. EMPTY for Full, deliberately: every
   * existing player's in-progress Full game is stored un-prefixed, and
   * prefixing it now would silently abandon those boards.
   */
  progressNamespace: string;
  /**
   * The `format` discriminator sent to the database for statistics and
   * streaks (game_sessions.format / user_streaks.format). Same string as the
   * format id; named separately because it is a stored value with a
   * compatibility contract, not just an in-memory tag.
   */
  statsNamespace: PuzzleFormatId;
  /** Where this format's Daily lives. */
  dailyPath: string;
  /** Where this format's Archive index lives. */
  archivePath: string;
  /** Where one archived puzzle of this format lives. */
  archivePuzzlePath: (puzzleId: string) => string;
  /** The heading a shared result of this format leads with. */
  shareHeading: string;
}

export const FULL_FORMAT: PuzzleFormat = {
  id: "full",
  name: "Full",
  sizeLabel: "4×4",
  rows: 4,
  columns: 4,
  categoryCount: 4,
  answersPerCategory: 4,
  tileCount: 16,
  difficultyOrder: [1, 2, 3, 4],
  colorOrder: ["yellow", "green", "blue", "red"],
  maxMistakes: 4,
  hasRainbow: true,
  progressNamespace: "",
  statsNamespace: "full",
  dailyPath: "/",
  archivePath: "/archive",
  archivePuzzlePath: (id) => `/archive/${id}`,
  shareHeading: "Rainbow Categories",
};

export const MINI_FORMAT: PuzzleFormat = {
  id: "mini",
  name: "Mini",
  sizeLabel: "3×3",
  rows: 3,
  columns: 3,
  categoryCount: 3,
  answersPerCategory: 3,
  tileCount: 9,
  // Green, Blue, Red — see the module comment on why these are 2, 3, 4.
  difficultyOrder: [2, 3, 4],
  colorOrder: ["green", "blue", "red"],
  // Four, same as Full. This is a product decision, not an inherited default:
  // it is stated here so changing it is a one-line change in one place.
  maxMistakes: 4,
  hasRainbow: false,
  progressNamespace: "mini",
  statsNamespace: "mini",
  dailyPath: "/mini",
  archivePath: "/mini/archive",
  archivePuzzlePath: (id) => `/mini/archive/${id}`,
  shareHeading: "Rainbow Categories Mini",
};

export const PUZZLE_FORMATS: Record<PuzzleFormatId, PuzzleFormat> = {
  full: FULL_FORMAT,
  mini: MINI_FORMAT,
};

export const PUZZLE_FORMAT_IDS: readonly PuzzleFormatId[] = ["full", "mini"];

export function isPuzzleFormatId(value: unknown): value is PuzzleFormatId {
  return value === "full" || value === "mini";
}

/**
 * The format for an id.
 *
 * Anything unrecognised — undefined, null, a legacy row with no format
 * column, a value from a newer build — resolves to Full. That is the whole
 * backward-compatibility contract in one line: every puzzle, progress blob,
 * draft and database row that predates formats IS a Full puzzle, and nothing
 * needs migrating to say so.
 */
export function getFormat(id: unknown): PuzzleFormat {
  return isPuzzleFormatId(id) ? PUZZLE_FORMATS[id] : FULL_FORMAT;
}

/** The format of a loaded puzzle (or anything else carrying a `format`). */
export function formatOf(source: { format?: PuzzleFormatId | null } | null | undefined): PuzzleFormat {
  return getFormat(source?.format);
}

/** Is this difficulty one this format actually uses? */
export function formatUsesDifficulty(format: PuzzleFormat, difficulty: number): boolean {
  return (format.difficultyOrder as readonly number[]).includes(difficulty);
}

/** The colour of the category sitting in `index` (0-based, easiest first). */
export function colorAt(format: PuzzleFormat, index: number): CategoryColor | null {
  return format.colorOrder[index] ?? null;
}

/**
 * The ascending solve order for this format, as `game_sessions.solve_order`
 * records it — Full: orange→green→blue→red; Mini: green→blue→red. Used by the
 * "In Order" statistic, which must compare against its OWN format's order.
 */
export function ascendingSolveOrder(format: PuzzleFormat): string[] {
  return format.difficultyOrder.map((d) => SOLVE_ORDER_NAME[d]);
}

/** The reverse of {@link ascendingSolveOrder}. */
export function descendingSolveOrder(format: PuzzleFormat): string[] {
  return ascendingSolveOrder(format).reverse();
}

/**
 * How many of a guess's answers must belong to one unsolved category for it
 * to be "One Away" — one short of a full category.
 *
 * This is the rule that used to be the literal `3` in useGame: Full is
 * 4 − 1 = 3, Mini is 3 − 1 = 2. It was never "three", it was "all but one".
 */
export function oneAwayThreshold(format: PuzzleFormat): number {
  return format.answersPerCategory - 1;
}

/** Category labels for the builder, easiest first ("Yellow"… / "Green"…). */
export function categoryColorLabels(format: PuzzleFormat): string[] {
  return format.colorOrder.map((c) => c.charAt(0).toUpperCase() + c.slice(1));
}

/**
 * Difficulty labels for the builder, easiest first. Stated per format rather
 * than derived, because "Easy"/"Hard" in a four-card ladder and "Medium" in a
 * three-card ladder are editorial words, not a computation.
 */
export function difficultyLabels(format: PuzzleFormat): string[] {
  return format.id === "mini"
    ? ["Easiest", "Medium", "Hardest"]
    : ["Easiest", "Easy", "Hard", "Hardest"];
}

/**
 * This puzzle's Rainbow answer set, or null when it has none.
 *
 * The single gate on Rainbow behaviour. It answers null for a format whose
 * `hasRainbow` is false even if a row somehow carried herring data, and for a
 * herring whose length does not match the format's category count — so the
 * board, the share grid, the hint list, the "Almost Rainbow" near-miss and
 * the bonus prompt all agree, from one rule, about whether a Rainbow exists.
 */
export function rainbowHerringFor(
  puzzle: { format?: PuzzleFormatId | null; rainbowHerring?: string[] | null } | null | undefined
): string[] | null {
  if (!puzzle) return null;
  const format = formatOf(puzzle);
  if (!format.hasRainbow) return null;
  const herring = puzzle.rainbowHerring;
  return herring && herring.length === format.categoryCount ? herring : null;
}

/**
 * The localStorage progress key body for one attempt.
 *
 * Isolation is EXPLICIT here rather than relying on puzzle ids being
 * different. Two facts make that necessary rather than merely tidy: a Beta
 * puzzle keeps its id when promoted to Published, and a format's Daily and
 * the other format's Daily are separate games a player is entitled to have
 * in progress at the same time on the same date.
 *
 * Full + official keeps the bare puzzle id — unchanged, so every already-saved
 * Full board still resumes:
 *
 *   Full   official  <id>            Mini   official  mini:<id>
 *   Full   beta      beta:<id>       Mini   beta      mini:beta:<id>
 *   Full   custom    custom:<id>     Mini   custom    mini:custom:<id>
 */
export function progressStorageId(
  puzzleId: string,
  format: PuzzleFormat,
  mode: "official" | "beta" | "custom" = "official"
): string {
  const modePrefix = mode === "official" ? "" : mode;
  return [format.progressNamespace, modePrefix, puzzleId].filter(Boolean).join(":");
}
