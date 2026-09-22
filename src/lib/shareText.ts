import { puzzleFullLabel } from "./puzzles";
import { FULL_FORMAT, type PuzzleFormat } from "./puzzleFormat";
import { miniShareDestination } from "./shareDestination";
import { shareTimeLine } from "./activeTimer";

/**
 * The site a shared result points at.
 *
 * Taken from the running origin, never a hardcoded host — the same rule
 * shareLinkText already followed — except for the official Daily footer,
 * which has always been the literal marketing domain.
 */
const OFFICIAL_SITE = "rainbowcategories.com";

/**
 * Daily / Archive / Beta result text. Its Full output is unchanged: the same
 * header line, the same rows, the same trailing rainbowcategories.com.
 *
 * A Mini result is its own shape:
 *
 *     Mini #1                 the format's name + the puzzle's own number
 *     🟩🟩🟩                  the real guess history, three symbols per row
 *     🟦🟦🟦
 *     🟥🟥🟥
 *     ⏳ 1m 30s               the solve time (format.showsTimer)
 *     rainbowcategories.com/mini   see lib/shareDestination.ts
 *
 * The ROWS are not built here — they come from the player's actual guess
 * history (GameBoard's generateShareLines), so a result with mistakes, a
 * Rainbow, hints or a loss reports exactly what happened. Nothing in this
 * module ever fabricates a clean grid.
 *
 * Kept deliberately plain and one-function-shaped: this is the place to
 * revise the wording later, and nothing else in the app composes these lines.
 */
export function buildOfficialShareText(
  title: string | null | undefined,
  lines: string[],
  format: PuzzleFormat = FULL_FORMAT,
  options: OfficialShareOptions = {}
): string {
  if (format.id === "full") {
    const header = puzzleFullLabel(title) ?? format.shareHeading;
    return `${header}\n${lines.join("\n")}\n${OFFICIAL_SITE}`;
  }

  return [
    formatShareHeading(title, format),
    ...lines,
    // The solve time, when this format shows one and the run actually
    // recorded some. Sits directly under the grid, above the link, so the
    // last line is still the address a reader types.
    ...(format.showsTimer && typeof options.activeSeconds === "number" && options.activeSeconds > 0
      ? [shareTimeLine(options.activeSeconds)]
      : []),
    shareDestinationFor(format),
  ].join("\n");
}

/**
 * The first line of a shared NON-FULL result: `Mini #1`.
 *
 * A shared result is often the only thing a reader sees, so it has to say
 * which game it came from. "#1" alone is ambiguous — the Full game numbers its
 * puzzles the same way, so a bare "#1" above a three-wide grid reads as a
 * broken Full result rather than a Mini one.
 *
 * The rule is therefore: lead with the FORMAT'S NAME, then the puzzle's own
 * display number exactly as the admin typed it.
 *
 *   "#1"        → "Mini #1"
 *   "7"         → "Mini 7"
 *   "Mini #1"   → "Mini #1"   (already named; never doubled to "Mini Mini #1")
 *   "mini #1"   → "mini #1"   (an admin's own casing is left alone)
 *   ""  / null  → "Rainbow Categories Mini"  (format.shareHeading)
 *
 * Nothing here invents or reformats a number: admins put their own numbering
 * convention in the title text ("#50", "Emoji #5" — see puzzleFullLabel), and
 * this only ever prepends the format name to whatever they wrote. Full does
 * not come through here at all; it keeps `puzzleFullLabel`'s "Puzzle #50".
 */
export function formatShareHeading(
  title: string | null | undefined,
  format: PuzzleFormat
): string {
  const trimmed = title?.trim();
  if (!trimmed) return format.shareHeading;
  // Already leads with the format's name as its own word ("Mini #1", "Mini 7")
  // — prefixing again would produce "Mini Mini #1".
  const alreadyNamed = new RegExp(`^${format.name}\\b`, "i").test(trimmed);
  return alreadyNamed ? trimmed : `${format.name} ${trimmed}`;
}

export interface OfficialShareOptions {
  /**
   * The run's active-play seconds. Printed as a `⏳ 1m 30s` line for a format
   * that shows a timer (see PuzzleFormat.showsTimer); ignored entirely by one
   * that doesn't, so a Full result is unaffected whatever is passed.
   */
  activeSeconds?: number;
}

/**
 * The public address a shared result of this format points at.
 *
 * Full's is the literal marketing domain it has always used. Mini's comes
 * from the one configurable boundary in lib/shareDestination.ts, because it
 * is expected to move to its own domain later.
 */
export function shareDestinationFor(format: PuzzleFormat): string {
  if (format.id === "full") return OFFICIAL_SITE;
  if (format.id === "mini") return miniShareDestination();
  return `${OFFICIAL_SITE}${format.dailyPath}`;
}

/**
 * The link shown in a shared custom result: the current origin's host (no
 * protocol, so it reads cleanly in a chat) plus the puzzle's own path.
 * Built from the running origin, never a hardcoded host.
 */
export function shareLinkText(origin: string, path: string): string {
  let host = origin;
  try {
    host = new URL(origin).host;
  } catch {
    // not a parseable origin: fall back to it as-is
  }
  return `${host}${path}`;
}

/** Custom-puzzle result text: real title, the real result rows, the puzzle's short link. */
export function buildCustomShareText(params: {
  title: string | null | undefined;
  lines: string[];
  origin: string;
  path: string;
  format?: PuzzleFormat;
}): string {
  const title = params.title?.trim() || "Custom Puzzle";
  const format = params.format ?? FULL_FORMAT;
  // Full keeps its exact existing first line. A Mini says so, because a
  // 3-wide grid with no explanation reads as a broken Full result.
  const heading = format.id === "full" ? "Rainbow Categories 🌈" : `${format.shareHeading} ${format.sizeLabel}`;
  return [
    heading,
    title,
    ...params.lines,
    shareLinkText(params.origin, params.path),
    "🧩 Play this puzzle! ⬆️",
  ].join("\n");
}
