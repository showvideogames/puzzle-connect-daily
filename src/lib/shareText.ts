import { puzzleFullLabel } from "./puzzles";

/**
 * Daily / Archive / Beta result text. Moved verbatim out of GameBoard so it can
 * be tested; its output is unchanged.
 */
export function buildOfficialShareText(title: string | null | undefined, lines: string[]): string {
  const header = puzzleFullLabel(title) ?? "Rainbow Categories";
  return `${header}\n${lines.join("\n")}\nrainbowcategories.com`;
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
}): string {
  const title = params.title?.trim() || "Custom Puzzle";
  return [
    "Rainbow Categories 🌈",
    title,
    ...params.lines,
    shareLinkText(params.origin, params.path),
    "🧩 Play this puzzle! ⬆️",
  ].join("\n");
}
