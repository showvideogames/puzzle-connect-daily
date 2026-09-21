import { puzzleFullLabel } from "./puzzles";
import { FULL_FORMAT, type PuzzleFormat } from "./puzzleFormat";

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
 * Mini adds its own identity — "Rainbow Categories Mini" as the heading, and
 * a link to the Mini Daily rather than the Full one — so a shared Mini result
 * sends a reader to the game that result came from.
 *
 * Kept deliberately plain and one-function-shaped: this is the place to
 * revise the wording later, and nothing else in the app composes these lines.
 */
export function buildOfficialShareText(
  title: string | null | undefined,
  lines: string[],
  format: PuzzleFormat = FULL_FORMAT
): string {
  if (format.id === "full") {
    const header = puzzleFullLabel(title) ?? format.shareHeading;
    return `${header}\n${lines.join("\n")}\n${OFFICIAL_SITE}`;
  }

  // A non-Full format leads with its own name so the format is unmistakable,
  // then the puzzle's own label when it has one.
  const label = puzzleFullLabel(title);
  return [
    format.shareHeading,
    ...(label ? [label] : []),
    ...lines,
    `${OFFICIAL_SITE}${format.dailyPath}`,
  ].join("\n");
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
